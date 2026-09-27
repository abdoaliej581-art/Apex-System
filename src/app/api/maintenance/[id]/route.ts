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

const PLANS = ["BASIC", "STANDARD", "PREMIUM", "CUSTOM"] as const;
const STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED"] as const;
const TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["EXPIRED", "CANCELLED"],
  EXPIRED: ["ACTIVE"],
  CANCELLED: ["ACTIVE"],
};

const PatchSchema = z.object({
  plan: z.enum(PLANS).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().nullable().optional(),
  includedHours: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().positive("Included hours must be greater than 0").max(10000).nullable().optional()
  ),
  notes: optionalText(2000),
  status: z.enum(STATUSES).optional(),
  projectId: optionalText(40),
  // usedHours intentionally NOT patchable — hours are only recorded via /hours logs
});

// ---- GET /api/maintenance/[id] ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("maintenance.view");
    const { id } = await params;

    const plan = await db.maintenancePlan.findFirst({
      where: { id, deletedAt: null },
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    });
    if (!plan) throw new ApiError(404, "NOT_FOUND", "This maintenance plan no longer exists.");

    const logs = await db.maintenanceLog.findMany({
      where: { planId: id },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      take: 50,
    });

    const activities = await db.activity.findMany({
      where: { entityType: "MAINTENANCE", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { name: true, avatarColor: true } } },
    });
    const actorIds = [...new Set(activities.map((a) => a.actorId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, avatarColor: true } })
      : [];
    const colorById = new Map(actors.map((u) => [u.id, u.avatarColor]));

    return ok({
      plan,
      logs: logs.map((l) => ({
        id: l.id, hours: l.hours, note: l.note, spentOn: l.spentOn,
        createdAt: l.createdAt, loggedById: l.loggedById, loggedByName: l.loggedByName,
      })),
      activities: activities.map((a) => ({
        id: a.id, title: a.title, description: a.description, createdAt: a.createdAt,
        actorName: a.actorName, actorColor: a.actorId ? colorById.get(a.actorId) ?? null : null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/maintenance/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("maintenance.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.maintenancePlan.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This maintenance plan no longer exists.");

    const data: Record<string, unknown> = {};
    if (body.plan !== undefined) data.plan = body.plan;
    if (body.includedHours !== undefined) data.includedHours = body.includedHours;
    if (body.notes !== undefined) data.notes = body.notes;

    if (body.startDate !== undefined) {
      const start = new Date(body.startDate);
      if (isNaN(start.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "startDate: Invalid date.");
      data.startDate = start;
    }
    if (body.endDate !== undefined) {
      data.endDate = body.endDate ? new Date(body.endDate) : null;
    }
    const nextStart = (data.startDate as Date | undefined) ?? existing.startDate;
    const nextEnd = (data.endDate as Date | null | undefined) ?? existing.endDate;
    if (nextStart && nextEnd && nextEnd < nextStart) {
      throw new ApiError(400, "INVALID_DATES", "End date cannot be before the start date.");
    }

    if (body.projectId !== undefined) {
      if (body.projectId) {
        const project = await db.project.findUnique({ where: { id: body.projectId } });
        if (!project) throw new ApiError(400, "INVALID_PROJECT", "The selected project no longer exists.");
        if (project.clientId !== existing.clientId) {
          throw new ApiError(400, "PROJECT_MISMATCH", "The selected project does not belong to this plan's client.");
        }
      }
      data.projectId = body.projectId;
    }

    let statusChanged = false;
    if (body.status && body.status !== existing.status) {
      const allowed = TRANSITIONS[existing.status] || [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(400, "INVALID_TRANSITION", `A ${existing.status.toLowerCase()} plan cannot move to ${body.status.toLowerCase()}.`);
      }
      data.status = body.status;
      statusChanged = true;
    }

    const plan = await db.maintenancePlan.update({
      where: { id },
      data,
      include: {
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true, projectNumber: true } },
      },
    });

    if (statusChanged) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "STATUS_CHANGE", entityType: "MAINTENANCE", entityId: id,
        title: `Maintenance plan ${plan.status.toLowerCase()}: ${plan.client.companyName}`,
        description: `${existing.status} → ${plan.status}`,
        metadata: { from: existing.status, to: plan.status },
      });
    }

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: statusChanged ? "STATUS_CHANGE" : "SUPPORT_ACTION", entityType: "MAINTENANCE", entityId: id,
      metadata: { changes: Object.keys(body) }, ip: clientIp(req),
    });

    return ok(plan);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/maintenance/[id] — soft archive (§64) ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("maintenance.delete");
    const { id } = await params;

    const existing = await db.maintenancePlan.findFirst({
      where: { id, deletedAt: null },
      include: { client: { select: { companyName: true } } },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This maintenance plan no longer exists.");

    await db.maintenancePlan.update({ where: { id }, data: { deletedAt: new Date() } });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "MAINTENANCE", entityId: id,
      title: `Maintenance plan archived: ${existing.client.companyName}`,
      description: `${existing.plan} plan archived — hour history is preserved.`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "ARCHIVE", entityType: "MAINTENANCE", entityId: id,
      metadata: { plan: existing.plan, client: existing.client.companyName }, ip: clientIp(req),
    });

    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
