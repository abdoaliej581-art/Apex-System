import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody,
  logAudit, logActivity, ApiError, clientIp,
} from "@/lib/api-helpers";
// Value list (duplicated locally — Next.js route files may only export HTTP handlers)
const CLIENT_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const actorSelect = { select: { id: true, name: true, avatarColor: true } } as const;

async function getClientOr404(id: string) {
  const client = await db.client.findUnique({ where: { id } });
  if (!client) throw new ApiError(404, "NOT_FOUND", "This client no longer exists.");
  return client;
}

// ---- GET /api/clients/[id] — full detail ----
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("clients.view");
    const { id } = await params;

    const client = await db.client.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        projects: {
          where: { archivedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, projectNumber: true, status: true, progress: true, deadline: true, type: true },
        },
        invoices: {
          orderBy: { issueDate: "desc" },
          take: 20,
          select: { id: true, invoiceNumber: true, total: true, status: true, issueDate: true },
        },
        tickets: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, subject: true, status: true, priority: true, createdAt: true },
        },
        followUps: {
          orderBy: { dueAt: "desc" },
          take: 20,
          include: { assignedTo: actorSelect },
        },
      },
    });
    if (!client) throw new ApiError(404, "NOT_FOUND", "This client no longer exists.");

    const activities = await db.activity.findMany({
      where: { entityType: "CLIENT", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return ok({
      client,
      activities: activities.map((a) => ({
        id: a.id, type: a.type, title: a.title, description: a.description,
        actorName: a.actorName || "System",
        actorColor: "#22d3ee",
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- PATCH /api/clients/[id] — edit fields + archive/restore via status ----
const PatchSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters").optional(),
  industry: optionalText(120),
  location: optionalText(200),
  website: optionalText(300),
  email: optionalText(200),
  phone: optionalText(50),
  instagram: optionalText(300),
  facebook: optionalText(300),
  linkedin: optionalText(300),
  notes: optionalText(4000),
  status: z.enum(CLIENT_STATUSES).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("clients.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const current = await getClientOr404(id);
    const actor = { actorId: session.user.id, actorName: session.user.name };

    const data: Record<string, unknown> = {};
    const plain = [
      "companyName", "industry", "location", "website", "email",
      "phone", "instagram", "facebook", "linkedin", "notes",
    ] as const;
    for (const key of plain) {
      if (body[key] !== undefined) data[key] = body[key];
    }

    const statusChanged = body.status !== undefined && body.status !== current.status;
    if (statusChanged) {
      data.status = body.status;
      if (body.status === "ARCHIVED") data.archivedAt = new Date();
      else if (current.status === "ARCHIVED") data.archivedAt = null;
    }

    const changedFields = Object.keys(data);
    if (changedFields.length === 0) {
      const unchanged = await db.client.findUnique({ where: { id } });
      return ok(unchanged);
    }

    const updated = await db.client.update({
      where: { id },
      data: data as Parameters<typeof db.client.update>[0]["data"],
    });

    if (statusChanged) {
      await logActivity({
        ...actor, type: "STATUS_CHANGED", entityType: "CLIENT", entityId: id,
        title: `Client ${current.status === "ARCHIVED" ? "restored" : "status changed"}: ${current.status} → ${updated.status}`,
      });
      await logAudit({
        ...actor, ip: clientIp(req),
        action: "STATUS_CHANGE", entityType: "CLIENT", entityId: id,
        metadata: { from: current.status, to: updated.status },
      });
    }
    await logAudit({
      ...actor, ip: clientIp(req),
      action: "UPDATE", entityType: "CLIENT", entityId: id,
      metadata: { fields: changedFields },
    });

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

// ---- DELETE /api/clients/[id] — archive-only delete; refuse when active projects exist ----
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("clients.delete");
    const { id } = await params;
    const client = await getClientOr404(id);

    const activeProjects = await db.project.count({
      where: { clientId: id, archivedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    });
    if (activeProjects > 0) {
      throw new ApiError(409, "ACTIVE_PROJECTS", "Archive instead: client has active projects.");
    }

    if (client.status === "ARCHIVED") {
      return ok({ archived: true, alreadyArchived: true });
    }

    await db.client.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "STATUS_CHANGED", entityType: "CLIENT", entityId: id,
      title: `Client archived: ${client.companyName}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "DELETE", entityType: "CLIENT", entityId: id,
      metadata: { mode: "ARCHIVED", clientNumber: client.clientNumber, company: client.companyName },
    });

    return ok({ archived: true, alreadyArchived: false });
  } catch (e) {
    return handleError(e);
  }
}
