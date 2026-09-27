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
  problem: z.string().nullable().optional(),
  solution: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
  deliverables: z.array(z.string().min(1)).nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  currency: z.enum(["EGP", "USD", "SAR"]).optional(),
  discountAmount: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  paymentTerms: z.string().nullable().optional(),
  revisionPolicy: z.string().nullable().optional(),
  maintenanceTerms: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(ItemSchema).optional(),
  status: z.enum(["DRAFT", "SENT", "VIEWED", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
});

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT"],
  SENT: ["VIEWED", "ACCEPTED", "REJECTED", "EXPIRED"],
  VIEWED: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

/** GET /api/proposals/[id] — full detail + items + activities */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("proposals.view");
    const { id } = await params;

    const proposal = await db.proposal.findUnique({
      where: { id },
      include: {
        items: { orderBy: { order: "asc" } },
        lead: { select: { id: true, companyName: true, contactName: true, email: true, phone: true } },
        client: { select: { id: true, companyName: true, email: true, phone: true } },
      },
    });
    if (!proposal) throw new ApiError(404, "NOT_FOUND", "Proposal not found.");

    const activities = await db.activity.findMany({
      where: { entityType: "PROPOSAL", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return ok({
      ...proposal,
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

/** PATCH /api/proposals/[id] — update fields/items or transition status (proposals.edit) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("proposals.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.proposal.findUnique({
      where: { id },
      include: { items: { orderBy: { order: "asc" } } },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Proposal not found.");

    // ---- Status transition
    let statusChanged: string | null = null;
    if (body.status && body.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(409, "INVALID_TRANSITION", `Cannot move a ${existing.status.toLowerCase()} proposal to ${body.status.toLowerCase()}.`);
      }
      statusChanged = body.status;
    }

    // ---- Content lock: accepted/rejected proposals are historical records
    if (["ACCEPTED", "REJECTED"].includes(existing.status) && !statusChanged) {
      throw new ApiError(409, "LOCKED", "Accepted or rejected proposals can no longer be edited.");
    }

    const hasFieldEdits = Object.entries(body).some(
      ([k, v]) => v !== undefined && !["status", "items"].includes(k)
    );

    const updated = await db.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined || k === "status" || k === "items") continue;
        data[k] = k === "deliverables"
          ? (Array.isArray(v) && (v as string[]).length > 0 ? JSON.stringify(v) : null)
          : v;
      }
      if (statusChanged === "SENT") data.sentAt = new Date();
      if (statusChanged && ["VIEWED", "ACCEPTED", "REJECTED"].includes(statusChanged)) data.respondedAt = new Date();
      if (statusChanged) data.status = statusChanged;

      // Replace items when provided, always recomputing totals server-side
      let items = existing.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice }));
      if (body.items) {
        await tx.proposalItem.deleteMany({ where: { proposalId: id } });
        if (body.items.length > 0) {
          await tx.proposalItem.createMany({
            data: body.items.map((i, idx) => ({
              proposalId: id,
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

      return tx.proposal.update({
        where: { id },
        data,
        include: { items: { orderBy: { order: "asc" } } },
      });
    });

    const relatedParty = updated.leadId ?? updated.clientId;
    const partyLabel = updated.leadId ? "lead" : updated.clientId ? "client" : null;

    if (statusChanged) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "STATUS_CHANGE", entityType: "PROPOSAL", entityId: id,
        metadata: { from: existing.status, to: statusChanged, proposalNumber: existing.proposalNumber },
      });
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "STATUS_CHANGED",
        entityType: "PROPOSAL", entityId: id,
        title: `Proposal ${existing.proposalNumber} ${statusChanged.toLowerCase()}`,
      });
      if (partyLabel && relatedParty) {
        await logActivity({
          actorId: session.user.id, actorName: session.user.name, type: "PROPOSAL",
          entityType: partyLabel.toUpperCase(), entityId: relatedParty,
          title: `Proposal ${existing.proposalNumber} ${statusChanged.toLowerCase()}`,
          metadata: { proposalId: id },
        });
      }
      if (statusChanged === "SENT") {
        await notifyRole("SUPER_ADMIN", {
          type: "PROPOSAL_SENT", title: `Proposal sent: ${existing.proposalNumber}`,
          body: `${updated.title} — sent by ${session.user.name}.`,
          entityType: "PROPOSAL", entityId: id,
        });
        await notifyRole("ADMIN", {
          type: "PROPOSAL_SENT", title: `Proposal sent: ${existing.proposalNumber}`,
          body: `${updated.title} — sent by ${session.user.name}.`,
          entityType: "PROPOSAL", entityId: id,
        });
        await notifyRole("SALES", {
          type: "PROPOSAL_SENT", title: `Proposal sent: ${existing.proposalNumber}`,
          body: `${updated.title} — sent by ${session.user.name}.`,
          entityType: "PROPOSAL", entityId: id,
        });
      }
    } else if (hasFieldEdits) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "PROPOSAL", entityId: id,
        metadata: { proposalNumber: existing.proposalNumber, fields: Object.keys(body).filter((k) => k !== "items") },
      });
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "UPDATED",
        entityType: "PROPOSAL", entityId: id,
        title: `Proposal ${existing.proposalNumber} updated`,
      });
    }

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/proposals/[id] — only drafts can be deleted (proposals.delete) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("proposals.delete");
    const { id } = await params;

    const proposal = await db.proposal.findUnique({ where: { id } });
    if (!proposal) throw new ApiError(404, "NOT_FOUND", "Proposal not found.");
    if (proposal.status !== "DRAFT") {
      throw new ApiError(409, "NOT_DRAFT", "Only draft proposals can be deleted.");
    }

    await db.proposal.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "PROPOSAL", entityId: id,
      metadata: { proposalNumber: proposal.proposalNumber },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
