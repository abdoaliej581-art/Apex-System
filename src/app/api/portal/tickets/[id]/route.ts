import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePortal, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, createNotification, notifyRole, ApiError,
} from "@/lib/api-helpers";

// GET /api/portal/tickets/[id] — conversation thread for the client (§72)
// HARD RULES: ticket must belong to the portal user's company; INTERNAL NOTES
// (isInternal=true) are never, under any circumstance, returned to portal users.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, clientId } = await requirePortal();
    const { id } = await params;

    const ticket = await db.ticket.findFirst({
      where: { id, clientId },
      select: {
        id: true, ticketNumber: true, subject: true, description: true, category: true,
        priority: true, status: true, closedAt: true, createdAt: true, updatedAt: true,
        project: { select: { name: true, projectNumber: true } },
        assignedTo: { select: { id: true, name: true, title: true, avatarColor: true } },
      },
    });
    if (!ticket) throw new ApiError(404, "NOT_FOUND", "Ticket not found among your company's tickets.");

    const messages = await db.ticketMessage.findMany({
      where: { ticketId: id, isInternal: false }, // internal notes filtered at the query level
      orderBy: { createdAt: "asc" },
      select: { id: true, authorName: true, body: true, createdAt: true, authorId: true },
    });

    // Portal users of THIS company (colleagues included) render as client bubbles;
    // everyone else (APEX staff) renders as support bubbles.
    const companyPortalUserIds = new Set(
      (
        await db.user.findMany({
          where: { clientId, roles: { some: { key: "CLIENT" } } },
          select: { id: true },
        })
      ).map((u) => u.id)
    );

    return ok({
      ticket,
      messages: messages.map((m) => ({
        ...m,
        authorIsClient: m.authorId !== null && companyPortalUserIds.has(m.authorId),
        isMine: m.authorId === session.user.id,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

const MessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000),
});

// POST /api/portal/tickets/[id] — client replies on their own ticket
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, clientId } = await requirePortal();
    const { id } = await params;
    const body = await parseBody(req, MessageSchema);

    const ticket = await db.ticket.findFirst({
      where: { id, clientId },
      select: {
        id: true, ticketNumber: true, subject: true, status: true, assignedToId: true,
        client: { select: { companyName: true } },
      },
    });
    if (!ticket) throw new ApiError(404, "NOT_FOUND", "Ticket not found among your company's tickets.");
    if (ticket.status === "CLOSED") {
      throw new ApiError(400, "TICKET_CLOSED", "This ticket is closed. Reopen it to continue the conversation.");
    }

    const message = await db.ticketMessage.create({
      data: {
        ticketId: id,
        authorId: session.user.id,
        authorName: session.user.name,
        isInternal: false,
        body: body.body,
      },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "TICKET", entityId: id,
      title: `Client replied: ${ticket.subject}`,
      description: `${ticket.ticketNumber} — ${ticket.client.companyName} replied via the Client Portal.`,
      metadata: { viaPortal: true },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "REPLY", entityType: "TICKET", entityId: id,
      metadata: { ticketNumber: ticket.ticketNumber, viaPortal: true }, ip: clientIp(req),
    });

    // Notify the assignee (or the SUPPORT role when unassigned) — never notify the portal user themself
    const notifyPayload = {
      type: "SUPPORT",
      title: `Client reply on ${ticket.ticketNumber}`,
      body: `${session.user.name} (${ticket.client.companyName}) replied: "${body.body.slice(0, 80)}${body.body.length > 80 ? "…" : ""}"`,
      entityType: "TICKET",
      entityId: id,
    };
    if (ticket.assignedToId) {
      await createNotification({ userId: ticket.assignedToId, ...notifyPayload });
    } else {
      await notifyRole("SUPPORT", notifyPayload);
    }

    return ok({ id: message.id, createdAt: message.createdAt }, 201);
  } catch (e) {
    return handleError(e);
  }
}

const PatchSchema = z.object({
  status: z.enum(["CLOSED", "OPEN"]),
});

// PATCH /api/portal/tickets/[id] — client may close their ticket or reopen a closed one
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session, clientId } = await requirePortal();
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const ticket = await db.ticket.findFirst({
      where: { id, clientId },
      select: { id: true, ticketNumber: true, subject: true, status: true, assignedToId: true },
    });
    if (!ticket) throw new ApiError(404, "NOT_FOUND", "Ticket not found among your company's tickets.");

    if (ticket.status === body.status) {
      throw new ApiError(400, "INVALID_TRANSITION", `Ticket is already ${body.status === "CLOSED" ? "closed" : "open"}.`);
    }
    if (body.status === "OPEN" && ticket.status !== "CLOSED") {
      throw new ApiError(400, "INVALID_TRANSITION", "Only closed tickets can be reopened.");
    }

    const updated = await db.ticket.update({
      where: { id },
      data: {
        status: body.status,
        closedAt: body.status === "CLOSED" ? new Date() : null,
      },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "TICKET", entityId: id,
      title: body.status === "CLOSED" ? `Client closed ticket: ${ticket.subject}` : `Client reopened ticket: ${ticket.subject}`,
      description: `${ticket.ticketNumber} — status changed to ${body.status} via the Client Portal.`,
      metadata: { from: ticket.status, to: body.status, viaPortal: true },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "STATUS_CHANGE", entityType: "TICKET", entityId: id,
      metadata: { ticketNumber: ticket.ticketNumber, from: ticket.status, to: body.status, viaPortal: true }, ip: clientIp(req),
    });

    const notifyPayload = {
      type: "SUPPORT",
      title: body.status === "CLOSED" ? `Client closed ${ticket.ticketNumber}` : `Client reopened ${ticket.ticketNumber}`,
      body: `${session.user.name} ${body.status === "CLOSED" ? "closed" : "reopened"} "${ticket.subject}" from the Client Portal.`,
      entityType: "TICKET",
      entityId: id,
    };
    if (ticket.assignedToId) {
      await createNotification({ userId: ticket.assignedToId, ...notifyPayload });
    } else {
      await notifyRole("SUPPORT", notifyPayload);
    }

    return ok({ id: updated.id, status: updated.status, closedAt: updated.closedAt });
  } catch (e) {
    return handleError(e);
  }
}
