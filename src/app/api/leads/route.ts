import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requirePermission, ok, handleError, parseBody, paginationFrom,
  logAudit, logActivity, createNotification, ApiError, clientIp,
} from "@/lib/api-helpers";
import { nextNumber } from "@/lib/numbering";
import { runAutomations } from "@/lib/automations";

// ---- Value lists (kept in sync with the UI; route files may only export handlers) ----
const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const;
const LEAD_SOURCES = ["WEBSITE", "REFERRAL", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "WHATSAPP", "EMAIL", "COLD_CALL", "EVENT", "OTHER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// ---- Zod primitives (empty string → null, keep undefined as "not provided") ----
const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable().optional()
  );

const idOrNull = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().nullable().optional()
);

const numberish = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    return typeof v === "string" ? Number(v) : v;
  },
  z.number().nullable().optional()
);

const dateish = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    return typeof v === "string" || typeof v === "number" ? new Date(v) : v;
  },
  z.date().nullable().optional()
);

// ---- GET /api/leads — paginated, filterable list ----
const SORTS: Record<string, Prisma.LeadOrderByWithRelationInput[]> = {
  createdAt_desc: [{ createdAt: "desc" }],
  createdAt_asc: [{ createdAt: "asc" }],
  companyName_asc: [{ companyName: "asc" }],
  companyName_desc: [{ companyName: "desc" }],
  budget_desc: [{ estimatedBudget: "desc" }],
  budget_asc: [{ estimatedBudget: "asc" }],
  followUp_asc: [{ nextFollowUpAt: "asc" }],
};

export async function GET(req: NextRequest) {
  try {
    await requirePermission("leads.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const q = (sp.get("q") || "").trim();
    const status = sp.get("status") || "";
    const source = sp.get("source") || "";
    const priority = sp.get("priority") || "";
    const assignedToId = sp.get("assignedToId") || "";
    const sortParam = sp.get("sort") || "createdAt_desc";
    const sort: string = SORTS[sortParam] ? sortParam : "createdAt_desc";

    const where: Prisma.LeadWhereInput = { deletedAt: null };
    if (q) {
      where.OR = [
        { companyName: { contains: q } },
        { contactName: { contains: q } },
        { leadNumber: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { serviceInterest: { contains: q } },
      ];
    }
    const statusList = status.split(",").map((s) => s.trim()).filter(Boolean) as string[];
    if (statusList.length > 0) where.status = { in: statusList };
    if (source) where.source = source;
    if (priority) where.priority = priority;
    if (assignedToId === "UNASSIGNED") where.assignedToId = null;
    else if (assignedToId) where.assignedToId = assignedToId;

    const [items, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: SORTS[sort],
        skip,
        take,
        include: { assignedTo: { select: { id: true, name: true, avatarColor: true } } },
      }),
      db.lead.count({ where }),
    ]);

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

// ---- POST /api/leads — create lead ----
const CreateSchema = z.object({
  companyName: z.string().trim().min(2, "Company name must be at least 2 characters"),
  contactName: z.string().trim().min(2, "Contact name must be at least 2 characters"),
  phone: z.string().trim().min(7, "Phone must be at least 7 characters"),
  email: optionalText(200),
  website: optionalText(300),
  instagram: optionalText(300),
  facebook: optionalText(300),
  linkedin: optionalText(300),
  industry: optionalText(120),
  location: optionalText(200),
  source: z.enum(LEAD_SOURCES).default("OTHER"),
  serviceInterest: optionalText(300),
  estimatedBudget: numberish,
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  assignedToId: idOrNull,
  nextFollowUpAt: dateish,
  notes: optionalText(4000),
});

export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("leads.create");
    const body = await parseBody(req, CreateSchema);

    if (body.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: body.assignedToId }, select: { id: true, isActive: true } });
      if (!assignee || !assignee.isActive) throw new ApiError(400, "INVALID_ASSIGNEE", "The selected assignee is not an active team member.");
    }

    const leadNumber = await nextNumber("lead");
    const lead = await db.lead.create({
      data: {
        leadNumber,
        companyName: body.companyName,
        contactName: body.contactName,
        phone: body.phone,
        email: body.email ?? null,
        website: body.website ?? null,
        instagram: body.instagram ?? null,
        facebook: body.facebook ?? null,
        linkedin: body.linkedin ?? null,
        industry: body.industry ?? null,
        location: body.location ?? null,
        source: body.source,
        serviceInterest: body.serviceInterest ?? null,
        estimatedBudget: body.estimatedBudget ?? null,
        priority: body.priority,
        assignedToId: body.assignedToId ?? null,
        nextFollowUpAt: body.nextFollowUpAt ?? null,
        notes: body.notes ?? null,
        createdById: session.user.id,
      },
      include: { assignedTo: { select: { id: true, name: true, avatarColor: true } } },
    });

    await logActivity({
      actorId: session.user.id, actorName: session.user.name,
      type: "CREATED", entityType: "LEAD", entityId: lead.id,
      title: "Lead created",
      description: `${lead.leadNumber} — ${lead.companyName}`,
    });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name, ip: clientIp(req),
      action: "CREATE", entityType: "LEAD", entityId: lead.id,
      metadata: { leadNumber: lead.leadNumber, company: lead.companyName },
    });

    if (lead.assignedToId && lead.assignedToId !== session.user.id) {
      await createNotification({
        userId: lead.assignedToId, type: "LEAD_ASSIGNED",
        title: `Lead assigned: ${lead.companyName}`,
        body: `${lead.leadNumber} — you are now the owner of this lead.`,
        entityType: "LEAD", entityId: lead.id,
      });
    }

    // Automation engine (§8) — fire-and-forget, never blocks the response
    runAutomations("LEAD_CREATED", {
      entityType: "LEAD", entityId: lead.id,
      leadNumber: lead.leadNumber, companyName: lead.companyName,
      contactName: lead.contactName, priority: lead.priority,
      source: lead.source, actorName: session.user.name,
      assigneeId: lead.assignedToId,
    }).catch(() => undefined);

    return ok(lead, 201);
  } catch (e) {
    return handleError(e);
  }
}
