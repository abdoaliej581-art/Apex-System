import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ok, handleError, ApiError } from "@/lib/api-helpers";

/** PATCH /api/notifications/[id] — mark a single notification as read */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requireAuth();
    const { id } = await params;

    const notification = await db.notification.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!notification) throw new ApiError(404, "NOT_FOUND", "Notification not found.");

    await db.notification.update({ where: { id }, data: { isRead: true } });
    return ok({ updated: true });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/notifications/[id] — dismiss (delete) a single notification */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requireAuth();
    const { id } = await params;

    const notification = await db.notification.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!notification) throw new ApiError(404, "NOT_FOUND", "Notification not found.");

    await db.notification.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
