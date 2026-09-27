import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, parseBody,
  logAudit, logActivity, createNotification, ApiError, handleError,
} from "@/lib/api-helpers";

/** Recompute project progress after task status/deletion changes. */
async function recomputeProjectProgress(projectId: string): Promise<void> {
  const [total, done] = await Promise.all([
    db.task.count({ where: { projectId, deletedAt: null } }),
    db.task.count({ where: { projectId, deletedAt: null, status: "DONE" } }),
  ]);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  await db.project.update({ where: { id: projectId }, data: { progress } });
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function normalizeLabels(input: string | string[] | null | undefined): string | null {
  let list: string[] = [];
  if (Array.isArray(input)) list = input.map((l) => l.trim());
  else if (typeof input === "string") list = input.split(",").map((l) => l.trim());
  list = list.filter((l) => l.length > 0);
  return list.length > 0 ? JSON.stringify(list) : null;
}

const TASK_INCLUDE = {
  project: { select: { id: true, name: true } },
  phase: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, avatarColor: true } },
  reporter: { select: { id: true, name: true, avatarColor: true } },
  checklist: { orderBy: [{ order: "asc" }, { id: "asc" }], select: { id: true, text: true, isDone: true, order: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

type TaskDetailPayload = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

function serializeDetail(t: TaskDetailPayload) {
  const { _count, ...rest } = t;
  return {
    ...rest,
    labels: parseLabels(rest.labels),
    commentsCount: _count.comments,
  };
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  status: z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assigneeId: z.string().min(1).nullish(),
  dueDate: z.union([z.string(), z.null()]).optional(),
  estimatedHours: z.number().nullish(),
  actualHours: z.number().nullish(),
  labels: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  position: z.number().int().optional(),
});

// ---- GET /api/tasks/[id] (tasks.view)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("tasks.view");
    const { id } = await params;

    const task = await db.task.findUnique({ where: { id }, include: TASK_INCLUDE });
    if (!task || task.deletedAt) throw new ApiError(404, "NOT_FOUND", "Task not found.");

    return ok({ task: serializeDetail(task) });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/tasks/[id] (tasks.edit)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tasks.edit");
    const { id } = await params;
    const data = await parseBody(req, updateSchema);

    const existing = await db.task.findUnique({
      where: { id },
      include: { assignee: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    });
    if (!existing || existing.deletedAt) throw new ApiError(404, "NOT_FOUND", "Task not found.");

    const patch: Prisma.TaskUncheckedUpdateInput = {};
    const activityLogs: { title: string; description?: string }[] = [];
    let assigneeChangedTo: string | null | undefined;
    let newAssigneeName: string | null = null;

    // Assignee change (assigning to others requires tasks.assign; self-assign allowed)
    if (data.assigneeId !== undefined && data.assigneeId !== existing.assigneeId) {
      if (data.assigneeId && data.assigneeId !== session.user.id) {
        if (!session.user.permissions.includes("tasks.assign")) {
          throw new ApiError(403, "FORBIDDEN", "You need the tasks.assign permission to assign tasks to others.");
        }
        const user = await db.user.findUnique({ where: { id: data.assigneeId }, select: { id: true, name: true } });
        if (!user) throw new ApiError(400, "INVALID_ASSIGNEE", "The selected assignee does not exist.");
        newAssigneeName = user.name;
      }
      patch.assigneeId = data.assigneeId;
      assigneeChangedTo = data.assigneeId;
      activityLogs.push({
        title: "Task reassigned",
        description: data.assigneeId
          ? `${existing.assignee?.name ?? "Unassigned"} → ${newAssigneeName ?? data.assigneeId}`
          : `Unassigned from ${existing.assignee?.name ?? "nobody"}`,
      });
    }

    // Status change
    if (data.status !== undefined && data.status !== existing.status) {
      patch.status = data.status;
      patch.completedAt = data.status === "DONE" ? new Date() : null;
      activityLogs.push({ title: "Task status changed", description: `${existing.status} → ${data.status}` });
    }

    if (data.title !== undefined && data.title !== existing.title) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.priority !== undefined && data.priority !== existing.priority) {
      patch.priority = data.priority;
      activityLogs.push({ title: "Task priority changed", description: `${existing.priority} → ${data.priority}` });
    }
    if (data.dueDate !== undefined) patch.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.estimatedHours !== undefined) patch.estimatedHours = data.estimatedHours;
    if (data.actualHours !== undefined) patch.actualHours = data.actualHours;
    if (data.labels !== undefined) patch.labels = normalizeLabels(data.labels);
    if (data.position !== undefined) patch.position = data.position;

    const updated = await db.task.update({
      where: { id },
      data: patch,
      include: TASK_INCLUDE,
    });

    // Notifications + activity logs
    const baseLog = {
      actorId: session.user.id, actorName: session.user.name,
      entityType: existing.projectId ? "PROJECT" : "TASK",
      entityId: existing.projectId ?? id,
    };

    await Promise.all([
      ...(assigneeChangedTo && assigneeChangedTo !== session.user.id
        ? [createNotification({
            userId: assigneeChangedTo,
            type: "TASK_ASSIGNED",
            title: `Task assigned to you: ${updated.title}`,
            body: existing.project?.name ? `Project: ${existing.project.name}` : undefined,
            entityType: "TASK",
            entityId: id,
          })]
        : []),
      ...activityLogs.map((log) => logActivity({ ...baseLog, type: "UPDATED", title: log.title, description: log.description })),
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "UPDATE", entityType: "TASK", entityId: id,
        metadata: { fields: Object.keys(patch), projectId: existing.projectId },
      }),
      ...(existing.projectId && (data.status !== undefined || data.assigneeId !== undefined)
        ? [recomputeProjectProgress(existing.projectId)]
        : []),
    ]);

    if (activityLogs.length === 0 && existing.projectId) {
      await logActivity({ ...baseLog, type: "UPDATED", title: `Task updated: ${updated.title}` });
    }

    return ok({ task: serializeDetail(updated) });
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/tasks/[id] (tasks.delete) — soft delete
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("tasks.delete");
    const { id } = await params;

    const existing = await db.task.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!existing || existing.deletedAt) throw new ApiError(404, "NOT_FOUND", "Task not found.");

    await db.task.update({ where: { id }, data: { deletedAt: new Date() } });

    await Promise.all([
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "DELETE", entityType: "TASK", entityId: id,
        metadata: { title: existing.title, projectId: existing.projectId },
      }),
      ...(existing.projectId
        ? [
            logActivity({
              actorId: session.user.id, actorName: session.user.name,
              type: "UPDATED", entityType: "PROJECT", entityId: existing.projectId,
              title: `Task deleted: ${existing.title}`,
            }),
            recomputeProjectProgress(existing.projectId),
          ]
        : []),
    ]);

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
