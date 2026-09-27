import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";

const HoursSchema = z.object({
  hours: z.number().positive("Hours must be greater than 0").max(500, "Hours looks too large — split the entry."),
  note: z.string().trim().max(500).nullable().optional(),
  spentOn: z.string().datetime().optional(),
});

// ---- POST /api/maintenance/[id]/hours — log time against a plan (source of truth for usedHours) ----
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("maintenance.edit");
    const { id } = await params;
    const body = await parseBody(req, HoursSchema);

    const plan = await db.maintenancePlan.findFirst({
      where: { id, deletedAt: null },
      include: { client: { select: { companyName: true } } },
    });
    if (!plan) throw new ApiError(404, "NOT_FOUND", "This maintenance plan no longer exists.");
    if (plan.status !== "ACTIVE") {
      throw new ApiError(400, "PLAN_INACTIVE", "Hours can only be logged on an active plan.");
    }

    const rounded = Math.round(body.hours * 100) / 100;
    const spentOn = body.spentOn ? new Date(body.spentOn) : new Date();

    // Log + usedHours recalc in ONE transaction (mirrors payments → invoice recalc)
    const result = await db.$transaction(async (tx) => {
      const log = await tx.maintenanceLog.create({
        data: {
          planId: id,
          hours: rounded,
          note: body.note ?? null,
          loggedById: session.user.id,
          loggedByName: session.user.name,
          spentOn,
        },
      });
      const agg = await tx.maintenanceLog.aggregate({ where: { planId: id }, _sum: { hours: true } });
      const updated = await tx.maintenancePlan.update({
        where: { id },
        data: { usedHours: Math.round((agg._sum.hours ?? 0) * 100) / 100 },
      });
      return { log, plan: updated };
    });

    const remaining = plan.includedHours != null ? plan.includedHours - result.plan.usedHours : null;

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "MAINTENANCE", entityId: id,
      title: `${rounded}h logged on ${plan.client.companyName} maintenance`,
      description: body.note ?? `Plan total: ${result.plan.usedHours}h used${remaining != null ? `, ${remaining}h remaining` : ""}.`,
      metadata: { hours: rounded, usedHours: result.plan.usedHours },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "HOURS_LOGGED", entityType: "MAINTENANCE", entityId: id,
      metadata: { hours: rounded, usedHours: result.plan.usedHours }, ip: clientIp(req),
    });

    return ok({
      id: result.log.id, hours: result.log.hours, note: result.log.note,
      spentOn: result.log.spentOn, createdAt: result.log.createdAt,
      loggedById: result.log.loggedById, loggedByName: result.log.loggedByName,
      usedHours: result.plan.usedHours,
      overBudget: plan.includedHours != null ? result.plan.usedHours > plan.includedHours : false,
    }, 201);
  } catch (e) {
    return handleError(e);
  }
}
