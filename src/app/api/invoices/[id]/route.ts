import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, createNotification, ApiError,
} from "@/lib/api-helpers";
import { runAutomations } from "@/lib/automations";
import { sendMail, invoiceEmail } from "@/lib/mailer";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const PatchSchema = z.object({
  dueDate: z.string().datetime().nullable().optional(),
  paymentTerms: optionalText(300),
  notes: optionalText(2000),
  // Items + money fields are ONLY editable in DRAFT (§61 — financial records never silently altered)
  items: z.array(z.object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
  })).optional(),
  discountAmount: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "SENT", "CANCELLED"]).optional(),
});

function computeTotals(
  items: { quantity: number; unitPrice: number }[],
  discountAmount: number,
  taxPercent: number
) {
  const subtotal = Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;
  const total = Math.round(Math.max(0, subtotal - discountAmount) * (1 + taxPercent / 100) * 100) / 100;
  return { subtotal, total };
}

function isOverdue(status: string, dueDate: Date | null) {
  return Boolean(
    dueDate && dueDate.getTime() < Date.now() && ["SENT", "PARTIALLY_PAID"].includes(status)
  );
}

async function notifyFinanceRoles(title: string, bodyText: string, entityId: string) {
  const users = await db.user.findMany({
    where: { isActive: true, roles: { some: { key: { in: ["SUPER_ADMIN", "ADMIN"] } } } },
    select: { id: true },
  });
  await Promise.all(
    users.map((u) => createNotification({ userId: u.id, type: "FINANCE", title, body: bodyText, entityType: "INVOICE", entityId }))
  );
}

// ---- GET /api/invoices/[id] ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("invoices.view");
    const { id } = await params;
    const inv = await db.invoice.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true, clientNumber: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
        items: { orderBy: { order: "asc" } },
        payments: {
          orderBy: { date: "desc" },
          include: { recordedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!inv) throw new ApiError(404, "NOT_FOUND", "This invoice no longer exists.");

    const activities = await db.activity.findMany({
      where: { entityType: "INVOICE", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return ok({
      ...inv,
      effectiveStatus: isOverdue(inv.status, inv.dueDate) ? "OVERDUE" : inv.status,
      remaining: Math.max(0, inv.total - inv.paidAmount),
      activities,
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/invoices/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("invoices.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const inv = await db.invoice.findUnique({
      where: { id },
      include: {
        client: { select: { companyName: true, email: true } },
        project: { select: { name: true } },
      },
    });
    if (!inv) throw new ApiError(404, "NOT_FOUND", "This invoice no longer exists.");

    // --- Status transitions (server-enforced, audited) ---
    if (body.status && body.status !== inv.status) {
      const allowed: Record<string, string[]> = {
        DRAFT: ["SENT", "CANCELLED"],
        SENT: ["CANCELLED"],
        PARTIALLY_PAID: [],
        PAID: [],
        CANCELLED: [],
      };
      if (!allowed[inv.status]?.includes(body.status)) {
        throw new ApiError(
          400, "INVALID_TRANSITION",
          `Cannot change invoice from ${inv.status} to ${body.status}. Only drafts can be edited after being sent — record a payment or cancel instead.`
        );
      }
      if (body.status === "CANCELLED" && inv.paidAmount > 0) {
        throw new ApiError(409, "HAS_PAYMENTS", "This invoice already has payments recorded. Issue a refund outside the system first, then cancel.");
      }
    }

    // --- Items/money edits only in DRAFT (§61) ---
    const wantsItemEdit = body.items !== undefined || body.discountAmount !== undefined || body.taxPercent !== undefined;
    if (wantsItemEdit && inv.status !== "DRAFT") {
      throw new ApiError(400, "LOCKED", "Items and amounts are locked once an invoice leaves Draft. Record payments or create a new invoice instead.");
    }

    const updated = await db.$transaction(async (tx) => {
      if (body.status === "SENT" && inv.status === "DRAFT") {
        await tx.activity.create({
          data: {
            type: "STATUS_CHANGED", actorId: session.user.id, actorName: session.user.name,
            entityType: "INVOICE", entityId: inv.id,
            title: `Invoice ${inv.invoiceNumber} sent to ${inv.client.companyName}`,
          },
        });
      }
      if (body.status === "CANCELLED") {
        await tx.activity.create({
          data: {
            type: "STATUS_CHANGED", actorId: session.user.id, actorName: session.user.name,
            entityType: "INVOICE", entityId: inv.id,
            title: `Invoice ${inv.invoiceNumber} cancelled`,
          },
        });
      }

      let data: Parameters<typeof tx.invoice.update>[0]["data"] = {
        dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : undefined,
        paymentTerms: body.paymentTerms !== undefined ? body.paymentTerms : undefined,
        notes: body.notes !== undefined ? body.notes : undefined,
        status: body.status ?? undefined,
      };

      if (wantsItemEdit) {
        const items = body.items ?? (await tx.invoiceItem.findMany({ where: { invoiceId: inv.id }, orderBy: { order: "asc" } }))
          .map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice }));
        const discountAmount = body.discountAmount ?? inv.discountAmount;
        const taxPercent = body.taxPercent ?? inv.taxPercent;
        const { subtotal, total } = computeTotals(items, discountAmount, taxPercent);
        data = {
          ...data,
          discountAmount, taxPercent, subtotal, total,
          items: body.items
            ? {
                deleteMany: {},
                create: body.items.map((it, i) => ({
                  description: it.description, quantity: it.quantity, unitPrice: it.unitPrice,
                  total: it.quantity * it.unitPrice, order: i,
                })),
              }
            : undefined,
        };
      }

      return tx.invoice.update({ where: { id: inv.id }, data });
    });

    if (body.status === "SENT") {
      await notifyFinanceRoles(
        `Invoice sent: ${inv.invoiceNumber}`,
        `Invoice for ${inv.client.companyName} (${inv.total} ${inv.currency}) was sent by ${session.user.name}.`,
        inv.id
      );

      // Real email to the client (fire-and-forget — never blocks or fails the send)
      const clientEmail = inv.client.email;
      if (clientEmail) {
        db.invoiceItem.findMany({ where: { invoiceId: inv.id }, orderBy: { order: "asc" } })
          .then((items) => {
            const mail = invoiceEmail(
              {
                invoiceNumber: inv.invoiceNumber,
                total: inv.total,
                paidAmount: inv.paidAmount,
                currency: inv.currency,
                issueDate: inv.issueDate,
                dueDate: inv.dueDate,
                paymentTerms: inv.paymentTerms,
                notes: inv.notes,
                clientName: inv.client.companyName,
                projectName: inv.project?.name ?? null,
                items: items.map((i) => ({
                  description: i.description,
                  quantity: i.quantity,
                  unitPrice: i.unitPrice,
                  total: i.total,
                })),
              },
              process.env.APP_URL ? `${process.env.APP_URL}/#/portal/invoices` : undefined
            );
            return sendMail({ to: clientEmail, subject: mail.subject, html: mail.html });
          })
          .catch((e) => console.error("[mail] invoice send failed:", e));
      }

      // Automation engine (§8) — fire-and-forget, never blocks the response
      runAutomations("INVOICE_SENT", {
        entityType: "INVOICE", entityId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        clientName: inv.client.companyName,
        total: inv.total, currency: inv.currency,
        dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
        actorName: session.user.name,
      }).catch(() => undefined);
    }

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: body.status && body.status !== inv.status ? "STATUS_CHANGE" : "FINANCE_ACTION",
      entityType: "INVOICE", entityId: inv.id,
      metadata: { changes: Object.keys(body) }, ip: clientIp(req),
    });

    return ok({ updated: true });
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/invoices/[id] — Draft only ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("invoices.delete");
    const { id } = await params;
    const inv = await db.invoice.findUnique({ where: { id } });
    if (!inv) throw new ApiError(404, "NOT_FOUND", "This invoice no longer exists.");
    if (inv.status !== "DRAFT") {
      throw new ApiError(409, "NOT_DRAFT", "Only draft invoices can be deleted. Cancel sent invoices instead to keep the financial history.");
    }
    await db.invoice.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "INVOICE", entityId: id,
      metadata: { invoiceNumber: inv.invoiceNumber }, ip: clientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
