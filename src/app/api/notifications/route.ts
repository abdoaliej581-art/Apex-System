import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api-helpers";

export async function GET(_req: NextRequest) {
  try {
    const { session } = await requireAuth();
    const items = await db.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const unread = await db.notification.count({ where: { userId: session.user.id, isRead: false } });
    return ok({ items, unread });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { session } = await requireAuth();
    const body = await req.json().catch(() => ({}));
    if (body?.markAllRead) {
      await db.notification.updateMany({ where: { userId: session.user.id, isRead: false }, data: { isRead: true } });
    } else if (body?.id) {
      await db.notification.updateMany({ where: { id: body.id, userId: session.user.id }, data: { isRead: true } });
    }
    return ok({ updated: true });
  } catch (e) {
    return handleError(e);
  }
}
