// POST /api/auth/forgot-password
//
// Security contract:
//  - Always returns 200 with the same body, whether or not the email exists.
//    Returning a different status for unknown emails would let an attacker
//    enumerate which team members / client portal users have accounts.
//  - The reset link is emailed, never returned in the response.
//  - Rate limited per email AND per IP to stop mail-bombing.

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, clientIp } from "@/lib/api-helpers";
import { generateResetToken, rateLimit } from "@/lib/auth-security";
import { sendMail, layout, p, callout, escapeHtml } from "@/lib/mailer";
import { isMailConfigured } from "@/lib/mailer";

const Schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
});

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, Schema);
    const ip = clientIp(req);

    // 5 requests/hour per email, 20/hour per IP.
    if (!rateLimit(`forgot-email:${body.email}`, 5, 60 * 60 * 1000).allowed) return generic();
    if (!rateLimit(`forgot-ip:${ip}`, 20, 60 * 60 * 1000).allowed) return generic();

    // Silently succeed even when SMTP is not configured — the response must not
    // reveal infrastructure state. The server log carries the reason.
    if (!isMailConfigured()) {
      console.warn("[forgot-password] SMTP not configured — reset link not sent");
      return generic();
    }

    const user = await db.user.findUnique({
      where: { email: body.email },
      include: { roles: { select: { key: true } } },
    });

    // Deactivated accounts get no email, but the response is identical.
    if (!user || !user.isActive) return generic();

    // Supersede any earlier unused token so only the newest link works.
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { token, hash, expiresAt } = generateResetToken();
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt },
    });

    const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
    const link = `${base}/#/reset-password?token=${token}`;

    const isPortal = user.roles.some((r) => r.key === "CLIENT");
    const mail = layout({
      title: "Reset your password",
      preheader: "A password reset link for your APEX account",
      body:
        p(`Hi <strong>${escapeHtml(user.name)}</strong>,`) +
        p(
          `We received a request to reset the password for <strong>${escapeHtml(user.email)}</strong> on APEX${
            isPortal ? " client portal" : ""
          }.`
        ) +
        callout(
          `This link expires in <strong>1 hour</strong> and can only be used once.`,
          "warn"
        ) +
        p(
          "If you did not request this, you can safely ignore this email — your password will not change."
        ),
    });

    const sent = await sendMail({
      to: user.email,
      subject: "Reset your APEX password",
      html:
        mail.replace(
          "<!--CTA-->",
          ""
        ) +
        `<p style="margin:24px 0 0;"><a href="${escapeHtml(link)}" style="display:inline-block;background:linear-gradient(135deg,#22d3ee,#0284c7);color:#06202a;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:9px;">Reset password</a></p>
         <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;word-break:break-all;">Or paste this link into your browser:<br>${escapeHtml(link)}</p>`,
    });

    if (!sent.sent) {
      // Do not leave a usable token behind when we could not deliver it.
      await db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }

    return generic();
  } catch (e) {
    return handleError(e);
  }
}

/** The one and only response shape — identical for every case. */
function generic() {
  return ok({
    sent: true,
    message: "If an account exists for that email, a reset link is on its way.",
  });
}
