// APEX SYSTEM — role-targeted outbound email
// Used by the automation engine (EMAIL_ROLE action) and internal alerts.

import { db } from "@/lib/db";
import { sendMail, layout, p, keyValues, isMailConfigured } from "@/lib/mailer";

/**
 * Send one email to every active member of a role.
 * Never throws — a failing internal alert must not break the business operation.
 */
export async function sendRoleEmail(
  roleKey: string,
  subject: string,
  bodyText?: string
): Promise<{ sent: number; skipped?: boolean }> {
  try {
    if (!isMailConfigured()) {
      console.warn("[role-mail] SMTP not configured — skipped:", subject);
      return { sent: 0, skipped: true };
    }
    const users = await db.user.findMany({
      where: { isActive: true, roles: { some: { key: roleKey } } },
      select: { email: true, name: true },
    });
    const emails = users.map((u) => u.email).filter(Boolean);
    if (emails.length === 0) return { sent: 0 };

    const html = layout({
      title: subject.replace(/^\[APEX\]\s*/, ""),
      preheader: subject,
      body:
        p(bodyText || "An automated event happened in APEX SYSTEM that needs your attention.") +
        keyValues([["Event", "Automation"], ["Role notified", roleKey], ["Recipients", String(emails.length)]]),
    });

    const r = await sendMail({ to: emails, subject, html });
    return { sent: r.sent ? emails.length : 0 };
  } catch (e) {
    console.error("[role-mail] failed:", e instanceof Error ? e.message : e);
    return { sent: 0 };
  }
}
