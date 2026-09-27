import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError, ApiError } from "@/lib/api-helpers";

// GET /api/portal/projects/[id] — sanitized project detail for the client (§72)
// Scope check: project must belong to the portal user's client company, else 404
// (never leak the existence of other companies' projects).
// Internal data (budget, internal checklists, member emails) is never exposed.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { clientId } = await requirePortal();
    const { id } = await params;

    const project = await db.project.findFirst({
      where: { id, clientId },
      select: {
        id: true, projectNumber: true, name: true, description: true, type: true,
        status: true, priority: true, progress: true, health: true,
        startDate: true, deadline: true, createdAt: true, updatedAt: true,
        manager: { select: { id: true, name: true, title: true, avatarColor: true } },
        phases: {
          orderBy: { order: "asc" },
          select: { id: true, name: true, status: true, order: true },
        },
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }],
          select: {
            id: true, title: true, status: true, priority: true, dueDate: true, phaseId: true,
            assignee: { select: { name: true } },
          },
        },
      },
    });

    if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found among your company's projects.");

    const members = await db.projectMember.count({ where: { projectId: project.id } });

    // Phase progress is derived from real task completion (no stored phase progress field).
    // A phase with no tasks falls back to a status-based estimate.
    const tasksByPhase = new Map<string, { total: number; done: number }>();
    for (const t of project.tasks) {
      if (!t.phaseId) continue;
      const bucket = tasksByPhase.get(t.phaseId) ?? { total: 0, done: 0 };
      bucket.total += 1;
      if (t.status === "DONE") bucket.done += 1;
      tasksByPhase.set(t.phaseId, bucket);
    }
    const phases = project.phases.map((ph) => {
      const bucket = tasksByPhase.get(ph.id);
      let progress: number;
      if (bucket && bucket.total > 0) {
        progress = Math.round((bucket.done / bucket.total) * 100);
      } else if (ph.status === "COMPLETED") {
        progress = 100;
      } else if (ph.status === "IN_PROGRESS") {
        progress = 50;
      } else {
        progress = 0;
      }
      return { ...ph, progress, taskCount: bucket?.total ?? 0 };
    });

    return ok({
      project: {
        ...project,
        phases: phases.map(({ id: _phaseId, order: _order, ...rest }) => rest),
      },
      teamSize: members,
    });
  } catch (e) {
    return handleError(e);
  }
}
