import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, createNotification, ApiError,
} from "@/lib/api-helpers";
import { runAutomations } from "@/lib/automations";
import { sendMail, paymentReceiptEmail } from "@/lib/mailer";

const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const CreateSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  // Round to 2 decimals up-front so floats like 28450.000000000007 never enter the ledger
  amount: z.number().positive("Amount must be greater than 0").transform((v) => Math.round(v * 100) / 100),
  date: z.string().datetime().optional(),
  method: z.enum(["BANK_TRANSFER", "CASH", "INSTAPAY", "VODAFONE_CASH", "PAYPAL", "OTHER"]).default("BANK_TRANSFER"),
  reference: optionalText(120),
  notes: optionalText(500),
});

/**
 * Recalculate an invoice's paidAmount + status from its payments (single source of truth).
 * paid == total → PAID, 0 < paid < total → PARTIALLY_PAID, else keeps SENT/DRAFT.
 */
async function recalcInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: { select: { amount: true } } },
  });
  if (!inv) throw new ApiError(404, "NOT_FOUND", "The invoice no longer exists.");
  const paidAmount = Math.round(inv.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  let status = inv.status;
  if (paidAmount >= inv.total && inv.total > 0) status = "PAID";
  else if (paidAmount > 0 && ["DRAFT", "SENT", "PARTIALLY_PAID"].includes(inv.status)) status = "PARTIALLY_PAID";
  return tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount, status } });
}

// ---- GET /api/payments?invoiceId=&clientId=&method=&from=&to=&q=&page= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("payments.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const invoiceId = (sp.get("invoiceId") || "").trim();
    const clientId = (sp.get("clientId") || "").trim();
    const method = (sp.get("method") || "").trim();
    const from = sp.get("from");
    const to = sp.get("to");

    const where: Prisma.PaymentWhereInput = {};
    if (invoiceId) where.invoiceId = invoiceId;
    if (clientId) where.clientId = clientId;
    if (method) where.method = method;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }
    if (q) {
      where.OR = [
        { reference: { contains: q } },
        { notes: { contains: q } },
        { invoice: { is: { invoiceNumber: { contains: q } } } },
        { client: { is: { companyName: { contains: q } } } },
      ];
    }

    const [rows, total, agg] = await Promise.all([
      db.payment.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip, take,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, currency: true, status: true, total: true, paidAmount: true } },
          client: { select: { id: true, companyName: true, clientNumber: true } },
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      db.payment.count({ where }),
      db.payment.aggregate({ _sum: { amount: true }, where: {} }),
    ]);

    return ok({ items: rows, total, page, pageSize, summary: { totalCollected: agg._sum.amount ?? 0 } });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/payments ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("payments.create");
    const body = await parseBody(req, CreateSchema);

    const invoice = await db.invoice.findUnique({
      where: { id: body.invoiceId },
      include: {
        client: { select: { id: true, companyName: true, email: true } },
        project: { select: { name: true } },
      },
    });
    if (!invoice) throw new ApiError(404, "NOT_FOUND", "The invoice no longer exists.");
    if (["DRAFT", "CANCELLED"].includes(invoice.status)) {
      throw new ApiError(400, "INVALID_INVOICE", `Payments can only be recorded against sent invoices — this one is still ${invoice.status}.`);
    }
    const remaining = Math.max(0, invoice.total - invoice.paidAmount);
    if (body.amount > remaining + 0.001) {
      throw new ApiError(400, "OVERPAYMENT", `Payment exceeds the remaining amount. Remaining on ${invoice.invoiceNumber} is ${remaining.toFixed(2)} ${invoice.currency}.`);
    }

    const paymentNumber = `PAY-${Date.now()}`; // traceability reference
    const payment = await db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          clientId: invoice.clientId,
          amount: body.amount,
          date: body.date ? new Date(body.date) : new Date(),
          method: body.method,
          reference: body.reference ?? null,
          notes: body.notes ?? null,
          recordedById: session.user.id,
        },
      });
      await recalcInvoice(tx, invoice.id);
      return p;
    });

    const updated = await db.invoice.findUnique({ where: { id: invoice.id } });
    const fullyPaid = updated?.status === "PAID";

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "PAYMENT", entityType: "INVOICE", entityId: invoice.id,
      title: `Payment ${body.amount.toFixed(2)} ${invoice.currency} received for ${invoice.invoiceNumber}`,
      description: fullyPaid ? "Invoice fully paid." : "Partial payment recorded.",
      metadata: { method: body.method, paymentId: payment.id, paymentNumber },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "FINANCE_ACTION", entityType: "PAYMENT", entityId: payment.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, amount: body.amount, method: body.method }, ip: clientIp(req),
    });

    // Notify finance roles + the invoice was created by someone else
    const admins = await db.user.findMany({
      where: { isActive: true, roles: { some: { key: { in: ["SUPER_ADMIN", "ADMIN"] } } } },
      select: { id: true },
    });
    await Promise.all(
      admins
        .filter((u) => u.id !== session.user.id)
        .map((u) =>
          createNotification({
            userId: u.id,
            type: "PAYMENT",
            title: fullyPaid ? `Invoice paid in full: ${invoice.invoiceNumber}` : `Partial payment: ${invoice.invoiceNumber}`,
            body: `${body.amount.toFixed(2)} ${invoice.currency} via ${body.method.replace(/_/g, " ")} — recorded by ${session.user.name}.`,
            entityType: "INVOICE",
            entityId: invoice.id,
          })
        )
    );

    // Receipt email to the client (fire-and-forget — never blocks or fails the payment)
    if (invoice.client?.email) {
      const mail = paymentReceiptEmail({
        amount: payment.amount,
        currency: invoice.currency,
        date: payment.date,
        method: payment.method,
        reference: payment.reference,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.client.companyName,
        projectName: invoice.project?.name ?? null,
      });
      sendMail({ to: invoice.client.email, subject: mail.subject, html: mail.html }).catch(() => undefined);
    }

    // Automation engine (§8) — fire-and-forget, never blocks the response
    runAutomations("PAYMENT_RECEIVED", {
      entityType: "PAYMENT", entityId: payment.id,
      amount: body.amount, currency: invoice.currency,
      method: body.method, invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client?.companyName ?? null,
      invoiceStatus: updated?.status ?? null,
      actorName: session.user.name,
    }).catch(() => undefined);

    return ok({ payment, invoiceStatus: updated?.status, paidAmount: updated?.paidAmount }, 201);
  } catch (e) {
    return handleError(e);
  }
}
