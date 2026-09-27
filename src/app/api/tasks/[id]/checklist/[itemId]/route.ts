import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, ApiError, handleError } from "@/lib/api-helpers";

// ---- PATCH /api/tasks/[id]/checklist/[itemId] { isDone?, text? } (tasks.edit)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    await requirePermission("tasks.edit");
    const { id, itemId } = await params;
    const data = await parseBody(req, z.object({
      isDone: z.boolean().optional(),
      text: z.string().min(1).optional(),
    }));

    const item = await db.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item || item.taskId !== id) throw new ApiError(404, "NOT_FOUND", "Checklist item not found.");

    const updated = await db.taskChecklistItem.update({
      where: { id: itemId },
      data: {
        ...(data.isDone !== undefined ? { isDone: data.isDone } : {}),
        ...(data.text !== undefined ? { text: data.text } : {}),
      },
    });

    return ok({ item: updated });
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/tasks/[id]/checklist/[itemId] (tasks.edit)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    await requirePermission("tasks.edit");
    const { id, itemId } = await params;

    const item = await db.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item || item.taskId !== id) throw new ApiError(404, "NOT_FOUND", "Checklist item not found.");

    await db.taskChecklistItem.delete({ where: { id: itemId } });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
