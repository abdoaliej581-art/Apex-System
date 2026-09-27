import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, ApiError, logAudit } from "@/lib/api-helpers";
import { TRIGGERS, isTriggerKey, findUnknownPlaceholders, type AutomationAction, type TriggerKey } from "@/lib/automations";

const actionSchema = z.object({
  type: z.enum(["NOTIFY_ROLE", "NOTIFY_ASSIGNEE"]),
  roleKey: z.string().trim().optional(),
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().max(500).optional().or(z.literal("")),
});

const patchSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  trigger: z.string().trim().optional(),
  condition: z.object({
    field: z.string().trim().min(1),
    equals: z.string().trim().optional(),
    in: z.array(z.string().trim()).optional(),
  }).optional().nullable(),
  actions: z.array(actionSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});

function serialize(a: {
  id: string; name: string; description: string | null; trigger: string; condition: string | null;
  actions: string | null; isActive: boolean; lastRunAt: Date | null; runCount: number;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id: a.id, name: a.name, description: a.description, trigger: a.trigger,
    condition: (() => { try { return a.condition ? JSON.parse(a.condition) : null; } catch { return null; } })(),
    actions: (() => { try { return a.actions ? JSON.parse(a.actions) : []; } catch { return []; } })(),
    isActive: a.isActive, lastRunAt: a.lastRunAt, runCount: a.runCount,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

async function getAutomation(id: string) {
  const automation = await db.automation.findUnique({ where: { id } });
  if (!automation) throw new ApiError(404, "NOT_FOUND", "Automation not found.");
  return automation;
}

/** PATCH /api/automations/[id] — edit / toggle (automations.manage) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("automations.manage");
    const { id } = await params;
    const body = await parseBody(req, patchSchema);
    const existing = await getAutomation(id);

    const trigger = body.trigger ?? existing.trigger;
    if (!isTriggerKey(trigger)) throw new ApiError(400, "INVALID_TRIGGER", "Unknown trigger.");

    let actions = body.actions;
    if (actions) {
      const triggerDef = TRIGGERS.find((t) => t.key === trigger)!;
      const fieldKeys = new Set(triggerDef.fields.map((f) => f.key));
      actions.forEach((a, i) => {
        if (a.type === "NOTIFY_ROLE" && !a.roleKey) throw new ApiError(400, "ROLE_REQUIRED", `Action ${i + 1}: choose a role to notify.`);
        const unknown = findUnknownPlaceholders(
          [a.title, a.body || ""],
          triggerDef.fields
        );
        if (unknown.length) throw new ApiError(400, "UNKNOWN_PLACEHOLDER", `Action ${i + 1}: unknown placeholder {{${unknown[0]}}}.`);
      });
    }

    const automation = await db.automation.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.trigger !== undefined ? { trigger } : {}),
        ...(body.condition !== undefined ? { condition: body.condition ? JSON.stringify(body.condition) : null } : {}),
        ...(actions !== undefined ? { actions: JSON.stringify(actions as AutomationAction[]) } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: body.isActive !== undefined && Object.keys(body).length === 1 ? "STATUS_CHANGE" : "UPDATE",
      entityType: "AUTOMATION", entityId: id,
      metadata: { name: automation.name, isActive: automation.isActive },
    });

    return ok({ automation: serialize(automation) });
  } catch (e) {
    return handleError(e);
  }
}

/** DELETE /api/automations/[id] — remove a rule (automations.manage) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { session } = await requirePermission("automations.manage");
    const { id } = await params;
    const existing = await getAutomation(id);

    await db.automation.delete({ where: { id } });
    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "DELETE", entityType: "AUTOMATION", entityId: id,
      metadata: { name: existing.name, trigger: existing.trigger },
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
