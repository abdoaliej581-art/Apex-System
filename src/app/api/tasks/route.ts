import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, parseBody, paginationFrom,
  logAudit, logActivity, createNotification, ApiError, handleError,
} from "@/lib/api-helpers";

/** Normalize labels input (string "a, b" | string[] | null) → JSON string or null */
function normalizeLabels(input: string | string[] | null | undefined): string | null {
  let list: string[] = [];
  if (Array.isArray(input)) list = input.map((l) => l.trim());
  else if (typeof input === "string") list = input.split(",").map((l) => l.trim());
  list = list.filter((l) => l.length > 0);
  return list.length > 0 ? JSON.stringify(list) : null;
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

const createSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().nullish(),
  projectId: z.string().min(1).nullish(),
  phaseId: z.string().min(1).nullish(),
  assigneeId: z.string().min(1).nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE"]).optional(),
  dueDate: z.string().nullish(),
  estimatedHours: z.number().nullish(),
  labels: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
});

const TASK_INCLUDE = {
  project: { select: { id: true, name: true } },
  phase: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, avatarColor: true } },
  _count: { select: { comments: true, checklist: true } },
  checklist: { select: { isDone: true } },
} satisfies Prisma.TaskInclude;

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

function serializeTask(t: TaskWithRelations) {
  const { checklist, _count, ...rest } = t;
  return {
    ...rest,
    labels: parseLabels(rest.labels),
    checklistDone: checklist.filter((c) => c.isDone).length,
    checklistTotal: checklist.length,
    commentsCount: _count.comments,
  };
}

// ---- GET /api/tasks?projectId=&assigneeId=&status=&priority=&q=&dueFrom=&dueTo=&view=my&page=
export async function GET(req: NextRequest) {
  try {
    const { session } = await requirePermission("tasks.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const where: Prisma.TaskWhereInput = { deletedAt: null };

    if (sp.get("view") === "my") {
      where.assigneeId = session.user.id;
    } else {
      const assigneeId = sp.get("assigneeId");
      if (assigneeId) where.assigneeId = assigneeId;
    }

    const projectId = sp.get("projectId");
    if (projectId) where.projectId = projectId;

    const phaseId = sp.get("phaseId");
    if (phaseId) where.phaseId = phaseId;

    const status = sp.get("status");
    if (status) where.status = status;

    const priority = sp.get("priority");
    if (priority) where.priority = priority;

    const q = sp.get("q");
    if (q) {
      where.OR = [{ title: { contains: q } }, { description: { contains: q } }];
    }

    const dueFrom = sp.get("dueFrom");
    const dueTo = sp.get("dueTo");
    if (dueFrom || dueTo) {
      where.dueDate = {
        ...(dueFrom ? { gte: new Date(dueFrom) } : {}),
        ...(dueTo ? { lte: new Date(dueTo) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      db.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      db.task.count({ where }),
    ]);

    return ok({ items: rows.map(serializeTask), total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/tasks (tasks.create)
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("tasks.create");
    const data = await parseBody(req, createSchema);

    // Resolve phase → project (phase must belong to the given project)
    let projectId = data.projectId ?? null;
    if (data.phaseId) {
      const phase = await db.projectPhase.findUnique({ where: { id: data.phaseId } });
      if (!phase) throw new ApiError(400, "INVALID_PHASE", "The selected phase does not exist.");
      if (projectId && phase.projectId !== projectId) {
        throw new ApiError(400, "INVALID_PHASE", "The selected phase does not belong to the selected project.");
      }
      projectId = projectId ?? phase.projectId;
    }

    let projectName: string | null = null;
    if (projectId) {
      const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, archivedAt: true } });
      if (!project || project.archivedAt) throw new ApiError(400, "INVALID_PROJECT", "The selected project does not exist.");
      projectName = project.name;
    }

    // Assigning to someone else requires tasks.assign; self-assign always allowed.
    if (data.assigneeId && data.assigneeId !== session.user.id) {
      if (!session.user.permissions.includes("tasks.assign")) {
        throw new ApiError(403, "FORBIDDEN", "You need the tasks.assign permission to assign tasks to others.");
      }
      const assignee = await db.user.findUnique({ where: { id: data.assigneeId }, select: { id: true } });
      if (!assignee) throw new ApiError(400, "INVALID_ASSIGNEE", "The selected assignee does not exist.");
    }

    const status = data.status ?? "BACKLOG";
    const maxPos = await db.task.aggregate({
      _max: { position: true },
      where: { status },
    });
    const position = (maxPos._max.position ?? 0) + 1;

    const task = await db.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        projectId,
        phaseId: data.phaseId ?? null,
        assigneeId: data.assigneeId ?? null,
        reporterId: session.user.id,
        priority: data.priority ?? "MEDIUM",
        status,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        estimatedHours: data.estimatedHours ?? null,
        labels: normalizeLabels(data.labels),
        position,
      },
      include: TASK_INCLUDE,
    });

    const serialized = serializeTask(task);

    await Promise.all([
      ...(data.assigneeId && data.assigneeId !== session.user.id
        ? [createNotification({
            userId: data.assigneeId,
            type: "TASK_ASSIGNED",
            title: `New task assigned: ${task.title}`,
            body: projectName ? `Project: ${projectName}` : undefined,
            entityType: "TASK",
            entityId: task.id,
          })]
        : []),
      ...(projectId
        ? [logActivity({
            actorId: session.user.id, actorName: session.user.name,
            type: "TASK", entityType: "PROJECT", entityId: projectId,
            title: `Task created: ${task.title}`,
            description: data.assigneeId
              ? `Assigned to ${task.assignee?.name ?? "teammate"}`
              : "Unassigned",
          })]
        : []),
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "CREATE", entityType: "TASK", entityId: task.id,
        metadata: { title: task.title, projectId, status },
      }),
    ]);

    return ok({ task: serialized }, 201);
  } catch (e) {
    return handleError(e);
  }
}
