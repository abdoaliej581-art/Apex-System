import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, paginationFrom, logAudit, logActivity, ApiError } from "@/lib/api-helpers";

/** GET /api/meetings?from=&to=&status=&q=&page= — list meetings with linked lead/client/project */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("meetings.view");
    const { page, pageSize, skip, take, sp } = paginationFrom(req);

    const where: Prisma.MeetingWhereInput = {};
    const status = sp.get("status");
    if (status) where.status = status;
    const q = sp.get("q");
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { location: { contains: q } },
        { notes: { contains: q } },
        { outcome: { contains: q } },
      ];
    }
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      db.meeting.findMany({
        where,
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        skip, take,
        include: {
          lead: { select: { id: true, companyName: true } },
          client: { select: { id: true, companyName: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      db.meeting.count({ where }),
    ]);

    return ok({ items, total, page, pageSize });
  } catch (e) {
    return handleError(e);
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const MeetingSchema = z.object({
  title: z.string().min(2, "Title is required"),
  date: z.coerce.date(),
  startTime: z.string().regex(TIME_RE, "Start time must be HH:MM"),
  endTime: z.string().regex(TIME_RE, "End time must be HH:MM"),
  leadId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  meetingLink: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  outcome: z.string().optional().nullable(),
  nextAction: z.string().optional().nullable(),
});

/** POST /api/meetings — schedule a meeting (meetings.create) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("meetings.create");
    const body = await parseBody(req, MeetingSchema);

    if (body.endTime <= body.startTime) {
      throw new ApiError(400, "VALIDATION_ERROR", "endTime: End time must be after start time.");
    }

    // Validate links exist (avoid dangling FK errors)
    if (body.leadId && !(await db.lead.findUnique({ where: { id: body.leadId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "leadId: The selected lead no longer exists.");
    if (body.clientId && !(await db.client.findUnique({ where: { id: body.clientId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "clientId: The selected client no longer exists.");
    if (body.projectId && !(await db.project.findUnique({ where: { id: body.projectId } })))
      throw new ApiError(400, "VALIDATION_ERROR", "projectId: The selected project no longer exists.");

    const meeting = await db.meeting.create({
      data: {
        title: body.title,
        date: body.date,
        startTime: body.startTime,
        endTime: body.endTime,
        leadId: body.leadId || null,
        clientId: body.clientId || null,
        projectId: body.projectId || null,
        location: body.location || null,
        meetingLink: body.meetingLink || null,
        notes: body.notes || null,
        outcome: body.outcome || null,
        nextAction: body.nextAction || null,
        status: "SCHEDULED",
        createdById: session.user.id,
      },
      include: {
        lead: { select: { id: true, companyName: true } },
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "MEETING", entityId: meeting.id,
      metadata: { title: meeting.title, date: meeting.date },
    });
    // Surface the meeting on the linked lead/client timeline
    if (meeting.lead) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "MEETING",
        entityType: "LEAD", entityId: meeting.lead.id,
        title: `Meeting scheduled: ${meeting.title}`,
        description: `${meeting.date.toDateString()} · ${meeting.startTime}–${meeting.endTime}`,
        metadata: { meetingId: meeting.id },
      });
    }
    if (meeting.client) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name, type: "MEETING",
        entityType: "CLIENT", entityId: meeting.client.id,
        title: `Meeting scheduled: ${meeting.title}`,
        description: `${meeting.date.toDateString()} · ${meeting.startTime}–${meeting.endTime}`,
        metadata: { meetingId: meeting.id },
      });
    }

    return ok(meeting, 201);
  } catch (e) {
    return handleError(e);
  }
}
