import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, ApiError,
} from "@/lib/api-helpers";

const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const CATEGORIES = ["HOSTING", "DOMAIN", "SOFTWARE", "MARKETING", "OPERATIONS", "OTHER"] as const;

const CreateSchema = z.object({
  category: z.enum(CATEGORIES).default("OTHER"),
  description: z.string().trim().min(2, "Description is required").max(300),
  amount: z.number().positive("Amount must be greater than 0"),
  date: z.string().datetime().optional(),
  vendor: optionalText(120),
  projectId: optionalText(40),
});

const PatchSchema = CreateSchema.partial();

function serializeExpense(ex: {
  id: string; category: string; description: string; amount: number; date: Date;
  vendor: string | null; projectId: string | null; createdAt: Date;
  project?: { id: string; name: string; projectNumber: string } | null;
}) {
  return {
    id: ex.id, category: ex.category, description: ex.description, amount: ex.amount,
    date: ex.date, vendor: ex.vendor, projectId: ex.projectId, createdAt: ex.createdAt,
    project: ex.project ?? null,
  };
}

// ---- GET /api/expenses?category=&projectId=&from=&to=&q=&page= ----
export async function GET(req: NextRequest) {
  try {
    await requirePermission("expenses.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const category = (sp.get("category") || "").trim();
    const projectId = (sp.get("projectId") || "").trim();
    const from = sp.get("from");
    const to = sp.get("to");

    const where: Prisma.ExpenseWhereInput = {};
    if (category) where.category = category;
    if (projectId) where.projectId = projectId;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }
    if (q) {
      where.OR = [{ description: { contains: q } }, { vendor: { contains: q } }];
    }

    const [rows, total, agg, byCategory] = await Promise.all([
      db.expense.findMany({
        where,
        orderBy: { date: "desc" },
        skip, take,
        include: { project: { select: { id: true, name: true, projectNumber: true } } },
      }),
      db.expense.count({ where }),
      db.expense.aggregate({ _sum: { amount: true }, where: {} }),
      db.expense.groupBy({ by: ["category"], _sum: { amount: true }, where: {} }),
    ]);

    return ok({
      items: rows.map(serializeExpense),
      total, page, pageSize,
      summary: {
        total: agg._sum.amount ?? 0,
        byCategory: byCategory.map((c) => ({ category: c.category, amount: c._sum.amount ?? 0 })),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/expenses ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("expenses.create");
    const body = await parseBody(req, CreateSchema);

    if (body.projectId) {
      const project = await db.project.findUnique({ where: { id: body.projectId } });
      if (!project) throw new ApiError(400, "INVALID_PROJECT", "The selected project no longer exists.");
    }

    const expense = await db.expense.create({
      data: {
        category: body.category,
        description: body.description,
        amount: body.amount,
        date: body.date ? new Date(body.date) : new Date(),
        vendor: body.vendor ?? null,
        projectId: body.projectId ?? null,
        createdById: session.user.id,
      },
      include: { project: { select: { id: true, name: true, projectNumber: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "FINANCE_ACTION", entityType: "EXPENSE", entityId: expense.id,
      metadata: { amount: body.amount, category: body.category }, ip: clientIp(req),
    });

    return ok(serializeExpense(expense), 201);
  } catch (e) {
    return handleError(e);
  }
}
