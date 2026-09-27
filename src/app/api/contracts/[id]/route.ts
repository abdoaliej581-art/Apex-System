import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, logAudit, logActivity, notifyRole, ApiError } from "@/lib/api-helpers";

const PatchSchema = z.object({
  clientId: z.string().optional(),
  title: z.string().min(2).optional(),
  projectId: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  deliverables: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  revisionTerms: z.string().nullable().optional(),
  maintenanceTerms: z.string().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  documentUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "SENT", "SIGNED", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
});

/** DRAFT → SENT → SIGNED → ACTIVE → COMPLETED / CANCELLED */
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["SIGNED", "CANCELLED"],
  SIGNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** GET /api/contracts/[id] — full detail + activities */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("contracts.view");
    const { id } = await params;

    const contract = await db.contract.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true, email: true, phone: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
        proposal: { select: { id: true, proposalNumber: true, title: true } },
      },
    });
    if (!contract) throw new ApiError(404, "NOT_FOUND", "Contract not found.");

    const activities = await db.activity.findMany({
      where: { entityType: "CONTRACT", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return ok({
      ...contract,
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

/** PATCH /api/contracts/[id] — update fields or transition status (contracts.edit) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("contracts.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.contract.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Contract not found.");

    let statusChanged: string | null = null;
    if (body.status && body.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(409, "INVALID_TRANSITION", `Cannot move a ${existing.status.toLowerCase()} contract to ${body.status.toLowerCase()}.`);
      }
      statusChanged = body.status;
    }

    // Contract terms are legal text — only editable before signature
    const hasFieldEdits = Object.entries(body).some(
      ([k, v]) => v !== undefined && !["status", "projectId", "proposalId", "notes"].includes(k)
    );
    if (hasFieldEdits && !["DRAFT", "SENT"].includes(existing.status)) {
      throw new ApiError(409, "LOCKED", "Contract terms can only be edited while the contract is a draft or awaiting signature.");
    }

    if (body.clientId && body.clientId !== existing.clientId) {
      if (!(await db.client.findUnique({ where: { id: body.clientId } })))
        throw new ApiError(400, "VALIDATION_ERROR", "clientId: The selected client no longer exists.");
    }
    if (body.projectId && !(await db.project.findUnique({ where: { id: body.projectId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "projectId: The selected project no longer exists.");
    if (body.proposalId && !(await db.proposal.findUnique({ where: { id: body.proposalId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "proposalId: The selected proposal no longer exists.");

    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || k === "status") continue;
      data[k] = v;
    }
    if (statusChanged === "SIGNED") data.signedDate = new Date();
    if (statusChanged) data.status = statusChanged;
    if (statusChanged === "ACTIVE" && !existing.startDate && !body.startDate) data.startDate = new Date();

    const updated = await db.contract.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
        proposal: { select: { id: true, proposalNumber: true, title: true } },
      },
    });

    if (statusChanged) {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "STATUS_CHANGE", entityType: "CONTRACT", entityId: id,
        metadata: { from: existing.status, to: statusChanged, contractNumber: existing.contractNumber },
      });
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "STATUS_CHANGED",
        entityType: "CONTRACT", entityId: id,
        title: statusChanged === "SIGNED"
          ? "Contract signed"
          : `Contract ${existing.contractNumber} ${statusChanged.toLowerCase()}`,
      });
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "CONTRACT",
        entityType: "CLIENT", entityId: updated.clientId,
        title: statusChanged === "SIGNED"
          ? "Contract signed"
          : `Contract ${existing.contractNumber} ${statusChanged.toLowerCase()}`,
        description: updated.title,
        metadata: { contractId: id },
      });
      // Signing is a revenue milestone — leadership must know (spec §Contracts)
      if (statusChanged === "SIGNED") {
        await notifyRole("SUPER_ADMIN", {
          type: "CONTRACT_SIGNED", title: "Contract signed",
          body: `Contract signed: ${existing.contractNumber} — ${updated.title}`,
          entityType: "CONTRACT", entityId: id,
        });
        await notifyRole("ADMIN", {
          type: "CONTRACT_SIGNED", title: "Contract signed",
          body: `Contract signed: ${existing.contractNumber} — ${updated.title}`,
          entityType: "CONTRACT", entityId: id,
        });
      }
    } else {
      await logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "CONTRACT", entityId: id,
        metadata: { contractNumber: existing.contractNumber, fields: Object.keys(body) },
      });
    }

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/contracts/[id] — only drafts can be deleted (contracts.delete) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("contracts.delete");
    const { id } = await params;

    const contract = await db.contract.findUnique({ where: { id } });
    if (!contract) throw new ApiError(404, "NOT_FOUND", "Contract not found.");
    if (contract.status !== "DRAFT") {
      throw new ApiError(409, "NOT_DRAFT", "Only draft contracts can be deleted.");
    }

    await db.contract.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "CONTRACT", entityId: id,
      metadata: { contractNumber: contract.contractNumber },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
