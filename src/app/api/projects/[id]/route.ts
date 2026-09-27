import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, parseBody,
  logAudit, logActivity, ApiError, handleError,
} from "@/lib/api-helpers";
import { runAutomations } from "@/lib/automations";

// ---- Shared helpers ----

type ChecklistEntry = { text: string; isDone: boolean };

function parseChecklist(raw: string | null | undefined): ChecklistEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is { text: string; isDone: boolean } =>
        !!x && typeof x === "object" && typeof (x as ChecklistEntry).text === "string")
      .map((x) => ({ text: x.text, isDone: Boolean(x.isDone) }));
  } catch {
    return [];
  }
}

async function getSettingStringList(key: string): Promise<string[]> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (row) {
      const parsed = JSON.parse(row.value) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch { /* ignore */ }
  return [];
}

/** Recompute progress from task counts (done / total, soft-deleted excluded). */
async function recomputeProgress(projectId: string): Promise<number> {
  const [total, done] = await Promise.all([
    db.task.count({ where: { projectId, deletedAt: null } }),
    db.task.count({ where: { projectId, deletedAt: null, status: "DONE" } }),
  ]);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  await db.project.update({ where: { id: projectId }, data: { progress } });
  return progress;
}

// Allowed status transitions (§63 workflow, same-set moves allowed)
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PLANNING: ["PLANNING", "ACTIVE", "CANCELLED"],
  ACTIVE: ["ACTIVE", "PLANNING", "ON_HOLD", "REVIEW", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ON_HOLD", "ACTIVE", "REVIEW", "COMPLETED", "CANCELLED"],
  REVIEW: ["REVIEW", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"],
  COMPLETED: ["COMPLETED", "ACTIVE"],
  CANCELLED: ["CANCELLED", "PLANNING", "ACTIVE"],
};

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  type: z.string().min(1).optional(),
  managerId: z.string().min(1).nullish(),
  budget: z.number().nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "REVIEW", "COMPLETED", "CANCELLED"]).optional(),
  health: z.enum(["ON_TRACK", "AT_RISK", "DELAYED"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  recomputeProgress: z.boolean().optional(),
  startDate: z.union([z.string(), z.null()]).optional(),
  deadline: z.union([z.string(), z.null()]).optional(),
  onboardingChecklist: z.array(z.object({ text: z.string().min(1), isDone: z.boolean() })).optional(),
  completionChecklist: z.array(z.object({ text: z.string().min(1), isDone: z.boolean() })).optional(),
});

// ---- GET /api/projects/[id] (projects.view)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("projects.view");
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, companyName: true, clientNumber: true } },
        manager: { select: { id: true, name: true, avatarColor: true, title: true } },
        members: {
          include: { user: { select: { id: true, name: true, avatarColor: true, title: true } } },
          // ProjectMember has no createdAt — cuid ids are time-ordered, so id asc ≈ join order
          orderBy: { id: "asc" },
        },
        phases: {
          orderBy: { order: "asc" },
          include: {
            tasks: {
              where: { deletedAt: null },
              orderBy: [{ position: "asc" }, { createdAt: "desc" }],
              select: {
                id: true, title: true, status: true, priority: true, dueDate: true,
                assignee: { select: { id: true, name: true, avatarColor: true } },
              },
            },
          },
        },
        tasks: { where: { deletedAt: null }, select: { status: true } },
      },
    });
    if (!project || project.archivedAt) throw new ApiError(404, "NOT_FOUND", "Project not found.");

    const canViewInvoices = session.user.permissions.includes("invoices.view");
    const [invoices, activities] = await Promise.all([
      canViewInvoices
        ? db.invoice.findMany({
            where: { projectId: id },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, invoiceNumber: true, total: true, status: true, currency: true },
          })
        : Promise.resolve(null),
      db.activity.findMany({
        where: { entityType: "PROJECT", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    // Resolve actor colors without the Activity.actor relation include (the running
    // Prisma client predates it — same pattern as leads/[id]): one extra plain query.
    const actorIds = [...new Set(activities.map((a) => a.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length > 0
      ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, avatarColor: true } })
      : [];
    const actorColorById = new Map(actors.map((u) => [u.id, u.avatarColor]));

    const statusCounts: Record<string, number> = {};
    project.tasks.forEach((t) => { statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1; });
    const done = project.tasks.filter((t) => t.status === "DONE").length;

    return ok({
      id: project.id,
      projectNumber: project.projectNumber,
      name: project.name,
      description: project.description,
      type: project.type,
      status: project.status,
      priority: project.priority,
      budget: project.budget,
      progress: project.progress,
      health: project.health,
      startDate: project.startDate,
      deadline: project.deadline,
      createdAt: project.createdAt,
      client: project.client,
      manager: project.manager,
      members: project.members.map((m) => ({ id: m.id, role: m.role, user: m.user })),
      phases: project.phases.map((ph) => ({
        id: ph.id, name: ph.name, order: ph.order, status: ph.status,
        doneCount: ph.tasks.filter((t) => t.status === "DONE").length,
        tasks: ph.tasks,
      })),
      taskStats: {
        byStatus: statusCounts,
        total: project.tasks.length,
        done,
        open: project.tasks.length - done,
      },
      invoices,
      onboardingChecklist: parseChecklist(project.onboardingChecklist),
      completionChecklist: parseChecklist(project.completionChecklist),
      activities: activities.map((a) => ({
        id: a.id, type: a.type, title: a.title, description: a.description,
        actorName: a.actorName || "System",
        actorColor: (a.actorId && actorColorById.get(a.actorId)) || "#22d3ee",
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/projects/[id] (projects.edit)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("projects.edit");
    const { id } = await params;
    const data = await parseBody(req, updateSchema);

    const existing = await db.project.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) throw new ApiError(404, "NOT_FOUND", "Project not found.");

    const patch: Prisma.ProjectUncheckedUpdateInput = {};
    const activityLogs: { title: string; description?: string; type: string }[] = [];
    let statusChanged = false;

    // Status transition
    if (data.status !== undefined && data.status !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(data.status)) {
        throw new ApiError(400, "INVALID_TRANSITION",
          `Cannot move project from ${existing.status} to ${data.status}.`);
      }
      patch.status = data.status;
      statusChanged = true;

      if (data.status === "COMPLETED") {
        const current = parseChecklist(existing.completionChecklist);
        if (current.length === 0) {
          const defaults = (await getSettingStringList("completionChecklist"))
            .map((text) => ({ text, isDone: false }));
          if (defaults.length > 0) patch.completionChecklist = JSON.stringify(defaults);
        }
      }
      activityLogs.push({
        type: "STATUS_CHANGED",
        title: "Project status changed",
        description: `${existing.status} → ${data.status}`,
      });
    }

    if (data.health !== undefined && data.health !== existing.health) {
      patch.health = data.health;
      activityLogs.push({
        type: "UPDATED",
        title: "Project health updated",
        description: `${existing.health} → ${data.health}`,
      });
    }

    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.type !== undefined) patch.type = data.type;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.budget !== undefined) patch.budget = data.budget;
    if (data.managerId !== undefined) {
      if (data.managerId) {
        const mgr = await db.user.findUnique({ where: { id: data.managerId }, select: { id: true } });
        if (!mgr) throw new ApiError(400, "INVALID_MANAGER", "The selected manager does not exist.");
      }
      patch.managerId = data.managerId;
    }
    if (data.startDate !== undefined) patch.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.deadline !== undefined) patch.deadline = data.deadline ? new Date(data.deadline) : null;
    if (data.onboardingChecklist !== undefined) {
      patch.onboardingChecklist = JSON.stringify(data.onboardingChecklist);
    }
    if (data.completionChecklist !== undefined) {
      patch.completionChecklist = JSON.stringify(data.completionChecklist);
    }

    if (data.recomputeProgress) {
      patch.progress = await recomputeProgress(id);
    } else if (data.progress !== undefined) {
      patch.progress = data.progress; // manual override
    }

    const updated = await db.project.update({
      where: { id }, data: patch,
      include: { client: { select: { companyName: true } } },
    });

    for (const log of activityLogs) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: log.type, entityType: "PROJECT", entityId: id,
        title: log.title, description: log.description,
      });
    }
    if (activityLogs.length === 0) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "UPDATED", entityType: "PROJECT", entityId: id,
        title: "Project updated",
      });
    }

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: statusChanged ? "STATUS_CHANGE" : "UPDATE",
      entityType: "PROJECT", entityId: id,
      metadata: {
        fields: Object.keys(patch),
        ...(statusChanged ? { from: existing.status, to: data.status } : {}),
      },
    });

    if (statusChanged && data.status === "COMPLETED") {
      // Automation engine (§8) — fire-and-forget, never blocks the response
      runAutomations("PROJECT_COMPLETED", {
        entityType: "PROJECT", entityId: id,
        projectNumber: updated.projectNumber, projectName: updated.name,
        clientName: updated.client?.companyName ?? null,
        actorName: session.user.name,
      }).catch(() => undefined);
    }

    return ok({
      project: {
        id: updated.id, status: updated.status, health: updated.health,
        progress: updated.progress, name: updated.name,
        completionChecklist: parseChecklist(updated.completionChecklist),
        onboardingChecklist: parseChecklist(updated.onboardingChecklist),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/projects/[id] (projects.delete) — soft delete (archive)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("projects.delete");
    const { id } = await params;

    const existing = await db.project.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) throw new ApiError(404, "NOT_FOUND", "Project not found.");

    const activeTasks = await db.task.count({
      where: { projectId: id, deletedAt: null, status: { not: "DONE" } },
    });
    if (activeTasks > 0) {
      throw new ApiError(409, "PROJECT_HAS_ACTIVE_TASKS",
        `This project still has ${activeTasks} active task${activeTasks === 1 ? "" : "s"}. Complete or remove them before archiving the project.`);
    }

    await db.project.update({ where: { id }, data: { archivedAt: new Date() } });

    await Promise.all([
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "DELETE", entityType: "PROJECT", entityId: id,
        metadata: { archived: true, projectNumber: existing.projectNumber },
      }),
      logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "UPDATED", entityType: "PROJECT", entityId: id,
        title: "Project archived",
        description: `${existing.name} (${existing.projectNumber}) was archived`,
      }),
    ]);

    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
