import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, paginationFrom, logAudit, logActivity, ApiError } from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";

// total = subtotal - discountAmount + (subtotal * taxPercent / 100) — always recomputed server-side
function computeTotals(
  items: { quantity: number; unitPrice: number }[],
  discountAmount: number,
  taxPercent: number
) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const tax = round2((subtotal * taxPercent) / 100);
  const total = round2(subtotal - discountAmount + tax);
  return { subtotal, total };
}

const ItemSchema = z.object({
  description: z.string().min(1, "Item description is required"),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unitPrice: z.number().min(0, "Unit price cannot be negative"),
});

/** GET /api/quotations?status=&q=&page= — list quotations with lead/client + item counts */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("quotations.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const where: Prisma.QuotationWhereInput = {};
    const status = sp.get("status");
    if (status) where.status = status;
    const q = sp.get("q");
    if (q) {
      where.OR = [{ quotationNumber: { contains: q } }, { title: { contains: q } }];
    }

    const [items, total] = await Promise.all([
      db.quotation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip, take,
        include: {
          lead: { select: { id: true, companyName: true } },
          client: { select: { id: true, companyName: true } },
          _count: { select: { items: true } },
        },
      }),
      db.quotation.count({ where }),
    ]);

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

const CreateSchema = z.object({
  title: z.string().min(2, "Title is required"),
  leadId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  currency: z.enum(["EGP", "USD", "SAR"]).default("EGP"),
  discountAmount: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(ItemSchema).default([]),
});

/** POST /api/quotations — create quotation with items in one transaction (quotations.create) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("quotations.create");
    const body = await parseBody(req, CreateSchema);

    if (body.leadId && !(await db.lead.findUnique({ where: { id: body.leadId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "leadId: The selected lead no longer exists.");
    if (body.clientId && !(await db.client.findUnique({ where: { id: body.clientId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "clientId: The selected client no longer exists.");

    const quotationNumber = await nextNumber("quotation");
    const { subtotal, total } = computeTotals(body.items, body.discountAmount, body.taxPercent);

    const quotation = await db.$transaction(async (tx) => {
      const created = await tx.quotation.create({
        data: {
          quotationNumber,
          leadId: body.leadId || null,
          clientId: body.clientId || null,
          title: body.title,
          currency: body.currency,
          subtotal,
          discountAmount: body.discountAmount,
          taxPercent: body.taxPercent,
          total,
          paymentTerms: body.paymentTerms || null,
          validUntil: body.validUntil ?? null,
          notes: body.notes || null,
          status: "DRAFT",
        },
      });
      if (body.items.length > 0) {
        await tx.quotationItem.createMany({
          data: body.items.map((i, idx) => ({
            quotationId: created.id,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            total: Math.round(i.quantity * i.unitPrice * 100) / 100,
            order: idx,
          })),
        });
      }
      return tx.quotation.findUnique({
        where: { id: created.id },
        include: { items: { orderBy: { order: "asc" } } },
      });
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "QUOTATION", entityId: quotation!.id,
      metadata: { quotationNumber, total, currency: body.currency },
    });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name, type: "CREATED",
      entityType: "QUOTATION", entityId: quotation!.id,
      title: `Quotation ${quotationNumber} created`,
    });

    return ok(quotation, 201);
  } catch (e) {
    return handleError(e);
  }
}
