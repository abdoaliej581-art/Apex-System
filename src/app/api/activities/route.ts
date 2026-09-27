import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, paginationFrom } from "@/lib/api-helpers";

/**
 * Global activity feed (§67) — filterable, paginated.
 * Filters: entityType, q (title/description contains).
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("activities.view");
    const { take, skip, page, pageSize, sp } = paginationFrom(req);
    const entityType = sp.get("entityType");
    const q = sp.get("q")?.trim();

    const where = {
      ...(entityType ? { entityType } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
            ],
          }
        : {}),
    };

    const [activities, total] = await Promise.all([
      db.activity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take, skip,
        include: { actor: { select: { name: true, avatarColor: true } } },
      }),
      db.activity.count({ where }),
    ]);

    return ok({
      items: activities.map((a) => ({
        id: a.id, type: a.type, title: a.title, description: a.description,
        entityType: a.entityType, entityId: a.entityId,
        actorName: a.actor?.name || a.actorName || "System",
        actorColor: a.actor?.avatarColor || "#22d3ee",
        createdAt: a.createdAt,
      })),
      total, page, pageSize,
    });
  } catch (e) {
    return handleError(e);
  }
}
