import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const PLANS = ["BASIC", "STANDARD", "PREMIUM", "CUSTOM"] as const;

const CreateSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  projectId: optionalText(40),
  plan: z.enum(PLANS).default("STANDARD"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().datetime().nullable().optional(),
  includedHours: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().positive("Included hours must be greater than 0").max(10000).nullable()
  ),
  notes: optionalText(2000),
});

const serializePlan = (p: {
  id: string; plan: string; startDate: Date; endDate: Date | null;
  includedHours: number | null; usedHours: number; status: string; notes: string | null;
  createdAt: Date; updatedAt: Date;
  client: { id: string; companyName: string } | null;
  project?: { id: string; name: string; projectNumber: string } | null;
  _count?: { logs: number };
}) => ({
  id: p.id, plan: p.plan, startDate: p.startDate, endDate: p.endDate,
  includedHours: p.includedHours, usedHours: p.usedHours, status: p.status, notes: p.notes,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
  client: p.client, project: p.project ?? null,
  logsCount: p._count?.logs ?? 0,
});

const planInclude = {
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true, projectNumber: true } },
} satisfies Prisma.MaintenancePlanInclude;

// ---- GET /api/maintenance?status=&clientId=&projectId=&q=&page= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("maintenance.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = (sp.get("status") || "").trim();
    const clientId = (sp.get("clientId") || "").trim();
    const projectId = (sp.get("projectId") || "").trim();

    const where: Prisma.MaintenancePlanWhereInput = { deletedAt: null };
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    if (q) {
      where.OR = [
        { client: { companyName: { contains: q } } },
        { project: { name: { contains: q } } },
      ];
    }

    const scoped = { deletedAt: null } satisfies Prisma.MaintenancePlanWhereInput;
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);

    const [rows, total, byStatus, hoursAgg, expiringSoon, activeCount] = await Promise.all([
      db.maintenancePlan.findMany({
        where,
        orderBy: [{ startDate: "desc" }],
        skip, take,
        include: { ...planInclude, _count: { select: { logs: true } } },
      }),
      db.maintenancePlan.count({ where }),
      db.maintenancePlan.groupBy({ by: ["status"], _count: { _all: true }, where: scoped }),
      db.maintenancePlan.aggregate({
        where: { ...scoped, includedHours: { not: null } },
        _sum: { includedHours: true, usedHours: true },
      }),
      db.maintenancePlan.count({
        where: { ...scoped, status: "ACTIVE", endDate: { not: null, lte: in30 } },
      }),
      db.maintenancePlan.count({ where: { ...scoped, status: "ACTIVE" } }),
    ]);

    return ok({
      items: rows.map(serializePlan),
      total, page, pageSize,
      summary: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        activeCount,
        expiringSoon,
        includedHours: hoursAgg._sum.includedHours ?? 0,
        usedHours: Math.round((hoursAgg._sum.usedHours ?? 0) * 100) / 100,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/maintenance ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("maintenance.create");
    const body = await parseBody(req, CreateSchema);

    const client = await db.client.findUnique({ where: { id: body.clientId } });
    if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client no longer exists.");

    if (body.projectId) {
      const project = await db.project.findUnique({ where: { id: body.projectId } });
      if (!project) throw new ApiError(400, "INVALID_PROJECT", "The selected project no longer exists.");
      if (project.clientId !== body.clientId) {
        throw new ApiError(400, "PROJECT_MISMATCH", "The selected project does not belong to this client.");
      }
    }

    const start = new Date(body.startDate);
    if (isNaN(start.getTime())) throw new ApiError(400, "VALIDATION_ERROR", "startDate: Invalid date.");

    const plan = await db.maintenancePlan.create({
      data: {
        clientId: body.clientId,
        projectId: body.projectId ?? null,
        plan: body.plan,
        startDate: start,
        endDate: body.endDate ? new Date(body.endDate) : null,
        includedHours: body.includedHours ?? null,
        status: "ACTIVE",
        notes: body.notes ?? null,
      },
      include: { ...planInclude, _count: { select: { logs: true } } },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "MAINTENANCE", entityId: plan.id,
      title: `Maintenance plan created for ${client.companyName}`,
      description: `${plan.plan} plan — ${plan.includedHours != null ? `${plan.includedHours}h included` : "unlimited hours"}.`,
      metadata: { plan: plan.plan },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "MAINTENANCE", entityId: plan.id,
      metadata: { client: client.companyName, tier: plan.plan }, ip: clientIp(req),
    });

    return ok(serializePlan(plan), 201);
  } catch (e) {
    return handleError(e);
  }
}
