import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, ApiError, logAudit, createNotification } from "@/lib/api-helpers";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const patchSchema = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.string().trim().min(1)).min(1, "Select at least one permission").optional(),
});

async function getRole(id: string) {
  const role = await db.role.findUnique({ where: { id }, include: { users: { select: { id: true } } } });
  if (!role) throw new ApiError(404, "NOT_FOUND", "Role not found.");
  return role;
}

/** PATCH /api/roles/[id] — rename / edit permission matrix (permissions.manage) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("permissions.manage");
    const { id } = await params;
    const body = await parseBody(req, patchSchema);
    const role = await getRole(id);

    let granted: string[] = [];
    let revoked: string[] = [];
    if (body.permissions !== undefined) {
      const invalid = body.permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
      if (invalid.length) throw new ApiError(400, "INVALID_PERMISSIONS", `Unknown permissions: ${invalid.slice(0, 3).join(", ")}`);
      const previous = (() => { try { return JSON.parse(role.permissions) as string[]; } catch { return []; } })();
      granted = body.permissions.filter((p) => !previous.includes(p));
      revoked = previous.filter((p) => !body.permissions!.includes(p));
      // integrity: the acting user must not strip permissions from a role they rely on
      const actorRoles = await db.user.findUnique({
        where: { id: session.user.id }, select: { roles: { select: { key: true } } },
      });
      if (actorRoles?.roles.some((r) => r.key === role.key) && revoked.includes("permissions.manage")) {
        throw new ApiError(400, "SELF_LOCKOUT", "You cannot remove permissions.manage from a role you hold yourself.");
      }
    }

    const updated = await db.role.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.permissions !== undefined ? { permissions: JSON.stringify(body.permissions) } : {}),
      },
      include: { _count: { select: { users: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "PERMISSION_CHANGE", entityType: "ROLE", entityId: id,
      metadata: {
        key: role.key, label: updated.label,
        granted, revoked,
        totalPermissions: body.permissions?.length ?? undefined,
      },
    });
    // tell affected members to refresh their session
    if (granted.length || revoked.length) {
      const members = await db.user.findMany({ where: { roles: { some: { id } } }, select: { id: true } });
      await Promise.all(members.filter((m) => m.id !== session.user.id).map((m) =>
        createNotification({
          userId: m.id, type: "PERMISSIONS",
          title: "Your role permissions changed",
          body: `Role “${updated.label}” was updated by ${session.user.name}. Sign out and back in to refresh.`,
          entityType: "ROLE", entityId: id,
        })
      ));
    }

    return ok({
      role: {
        ...updated,
        permissions: (() => { try { return JSON.parse(updated.permissions) as string[]; } catch { return []; } })(),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/roles/[id] — delete a custom role (permissions.manage) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("permissions.manage");
    const { id } = await params;
    const role = await getRole(id);
    if (role.isSystem) throw new ApiError(400, "SYSTEM_ROLE", "System roles cannot be deleted.");
    if (role.users.length > 0) {
      throw new ApiError(400, "ROLE_IN_USE", `This role is assigned to ${role.users.length} user(s). Reassign them first.`);
    }

    await db.role.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "ROLE", entityId: id,
      metadata: { key: role.key, label: role.label },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
