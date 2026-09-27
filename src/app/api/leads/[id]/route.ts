import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, createNotification, ApiError, clientIp,
} from "@/lib/api-helpers";
// Value lists (duplicated locally — Next.js route files may only export HTTP handlers)
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
const LEAD_SOURCES = ["WEBSITE", "REFERRAL", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "WHATSAPP", "EMAIL", "COLD_CALL", "EVENT", "OTHER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// ---- Zod primitives (empty string → null, keep undefined as "not provided") ----
const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const idOrNull = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().nullable().optional()
);

const numberish = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    return typeof v === "string" ? Number(v) : v;
  },
  z.number().nullable().optional()
);

const dateish = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    return typeof v === "string" || typeof v === "number" ? new Date(v) : v;
  },
  z.date().nullable().optional()
);

const actorSelect = { select: { id: true, name: true, avatarColor: true } } as const;

async function getLeadOr404(id: string) {
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) throw new ApiError(404, "NOT_FOUND", "This lead no longer exists.");
  return lead;
}

// ---- GET /api/leads/[id] — full detail with timeline ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("leads.view");
    const { id } = await params;

    const lead = await db.lead.findUnique({
      where: { id },
      include: {
        assignedTo: actorSelect,
        createdBy: actorSelect,
        followUps: {
          orderBy: { dueAt: "desc" },
          include: { assignedTo: actorSelect },
        },
        meetings: {
          orderBy: { date: "desc" },
          select: { id: true, title: true, date: true, startTime: true, endTime: true, status: true },
        },
        proposals: {
          orderBy: { createdAt: "desc" },
          select: { id: true, proposalNumber: true, title: true, status: true, total: true, createdAt: true },
        },
      },
    });
    if (!lead) throw new ApiError(404, "NOT_FOUND", "This lead no longer exists.");

    const [activities, convertedClient] = await Promise.all([
      db.activity.findMany({
        where: { entityType: "LEAD", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      lead.convertedClientId
        ? db.client.findUnique({
            where: { id: lead.convertedClientId },
            select: { id: true, companyName: true, clientNumber: true },
          })
        : Promise.resolve(null),
    ]);

    return ok({
      lead: { ...lead, convertedClient },
      activities: activities.map((a) => ({
        id: a.id, type: a.type, title: a.title, description: a.description,
        actorName: a.actorName || "System",
        actorColor: "#22d3ee",
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/leads/[id] — edit with status/assignee/follow-up side effects ----
const PatchSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters").optional(),
  contactName: z.string().trim().min(2, "Contact name must be at least 2 characters").optional(),
  phone: z.string().trim().min(7, "Phone must be at least 7 characters").optional(),
  email: optionalText(200),
  website: optionalText(300),
  instagram: optionalText(300),
  facebook: optionalText(300),
  linkedin: optionalText(300),
  industry: optionalText(120),
  location: optionalText(200),
  source: z.enum(LEAD_SOURCES).optional(),
  serviceInterest: optionalText(300),
  estimatedBudget: numberish,
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  lostReason: optionalText(1000),
  nextFollowUpAt: dateish,
  assignedToId: idOrNull,
  notes: optionalText(4000),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("leads.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const current = await getLeadOr404(id);
    if (current.deletedAt) throw new ApiError(409, "LEAD_DELETED", "This lead is deleted and cannot be edited.");

    const actor = { actorId: session.user.id, actorName: session.user.name };
    const data: Record<string, unknown> = {};

    // Plain field copies
    const plain = [
      "companyName", "contactName", "phone", "email", "website", "instagram", "facebook",
      "linkedin", "industry", "location", "source", "serviceInterest", "priority", "notes",
    ] as const;
    for (const key of plain) {
      const value = body[key];
      if (value !== undefined) data[key] = value;
    }
    if (body.estimatedBudget !== undefined) data.estimatedBudget = body.estimatedBudget;
    if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = body.nextFollowUpAt;

    // Status change
    const statusChanged = body.status !== undefined && body.status !== current.status;
    if (statusChanged) {
      if (body.status === "LOST" && !body.lostReason) {
        throw new ApiError(400, "LOST_REASON_REQUIRED", "A lost reason is required when marking a lead as lost.");
      }
      data.status = body.status;
      if (body.lostReason !== undefined) data.lostReason = body.lostReason;
      if (body.status === "WON") data.lostReason = null;
    } else if (body.lostReason !== undefined) {
      data.lostReason = body.lostReason;
    }

    // Assignee change
    const assigneeChanged = body.assignedToId !== undefined && body.assignedToId !== current.assignedToId;
    if (assigneeChanged) {
      if (body.assignedToId) {
        const assignee = await db.user.findUnique({ where: { id: body.assignedToId }, select: { id: true, name: true, isActive: true } });
        if (!assignee || !assignee.isActive) throw new ApiError(400, "INVALID_ASSIGNEE", "The selected assignee is not an active team member.");
      }
      data.assignedToId = body.assignedToId ?? null;
    }

    // Follow-up date change (for notification decision)
    const followUpSet =
      body.nextFollowUpAt !== undefined &&
      body.nextFollowUpAt !== null &&
      (current.nextFollowUpAt === null ||
        (body.nextFollowUpAt instanceof Date && current.nextFollowUpAt instanceof Date &&
          body.nextFollowUpAt.getTime() !== current.nextFollowUpAt.getTime()));

    const changedFields = Object.keys(data);
    if (changedFields.length === 0) {
      const unchanged = await db.lead.findUnique({ where: { id }, include: { assignedTo: actorSelect } });
      return ok(unchanged);
    }

    const updated = await db.lead.update({
      where: { id },
      data: data as Parameters<typeof db.lead.update>[0]["data"],
      include: { assignedTo: actorSelect },
    });

    // Activities + audit
    if (statusChanged) {
      await logActivity({
        ...actor, type: "STATUS_CHANGED", entityType: "LEAD", entityId: id,
        title: `Lead moved from ${current.status} to ${updated.status}`,
        description: updated.status === "LOST" && updated.lostReason ? `Lost reason: ${updated.lostReason}` : undefined,
      });
    }
    if (assigneeChanged) {
      await logActivity({
        ...actor, type: "UPDATED", entityType: "LEAD", entityId: id,
        title: updated.assignedTo ? `Lead assigned to ${updated.assignedTo.name}` : "Lead unassigned",
      });
      if (updated.assignedToId && updated.assignedToId !== session.user.id) {
        await createNotification({
          userId: updated.assignedToId, type: "LEAD_ASSIGNED",
          title: `Lead assigned: ${updated.companyName}`,
          body: `${updated.leadNumber} — you are now the owner of this lead.`,
          entityType: "LEAD", entityId: id,
        });
      }
    }
    if (followUpSet && updated.assignedToId && updated.assignedToId !== session.user.id) {
      await createNotification({
        userId: updated.assignedToId, type: "FOLLOWUP_SCHEDULED",
        title: `Follow-up scheduled: ${updated.companyName}`,
        body: `Next follow-up on ${updated.nextFollowUpAt ? new Date(updated.nextFollowUpAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}.`,
        entityType: "LEAD", entityId: id,
      });
    }

    await logAudit({
      ...actor, ip: clientIp(req),
      action: statusChanged ? "STATUS_CHANGE" : "UPDATE", entityType: "LEAD", entityId: id,
      metadata: { fields: changedFields, from: statusChanged ? current.status : undefined, to: statusChanged ? updated.status : undefined },
    });
    if (statusChanged) {
      await logAudit({
        ...actor, ip: clientIp(req),
        action: "UPDATE", entityType: "LEAD", entityId: id, metadata: { fields: changedFields },
      });
    }

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/leads/[id] — soft delete, hard delete if already soft-deleted ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("leads.delete");
    const { id } = await params;
    const lead = await getLeadOr404(id);

    if (lead.deletedAt === null) {
      await db.lead.update({ where: { id }, data: { deletedAt: new Date() } });
      await logAudit({
        actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
        action: "DELETE", entityType: "LEAD", entityId: id,
        metadata: { mode: "SOFT", leadNumber: lead.leadNumber, company: lead.companyName },
      });
      return ok({ soft: true });
    }

    await db.lead.delete({ where: { id } }); // cascades follow-ups
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "DELETE", entityType: "LEAD", entityId: id,
      metadata: { mode: "HARD", leadNumber: lead.leadNumber, company: lead.companyName },
    });
    return ok({ soft: false });
  } catch (e) {
    return handleError(e);
  }
}
