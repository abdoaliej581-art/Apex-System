import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, createNotification, notifyRole, ApiError,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";
import { runAutomations } from "@/lib/automations";
import { sendMail, ticketCreatedEmail, internalAlertEmail } from "@/lib/mailer";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const CATEGORIES = ["BUG", "CHANGE_REQUEST", "QUESTION", "FEATURE_REQUEST", "TECHNICAL_ISSUE", "OTHER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const CreateSchema = z.object({
  subject: z.string().trim().min(3, "Subject is required").max(200),
  clientId: z.string().min(1, "Client is required"),
  projectId: optionalText(40),
  category: z.enum(CATEGORIES).default("OTHER"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  description: optionalText(5000),
  assignedToId: optionalText(40),
});

const serializeTicket = (t: {
  id: string; ticketNumber: string; subject: string; description: string | null;
  category: string; priority: string; status: string; closedAt: Date | null;
  createdAt: Date; updatedAt: Date;
  client: { id: string; companyName: string } | null;
  project?: { id: string; name: string; projectNumber: string } | null;
  assignedTo?: { id: string; name: string; avatarColor: string } | null;
  _count?: { messages: number };
}) => ({
  id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, description: t.description,
  category: t.category, priority: t.priority, status: t.status, closedAt: t.closedAt,
  createdAt: t.createdAt, updatedAt: t.updatedAt,
  client: t.client, project: t.project ?? null, assignedTo: t.assignedTo ?? null,
  messagesCount: t._count?.messages ?? 0,
});

const ticketInclude = {
  client: { select: { id: true, companyName: true } },
  project: { select: { id: true, name: true, projectNumber: true } },
  assignedTo: { select: { id: true, name: true, avatarColor: true } },
} satisfies Prisma.TicketInclude;

// ---- GET /api/tickets?status=&priority=&category=&clientId=&projectId=&assignedToId=&assignment=&q=&page=
export async function GET(req: NextRequest) {
  try {
    const { session } = await requirePermission("tickets.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = (sp.get("status") || "").trim();
    const priority = (sp.get("priority") || "").trim();
    const category = (sp.get("category") || "").trim();
    const clientId = (sp.get("clientId") || "").trim();
    const projectId = (sp.get("projectId") || "").trim();
    const assignedToId = (sp.get("assignedToId") || "").trim();
    const assignment = (sp.get("assignment") || "").trim(); // ALL | MINE | UNASSIGNED

    const where: Prisma.TicketWhereInput = { deletedAt: null };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (clientId) where.clientId = clientId;
    if (projectId) where.projectId = projectId;
    if (assignment === "MINE") where.assignedToId = assignedToId || session.user.id;
    else if (assignment === "UNASSIGNED") where.assignedToId = null;
    else if (assignedToId) where.assignedToId = assignedToId;
    if (q) {
      where.OR = [
        { subject: { contains: q } },
        { ticketNumber: { contains: q } },
        { client: { companyName: { contains: q } } },
      ];
    }

    const openFilter: Prisma.TicketWhereInput = { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } };

    const [rows, total, byStatus, unassigned, urgentOpen] = await Promise.all([
      db.ticket.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip, take,
        include: { ...ticketInclude, _count: { select: { messages: true } } },
      }),
      db.ticket.count({ where }),
      db.ticket.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } }),
      db.ticket.count({ where: { ...openFilter, assignedToId: null } }),
      db.ticket.count({ where: { ...openFilter, priority: "URGENT" } }),
    ]);

    return ok({
      items: rows.map(serializeTicket),
      total, page, pageSize,
      summary: {
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        unassigned,
        urgentOpen,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/tickets ----
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("tickets.create");
    const body = await parseBody(req, CreateSchema);

    const client = await db.client.findUnique({ where: { id: body.clientId } });
    if (!client) throw new ApiError(400, "INVALID_CLIENT", "The selected client no longer exists.");

    if (body.projectId) {
      const project = await db.project.findUnique({ where: { id: body.projectId } });
      if (!project) throw new ApiError(400, "INVALID_PROJECT", "The selected project no longer exists.");
      if (project.clientId !== body.clientId) {
        throw new ApiError(400, "PROJECT_MISMATCH", "The selected project does not belong to this client.");
      }
    }

    let assignee: { id: string; name: string } | null = null;
    if (body.assignedToId) {
      const user = await db.user.findUnique({ where: { id: body.assignedToId } });
      if (!user || !user.isActive) throw new ApiError(400, "INVALID_USER", "The assignee must be an active team member.");
      if (body.assignedToId !== session.user.id && !session.user.permissions.includes("tickets.assign")) {
        throw new ApiError(403, "FORBIDDEN", "You need tickets.assign permission to assign tickets to others.");
      }
      assignee = { id: user.id, name: user.name };
    }

    const ticketNumber = await nextNumber("ticket");

    const ticket = await db.ticket.create({
      data: {
        ticketNumber,
        subject: body.subject,
        clientId: body.clientId,
        projectId: body.projectId ?? null,
        category: body.category,
        priority: body.priority,
        description: body.description ?? null,
        assignedToId: body.assignedToId ?? null,
        status: "OPEN",
      },
      include: { ...ticketInclude, _count: { select: { messages: true } } },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "TICKET", entityId: ticket.id,
      title: `Ticket created: ${ticket.subject}`,
      description: `${ticketNumber} for ${client.companyName} — priority ${ticket.priority}.`,
      metadata: { priority: ticket.priority, category: ticket.category },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "TICKET", entityId: ticket.id,
      metadata: { ticketNumber, subject: ticket.subject, priority: ticket.priority }, ip: clientIp(req),
    });

    if (assignee && assignee.id !== session.user.id) {
      await createNotification({
        userId: assignee.id,
        type: "SUPPORT",
        title: `New ticket assigned to you: ${ticket.subject}`,
        body: `${session.user.name} assigned you ${ticketNumber} (${client.companyName}).`,
        entityType: "TICKET",
        entityId: ticket.id,
      });
    } else if (!body.assignedToId) {
      await notifyRole("SUPPORT", {
        type: "SUPPORT",
        title: `Unassigned ticket: ${ticket.subject}`,
        body: `${ticketNumber} was created for ${client.companyName} and needs an owner.`,
        entityType: "TICKET",
        entityId: ticket.id,
      });
    }

    // Confirmation email to the client (fire-and-forget)
    if (client.email) {
      const mail = ticketCreatedEmail({
        ticketNumber,
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.priority,
        clientName: client.companyName,
        projectName: ticket.projectId ? (await db.project.findUnique({ where: { id: ticket.projectId }, select: { name: true } }))?.name ?? null : null,
        portalUrl: process.env.APP_URL ? `${process.env.APP_URL}/#/portal/tickets` : undefined,
      });
      sendMail({ to: client.email, subject: mail.subject, html: mail.html }).catch(() => undefined);
    }

    // Automation engine (§8) — fire-and-forget, never blocks the response
    runAutomations("TICKET_CREATED", {
      entityType: "TICKET", entityId: ticket.id,
      ticketNumber, subject: ticket.subject,
      clientName: client.companyName,
      priority: ticket.priority, category: ticket.category,
      actorName: session.user.name,
      assigneeId: ticket.assignedToId,
    }).catch(() => undefined);

    return ok(serializeTicket(ticket), 201);
  } catch (e) {
    return handleError(e);
  }
}
