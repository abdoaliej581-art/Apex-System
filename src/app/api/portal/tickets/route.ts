import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePortal, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, clientIp, notifyRole, ApiError,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";
import { runAutomations } from "@/lib/automations";

const optionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const CATEGORIES = ["BUG", "CHANGE_REQUEST", "QUESTION", "FEATURE_REQUEST", "TECHNICAL_ISSUE", "OTHER"] as const;
// Clients may flag urgency as HIGH at most — URGENT is the internal escalation level.
const PORTAL_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

const CreateSchema = z.object({
  subject: z.string().trim().min(3, "Subject is required").max(200),
  category: z.enum(CATEGORIES).default("OTHER"),
  priority: z.enum(PORTAL_PRIORITIES).default("MEDIUM"),
  description: optionalText(5000),
  projectId: optionalText(40),
});

// GET /api/portal/tickets — support tickets of the signed-in client company ONLY (§72)
export async function GET(req: NextRequest) {
  try {
    const { clientId } = await requirePortal();
    const { page, pageSize, skip, take, sp } = paginationFrom(req);
    const status = (sp.get("status") || "").trim();
    const q = (sp.get("q") || "").trim();

    const where: Prisma.TicketWhereInput = { clientId };
    if (status) where.status = status;
    if (q) where.OR = [{ subject: { contains: q } }, { ticketNumber: { contains: q } }];

    const [rows, total, byStatus] = await Promise.all([
      db.ticket.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip, take,
        select: {
          id: true, ticketNumber: true, subject: true, category: true, priority: true,
          status: true, closedAt: true, createdAt: true, updatedAt: true,
          project: { select: { name: true, projectNumber: true } },
          assignedTo: { select: { name: true, avatarColor: true } },
          _count: { select: { messages: { where: { isInternal: false } } } },
        },
      }),
      db.ticket.count({ where }),
      db.ticket.groupBy({ by: ["status"], _count: { _all: true }, where: { clientId } }),
    ]);

    return ok({
      items: rows.map((t) => ({ ...t, messagesCount: t._count.messages })),
      total, page, pageSize,
      summary: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// POST /api/portal/tickets — client creates a support ticket (always scoped to own company)
export async function POST(req: NextRequest) {
  try {
    const { session, clientId } = await requirePortal();
    const body = await parseBody(req, CreateSchema);

    const client = await db.client.findUnique({ where: { id: clientId }, select: { companyName: true } });
    if (!client) throw new ApiError(403, "NO_CLIENT_LINK", "Your account is not linked to an active client company.");

    if (body.projectId) {
      const project = await db.project.findFirst({ where: { id: body.projectId, clientId } });
      if (!project) throw new ApiError(400, "INVALID_PROJECT", "The selected project does not belong to your company.");
    }

    const ticketNumber = await nextNumber("ticket");

    const ticket = await db.ticket.create({
      data: {
        ticketNumber,
        subject: body.subject,
        clientId,
        projectId: body.projectId ?? null,
        category: body.category,
        priority: body.priority,
        description: body.description ?? null,
        status: "OPEN",
      },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "SUPPORT", entityType: "TICKET", entityId: ticket.id,
      title: `Portal ticket created: ${ticket.subject}`,
      description: `${ticketNumber} submitted via Client Portal by ${client.companyName} — priority ${ticket.priority}.`,
      metadata: { priority: ticket.priority, category: ticket.category, viaPortal: true },
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "TICKET", entityId: ticket.id,
      metadata: { ticketNumber, subject: ticket.subject, priority: ticket.priority, viaPortal: true }, ip: clientIp(req),
    });

    // Internal team is alerted — unassigned portal tickets go to the SUPPORT role
    await notifyRole("SUPPORT", {
      type: "SUPPORT",
      title: `Portal ticket: ${ticket.subject}`,
      body: `${ticketNumber} was submitted by ${client.companyName} via the Client Portal and needs an owner.`,
      entityType: "TICKET",
      entityId: ticket.id,
    });

    // Automation engine (fire-and-forget) — portal tickets trigger rules too
    runAutomations("TICKET_CREATED", {
      entityType: "TICKET", entityId: ticket.id,
      ticketNumber, subject: ticket.subject,
      clientName: client.companyName,
      priority: ticket.priority, category: ticket.category,
      actorName: session.user.name,
      assigneeId: null,
    }).catch(() => undefined);

    return ok({
      id: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject,
      category: ticket.category, priority: ticket.priority, status: ticket.status,
      createdAt: ticket.createdAt, messagesCount: 0,
    }, 201);
  } catch (e) {
    return handleError(e);
  }
}
