import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, createNotification, ApiError, clientIp,
} from "@/lib/api-helpers";

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

// ---- GET /api/followups?status=&assignedToId=&from=&to=&page= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("followups.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const status = sp.get("status") || "";
    const assignedToId = sp.get("assignedToId") || "";
    const from = sp.get("from");
    const to = sp.get("to");

    const where: Prisma.FollowUpWhereInput = {};
    const statusList = status.split(",").map((s) => s.trim()).filter(Boolean) as string[];
    if (statusList.length > 0) where.status = { in: statusList };
    if (assignedToId) where.assignedToId = assignedToId;
    if (from || to) {
      where.dueAt = {};
      if (from && !Number.isNaN(new Date(from).getTime())) where.dueAt.gte = new Date(from);
      if (to && !Number.isNaN(new Date(to).getTime())) where.dueAt.lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      db.followUp.findMany({
        where,
        orderBy: { dueAt: "asc" },
        skip,
        take,
        include: includeRelations,
      }),
      db.followUp.count({ where }),
    ]);

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/followups ----
const CreateSchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters"),
  dueAt: z.preprocess(
    (v) => (typeof v === "string" || typeof v === "number" ? new Date(v) : v),
    z.date({ message: "Due date is required" })
  ),
  leadId: idOrNull,
  clientId: idOrNull,
  assignedToId: idOrNull,
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  notes: optionalText(2000),
});

export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("followups.create");
    const body = await parseBody(req, CreateSchema);

    if (body.leadId) {
      const lead = await db.lead.findUnique({ where: { id: body.leadId }, select: { id: true, deletedAt: true } });
      if (!lead || lead.deletedAt) throw new ApiError(400, "INVALID_LEAD", "The selected lead no longer exists.");
    }
    if (body.clientId) {
      const client = await db.client.findUnique({ where: { id: body.clientId }, select: { id: true } });
      if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client no longer exists.");
    }
    if (body.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: body.assignedToId }, select: { id: true, isActive: true } });
      if (!assignee || !assignee.isActive) throw new ApiError(400, "INVALID_ASSIGNEE", "The selected assignee is not an active team member.");
    }

    const followUp = await db.followUp.create({
      data: {
        title: body.title,
        dueAt: body.dueAt,
        leadId: body.leadId ?? null,
        clientId: body.clientId ?? null,
        assignedToId: body.assignedToId ?? null,
        priority: body.priority,
        notes: body.notes ?? null,
      },
      include: includeRelations,
    });

    const relatedType = body.leadId ? "LEAD" : body.clientId ? "CLIENT" : null;
    const relatedId = body.leadId ?? body.clientId ?? null;
    const entityLabel = followUp.lead?.companyName ?? followUp.client?.companyName ?? null;
    if (relatedType && relatedId) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "UPDATED", entityType: relatedType, entityId: relatedId,
        title: `Follow-up scheduled: ${followUp.title}`,
        description: entityLabel ? `Due ${followUp.dueAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : undefined,
      });
    }

    if (body.assignedToId && body.assignedToId !== session.user.id) {
      await createNotification({
        userId: body.assignedToId, type: "FOLLOWUP_ASSIGNED",
        title: `New follow-up: ${followUp.title}`,
        body: entityLabel ? `Related to ${entityLabel}. Due ${followUp.dueAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.` : undefined,
        entityType: "FOLLOWUP", entityId: followUp.id,
      });
    }

    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "CREATE", entityType: "FOLLOWUP", entityId: followUp.id,
      metadata: { title: followUp.title, leadId: body.leadId, clientId: body.clientId },
    });

    return ok(followUp, 201);
  } catch (e) {
    return handleError(e);
  }
}
