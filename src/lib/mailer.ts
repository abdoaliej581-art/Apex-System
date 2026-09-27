// APEX SYSTEM — Outbound email
// SMTP transport configured from environment variables. Works with any provider:
// Resend, SendGrid, Mailgun, Gmail, or Supabase's own SMTP relay.
//
// Design rules:
//  - Never throw into a business flow. Every send is wrapped and logged; a failed
//    email must never roll back or fail an invoice / payment / ticket (§53).
//  - Credentials are only read server-side; nothing secret reaches the client.
//  - When SMTP is not configured, sends are skipped (dev mode) instead of erroring.

import nodemailer, { type Transporter } from "nodemailer";

// ---- Configuration ----

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  replyTo?: string;
};

export function mailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!host || !user || !pass || !from) return null;

  const port = Number(process.env.SMTP_PORT || 465);
  return {
    host,
    port,
    // Port 465 is implicit TLS; 587/2525 uses STARTTLS.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    user,
    pass,
    from,
    fromName: process.env.MAIL_FROM_NAME?.trim() || "APEX SYSTEM",
    replyTo: process.env.MAIL_REPLY_TO?.trim() || undefined,
  };
}

export function isMailConfigured(): boolean {
  return mailConfig() !== null;
}

// ---- Transport (lazy singleton — never connects at import time) ----

let cached: Transporter | null = null;
let cachedKey = "";

function transport(): Transporter | null {
  const cfg = mailConfig();
  if (!cfg) return null;
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (cached && cachedKey === key) return cached;
  cached = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  cachedKey = key;
  return cached;
}

export type SendResult = { sent: boolean; skipped?: boolean; id?: string; error?: string };

/** Low-level send. Never throws. */
export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}): Promise<SendResult> {
  const cfg = mailConfig();
  if (!cfg) {
    console.warn("[mail] SMTP not configured — email skipped:", opts.subject);
    return { sent: false, skipped: true };
  }
  // Reject obviously invalid addresses before hitting the provider.
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((r) => r.trim())
    .filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));
  if (recipients.length === 0) {
    console.warn("[mail] no valid recipients — skipped:", opts.subject);
    return { sent: false, skipped: true, error: "NO_VALID_RECIPIENT" };
  }

  try {
    const info = await transport()!.sendMail({
      from: { name: cfg.fromName, address: cfg.from },
      to: recipients,
      cc: opts.cc,
      bcc: opts.bcc,
      replyTo: opts.replyTo || cfg.replyTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? stripHtml(opts.html),
    });
    return { sent: true, id: info.messageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[mail] send failed:", message, "| subject:", opts.subject);
    // Reset the cached transport so the next attempt reconnects.
    cached = null;
    cachedKey = "";
    return { sent: false, error: message };
  }
}

// ---- HTML template ----

export const BRAND = {
  cyan: "#22d3ee",
  deep: "#06202a",
  bg: "#0a1120",
  panel: "#0f172a",
  border: "#1e293b",
  text: "#e2e8f0",
  muted: "#94a3b8",
};

const money = (amount: number, currency: string) =>
  `${currency} ${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateFmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Wrap content in the APEX branded layout. */
export function layout(opts: { title: string; preheader?: string; body: string; cta?: { label: string; url: string } }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader ?? opts.title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${BRAND.panel};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;">
    <tr><td style="padding:22px 28px;border-bottom:1px solid ${BRAND.border};">
      <table role="presentation" width="100%"><tr>
        <td><span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;border-radius:9px;background:linear-gradient(135deg,#22d3ee,#0284c7);color:${BRAND.deep};font-weight:800;font-size:19px;">A</span>
            <span style="margin-left:10px;font-size:15px;font-weight:800;letter-spacing:2.5px;color:#ffffff;">APEX</span></td>
        <td align="right"><span style="font-size:10px;letter-spacing:2px;color:${BRAND.muted};">SYSTEM</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px;">
      <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#ffffff;font-weight:700;">${escapeHtml(opts.title)}</h1>
      <div style="font-size:15px;line-height:1.65;color:${BRAND.text};">${opts.body}</div>
      ${opts.cta ? `<div style="margin:26px 0 4px;"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:linear-gradient(135deg,#22d3ee,#0284c7);color:${BRAND.deep};text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:9px;">${escapeHtml(opts.cta.label)}</a></div>` : ""}
    </td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid ${BRAND.border};">
      <p style="margin:0;font-size:11px;line-height:1.6;color:${BRAND.muted};">
        APEX SYSTEM — One System. One Workflow.<br>
        This is an automated message. Please do not reply to this email.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// ---- Reusable content blocks ----

export function p(text: string): string {
  return `<p style="margin:0 0 14px;">${text}</p>`;
}

export function keyValues(rows: [string, string][]): string {
  const body = rows
    .map(([k, v]) => `<tr>
      <td style="padding:9px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted};font-size:13px;width:45%;">${escapeHtml(k)}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${BRAND.border};color:#ffffff;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(v)}</td>
    </tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${body}</table>`;
}

export function itemsTable(items: { description: string; quantity: number; unitPrice: number; total: number }[]): string {
  const rows = items
    .map(
      (it) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.text};font-size:14px;">${escapeHtml(it.description)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted};font-size:13px;text-align:center;width:70px;">${it.quantity}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted};font-size:13px;text-align:right;width:110px;">${escapeHtml(money(it.unitPrice, ""))}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};color:#ffffff;font-size:14px;font-weight:600;text-align:right;width:120px;">${escapeHtml(money(it.total, ""))}</td>
    </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
    <tr>
      <td style="padding:0 0 8px;color:${BRAND.muted};font-size:11px;letter-spacing:1px;text-transform:uppercase;">Description</td>
      <td style="padding:0 0 8px;color:${BRAND.muted};font-size:11px;letter-spacing:1px;text-transform:uppercase;text-align:center;">Qty</td>
      <td style="padding:0 0 8px;color:${BRAND.muted};font-size:11px;letter-spacing:1px;text-align:uppercase;text-align:right;">Price</td>
      <td style="padding:0 0 8px;color:${BRAND.muted};font-size:11px;letter-spacing:1px;text-transform:uppercase;text-align:right;">Total</td>
    </tr>
    ${rows}
  </table>`;
}

export function callout(text: string, tone: "info" | "warn" | "ok" = "info"): string {
  const colors = {
    info: ["rgba(34,211,238,0.08)", "#22d3ee"],
    warn: ["rgba(251,191,36,0.08)", "#fbbf24"],
    ok: ["rgba(52,211,153,0.08)", "#34d399"],
  }[tone];
  return `<div style="margin:18px 0;padding:14px 16px;background:${colors[0]};border-left:3px solid ${colors[1]};border-radius:8px;font-size:14px;color:${BRAND.text};">${text}</div>`;
}

export { money, dateFmt };

// ===================================================================
//  Business emails
// ===================================================================

export function invoiceEmail(inv: {
  invoiceNumber: string; total: number; paidAmount: number; currency: string;
  issueDate: Date; dueDate: Date | null; paymentTerms: string | null; notes: string | null;
  clientName: string; projectName: string | null;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
}, portalUrl?: string): { subject: string; html: string } {
  const remaining = Math.max(0, inv.total - inv.paidAmount);
  const body = [
    p(`Dear <strong>${escapeHtml(inv.clientName)}</strong>,`),
    p(`Please find invoice <strong>${escapeHtml(inv.invoiceNumber)}</strong>${inv.projectName ? ` for <strong>${escapeHtml(inv.projectName)}</strong>` : ""}.`),
    itemsTable(inv.items),
    keyValues([
      ["Invoice number", inv.invoiceNumber],
      ["Issue date", dateFmt(inv.issueDate)],
      ["Due date", dateFmt(inv.dueDate)],
      ["Total", money(inv.total, inv.currency)],
      ["Paid", money(inv.paidAmount, inv.currency)],
      ["Amount due", money(remaining, inv.currency)],
    ]),
    inv.paymentTerms ? callout(`<strong>Payment terms:</strong> ${escapeHtml(inv.paymentTerms)}`, "info") : "",
    inv.notes ? p(`<span style="color:${BRAND.muted};font-size:14px;">${escapeHtml(inv.notes)}</span>`) : "",
    p(`Thank you for your business.<br><span style="color:${BRAND.muted};font-size:14px;">— APEX Team</span>`),
  ].join("");

  return {
    subject: `Invoice ${inv.invoiceNumber} — ${money(remaining, inv.currency)} due`,
    html: layout({
      title: `Invoice ${inv.invoiceNumber}`,
      preheader: `Amount due: ${money(remaining, inv.currency)}`,
      body,
      cta: portalUrl ? { label: "View in client portal", url: portalUrl } : undefined,
    }),
  };
}

export function paymentReceiptEmail(pay: {
  amount: number; currency: string; date: Date; method: string; reference: string | null;
  invoiceNumber: string | null; clientName: string | null; projectName: string | null;
}): { subject: string; html: string } {
  const body = [
    p(`Dear <strong>${escapeHtml(pay.clientName ?? "Valued Client")}</strong>,`),
    p(`We have recorded your payment. Thank you.`),
    keyValues([
      ["Amount received", money(pay.amount, pay.currency)],
      ["Date", dateFmt(pay.date)],
      ["Payment method", pay.method.replace(/_/g, " ").toLowerCase()],
      ["Reference", pay.reference ?? "—"],
      ["Invoice", pay.invoiceNumber ?? "—"],
      ["Project", pay.projectName ?? "—"],
    ]),
    callout("This receipt confirms the payment has been recorded in our system.", "ok"),
  ].join("");

  return {
    subject: `Payment received — ${money(pay.amount, pay.currency)}${pay.invoiceNumber ? ` (${pay.invoiceNumber})` : ""}`,
    html: layout({
      title: "Payment received",
      preheader: `${money(pay.amount, pay.currency)} received`,
      body,
    }),
  };
}

export function ticketCreatedEmail(t: {
  ticketNumber: string; subject: string; category: string; priority: string;
  clientName: string; projectName: string | null; portalUrl?: string;
}): { subject: string; html: string } {
  const body = [
    p(`Dear <strong>${escapeHtml(t.clientName)}</strong>,`),
    p(`Your support ticket has been received. Our team will get back to you shortly.`),
    keyValues([
      ["Ticket number", t.ticketNumber],
      ["Subject", t.subject],
      ["Category", t.category.replace(/_/g, " ").toLowerCase()],
      ["Priority", t.priority.toLowerCase()],
      ["Project", t.projectName ?? "—"],
    ]),
    callout("You can follow the progress and reply to this ticket from your client portal.", "info"),
  ].join("");

  return {
    subject: `Ticket ${t.ticketNumber} received — ${t.subject}`,
    html: layout({
      title: `Support ticket ${t.ticketNumber}`,
      preheader: t.subject,
      body,
      cta: t.portalUrl ? { label: "Open ticket", url: t.portalUrl } : undefined,
    }),
  };
}

export function ticketUpdateEmail(t: {
  ticketNumber: string; subject: string; status: string; clientName: string;
  message: string | null; isInternal: boolean; portalUrl?: string;
}): { subject: string; html: string } {
  const body = [
    p(`Dear <strong>${escapeHtml(t.clientName)}</strong>,`),
    p(`There is an update on your support ticket <strong>${escapeHtml(t.ticketNumber)}</strong>.`),
    keyValues([
      ["Ticket number", t.ticketNumber],
      ["Subject", t.subject],
      ["Status", t.status.replace(/_/g, " ").toLowerCase()],
    ]),
    t.message
      ? `<div style="margin:18px 0;padding:16px;background:rgba(148,163,184,0.08);border:1px solid ${BRAND.border};border-radius:10px;font-size:14px;line-height:1.6;color:${BRAND.text};">${escapeHtml(t.message).replace(/\n/g, "<br>")}</div>`
      : "",
  ].join("");

  return {
    subject: `Update on ticket ${t.ticketNumber} — ${t.status.replace(/_/g, " ").toLowerCase()}`,
    html: layout({
      title: `Ticket update — ${t.ticketNumber}`,
      preheader: t.subject,
      body,
      cta: t.portalUrl ? { label: "View ticket", url: t.portalUrl } : undefined,
    }),
  };
}

export function proposalEmail(pp: {
  proposalNumber: string; title: string; total: number; currency: string; validUntil: Date | null;
  clientName: string; body: string | null; portalUrl?: string;
}): { subject: string; html: string } {
  const inner = [
    p(`Dear <strong>${escapeHtml(pp.clientName)}</strong>,`),
    p(`Thank you for your time. Please find our proposal <strong>${escapeHtml(pp.proposalNumber)}</strong> — <strong>${escapeHtml(pp.title)}</strong>.`),
    pp.body
      ? `<div style="margin:18px 0;padding:16px;background:rgba(148,163,184,0.07);border-left:3px solid ${BRAND.cyan};border-radius:8px;font-size:14px;line-height:1.65;color:${BRAND.text};">${escapeHtml(pp.body).replace(/\n/g, "<br>")}</div>`
      : "",
    keyValues([
      ["Proposal number", pp.proposalNumber],
      ["Total investment", money(pp.total, pp.currency)],
      ["Valid until", dateFmt(pp.validUntil)],
    ]),
    p(`We look forward to working with you.<br><span style="color:${BRAND.muted};font-size:14px;">— APEX Team</span>`),
  ].join("");

  return {
    subject: `Proposal ${pp.proposalNumber} — ${pp.title}`,
    html: layout({
      title: `Proposal ${pp.proposalNumber}`,
      preheader: pp.title,
      body: inner,
      cta: pp.portalUrl ? { label: "Review proposal", url: pp.portalUrl } : undefined,
    }),
  };
}

export function contractEmail(c: {
  contractNumber: string; title: string; status: string; startDate: Date | null; endDate: Date | null;
  clientName: string; portalUrl?: string;
}): { subject: string; html: string } {
  const body = [
    p(`Dear <strong>${escapeHtml(c.clientName)}</strong>,`),
    p(`Please find contract <strong>${escapeHtml(c.contractNumber)}</strong> — ${escapeHtml(c.title)}.`),
    keyValues([
      ["Contract number", c.contractNumber],
      ["Status", c.status.replace(/_/g, " ").toLowerCase()],
      ["Start date", dateFmt(c.startDate)],
      ["End date", dateFmt(c.endDate)],
    ]),
  ].join("");

  return {
    subject: `Contract ${c.contractNumber} — ${c.title}`,
    html: layout({
      title: `Contract ${c.contractNumber}`,
      preheader: c.title,
      body,
      cta: c.portalUrl ? { label: "View contract", url: c.portalUrl } : undefined,
    }),
  };
}

export function welcomeEmail(u: { name: string; email: string; password?: string }): { subject: string; html: string } {
  const body = [
    p(`Welcome to the APEX team, <strong>${escapeHtml(u.name)}</strong>.`),
    p(`An account has been created for you on APEX SYSTEM — the internal operating system for sales, delivery, finance and support.`),
    u.password
      ? keyValues([["Email", u.email], ["Temporary password", u.password], ["Change it", "Sign in → Settings → Security"]])
      : keyValues([["Email", u.email]]),
    callout("Please sign in and change your temporary password as soon as possible.", "warn"),
  ].join("");

  return {
    subject: "Welcome to APEX SYSTEM",
    html: layout({ title: "Welcome to APEX", preheader: "Your APEX account is ready", body }),
  };
}

export function internalAlertEmail(opts: {
  title: string; lines: [string, string][]; note?: string;
}): { subject: string; html: string } {
  const body = [
    p(`<strong>${escapeHtml(opts.title)}</strong>`),
    keyValues(opts.lines),
    opts.note ? callout(escapeHtml(opts.note), "warn") : "",
  ].join("");

  return {
    subject: `[APEX] ${opts.title}`,
    html: layout({ title: opts.title, preheader: opts.title, body }),
  };
}
