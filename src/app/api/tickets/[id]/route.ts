import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, createNotification, ApiError,
} from "@/lib/api-helpers";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const CATEGORIES = ["BUG", "CHANGE_REQUEST", "QUESTION", "FEATURE_REQUEST", "TECHNICAL_ISSUE", "OTHER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// §60 guarded transitions — reopen allowed from anywhere; closed tickets reopen only.
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["OPEN", "WAITING_CLIENT", "RESOLVED", "CLOSED"],
  WAITING_CLIENT: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "IN_PROGRESS", "CLOSED"],
  CLOSED: ["OPEN"],
};

const PatchSchema = z.object({
  subject: z.string().trim().min(3).max(200).optional(),
  description: optionalText(5000),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.string().trim().optional(),
  projectId: optionalText(40),
  assignedToId: optionalText(40),
});

// ---- GET /api/tickets/[id] ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tickets.view");
    const { id } = await params;

    const ticket = await db.ticket.findFirst({
      where: { id, deletedAt: null },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
        assignedTo: { select: { id: true, name: true, avatarColor: true } },
      },
    });
    if (!ticket) throw new ApiError(404, "NOT_FOUND", "This ticket no longer exists.");

    // Internal notes are staff-only: require tickets.edit to see them (§72, portal-ready)
    const canSeeInternal = session.user.permissions.includes("tickets.edit");
    const messages = await db.ticketMessage.findMany({
      where: { ticketId: id, ...(canSeeInternal ? {} : { isInternal: false }) },
      orderBy: { createdAt: "asc" },
      include: { ticket: { select: { id: true } } },
    });

    const activities = await db.activity.findMany({
      where: { entityType: "TICKET", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { name: true, avatarColor: true } } },
    });

    const actorIds = [...new Set(activities.map((a) => a.actorId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, avatarColor: true } })
      : [];
    const colorById = new Map(actors.map((u) => [u.id, u.avatarColor]));

    return ok({
      ticket: { ...ticket, messagesCount: messages.length },
      messages: messages.map((m) => ({
        id: m.id, body: m.body, isInternal: m.isInternal, createdAt: m.createdAt,
        authorId: m.authorId, authorName: m.authorName,
      })),
      activities: activities.map((a) => ({
        id: a.id, title: a.title, description: a.description, createdAt: a.createdAt,
        actorName: a.actorName, actorColor: a.actorId ? colorById.get(a.actorId) ?? null : null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/tickets/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tickets.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.ticket.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This ticket no longer exists.");

    const data: Record<string, unknown> = {};
    if (body.subject !== undefined) data.subject = body.subject;
    if (body.description !== undefined) data.description = body.description;
    if (body.category !== undefined) data.category = body.category;
    if (body.priority !== undefined) data.priority = body.priority;

    if (body.projectId !== undefined) {
      if (body.projectId) {
        const project = await db.project.findUnique({ where: { id: body.projectId } });
        if (!project) throw new ApiError(400, "INVALID_PROJECT", "The selected project no longer exists.");
        if (project.clientId !== existing.clientId) {
          throw new ApiError(400, "PROJECT_MISMATCH", "The selected project does not belong to this ticket's client.");
        }
      }
      data.projectId = body.projectId;
    }

    // ---- status with guarded transitions ----
    let statusChanged = false;
    if (body.status && body.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status] || [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(400, "INVALID_TRANSITION", `A ${existing.status.toLowerCase()} ticket cannot move to ${body.status.toLowerCase()}.`);
      }
      data.status = body.status;
      statusChanged = true;
      if (body.status === "CLOSED") data.closedAt = new Date();
      if (existing.status === "CLOSED" && body.status === "OPEN") data.closedAt = null;
    }

    // ---- assignment ----
    let newAssignee: { id: string; name: string } | null = null;
    if (body.assignedToId !== undefined && body.assignedToId !== existing.assignedToId) {
      if (body.assignedToId) {
        const user = await db.user.findUnique({ where: { id: body.assignedToId } });
        if (!user || !user.isActive) throw new ApiError(400, "INVALID_USER", "The assignee must be an active team member.");
        if (body.assignedToId !== session.user.id && !session.user.permissions.includes("tickets.assign")) {
          throw new ApiError(403, "FORBIDDEN", "You need tickets.assign permission to assign tickets to others.");
        }
        newAssignee = { id: user.id, name: user.name };
        data.assignedToId = body.assignedToId;
      } else {
        data.assignedToId = null;
      }
    }

    const ticket = await db.ticket.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
        assignedTo: { select: { id: true, name: true, avatarColor: true } },
      },
    });

    if (statusChanged) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "STATUS_CHANGE", entityType: "TICKET", entityId: id,
        title: `Ticket moved to ${ticket.status}: ${ticket.subject}`,
        description: `${existing.status} → ${ticket.status}`,
        metadata: { from: existing.status, to: ticket.status },
      });
    }
    if (newAssignee) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "SUPPORT", entityType: "TICKET", entityId: id,
        title: `Ticket assigned to ${newAssignee.name}: ${ticket.subject}`,
      });
      await createNotification({
        userId: newAssignee.id,
        type: "SUPPORT",
        title: `Ticket assigned to you: ${ticket.subject}`,
        body: `${session.user.name} assigned you ${ticket.ticketNumber} (${ticket.client.companyName}).`,
        entityType: "TICKET",
        entityId: id,
      });
    }
    if (body.priority && body.priority !== existing.priority) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "SUPPORT", entityType: "TICKET", entityId: id,
        title: `Ticket priority changed to ${body.priority}: ${ticket.subject}`,
        description: `${existing.priority} → ${body.priority}`,
      });
    }

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: statusChanged ? "STATUS_CHANGE" : "SUPPORT_ACTION", entityType: "TICKET", entityId: id,
      metadata: {
        changes: Object.keys(body),
        ...(statusChanged ? { from: existing.status, to: ticket.status } : {}),
      },
      ip: clientIp(req),
    });

    return ok({ ...ticket, messagesCount: undefined });
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/tickets/[id] — soft archive (§64) ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tickets.delete");
    const { id } = await params;

    const existing = await db.ticket.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This ticket no longer exists.");

    await db.ticket.update({ where: { id }, data: { deletedAt: new Date() } });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "TICKET", entityId: id,
      title: `Ticket archived: ${existing.subject}`,
      description: `${existing.ticketNumber} was archived and removed from active lists.`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "ARCHIVE", entityType: "TICKET", entityId: id,
      metadata: { ticketNumber: existing.ticketNumber, subject: existing.subject }, ip: clientIp(req),
    });

    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
