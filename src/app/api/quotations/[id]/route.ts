import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, logAudit, logActivity, notifyRole, ApiError } from "@/lib/api-helpers";

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

const PatchSchema = z.object({
  title: z.string().min(2).optional(),
  leadId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  currency: z.enum(["EGP", "USD", "SAR"]).optional(),
  discountAmount: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  paymentTerms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(ItemSchema).optional(),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
});

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT", "EXPIRED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

/** GET /api/quotations/[id] — full detail + items + activities */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("quotations.view");
    const { id } = await params;

    const quotation = await db.quotation.findUnique({
      where: { id },
      include: {
        items: { orderBy: { order: "asc" } },
        lead: { select: { id: true, companyName: true, contactName: true, email: true, phone: true } },
        client: { select: { id: true, companyName: true, email: true, phone: true } },
      },
    });
    if (!quotation) throw new ApiError(404, "NOT_FOUND", "Quotation not found.");

    const activities = await db.activity.findMany({
      where: { entityType: "QUOTATION", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return ok({
      ...quotation,
      activities: activities.map((a) => ({
        id: a.id, type: a.type, title: a.title, description: a.description,
        actorName: a.actorName || "System",
        actorColor: "#22d3ee",
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

/** PATCH /api/quotations/[id] — update fields/items or transition status (quotations.edit) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("quotations.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.quotation.findUnique({
      where: { id },
      include: { items: { orderBy: { order: "asc" } } },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Quotation not found.");

    let statusChanged: string | null = null;
    if (body.status && body.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(409, "INVALID_TRANSITION", `Cannot move a ${existing.status.toLowerCase()} quotation to ${body.status.toLowerCase()}.`);
      }
      statusChanged = body.status;
    }

    if (["ACCEPTED", "REJECTED", "EXPIRED"].includes(existing.status) && !statusChanged) {
      throw new ApiError(409, "LOCKED", "Accepted, rejected or expired quotations can no longer be edited.");
    }

    const hasFieldEdits = Object.entries(body).some(
      ([k, v]) => v !== undefined && !["status", "items"].includes(k)
    );

    const updated = await db.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined || k === "status" || k === "items") continue;
        data[k] = v;
      }
      if (statusChanged) data.status = statusChanged;

      let items = existing.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice }));
      if (body.items) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        if (body.items.length > 0) {
          await tx.quotationItem.createMany({
            data: body.items.map((i, idx) => ({
              quotationId: id,
              description: i.description,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              total: Math.round(i.quantity * i.unitPrice * 100) / 100,
              order: idx,
            })),
          });
        }
        items = body.items;
      }

      const discountAmount = body.discountAmount ?? existing.discountAmount;
      const taxPercent = body.taxPercent ?? existing.taxPercent;
      const { subtotal, total } = computeTotals(items, discountAmount, taxPercent);
      data.subtotal = subtotal;
      data.total = total;
      if (body.discountAmount !== undefined) data.discountAmount = discountAmount;
      if (body.taxPercent !== undefined) data.taxPercent = taxPercent;

      return tx.quotation.update({
        where: { id },
        data,
        include: { items: { orderBy: { order: "asc" } } },
      });
    });

    const relatedParty = updated.leadId ?? updated.clientId;
    const partyLabel = updated.leadId ? "LEAD" : updated.clientId ? "CLIENT" : null;

    if (statusChanged) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "STATUS_CHANGE", entityType: "QUOTATION", entityId: id,
        metadata: { from: existing.status, to: statusChanged, quotationNumber: existing.quotationNumber },
      });
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "STATUS_CHANGED",
        entityType: "QUOTATION", entityId: id,
        title: `Quotation ${existing.quotationNumber} ${statusChanged.toLowerCase()}`,
      });
      if (partyLabel && relatedParty) {
        await logActivity({
          actorId: session.user.id, actorName: session.user.name, type: "QUOTATION",
          entityType: partyLabel, entityId: relatedParty,
          title: `Quotation ${existing.quotationNumber} ${statusChanged.toLowerCase()}`,
          metadata: { quotationId: id },
        });
      }
      if (statusChanged === "SENT") {
        await notifyRole("SUPER_ADMIN", {
          type: "QUOTATION_SENT", title: "Quotation sent",
          body: `Quotation sent: ${existing.quotationNumber} — ${updated.title}`,
          entityType: "QUOTATION", entityId: id,
        });
        await notifyRole("ADMIN", {
          type: "QUOTATION_SENT", title: "Quotation sent",
          body: `Quotation sent: ${existing.quotationNumber} — ${updated.title}`,
          entityType: "QUOTATION", entityId: id,
        });
        await notifyRole("SALES", {
          type: "QUOTATION_SENT", title: "Quotation sent",
          body: `Quotation sent: ${existing.quotationNumber} — ${updated.title}`,
          entityType: "QUOTATION", entityId: id,
        });
      }
    } else if (hasFieldEdits) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "QUOTATION", entityId: id,
        metadata: { quotationNumber: existing.quotationNumber, fields: Object.keys(body).filter((k) => k !== "items") },
      });
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "UPDATED",
        entityType: "QUOTATION", entityId: id,
        title: `Quotation ${existing.quotationNumber} updated`,
      });
    }

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/quotations/[id] — only drafts can be deleted (quotations.delete) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("quotations.delete");
    const { id } = await params;

    const quotation = await db.quotation.findUnique({ where: { id } });
    if (!quotation) throw new ApiError(404, "NOT_FOUND", "Quotation not found.");
    if (quotation.status !== "DRAFT") {
      throw new ApiError(409, "NOT_DRAFT", "Only draft quotations can be deleted.");
    }

    await db.quotation.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "QUOTATION", entityId: id,
      metadata: { quotationNumber: quotation.quotationNumber },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
