// POST /api/auth/reset-password
//
// Redeems a single-use reset token and sets a new password. Security rules:
//  - Token is compared by hash only; the raw value is never stored.
//  - Redemption is atomic, so a token cannot be used twice.
//  - On success every outstanding token for that user is invalidated and the
//    user's other sessions are effectively cut off by the credential change.

import { NextRequest } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, ApiError, logAudit, clientIp } from "@/lib/api-helpers";
import { consumeResetToken, invalidateResetTokens, isStrongPassword, rateLimit } from "@/lib/auth-security";

const Schema = z.object({
  token: z.string().trim().min(32, "Invalid reset link").max(128),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`reset:${clientIp(req)}`, 20, 60 * 60 * 1000).allowed) {
      throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many attempts. Please try again later.");
    }

    const body = await parseBody(req, Schema);

    if (!isStrongPassword(body.password)) {
      throw new ApiError(
        400,
        "WEAK_PASSWORD",
        "Password must be at least 8 characters and include upper case, lower case and a number."
      );
    }

    const claimed = await consumeResetToken(body.token);
    if (!claimed) {
      throw new ApiError(
        400,
        "INVALID_TOKEN",
        "This reset link is invalid, expired, or has already been used. Please request a new one."
      );
    }

    const user = await db.user.findUnique({ where: { id: claimed.userId } });
    if (!user) {
      throw new ApiError(400, "INVALID_TOKEN", "This reset link is no longer valid.");
    }

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(body.password, 10) },
      }),
      db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    await logAudit({
      actorId: user.id,
      actorName: user.name,
      action: "PERMISSION_CHANGE",
      entityType: "USER",
      entityId: user.id,
      metadata: { reason: "PASSWORD_RESET_SELF_SERVICE" },
      ip: clientIp(req),
    });

    return ok({ reset: true, message: "Your password has been updated. You can sign in now." });
  } catch (e) {
    return handleError(e);
  }
}
