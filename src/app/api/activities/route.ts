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

    const [activitiesRaw, total] = await Promise.all([
      db.activity.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take, skip,
        select: {
          id: true, type: true, title: true, description: true,
          entityType: true, entityId: true,
          actorId: true, actorName: true, createdAt: true,
        },
      }),
      db.activity.count({ where }),
    ]);

    // Resolve actor avatarColors without the potentially-stale actor relation
    const actorIds = [...new Set(activitiesRaw.map((a) => a.actorId).filter((id): id is string => !!id))];
    const actorMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const actors = await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, avatarColor: true },
      });
      actors.forEach((u) => actorMap.set(u.id, u.avatarColor));
    }

    return ok({
      items: activitiesRaw.map((a) => ({
        id: a.id, type: a.type, title: a.title, description: a.description,
        entityType: a.entityType, entityId: a.entityId,
        actorName: a.actorName || "System",
        actorColor: (a.actorId && actorMap.get(a.actorId)) || "#22d3ee",
        createdAt: a.createdAt,
      })),
      total, page, pageSize,
    });
  } catch (e) {
    return handleError(e);
  }
}
