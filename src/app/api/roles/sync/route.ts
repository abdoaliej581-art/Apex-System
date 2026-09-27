import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, logAudit, clientIp } from "@/lib/api-helpers";
import { DEFAULT_ROLES } from "@/lib/permissions";

/**
 * POST /api/roles/sync
 * Re-syncs all system role permissions from the DEFAULT_ROLES constant in
 * permissions.ts to the database. Only affects system roles (isSystem=true).
 * Requires: permissions.manage
 *
 * Use this when:
 *  - permissions.ts has been updated but the DB has not been re-seeded
 *  - A team member reports 403 on a view they should have access to
 */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("permissions.manage");

    const results: { key: string; updated: boolean; permissionCount: number }[] = [];

    for (const role of DEFAULT_ROLES) {
      const updated = await db.role.updateMany({
        where: { key: role.key, isSystem: true },
        data: {
          label: role.label,
          description: role.description,
          permissions: JSON.stringify(role.permissions),
        },
      });
      results.push({
        key: role.key,
        updated: updated.count > 0,
        permissionCount: role.permissions.length,
      });
    }

    await logAudit({
      actorId: session.user.id,
      actorName: session.user.name,
      action: "PERMISSION_CHANGE",
      entityType: "ROLE",
      entityId: null,
      metadata: {
        action: "BULK_SYNC",
        rolesUpdated: results.filter((r) => r.updated).length,
        rolesTotal: results.length,
      },
      ip: clientIp(req),
    });

    return ok({
      synced: true,
      results,
      message: `Synced ${results.filter((r) => r.updated).length} of ${results.length} system roles.`,
    });
  } catch (e) {
    return handleError(e);
  }
}
