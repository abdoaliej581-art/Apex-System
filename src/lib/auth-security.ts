// APEX SYSTEM — authentication hardening primitives
// Shared by the credential provider, forgot-password and reset-password routes.

import crypto from "node:crypto";
import { db } from "@/lib/db";

// ---- Rate limiting (in-process) ----
// Suitable for a single-instance deployment (Vercel serverless functions are
// best-effort here; a shared store like Upstash Redis is the upgrade path).
// Always fails OPEN on error: a limiter bug must never lock out real users.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Bound memory: drop expired buckets on write so the map cannot grow unbounded.
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { allowed: true, remaining: limit - b.count, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

/** Clear a bucket after a successful action (e.g. correct password). */
export function resetLimit(key: string) {
  buckets.delete(key);
}

// ---- Password reset tokens ----

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function generateResetToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    hash: hashResetToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
}

/** Tokens are high-entropy random values, so a plain SHA-256 is the right primitive. */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function isStrongPassword(pw: string): boolean {
  if (pw.length < 8) return false;
  if (pw.length > 72) return false; // bcrypt silently truncates beyond 72 bytes
  return /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw);
}

/**
 * Consume a reset token. Returns the userId when the token is valid, unused and
 * unexpired; otherwise null. Marks the token used atomically so a token can
 * never be redeemed twice even under concurrent requests.
 */
export async function consumeResetToken(
  token: string
): Promise<{ userId: string } | null> {
  if (!token || token.length !== 64 || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = hashResetToken(token);

  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hash } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;

  const claimed = await db.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null; // lost the race — someone else redeemed it

  return { userId: row.userId };
}

/** Invalidate every outstanding token for a user (e.g. after a password change). */
export async function invalidateResetTokens(userId: string) {
  await db.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
}
