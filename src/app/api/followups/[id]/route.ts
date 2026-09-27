import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, createNotification, ApiError, clientIp,
} from "@/lib/api-helpers";
// Value lists (duplicated locally — Next.js route files may only export HTTP handlers)
const FOLLOWUP_STATUSES = ["PENDING", "COMPLETED", "CANCELLED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const idOrNull = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().nullable().optional()
);

const dateish = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    return typeof v === "string" || typeof v === "number" ? new Date(v) : v;
  },
  z.date().nullable().optional()
);

const includeRelations = {
  lead: { select: { id: true, companyName: true, leadNumber: true } },
  client: { select: { id: true, companyName: true, clientNumber: true } },
  assignedTo: { select: { id: true, name: true, avatarColor: true } },
} as const;

async function getFollowUpOr404(id: string) {
  const followUp = await db.followUp.findUnique({ where: { id } });
  if (!followUp) throw new ApiError(404, "NOT_FOUND", "This follow-up no longer exists.");
  return followUp;
}

// ---- PATCH /api/followups/[id] — edit + complete/cancel/reopen ----
const PatchSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters").optional(),
  dueAt: dateish,
  leadId: idOrNull,
  clientId: idOrNull,
  assignedToId: idOrNull,
  priority: z.enum(PRIORITIES).optional(),
  notes: optionalText(2000),
  status: z.enum(FOLLOWUP_STATUSES).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("followups.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const current = await getFollowUpOr404(id);
    const actor = { actorId: session.user.id, actorName: session.user.name };

    const data: Record<string, unknown> = {};

    if (body.title !== undefined) data.title = body.title;
    if (body.dueAt !== undefined) data.dueAt = body.dueAt;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.notes !== undefined) data.notes = body.notes;

    if (body.leadId !== undefined) {
      if (body.leadId) {
        const lead = await db.lead.findUnique({ where: { id: body.leadId }, select: { id: true, deletedAt: true } });
        if (!lead || lead.deletedAt) throw new ApiError(400, "INVALID_LEAD", "The selected lead no longer exists.");
      }
      data.leadId = body.leadId ?? null;
    }
    if (body.clientId !== undefined) {
      if (body.clientId) {
        const client = await db.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
        if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client no longer exists.");
      }
      data.clientId = body.clientId ?? null;
    }
    if (body.assignedToId !== undefined) {
      if (body.assignedToId) {
        const assignee = await db.user.findUnique({ where: { id: body.assignedToId }, select: { id: true, isActive: true } });
        if (!assignee || !assignee.isActive) throw new ApiError(400, "INVALID_ASSIGNEE", "The selected assignee is not an active team member.");
      }
      data.assignedToId = body.assignedToId ?? null;
    }

    // Status transitions
    const statusChanged = body.status !== undefined && body.status !== current.status;
    if (statusChanged) {
      data.status = body.status;
      if (body.status === "COMPLETED") data.completedAt = new Date();
      else data.completedAt = null;
    }

    const changedFields = Object.keys(data);
    if (changedFields.length === 0) {
      const unchanged = await db.followUp.findUnique({ where: { id }, include: includeRelations });
      return ok(unchanged);
    }

    const updated = await db.followUp.update({
      where: { id },
      data: data as Parameters<typeof db.followUp.update>[0]["data"],
      include: includeRelations,
    });

    // Activity on the related lead/client when status changed
    if (statusChanged) {
      const relatedType = updated.leadId ? "LEAD" : updated.clientId ? "CLIENT" : null;
      const relatedId = updated.leadId ?? updated.clientId ?? null;
      if (relatedType && relatedId) {
        const statusTitle =
          updated.status === "COMPLETED" ? `Follow-up completed: ${updated.title}` :
          updated.status === "CANCELLED" ? `Follow-up cancelled: ${updated.title}` :
          `Follow-up reopened: ${updated.title}`;
        await logActivity({
          ...actor, type: updated.status === "COMPLETED" ? "STATUS_CHANGED" : "UPDATED",
          entityType: relatedType, entityId: relatedId, title: statusTitle,
        });
      }
      await logAudit({
        ...actor, ip: clientIp(req),
        action: "STATUS_CHANGE", entityType: "FOLLOWUP", entityId: id,
        metadata: { title: updated.title, from: current.status, to: updated.status },
      });
    }

    // Notify new assignee when reassigned
    const assigneeChanged = body.assignedToId !== undefined && body.assignedToId !== current.assignedToId;
    if (assigneeChanged && updated.assignedToId && updated.assignedToId !== session.user.id) {
      const entityLabel = updated.lead?.companyName ?? updated.client?.companyName ?? null;
      await createNotification({
        userId: updated.assignedToId, type: "FOLLOWUP_ASSIGNED",
        title: `Follow-up assigned: ${updated.title}`,
        body: entityLabel ? `Related to ${entityLabel}.` : undefined,
        entityType: "FOLLOWUP", entityId: id,
      });
    }

    if (!statusChanged) {
      await logAudit({
        ...actor, ip: clientIp(req),
        action: "UPDATE", entityType: "FOLLOWUP", entityId: id, metadata: { fields: changedFields },
      });
    }

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/followups/[id] — hard delete (follow-ups are disposable) ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("followups.delete");
    const { id } = await params;
    const followUp = await getFollowUpOr404(id);

    await db.followUp.delete({ where: { id } });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "DELETE", entityType: "FOLLOWUP", entityId: id,
      metadata: { title: followUp.title, mode: "HARD" },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
