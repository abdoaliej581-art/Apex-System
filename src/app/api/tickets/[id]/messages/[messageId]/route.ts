import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, logAudit, clientIp, ApiError,
} from "@/lib/api-helpers";

// ---- DELETE /api/tickets/[id]/messages/[messageId] — author or tickets.delete ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const { session } = await requirePermission("tickets.edit");
    const { id, messageId } = await params;

    const message = await db.ticketMessage.findUnique({ where: { id: messageId } });
    if (!message || message.ticketId !== id) {
      throw new ApiError(404, "NOT_FOUND", "This message no longer exists.");
    }

    const isAuthor = message.authorId === session.user.id;
    const canDeleteAny = session.user.permissions.includes("tickets.delete");
    if (!isAuthor && !canDeleteAny) {
      throw new ApiError(403, "FORBIDDEN", "You can only delete your own messages.");
    }

    await db.ticketMessage.delete({ where: { id: messageId } });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "TICKET_MESSAGE", entityId: messageId,
      metadata: { ticketId: id, isInternal: message.isInternal }, ip: clientIp(req),
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
