import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, paginationFrom } from "@/lib/api-helpers";

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return { raw }; }
}

function parseDate(v: string | null, endOfDay = false): Date | null {
  if (!v) return null;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00.000Z` : v);
  if (isNaN(d.getTime())) return null;
  if (endOfDay && v.length <= 10) d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * GET /api/audit — full traceability of sensitive actions (§66).
 * Filters: q (actor name), action, entityType, from, to. Also returns a filter
 * summary (distinct actions/entityTypes, top actors, events today).
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("audit.view");
    const { take, skip, page, pageSize, sp } = paginationFrom(req);

    const from = parseDate(sp.get("from"));
    const to = parseDate(sp.get("to"), true);
    const q = sp.get("q")?.trim();

    const where = {
      ...(sp.get("entityType") ? { entityType: sp.get("entityType")! } : {}),
      ...(sp.get("action") ? { action: sp.get("action")! } : {}),
      ...(q ? { actorName: { contains: q } } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [items, total, actions, entityTypes, topActors, today] = await Promise.all([
      db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
      db.auditLog.count({ where }),
      db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
      db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
      db.auditLog.groupBy({
        by: ["actorName"],
        _count: { _all: true },
        where: { actorName: { not: null } },
        orderBy: { _count: { actorName: "desc" } },
        take: 5,
      }),
      db.auditLog.count({ where: { createdAt: { gte: startOfDay } } }),
    ]);

    return ok({
      items: items.map((i) => ({
        id: i.id,
        actorId: i.actorId,
        actorName: i.actorName,
        action: i.action,
        entityType: i.entityType,
        entityId: i.entityId,
        metadata: parseMetadata(i.metadata),
        ip: i.ip,
        createdAt: i.createdAt,
      })),
      total, page, pageSize,
      summary: {
        today,
        actions: actions.map((a) => a.action).filter(Boolean),
        entityTypes: entityTypes.map((e) => e.entityType).filter(Boolean),
        topActors: topActors.map((t) => ({ actorName: t.actorName, count: t._count._all })),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
