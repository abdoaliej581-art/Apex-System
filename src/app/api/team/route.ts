import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api-helpers";

/** Team list with workload (§26-27) */
export async function GET(_req: NextRequest) {
  try {
    await requirePermission("team.view");
    const users = await db.user.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, email: true, title: true, avatarColor: true, skills: true,
        lastLoginAt: true, createdAt: true,
        roles: { select: { key: true, label: true } },
        assignedTasks: { where: { status: { notIn: ["DONE"] }, deletedAt: null }, select: { id: true, priority: true, dueDate: true } },
        managedProjects: { where: { status: { in: ["PLANNING", "ACTIVE", "REVIEW"] } }, select: { id: true } },
        projectMemberships: { select: { projectId: true } },
      },
      orderBy: { name: "asc" },
    });

    const team = users.map((u) => {
      const open = u.assignedTasks.length;
      return {
        id: u.id, name: u.name, email: u.email, title: u.title, avatarColor: u.avatarColor,
        roles: u.roles, skills: u.skills ? JSON.parse(u.skills) : [],
        lastLoginAt: u.lastLoginAt, joinedAt: u.createdAt,
        openTasks: open,
        overdueTasks: u.assignedTasks.filter((t) => t.dueDate && t.dueDate < new Date()).length,
        activeProjects: u.managedProjects.length + u.projectMemberships.length,
        load: open >= 8 ? "OVERLOADED" : open >= 5 ? "BUSY" : open >= 2 ? "NORMAL" : "AVAILABLE",
      };
    });

    return ok({ team });
  } catch (e) {
    return handleError(e);
  }
}
