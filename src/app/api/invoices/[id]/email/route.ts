// POST /api/invoices/[id]/email
//
// Sends the invoice to the client contact email.
// Security: invoices.edit permission + invoice must not be DRAFT/CANCELLED.
// If SMTP is not configured the route returns 422 with a clear message.

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  ok, fail, handleError, parseBody, requirePermission, logAudit, logActivity, clientIp,
} from "@/lib/api-helpers";
import { sendMail, invoiceEmail, isMailConfigured } from "@/lib/mailer";

const Schema = z.object({
  /** Override email — if omitted we use the primary client contact or client email. */
  toEmail: z.string().trim().email("Enter a valid email address").max(200).optional(),
  /** Extra message shown above the invoice in the email. */
  message: z.string().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requirePermission("invoices.edit");
    const { id } = await context.params;
    const body = await parseBody(req, Schema);

    if (!isMailConfigured()) {
      return fail(422, "SMTP_NOT_CONFIGURED",
        "Email sending is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM in your environment to enable this feature.");
    }

    const inv = await db.invoice.findUnique({
      where: { id },
      include: {
        client: {
          include: { contacts: { where: { isPrimary: true }, take: 1 } },
        },
        project: { select: { id: true, name: true } },
        items: { orderBy: { order: "asc" } },
        payments: { orderBy: { date: "desc" } },
      },
    });

    if (!inv) return fail(404, "NOT_FOUND", "Invoice not found.");
    if (inv.status === "DRAFT") {
      return fail(400, "INVOICE_DRAFT",
        "Draft invoices cannot be emailed. Mark the invoice as Sent first.");
    }
    if (inv.status === "CANCELLED") {
      return fail(400, "INVOICE_CANCELLED", "Cancelled invoices cannot be emailed.");
    }

    // Resolve the recipient: override → primary contact email → client email
    const primaryContact = inv.client.contacts[0];
    const recipientEmail =
      body.toEmail ||
      primaryContact?.email ||
      inv.client.email;

    if (!recipientEmail) {
      return fail(422, "NO_CLIENT_EMAIL",
        "No email address found for this client. Add one under the client's Contacts or pass toEmail in the request.");
    }

    const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");

    const mail = invoiceEmail(
      {
        invoiceNumber: inv.invoiceNumber,
        total: inv.total,
        paidAmount: inv.paidAmount,
        currency: inv.currency,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        paymentTerms: inv.paymentTerms,
        notes: body.message
          ? `${body.message}${inv.notes ? `\n\n${inv.notes}` : ""}`
          : inv.notes,
        clientName: inv.client.companyName,
        projectName: inv.project?.name ?? null,
        items: inv.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        })),
      },
      base ? `${base}/#portal/invoices` : undefined
    );

    const result = await sendMail({
      to: recipientEmail,
      subject: mail.subject,
      html: mail.html,
      replyTo: process.env.MAIL_REPLY_TO,
    });

    if (!result.sent && !result.skipped) {
      return fail(500, "SEND_FAILED",
        `Email delivery failed: ${result.error || "Unknown error"}. Please check your SMTP settings.`);
    }

    await Promise.all([
      logActivity({
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        type: "EMAIL_SENT",
        entityType: "INVOICE",
        entityId: inv.id,
        title: `Invoice emailed to ${recipientEmail}`,
        description: body.message ? `Message: ${body.message.slice(0, 120)}` : undefined,
      }),
      logAudit({
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        action: "FINANCE_ACTION",
        entityType: "INVOICE",
        entityId: inv.id,
        metadata: { invoiceNumber: inv.invoiceNumber, sentTo: recipientEmail, messageId: result.id },
        ip: clientIp(req),
      }),
    ]);

    return ok({
      sent: result.sent,
      skipped: result.skipped ?? false,
      messageId: result.id ?? null,
      sentTo: recipientEmail,
    });
  } catch (e) {
    return handleError(e);
  }
}
