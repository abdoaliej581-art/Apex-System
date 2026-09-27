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

const STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;

const CreateSchema = z.object({
  name: z.string().trim().min(2, "Campaign name is required").max(150),
  objective: optionalText(500),
  audience: optionalText(300),
  platform: optionalText(120),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  // Round money to 2 decimals to keep ledgers clean
  budget: z.number().min(0, "Budget cannot be negative").transform((v) => Math.round(v * 100) / 100).nullable().optional(),
  notes: optionalText(2000),
  status: z.enum(STATUSES).default("PLANNING"),
});

const serializeCampaign = (c: {
  id: string; name: string; objective: string | null; audience: string | null;
  platform: string | null; startDate: Date | null; endDate: Date | null; budget: number | null;
  notes: string | null; status: string; createdAt: Date; updatedAt: Date;
  _count?: { contents: number };
}) => ({
  id: c.id, name: c.name, objective: c.objective, audience: c.audience,
  platform: c.platform, startDate: c.startDate, endDate: c.endDate,
  budget: c.budget, notes: c.notes, status: c.status,
  createdAt: c.createdAt, updatedAt: c.updatedAt,
  contentCount: c._count?.contents ?? 0,
});

// ---- GET /api/campaigns?status=&q=&page=&pageSize= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("campaigns.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = (sp.get("status") || "").trim();

    const where: Prisma.CampaignWhereInput = {};
    if (status) where.status = status;
    if (q) {
      where.OR = [{ name: { contains: q } }, { objective: { contains: q } }, { audience: { contains: q } }];
    }

    const [rows, total, byStatus, budgetAgg] = await Promise.all([
      db.campaign.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip, take,
        include: { _count: { select: { contents: true } } },
      }),
      db.campaign.count({ where }),
      db.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
      db.campaign.aggregate({ _sum: { budget: true } }),
    ]);

    return ok({
      items: rows.map(serializeCampaign),
      total, page, pageSize,
      summary: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        totalBudget: budgetAgg._sum.budget ?? 0,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/campaigns ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("campaigns.create");
    const body = await parseBody(req, CreateSchema);

    if (body.startDate && body.endDate && new Date(body.endDate) < new Date(body.startDate)) {
      throw new ApiError(400, "INVALID_DATES", "End date cannot be before the start date.");
    }

    const campaign = await db.campaign.create({
      data: {
        name: body.name,
        objective: body.objective ?? null,
        audience: body.audience ?? null,
        platform: body.platform ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        budget: body.budget ?? null,
        notes: body.notes ?? null,
        status: body.status,
      },
      include: { _count: { select: { contents: true } } },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "MARKETING", entityType: "CAMPAIGN", entityId: campaign.id,
      title: `Campaign created: ${campaign.name}`,
      description: `Status ${campaign.status}${campaign.budget ? ` · budget ${campaign.budget.toLocaleString()} EGP` : ""}.`,
      metadata: { status: campaign.status, budget: campaign.budget },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "CAMPAIGN", entityId: campaign.id,
      metadata: { name: campaign.name }, ip: clientIp(req),
    });

    return ok(serializeCampaign(campaign), 201);
  } catch (e) {
    return handleError(e);
  }
}
