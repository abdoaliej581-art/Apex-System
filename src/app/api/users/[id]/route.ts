import { NextRequest } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, ApiError, logAudit, logActivity, createNotification } from "@/lib/api-helpers";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  title: z.string().trim().max(120).optional().nullable(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
  roleKeys: z.array(z.string().trim().min(1)).optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(72).optional(),
});

/** Guard: the system must always keep at least one active SUPER_ADMIN */
async function assertSuperAdminIntegrity(excludeUserId?: string) {
  const supers = await db.user.findMany({
    where: { isActive: true, roles: { some: { key: "SUPER_ADMIN" } } },
    select: { id: true },
  });
  const remaining = supers.filter((u) => u.id !== excludeUserId);
  if (remaining.length === 0) {
    throw new ApiError(400, "LAST_SUPER_ADMIN", "At least one active Super Admin must remain.");
  }
}

/** PATCH /api/users/[id] — update member, roles, password, active state (team.manage) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("team.manage");
    const { id } = await params;
    const body = await parseBody(req, patchSchema);
    const target = await db.user.findUnique({ where: { id }, include: { roles: true } });
    if (!target) throw new ApiError(404, "NOT_FOUND", "User not found.");

    // --- self-protection guards (§42 lockout prevention) ---
    if (id === session.user.id) {
      if (body.isActive === false) throw new ApiError(400, "SELF_DEACTIVATION", "You cannot deactivate your own account.");
      if (body.roleKeys) throw new ApiError(400, "SELF_ROLE_CHANGE", "You cannot change your own roles. Ask another Super Admin.");
      if (body.newPassword) throw new ApiError(400, "SELF_PASSWORD", "Reset your password from the login screen instead.");
    }

    const roleKeysChanged = body.roleKeys !== undefined;
    let connectedRoles: { id: string }[] = [];
    if (roleKeysChanged) {
      const roles = await db.role.findMany({ where: { key: { in: body.roleKeys } } });
      if (roles.length === 0) throw new ApiError(400, "INVALID_ROLES", "No valid roles were provided.");
      connectedRoles = roles.map((r) => ({ id: r.id }));
      // if target currently holds SUPER_ADMIN and new set drops it — keep integrity
      const hadSuper = target.roles.some((r) => r.key === "SUPER_ADMIN");
      const keepsSuper = roles.some((r) => r.key === "SUPER_ADMIN");
      if (hadSuper && !keepsSuper && target.isActive) await assertSuperAdminIntegrity();
    }
    if (body.isActive === false && target.isActive && target.roles.some((r) => r.key === "SUPER_ADMIN")) {
      await assertSuperAdminIntegrity(id);
    }

    const previousRoleKeys = target.roles.map((r) => r.key);
    const user = await db.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.title !== undefined ? { title: body.title || null } : {}),
        ...(body.avatarColor !== undefined ? { avatarColor: body.avatarColor } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.newPassword ? { passwordHash: await hash(body.newPassword, 10) } : {}),
        ...(roleKeysChanged ? { roles: { set: connectedRoles } } : {}),
      },
      select: { id: true, name: true, email: true, title: true, avatarColor: true, isActive: true, roles: { select: { key: true, label: true } } },
    });

    // --- audit + notifications ---
    if (roleKeysChanged) {
      const granted = user.roles.map((r) => r.key).filter((k) => !previousRoleKeys.includes(k));
      const revoked = previousRoleKeys.filter((k) => !user.roles.map((r) => r.key).includes(k));
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "PERMISSION_CHANGE", entityType: "USER", entityId: id,
        metadata: { email: user.email, granted, revoked },
      });
      await createNotification({
        userId: id, type: "PERMISSIONS",
        title: "Your access was updated",
        body: `Roles changed by ${session.user.name}. Sign out and back in to refresh your permissions.`,
        entityType: "USER", entityId: id,
      });
    }
    if (body.newPassword) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "PERMISSION_CHANGE", entityType: "USER", entityId: id,
        metadata: { email: user.email, passwordReset: true },
      });
    }
    if (body.isActive === false) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "USER", entityId: id,
        metadata: { email: user.email, deactivated: true },
      });
    } else if (!roleKeysChanged && !body.newPassword && body.isActive === undefined) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "USER", entityId: id,
        metadata: { email: user.email },
      });
    }
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "UPDATED", entityType: "USER", entityId: id,
      title: `Team member updated: ${user.name}`,
      description: roleKeysChanged
        ? `Roles now: ${user.roles.map((r) => r.label).join(", ")}`
        : body.newPassword ? "Password was reset" : body.isActive === false ? "Account deactivated" : "Profile updated",
    });

    return ok({ user });
  } catch (e) {
    return handleError(e);
  }
}
