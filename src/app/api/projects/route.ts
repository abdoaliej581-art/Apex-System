import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, parseBody, paginationFrom,
  logAudit, logActivity, ApiError, handleError,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";

// ---- Project types come from Settings (key "projects" → { types: [{ key, label, phases[] }] })
// with a hardcoded fallback matching the seeded defaults (used if Settings unavailable).
type ProjectTypeConfig = { key: string; label: string; phases: string[] };

const FALLBACK_TYPES: ProjectTypeConfig[] = [
  { key: "BUSINESS_WEBSITE", label: "Business Website", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "ECOMMERCE", label: "E-commerce", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Payments Integration", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "WEB_APPLICATION", label: "Web Application", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Revisions", "Deployment", "Handover"] },
  { key: "CUSTOM_SOFTWARE", label: "Custom Software", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Revisions", "Deployment", "Handover"] },
  { key: "CRM", label: "CRM System", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Integration", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "DASHBOARD", label: "Dashboard", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "EDUCATIONAL_PLATFORM", label: "Educational Platform", phases: ["Discovery", "Requirements", "UI/UX", "Development", "Testing", "Client Review", "Deployment", "Handover"] },
  { key: "LANDING_PAGE", label: "Landing Page", phases: ["Requirements", "UI/UX", "Development", "Client Review", "Deployment"] },
  { key: "AUTOMATION_SYSTEM", label: "Automation System", phases: ["Discovery", "Requirements", "Development", "Testing", "Deployment", "Handover"] },
  { key: "MAINTENANCE", label: "Maintenance", phases: ["Assessment", "Execution", "Client Review"] },
];

async function getProjectTypes(): Promise<ProjectTypeConfig[]> {
  try {
    const row = await db.setting.findUnique({ where: { key: "projects" } });
    if (row) {
      const parsed = JSON.parse(row.value) as { types?: ProjectTypeConfig[] };
      if (Array.isArray(parsed?.types) && parsed.types.length > 0) return parsed.types;
    }
  } catch { /* fall through to fallback */ }
  return FALLBACK_TYPES;
}

/** Read a Settings key holding a JSON string array (e.g. default checklists). */
async function getStringListSetting(key: string): Promise<string[]> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (row) {
      const parsed = JSON.parse(row.value) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch { /* ignore */ }
  return [];
}

const createSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  clientId: z.string().min(1, "Client is required"),
  type: z.string().min(1).optional(),
  managerId: z.string().min(1).nullish(),
  description: z.string().nullish(),
  budget: z.number().nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  startDate: z.string().nullish(),
  deadline: z.string().nullish(),
});

// ---- GET /api/projects?q=&status=&clientId=&managerId=&page=&pageSize= (projects.view)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("projects.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const where: Prisma.ProjectWhereInput = { archivedAt: null };
    const q = sp.get("q");
    if (q) {
      where.OR = [{ name: { contains: q } }, { projectNumber: { contains: q } }];
    }
    const status = sp.get("status");
    if (status) where.status = status;
    const clientId = sp.get("clientId");
    if (clientId) where.clientId = clientId;
    const managerId = sp.get("managerId");
    if (managerId) where.managerId = managerId;

    const [rows, total] = await Promise.all([
      db.project.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true } },
          manager: { select: { id: true, name: true, avatarColor: true } },
          _count: { select: { phases: true, members: true } },
          tasks: { where: { deletedAt: null }, select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.project.count({ where }),
    ]);

    const items = rows.map((p) => {
      const { tasks, _count, ...rest } = p;
      return {
        ...rest,
        phasesCount: _count.phases,
        membersCount: _count.members,
        totalTasks: tasks.length,
        doneTasks: tasks.filter((t) => t.status === "DONE").length,
      };
    });

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/projects (projects.create)
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("projects.create");
    const data = await parseBody(req, createSchema);

    const client = await db.client.findUnique({ where: { id: data.clientId }, select: { id: true, companyName: true } });
    if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client does not exist.");

    let manager: { id: string; name: string } | null = null;
    if (data.managerId) {
      manager = await db.user.findUnique({
        where: { id: data.managerId },
        select: { id: true, name: true },
      });
      if (!manager) throw new ApiError(400, "INVALID_MANAGER", "The selected manager does not exist.");
    }

    const types = await getProjectTypes();
    const type = types.find((t) => t.key === (data.type ?? "BUSINESS_WEBSITE")) ?? types[0];
    const phases = Array.isArray(type?.phases) ? type.phases.filter((n) => typeof n === "string" && n.trim()) : [];

    const projectNumber = await nextNumber("project");
    const onboardingChecklist = (await getStringListSetting("onboardingChecklist"))
      .map((text) => ({ text, isDone: false }));

    // Manager joins as MANAGER, creator joins as MEMBER (deduplicated).
    const memberRows = [
      ...(manager ? [{ userId: manager.id, role: "MANAGER" }] : []),
      ...(session.user.id !== manager?.id ? [{ userId: session.user.id, role: "MEMBER" }] : []),
    ];

    const project = await db.project.create({
      data: {
        projectNumber,
        name: data.name,
        clientId: data.clientId,
        type: type?.key ?? "BUSINESS_WEBSITE",
        managerId: manager?.id ?? null,
        description: data.description ?? null,
        budget: data.budget ?? null,
        priority: data.priority ?? "MEDIUM",
        status: "PLANNING",
        health: "ON_TRACK",
        progress: 0,
        startDate: data.startDate ? new Date(data.startDate) : null,
        deadline: data.deadline ? new Date(data.deadline) : null,
        onboardingChecklist: onboardingChecklist.length > 0 ? JSON.stringify(onboardingChecklist) : null,
        createdById: session.user.id,
        phases: {
          create: phases.map((name, index) => ({ name: name.trim(), order: index, status: "PENDING" })),
        },
        members: { create: memberRows },
      },
      include: {
        client: { select: { id: true, companyName: true } },
        manager: { select: { id: true, name: true, avatarColor: true } },
        _count: { select: { phases: true, members: true } },
        tasks: { where: { deletedAt: null }, select: { status: true } },
      },
    });

    const { tasks, _count, ...rest } = project;

    await Promise.all([
      logAudit({
        actorId: session.user.id, actorName: session.user.name,
        action: "CREATE", entityType: "PROJECT", entityId: project.id,
        metadata: { projectNumber, name: project.name, type: type?.key },
      }),
      logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: "PROJECT", entityType: "PROJECT", entityId: project.id,
        title: "Project created",
        description: `${project.name} (${projectNumber}) for ${client.companyName}`,
        metadata: { status: "PLANNING", type: type?.key ?? "BUSINESS_WEBSITE" },
      }),
    ]);

    return ok({ project: { ...rest, phasesCount: _count.phases, membersCount: _count.members, totalTasks: tasks.length, doneTasks: 0 } }, 201);
  } catch (e) {
    return handleError(e);
  }
}
