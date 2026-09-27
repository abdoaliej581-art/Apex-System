import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, logAudit, clientIp, ApiError } from "@/lib/api-helpers";
import { z } from "zod";

const PatchSchema = z.object({
  category: z.enum(["HOSTING", "DOMAIN", "SOFTWARE", "MARKETING", "OPERATIONS", "OTHER"]).optional(),
  description: z.string().trim().min(2).max(300).optional(),
  amount: z.number().positive("Amount must be greater than 0").optional(),
  date: z.string().datetime().optional(),
  vendor: z.string().max(120).nullable().optional(),
  projectId: z.string().nullable().optional(),
});

// ---- PATCH /api/expenses/[id] ----
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("expenses.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This expense no longer exists.");

    const expense = await db.expense.update({
      where: { id },
      data: {
        category: body.category,
        description: body.description,
        amount: body.amount,
        date: body.date ? new Date(body.date) : undefined,
        vendor: body.vendor,
        projectId: body.projectId,
      },
      include: { project: { select: { id: true, name: true, projectNumber: true } } },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "FINANCE_ACTION", entityType: "EXPENSE", entityId: id,
      metadata: { changes: Object.keys(body) }, ip: clientIp(req),
    });

    return ok(expense);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/expenses/[id] ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("expenses.delete");
    const { id } = await params;
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "This expense no longer exists.");

    await db.expense.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "EXPENSE", entityId: id,
      metadata: { amount: existing.amount, category: existing.category }, ip: clientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
