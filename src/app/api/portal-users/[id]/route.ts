import { NextRequest } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, clientIp, ApiError,
} from "@/lib/api-helpers";

const PatchSchema = z.object({
  isActive: z.boolean().optional(),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(100).optional(),
});

// PATCH /api/portal-users/[id] — manage a CLIENT PORTAL account (§72)
// Guards:
//  • only manages portal accounts (users linked to a client) — staff accounts 404
//  • password resets are audited WITHOUT storing the password itself
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("clients.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const user = await db.user.findFirst({
      where: { id, clientId: { not: null } }, // portal accounts only
      select: { id: true, name: true, email: true, isActive: true, clientId: true },
    });
    if (!user) throw new ApiError(404, "NOT_FOUND", "Portal account not found. Staff accounts are managed in Settings → Team.");

    const data: Record<string, unknown> = {};
    const actions: string[] = [];

    if (body.isActive !== undefined && body.isActive !== user.isActive) {
      data.isActive = body.isActive;
      actions.push(body.isActive ? "PORTAL_ACCOUNT_ACTIVATED" : "PORTAL_ACCOUNT_DEACTIVATED");
    }
    if (body.newPassword) {
      data.passwordHash = await hash(body.newPassword, 10);
      actions.push("PORTAL_PASSWORD_RESET");
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, "NO_CHANGES", "Nothing to update — provide a change (status or new password).");
    }

    await db.user.update({ where: { id }, data });

    for (const action of actions) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action, entityType: "USER", entityId: user.id,
        metadata: { email: user.email, portalUser: true },
        ...(body.newPassword && action === "PORTAL_PASSWORD_RESET" ? {} : {}),
        ip: clientIp(req),
      });
    }

    return ok({ id: user.id, isActive: body.isActive ?? user.isActive, actions });
  } catch (e) {
    return handleError(e);
  }
}
