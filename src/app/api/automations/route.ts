import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ok, parseBody, handleError, ApiError, logAudit } from "@/lib/api-helpers";
import { TRIGGERS, ACTION_TYPES, KNOWN_ROLES, isTriggerKey, type AutomationAction, type TriggerKey } from "@/lib/automations";

const actionSchema = z.object({
  type: z.enum(["NOTIFY_ROLE", "NOTIFY_ASSIGNEE"]),
  roleKey: z.string().trim().optional(),
  title: z.string().trim().min(3, "Action title must be at least 3 characters").max(160),
  body: z.string().trim().max(500).optional().or(z.literal("")),
});

const conditionSchema = z.object({
  field: z.string().trim().min(1),
  equals: z.string().trim().optional(),
  in: z.array(z.string().trim()).optional(),
}).optional().nullable();

const createSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(80),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  trigger: z.string().trim().min(1),
  condition: conditionSchema,
  actions: z.array(actionSchema).min(1, "Add at least one action"),
  isActive: z.boolean().default(true),
});

function validateActions(trigger: TriggerKey, actions: z.infer<typeof actionSchema>[]) {
  const triggerDef = TRIGGERS.find((t) => t.key === trigger)!;
  const fieldKeys = new Set(triggerDef.fields.map((f) => f.key));
  actions.forEach((a, i) => {
    if (a.type === "NOTIFY_ROLE") {
      if (!a.roleKey) throw new ApiError(400, "ROLE_REQUIRED", `Action ${i + 1}: choose a role to notify.`);
      if (!KNOWN_ROLES.includes(a.roleKey)) throw new ApiError(400, "INVALID_ROLE", `Action ${i + 1}: unknown role ${a.roleKey}.`);
    }
    const refs = [...(a.title.match(/\{\{\s*(\w+)\s*\}\}/g) || []), ...((a.body || "").match(/\{\{\s*(\w+)\s*\}\}/g) || [])];
    for (const ref of refs) {
      const key = ref.replace(/[{\s}]/g, "");
      if (!fieldKeys.has(key) && key !== "entityId" && key !== "actorName") {
        throw new ApiError(400, "UNKNOWN_PLACEHOLDER", `Action ${i + 1}: {{${key}}} is not available for the “${triggerDef.label}” trigger.`);
      }
    }
  });
}

function serialize(a: {
  id: string; name: string; description: string | null; trigger: string; condition: string | null;
  config: string | null; actions: string | null; isActive: boolean; lastRunAt: Date | null; runCount: number;
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

/** GET /api/automations — registry + rules (automations.manage) */
export async function GET(_req: NextRequest) {
  try {
    await requirePermission("automations.manage");
    const rows = await db.automation.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] });
    return ok({
      automations: rows.map(serialize),
      registry: TRIGGERS,
      actionTypes: ACTION_TYPES,
      roles: KNOWN_ROLES,
    });
  } catch (e) {
    return handleError(e);
  }
}

/** POST /api/automations — create a rule (automations.manage) */
export async function POST(req: NextRequest) {
  try {
    const { session } = await requirePermission("automations.manage");
    const body = await parseBody(req, createSchema);
    if (!isTriggerKey(body.trigger)) throw new ApiError(400, "INVALID_TRIGGER", "Unknown trigger.");

    validateActions(body.trigger as TriggerKey, body.actions);
    const dup = await db.automation.findFirst({ where: { name: body.name } });
    if (dup) throw new ApiError(409, "NAME_TAKEN", "An automation with this name already exists.");

    const automation = await db.automation.create({
      data: {
        name: body.name,
        description: body.description || null,
        trigger: body.trigger,
        condition: body.condition ? JSON.stringify(body.condition) : null,
        actions: JSON.stringify(body.actions as AutomationAction[]),
        isActive: body.isActive,
      },
    });

    await logAudit({
      actorId: session.user.id, actorName: session.user.name,
      action: "CREATE", entityType: "AUTOMATION", entityId: automation.id,
      metadata: { name: body.name, trigger: body.trigger, actionCount: body.actions.length },
    });

    return ok({ automation: serialize(automation) }, 201);
  } catch (e) {
    return handleError(e);
  }
}
