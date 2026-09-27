import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, parseBody,
  logAudit, logActivity, createNotification, ApiError, handleError,
} from "@/lib/api-helpers";

const addSchema = z.object({
  userId: z.string().min(1, "User is required"),
  role: z.string().min(1).optional(),
});

// ---- POST /api/projects/[id]/members (projects.assign)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("projects.assign");
    const { id } = await params;
    const data = await parseBody(req, addSchema);

    const project = await db.project.findUnique({ where: { id } });
    if (!project || project.archivedAt) throw new ApiError(404, "NOT_FOUND", "Project not found.");

    const user = await db.user.findUnique({ where: { id: data.userId }, select: { id: true, name: true, isActive: true } });
    if (!user) throw new ApiError(400, "INVALID_USER", "The selected user does not exist.");
    if (!user.isActive) throw new ApiError(400, "INACTIVE_USER", "This user account is inactive.");

    const existing = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: data.userId } },
    });
    if (existing) throw new ApiError(409, "ALREADY_MEMBER", "This user is already a member of the project.");

    const member = await db.projectMember.create({
      data: { projectId: id, userId: data.userId, role: data.role ?? "MEMBER" },
      include: { user: { select: { id: true, name: true, avatarColor: true, title: true } } },
    });

    await Promise.all([
      createNotification({
        userId: user.id,
        type: "PROJECT_ADDED",
        title: `Added to project ${project.name}`,
        body: `You were added as ${member.role.toLowerCase()} by ${session.user.name ?? "a teammate"}.`,
        entityType: "PROJECT",
        entityId: id,
      }),
      logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "UPDATED", entityType: "PROJECT", entityId: id,
        title: "Member added",
        description: `${user.name} joined as ${member.role.toLowerCase()}`,
      }),
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "CREATE", entityType: "PROJECT_MEMBER", entityId: member.id,
        metadata: { projectId: id, userId: data.userId, role: member.role },
      }),
    ]);

    return ok({ member }, 201);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/projects/[id]/members?userId= (projects.assign)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("projects.assign");
    const { id } = await params;
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) throw new ApiError(400, "VALIDATION_ERROR", "userId query parameter is required.");

    const project = await db.project.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found.");

    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId } },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!member) throw new ApiError(404, "NOT_FOUND", "This user is not a member of the project.");

    await db.projectMember.delete({ where: { id: member.id } });

    await Promise.all([
      logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "UPDATED", entityType: "PROJECT", entityId: id,
        title: "Member removed",
        description: `${member.user.name} was removed from the project`,
      }),
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "DELETE", entityType: "PROJECT_MEMBER", entityId: member.id,
        metadata: { projectId: id, userId },
      }),
    ]);

    return ok({ removed: true });
  } catch (e) {
    return handleError(e);
  }
}
