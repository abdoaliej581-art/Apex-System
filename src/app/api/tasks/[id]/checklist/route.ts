import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, ApiError, handleError } from "@/lib/api-helpers";

// ---- POST /api/tasks/[id]/checklist { text } (tasks.edit)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("tasks.edit");
    const { id } = await params;
    const data = await parseBody(req, z.object({ text: z.string().min(1, "Checklist item text is required") }));

    const task = await db.task.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!task || task.deletedAt) throw new ApiError(404, "NOT_FOUND", "Task not found.");

    const maxOrder = await db.taskChecklistItem.aggregate({
      _max: { order: true },
      where: { taskId: id },
    });

    const item = await db.taskChecklistItem.create({
      data: {
        taskId: id,
        text: data.text,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    });

    return ok({ item }, 201);
  } catch (e) {
    return handleError(e);
  }
}
