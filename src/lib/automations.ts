import { db } from "@/lib/db";

/**
 * APEX SYSTEM — Automation engine (§8 groundwork)
 * Event-driven rules: when a trigger fires, matching automations render their
 * templates against the event context and execute their actions.
 * Design guarantees:
 *  - NEVER throws into the caller: every step is guarded; a failing automation
 *    must not break the business operation that triggered it.
 *  - Actions are an allow-list (NOTIFY_ROLE / NOTIFY_ASSIGNEE) — no arbitrary writes.
 *  - Templates support {{placeholder}} substitution from the trigger context.
 */

// ---- Trigger registry ----

export type TriggerKey =
  | "LEAD_CREATED"
  | "TICKET_CREATED"
  | "INVOICE_SENT"
  | "PAYMENT_RECEIVED"
  | "PROJECT_COMPLETED";

export type TriggerDef = {
  key: TriggerKey;
  label: string;
  description: string;
  icon: "USERS" | "LIFE_BUOY" | "FILE_SPREADSHEET" | "CREDIT_CARD" | "FOLDER_KANBAN";
  fields: { key: string; label: string; sample: string }[];
};

export const TRIGGERS: TriggerDef[] = [
  {
    key: "LEAD_CREATED",
    label: "Lead created",
    description: "Fires when a new lead enters the CRM.",
    icon: "USERS",
    fields: [
      { key: "leadNumber", label: "Lead number", sample: "APX-L-2026-0001" },
      { key: "companyName", label: "Company", sample: "Nile Digital Agency" },
      { key: "contactName", label: "Contact", sample: "Mona Hassan" },
      { key: "priority", label: "Priority", sample: "HIGH" },
      { key: "source", label: "Source", sample: "REFERRAL" },
      { key: "actorName", label: "Created by", sample: "APEX Sales" },
    ],
  },
  {
    key: "TICKET_CREATED",
    label: "Ticket created",
    description: "Fires when a client opens a new support ticket.",
    icon: "LIFE_BUOY",
    fields: [
      { key: "ticketNumber", label: "Ticket number", sample: "APX-T-2026-0001" },
      { key: "subject", label: "Subject", sample: "Checkout page fails on Safari" },
      { key: "clientName", label: "Client", sample: "Nile Digital Agency" },
      { key: "priority", label: "Priority", sample: "URGENT" },
      { key: "category", label: "Category", sample: "BUG" },
      { key: "actorName", label: "Created by", sample: "APEX Support" },
    ],
  },
  {
    key: "INVOICE_SENT",
    label: "Invoice sent",
    description: "Fires when an invoice leaves Draft and is sent to the client.",
    icon: "FILE_SPREADSHEET",
    fields: [
      { key: "invoiceNumber", label: "Invoice number", sample: "APX-INV-2026-0001" },
      { key: "clientName", label: "Client", sample: "Nile Digital Agency" },
      { key: "total", label: "Total", sample: "48450" },
      { key: "currency", label: "Currency", sample: "EGP" },
      { key: "dueDate", label: "Due date", sample: "2026-10-15" },
      { key: "actorName", label: "Sent by", sample: "APEX Owner" },
    ],
  },
  {
    key: "PAYMENT_RECEIVED",
    label: "Payment received",
    description: "Fires when a payment is recorded against an invoice.",
    icon: "CREDIT_CARD",
    fields: [
      { key: "amount", label: "Amount", sample: "20000" },
      { key: "currency", label: "Currency", sample: "EGP" },
      { key: "method", label: "Method", sample: "INSTAPAY" },
      { key: "invoiceNumber", label: "Invoice number", sample: "APX-INV-2026-0001" },
      { key: "clientName", label: "Client", sample: "Nile Digital Agency" },
      { key: "invoiceStatus", label: "Invoice status after", sample: "PARTIALLY_PAID" },
      { key: "actorName", label: "Recorded by", sample: "APEX Owner" },
    ],
  },
  {
    key: "PROJECT_COMPLETED",
    label: "Project completed",
    description: "Fires when a project is marked Completed.",
    icon: "FOLDER_KANBAN",
    fields: [
      { key: "projectNumber", label: "Project number", sample: "APX-PRJ-2026-0001" },
      { key: "projectName", label: "Project", sample: "E-commerce Platform" },
      { key: "clientName", label: "Client", sample: "Nile Digital Agency" },
      { key: "actorName", label: "Completed by", sample: "APEX PM" },
    ],
  },
];

export function isTriggerKey(v: string): v is TriggerKey {
  return TRIGGERS.some((t) => t.key === v);
}

// ---- Actions ----

export type AutomationAction = {
  type: "NOTIFY_ROLE" | "NOTIFY_ASSIGNEE" | "EMAIL_ROLE";
  roleKey?: string;
  title: string;
  body?: string;
};

export const ACTION_TYPES: { type: AutomationAction["type"]; label: string; needsRole: boolean; description: string }[] = [
  { type: "NOTIFY_ROLE", label: "Notify a role", needsRole: true, description: "Send an in-app notification to every active member of a role." },
  { type: "NOTIFY_ASSIGNEE", label: "Notify the assignee", needsRole: false, description: "Notify the person assigned to the record (skipped when nobody is assigned)." },
  { type: "EMAIL_ROLE", label: "Email a role", needsRole: true, description: "Send a real email to every active member of a role (requires SMTP to be configured)." },
];

export const KNOWN_ROLES = ["SUPER_ADMIN", "ADMIN", "SALES", "PROJECT_MANAGER", "DEVELOPER", "DESIGNER", "MARKETING", "SUPPORT"];

// ---- Condition evaluation ----

export type AutomationCondition = { field: string; equals?: string; in?: string[] };

export function evaluateCondition(condition: AutomationCondition | null | undefined, context: Record<string, unknown>): boolean {
  if (!condition || !condition.field) return true;
  const value = context[condition.field];
  if (condition.in && Array.isArray(condition.in)) return condition.in.includes(String(value));
  if (condition.equals !== undefined) return String(value) === condition.equals;
  return true;
}

// ---- Template rendering ----

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = context[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** Unknown placeholders are left visible so authors can spot typos in the preview. */
export function findUnknownPlaceholders(templates: string[], fields: { key: string }[]): string[] {
  const known = new Set([...fields.map((f) => f.key), "entityId", "actorName"]);
  const unknown = new Set<string>();
  templates.forEach((t) => {
    (t.match(/\{\{\s*(\w+)\s*\}\}/g) || []).forEach((m) => {
      const key = m.replace(/[{\s}]/g, "");
      if (!known.has(key)) unknown.add(key);
    });
  });
  return [...unknown];
}

// ---- Engine ----

type StoredAutomation = {
  id: string;
  name: string;
  condition: AutomationCondition | null;
  actions: AutomationAction[];
};

function parseAutomation(a: {
  id: string;
  name: string;
  condition: string | null;
  actions: string | null;
}): StoredAutomation | null {
  try {
    const actions = a.actions ? (JSON.parse(a.actions) as AutomationAction[]) : [];
    const condition = a.condition ? (JSON.parse(a.condition) as AutomationCondition) : null;
    if (!Array.isArray(actions) || actions.length === 0) return null;
    return { id: a.id, name: a.name, condition, actions: actions.filter((x) => x && ["NOTIFY_ROLE", "NOTIFY_ASSIGNEE", "EMAIL_ROLE"].includes(x.type) && typeof x.title === "string") };
  } catch {
    return null;
  }
}

async function updateRunStats(id: string) {
  try {
    await db.automation.update({
      where: { id },
      data: { lastRunAt: new Date(), runCount: { increment: 1 } },
    });
  } catch { /* stats only — never surface */ }
}

/**
 * Fire all active automations bound to a trigger.
 * Call this AFTER the business transaction commits. Never throws.
 */
export async function runAutomations(trigger: TriggerKey, context: Record<string, unknown>): Promise<void> {
  try {
    const rows = await db.automation.findMany({ where: { trigger, isActive: true } });
    const automations = rows.map(parseAutomation).filter((a): a is StoredAutomation => a !== null);
    for (const automation of automations) {
      try {
        if (!evaluateCondition(automation.condition, context)) continue;
        for (const action of automation.actions) {
          const title = renderTemplate(action.title, context);
          const body = action.body ? renderTemplate(action.body, context) : undefined;
          if (action.type === "NOTIFY_ROLE" && action.roleKey) {
            const users = await db.user.findMany({
              where: { isActive: true, roles: { some: { key: action.roleKey } } },
              select: { id: true },
            });
            await Promise.all(users.map((u) =>
              db.notification.create({
                data: { userId: u.id, type: "AUTOMATION", title, body, entityType: String(context.entityType ?? "AUTOMATION"), entityId: String(context.entityId ?? "") || null },
              }).catch(() => undefined)
            ));
          } else if (action.type === "NOTIFY_ASSIGNEE") {
            const assigneeId = context.assigneeId ? String(context.assigneeId) : null;
            if (!assigneeId) continue;
            await db.notification.create({
              data: { userId: assigneeId, type: "AUTOMATION", title, body, entityType: String(context.entityType ?? "AUTOMATION"), entityId: String(context.entityId ?? "") || null },
            }).catch(() => undefined);
          } else if (action.type === "EMAIL_ROLE" && action.roleKey) {
            // Real outbound email to every active member of the role (§42).
            // Imported lazily to keep the automation engine usable without SMTP.
            const { sendRoleEmail } = await import("@/lib/role-mail");
            await sendRoleEmail(action.roleKey, title, body ?? "");
          }
        }
        await updateRunStats(automation.id);
      } catch { /* one bad automation never blocks the rest */ }
    }
  } catch (e) {
    console.error("[automation-engine]", e instanceof Error ? e.message : e);
  }
}

/** Render every action of an automation against a context — used by the /test dry-run endpoint. */
export function previewAutomation(actions: AutomationAction[], condition: AutomationCondition | null | undefined, context: Record<string, unknown>) {
  const conditionMet = evaluateCondition(condition, context);
  return {
    conditionMet,
    actions: actions.map((a) => ({
      type: a.type,
      roleKey: a.roleKey,
      title: renderTemplate(a.title, context),
      body: a.body ? renderTemplate(a.body, context) : undefined,
    })),
  };
}
