import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const itemSchema = z.object({
  description: z.string().trim().min(1, "Item description is required").max(300),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unitPrice: z.number().min(0, "Unit price cannot be negative"),
});

const CreateSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  projectId: optionalText(40),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  currency: z.enum(["EGP", "USD", "SAR", "EUR"]).default("EGP"),
  discountAmount: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  paymentTerms: optionalText(300),
  notes: optionalText(2000),
  items: z.array(itemSchema).min(1, "Add at least one invoice item"),
});

/** Server-side money math (never trust client totals — §47) */
function computeTotals(
  items: { quantity: number; unitPrice: number }[],
  discountAmount: number,
  taxPercent: number
) {
  const subtotal = Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;
  const total = Math.round(Math.max(0, subtotal - discountAmount) * (1 + taxPercent / 100) * 100) / 100;
  return { subtotal, total };
}

/** Effective status: OVERDUE is computed, never stored (§31) */
export function isOverdue(status: string, dueDate: Date | null) {
  return Boolean(
    dueDate && dueDate.getTime() < Date.now() && ["SENT", "PARTIALLY_PAID"].includes(status)
  );
}

export function serializeInvoice(inv: {
  id: string; invoiceNumber: string; status: string; currency: string;
  subtotal: number; discountAmount: number; taxPercent: number; total: number; paidAmount: number;
  issueDate: Date; dueDate: Date | null; paymentTerms: string | null; notes: string | null;
  createdAt: Date; updatedAt: Date;
  client?: { id: string; companyName: string; clientNumber: string } | null;
  project?: { id: string; name: string; projectNumber: string } | null;
  items?: unknown[];
}) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    effectiveStatus: isOverdue(inv.status, inv.dueDate) ? "OVERDUE" : inv.status,
    currency: inv.currency,
    subtotal: inv.subtotal,
    discountAmount: inv.discountAmount,
    taxPercent: inv.taxPercent,
    total: inv.total,
    paidAmount: inv.paidAmount,
    remaining: Math.max(0, inv.total - inv.paidAmount),
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    paymentTerms: inv.paymentTerms,
    notes: inv.notes,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    client: inv.client ?? null,
    project: inv.project ?? null,
    ...(inv.items !== undefined ? { items: inv.items } : {}),
  };
}

// ---- GET /api/invoices?q=&status=&clientId=&page=&pageSize= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("invoices.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = (sp.get("status") || "").trim();
    const clientId = (sp.get("clientId") || "").trim();

    const where: Prisma.InvoiceWhereInput = {};
    if (q) {
      where.OR = [
        { invoiceNumber: { contains: q } },
        { notes: { contains: q } },
        { client: { is: { companyName: { contains: q } } } },
      ];
    }
    if (clientId) where.clientId = clientId;

    const now = new Date();
    if (status === "OVERDUE") {
      where.dueDate = { lt: now };
      where.status = { in: ["SENT", "PARTIALLY_PAID"] };
    } else if (status === "UNPAID") {
      where.status = { in: ["DRAFT", "SENT", "PARTIALLY_PAID"] };
    } else if (status) {
      where.status = status;
    }

    const [rows, total, agg] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip, take,
        include: {
          client: { select: { id: true, companyName: true, clientNumber: true } },
          project: { select: { id: true, name: true, projectNumber: true } },
        },
      }),
      db.invoice.count({ where }),
      db.invoice.aggregate({ _sum: { total: true, paidAmount: true }, where: {} }),
    ]);

    return ok({
      items: rows.map((r) => serializeInvoice(r)),
      total, page, pageSize,
      summary: { invoicedTotal: agg._sum.total ?? 0, paidTotal: agg._sum.paidAmount ?? 0 },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/invoices ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("invoices.create");
    const body = await parseBody(req, CreateSchema);

    const client = await db.client.findUnique({ where: { id: body.clientId } });
    if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client no longer exists.");
    if (body.projectId) {
      const project = await db.project.findUnique({ where: { id: body.projectId } });
      if (!project || project.clientId !== body.clientId) {
        throw new ApiError(400, "INVALID_PROJECT", "Project must belong to the same client as the invoice.");
      }
    }

    const invoiceNumber = await nextNumber("invoice"); // OUTSIDE tx (SQLite single-writer, see worklog)
    const { subtotal, total } = computeTotals(body.items, body.discountAmount, body.taxPercent);

    const invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        clientId: body.clientId,
        projectId: body.projectId ?? null,
        issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        currency: body.currency,
        discountAmount: body.discountAmount,
        taxPercent: body.taxPercent,
        subtotal,
        total,
        paymentTerms: body.paymentTerms ?? null,
        notes: body.notes ?? null,
        items: {
          create: body.items.map((it, i) => ({
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: it.quantity * it.unitPrice,
            order: i,
          })),
        },
      },
      include: {
        client: { select: { id: true, companyName: true, clientNumber: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
        items: { orderBy: { order: "asc" } },
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "INVOICE", entityId: invoice.id,
      metadata: { invoiceNumber, total }, ip: clientIp(req),
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "INVOICE", entityType: "INVOICE", entityId: invoice.id,
      title: `Invoice ${invoiceNumber} created for ${client.companyName}`,
      metadata: { total, currency: invoice.currency },
    });

    return ok(serializeInvoice(invoice), 201);
  } catch (e) {
    return handleError(e);
  }
}
