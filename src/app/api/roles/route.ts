import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, requirePermission, ok, parseBody, handleError, ApiError, logAudit } from "@/lib/api-helpers";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const createSchema = z.object({
  key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,39}$/, "Key must be UPPER_SNAKE_CASE (3-40 chars)"),
  label: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  permissions: z.array(z.string().trim().min(1)).min(1, "Select at least one permission"),
});

function slugifyKey(key: string) {
  return key.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** GET /api/roles — roles with parsed permissions + user counts (settings.manage) */
export async function GET(_req: NextRequest) {
  try {
    const { session } = await requireAuth();
    const perms = session.user.permissions || [];
    if (!perms.includes("settings.manage") && !perms.includes("permissions.manage")) {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action.");
    }
    const roles = await db.role.findMany({
      orderBy: [{ isSystem: "desc" }, { label: "asc" }],
      include: { _count: { select: { users: true } } },
    });
    return ok({
      roles: roles.map((r) => ({
        id: r.id, key: r.key, label: r.label, description: r.description,
        isSystem: r.isSystem, userCount: r._count.users,
        permissions: (() => { try { return JSON.parse(r.permissions) as string[]; } catch { return []; } })(),
      })),
      allPermissions: ALL_PERMISSIONS,
    });
  } catch (e) {
    return handleError(e);
  }
}

/** POST /api/roles — create a custom role (permissions.manage) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("permissions.manage");
    const body = await parseBody(req, createSchema);
    const key = slugifyKey(body.key);

    const existing = await db.role.findUnique({ where: { key } });
    if (existing) throw new ApiError(409, "KEY_TAKEN", "A role with this key already exists.");

    const invalid = body.permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (invalid.length) throw new ApiError(400, "INVALID_PERMISSIONS", `Unknown permissions: ${invalid.slice(0, 3).join(", ")}`);

    const role = await db.role.create({
      data: {
        key, label: body.label, description: body.description || null,
        permissions: JSON.stringify(body.permissions),
        isSystem: false,
      },
      include: { _count: { select: { users: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "ROLE", entityId: role.id,
      metadata: { key, label: body.label, permissionCount: body.permissions.length },
    });

    return ok({ role: { ...role, permissions: body.permissions } }, 201);
  } catch (e) {
    return handleError(e);
  }
}
