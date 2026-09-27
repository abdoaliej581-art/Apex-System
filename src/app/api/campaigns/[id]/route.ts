import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  objective: optionalText(500),
  audience: optionalText(300),
  platform: optionalText(120),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  budget: z.number().min(0).transform((v) => Math.round(v * 100) / 100).nullable().optional(),
  notes: optionalText(2000),
  status: z.enum(["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
});

// ---- GET /api/campaigns/[id] ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("campaigns.view");
    const { id } = await params;

    const campaign = await db.campaign.findUnique({
      where: { id },
      include: {
        contents: {
          orderBy: [{ publishDate: "asc" }, { createdAt: "desc" }],
          include: {
            author: { select: { id: true, name: true, avatarColor: true } },
          },
        },
      },
    });
    if (!campaign) throw new ApiError(404, "NOT_FOUND", "This campaign no longer exists.");

    const activities = await db.activity.findMany({
      where: { entityType: "CAMPAIGN", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { name: true, avatarColor: true } } },
    });

    // Split contents out of the campaign object so the list/detail shapes stay consistent
    const { contents, ...campaignFields } = campaign;
    return ok({ campaign: campaignFields, contents, activities });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/campaigns/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("campaigns.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.campaign.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This campaign no longer exists.");

    const nextStart = body.startDate === undefined ? existing.startDate : (body.startDate ? new Date(body.startDate) : null);
    const nextEnd = body.endDate === undefined ? existing.endDate : (body.endDate ? new Date(body.endDate) : null);
    if (nextStart && nextEnd && nextEnd < nextStart) {
      throw new ApiError(400, "INVALID_DATES", "End date cannot be before the start date.");
    }

    const campaign = await db.campaign.update({
      where: { id },
      data: {
        name: body.name,
        objective: body.objective,
        audience: body.audience,
        platform: body.platform,
        startDate: body.startDate === undefined ? undefined : (body.startDate ? new Date(body.startDate) : null),
        endDate: body.endDate === undefined ? undefined : (body.endDate ? new Date(body.endDate) : null),
        budget: body.budget,
        notes: body.notes,
        status: body.status,
      },
      include: { _count: { select: { contents: true } } },
    });

    const statusChanged = body.status && body.status !== existing.status;
    if (statusChanged) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "STATUS_CHANGE", entityType: "CAMPAIGN", entityId: id,
        title: `Campaign moved to ${body.status}: ${campaign.name}`,
        description: `${existing.status} → ${body.status}`,
        metadata: { from: existing.status, to: body.status },
      });
    }
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: statusChanged ? "STATUS_CHANGE" : "MARKETING_ACTION", entityType: "CAMPAIGN", entityId: id,
      metadata: { changes: Object.keys(body), ...(statusChanged ? { from: existing.status, to: body.status } : {}) },
      ip: clientIp(req),
    });

    return ok(campaign);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/campaigns/[id] ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("campaigns.delete");
    const { id } = await params;
    const existing = await db.campaign.findUnique({
      where: { id },
      include: { _count: { select: { contents: true } } },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This campaign no longer exists.");

    // Contents survive with campaignId = null (schema onDelete: SetNull) — warn via metadata
    await db.campaign.delete({ where: { id } });
    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "MARKETING", entityType: "CAMPAIGN", entityId: id,
      title: `Campaign deleted: ${existing.name}`,
      description: existing._count.contents > 0 ? `${existing._count.contents} linked content items kept (unlinked).` : undefined,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "CAMPAIGN", entityId: id,
      metadata: { name: existing.name, unlinkedContents: existing._count.contents }, ip: clientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
