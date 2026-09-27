import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, createNotification, ApiError, handleError } from "@/lib/api-helpers";

// ---- GET /api/tasks/[id]/comments (tasks.view)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("tasks.view");
    const { id } = await params;

    const task = await db.task.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!task || task.deletedAt) throw new ApiError(404, "NOT_FOUND", "Task not found.");

    const comments = await db.taskComment.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
    });

    return ok({ comments });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/tasks/[id]/comments (tasks.view — any teammate can comment)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tasks.view");
    const { id } = await params;
    const data = await parseBody(req, z.object({ body: z.string().min(1, "Comment cannot be empty") }));

    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, title: true, assigneeId: true, projectId: true },
    });
    if (!task || task.deletedAt) throw new ApiError(404, "NOT_FOUND", "Task not found.");

    const comment = await db.taskComment.create({
      data: { taskId: id, authorId: session.user.id, body: data.body },
      include: { author: { select: { id: true, name: true, avatarColor: true } } },
    });

    // Notify the assignee about new comments (not when commenting on your own task)
    if (task.assigneeId && task.assigneeId !== session.user.id) {
      await createNotification({
        userId: task.assigneeId,
        type: "TASK_COMMENT",
        title: `New comment on: ${task.title}`,
        body: `${session.user.name ?? "A teammate"}: ${data.body.slice(0, 80)}`,
        entityType: "TASK",
        entityId: id,
      });
    }

    return ok({ comment }, 201);
  } catch (e) {
    return handleError(e);
  }
}
