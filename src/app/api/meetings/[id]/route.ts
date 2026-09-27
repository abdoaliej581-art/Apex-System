import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError, parseBody, logAudit, logActivity, ApiError } from "@/lib/api-helpers";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Allowed meeting status transitions */
const MEETING_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["COMPLETED", "CANCELLED", "RESCHEDULED"],
  RESCHEDULED: ["SCHEDULED", "COMPLETED", "CANCELLED"],
  CANCELLED: ["SCHEDULED"],
  COMPLETED: [],
};

const PatchSchema = z.object({
  title: z.string().min(2).optional(),
  date: z.coerce.date().optional(),
  startTime: z.string().regex(TIME_RE, "Start time must be HH:MM").optional(),
  endTime: z.string().regex(TIME_RE, "End time must be HH:MM").optional(),
  leadId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  meetingLink: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "RESCHEDULED"]).optional(),
});

/** PATCH /api/meetings/[id] — edit meeting or transition status (meetings.edit) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("meetings.edit");
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);

    const meeting = await db.meeting.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, companyName: true } },
        client: { select: { id: true, companyName: true } },
      },
    });
    if (!meeting) throw new ApiError(404, "NOT_FOUND", "Meeting not found.");

    const start = body.startTime ?? meeting.startTime;
    const end = body.endTime ?? meeting.endTime;
    if (end <= start) throw new ApiError(400, "VALIDATION_ERROR", "endTime: End time must be after start time.");

    // ---- Status transition
    let statusChanged = false;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) data[k] = v;
    }

    if (body.status && body.status !== meeting.status) {
      const allowed = MEETING_TRANSITIONS[meeting.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(409, "INVALID_TRANSITION", `Cannot move a ${meeting.status.toLowerCase()} meeting to ${body.status.toLowerCase()}.`);
      }
      statusChanged = true;
    }

    const updated = await db.meeting.update({
      where: { id },
      data,
      include: {
        lead: { select: { id: true, companyName: true } },
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: statusChanged ? "STATUS_CHANGE" : "UPDATE", entityType: "MEETING", entityId: id,
      metadata: statusChanged ? { from: meeting.status, to: body.status } : { fields: Object.keys(body) },
    });

    // Log activity on the linked lead/client so CRM timelines stay in sync
    const targets: { entityType: "LEAD" | "CLIENT"; entityId: string; label: string }[] = [];
    if (updated.lead) targets.push({ entityType: "LEAD", entityId: updated.lead.id, label: updated.lead.companyName });
    if (updated.client) targets.push({ entityType: "CLIENT", entityId: updated.client.id, label: updated.client.companyName });
    for (const t of targets) {
      await logActivity({
        actorId: session.user.id, actorName: session.user.name,
        type: statusChanged ? "STATUS_CHANGED" : "MEETING",
        entityType: t.entityType, entityId: t.entityId,
        title: statusChanged
          ? `Meeting "${updated.title}" ${body.status!.toLowerCase()}`
          : `Meeting "${updated.title}" updated`,
        description: statusChanged && body.status === "COMPLETED" && updated.outcome
          ? `Outcome: ${updated.outcome}`
          : `${new Date(updated.date).toDateString()} · ${updated.startTime}–${updated.endTime}`,
        metadata: { meetingId: id },
      });
    }

    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/meetings/[id] — hard delete (meetings.delete) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("meetings.delete");
    const { id } = await params;

    const meeting = await db.meeting.findUnique({ where: { id } });
    if (!meeting) throw new ApiError(404, "NOT_FOUND", "Meeting not found.");

    await db.meeting.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "MEETING", entityId: id,
      metadata: { title: meeting.title },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
