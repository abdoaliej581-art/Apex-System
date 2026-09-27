import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, createNotification, ApiError,
} from "@/lib/api-helpers";

const MessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000),
  isInternal: z.boolean().default(false),
});

// ---- POST /api/tickets/[id]/messages ----
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tickets.edit");
    const { id } = await params;
    const body = await parseBody(req, MessageSchema);

    const ticket = await db.ticket.findFirst({
      where: { id, deletedAt: null },
      include: { client: { select: { companyName: true } } },
    });
    if (!ticket) throw new ApiError(404, "NOT_FOUND", "This ticket no longer exists.");

    if (ticket.status === "CLOSED") {
      throw new ApiError(400, "TICKET_CLOSED", "Reopen the ticket before adding messages.");
    }

    const message = await db.ticketMessage.create({
      data: {
        ticketId: id,
        authorId: session.user.id,
        authorName: session.user.name,
        isInternal: body.isInternal,
        body: body.body,
      },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "TICKET", entityId: id,
      title: body.isInternal
        ? `Internal note added on ${ticket.ticketNumber}`
        : `Reply sent on ${ticket.ticketNumber}`,
      description: ticket.subject,
      metadata: { isInternal: body.isInternal },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: body.isInternal ? "INTERNAL_NOTE" : "REPLY", entityType: "TICKET", entityId: id,
      metadata: { ticketNumber: ticket.ticketNumber }, ip: clientIp(req),
    });

    // Notify the assignee when someone else writes on their ticket
    if (ticket.assignedToId && ticket.assignedToId !== session.user.id) {
      await createNotification({
        userId: ticket.assignedToId,
        type: "SUPPORT",
        title: body.isInternal ? `Internal note on ${ticket.ticketNumber}` : `New reply on ${ticket.ticketNumber}`,
        body: `${session.user.name}: ${body.body.slice(0, 120)}${body.body.length > 120 ? "…" : ""}`,
        entityType: "TICKET",
        entityId: id,
      });
    }

    return ok({
      id: message.id, body: message.body, isInternal: message.isInternal,
      createdAt: message.createdAt, authorId: message.authorId, authorName: message.authorName,
    }, 201);
  } catch (e) {
    return handleError(e);
  }
}
