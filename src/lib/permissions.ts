// APEX SYSTEM — Granular Permission System
// Permissions are enforced SERVER-SIDE in every API route via requirePermission().

export const MODULES = [
  "dashboard", "leads", "followups", "clients", "contacts", "activities",
  "meetings", "proposals", "quotations", "contracts",
  "projects", "tasks", "team",
  "invoices", "payments", "expenses",
  "content", "campaigns", "marketing.analytics",
  "tickets", "maintenance", "kb",
  "reports", "audit", "settings", "automations", "notifications", "files",
] as const;

export const ACTIONS = ["view", "create", "edit", "delete"] as const;

const crud = (m: string, extra: string[] = []): string[] => [
  `${m}.view`, `${m}.create`, `${m}.edit`, `${m}.delete`, ...extra,
];

/** Master permission list (seeded into roles as needed) */
export const ALL_PERMISSIONS: string[] = [
  "dashboard.view",
  ...crud("leads", ["leads.assign", "leads.export"]),
  ...crud("followups"),
  ...crud("clients"),
  ...crud("contacts"),
  "activities.view",
  ...crud("meetings"),
  ...crud("proposals"),
  ...crud("quotations"),
  ...crud("contracts"),
  ...crud("projects", ["projects.assign"]),
  ...crud("tasks", ["tasks.assign"]),
  "team.view", "team.manage",
  ...crud("invoices"),
  "payments.view", "payments.create", "payments.edit", "payments.delete",
  ...crud("expenses"),
  ...crud("content"),
  ...crud("campaigns"),
  "marketing.analytics.view",
  "tickets.view", "tickets.create", "tickets.edit", "tickets.delete", "tickets.assign",
  ...crud("maintenance"),
  ...crud("kb"),
  "reports.view",
  "audit.view",
  "settings.manage",
  "permissions.manage",
  "automations.manage",
  "files.view", "files.upload", "files.delete",
  // Client Portal (§72) — deliberately NOT in ALL_PERMISSIONS: only the CLIENT role
  // carries portal.view, so internal staff never see portal nav items by default.
  "portal.view",
];

export type Permission = string;

export const DEFAULT_ROLES: { key: string; label: string; description: string; permissions: string[] }[] = [
  {
    key: "SUPER_ADMIN", label: "Super Admin", description: "Full system access",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "ADMIN", label: "Admin", description: "Manage everything except sensitive permissions",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "permissions.manage"),
  },
  {
    key: "SALES", label: "Sales", description: "CRM + Sales pipeline",
    permissions: [
      "dashboard.view", "notifications.view",
      ...crud("leads", ["leads.assign", "leads.export"]),
      ...crud("followups"), ...crud("clients"), ...crud("contacts"), "activities.view",
      ...crud("meetings"), ...crud("proposals"), ...crud("quotations"), ...crud("contracts"),
      "projects.view", "reports.view", "kb.view",
      "files.view", "files.upload",
    ],
  },
  {
    key: "PROJECT_MANAGER", label: "Project Manager", description: "Deliver projects and coordinate the team",
    permissions: [
      "dashboard.view", "notifications.view",
      "leads.view", "clients.view", "contacts.view", "activities.view",
      ...crud("meetings"), "proposals.view", "quotations.view", "contracts.view",
      ...crud("projects", ["projects.assign"]), ...crud("tasks", ["tasks.assign"]),
      "team.view", "reports.view", "kb.view", "kb.create", "kb.edit",
      "invoices.view", "payments.view", "tickets.view", "tickets.edit", "tickets.assign", "maintenance.view",
      "files.view", "files.upload",
    ],
  },
  {
    key: "DEVELOPER", label: "Developer", description: "Execute assigned tasks",
    permissions: [
      "dashboard.view", "notifications.view",
      "projects.view", "tasks.view", "tasks.create", "tasks.edit",
      "clients.view", "contacts.view", "kb.view", "kb.create", "kb.edit",
      "files.view", "files.upload",
    ],
  },
  {
    key: "DESIGNER", label: "Designer", description: "Execute assigned design tasks",
    permissions: [
      "dashboard.view", "notifications.view",
      "projects.view", "tasks.view", "tasks.create", "tasks.edit",
      "clients.view", "contacts.view", "kb.view", "kb.create", "kb.edit",
      "files.view", "files.upload",
    ],
  },
  {
    key: "MARKETING", label: "Marketing", description: "Content, campaigns and lead capture",
    permissions: [
      "dashboard.view", "notifications.view",
      "leads.view", "leads.create", "leads.edit",
      "clients.view", "activities.view",
      ...crud("content"), ...crud("campaigns"), "marketing.analytics.view", "reports.view", "kb.view",
      "files.view", "files.upload",
    ],
  },
  {
    key: "SUPPORT", label: "Support", description: "Tickets and maintenance",
    permissions: [
      "dashboard.view", "notifications.view",
      "clients.view", "contacts.view", "projects.view",
      "tickets.view", "tickets.create", "tickets.edit", "tickets.assign",
      ...crud("maintenance"), "kb.view", "kb.create", "kb.edit",
      "files.view", "files.upload",
    ],
  },
  {
    key: "CLIENT", label: "Client", description: "Client Portal access — sees only their own company's projects, invoices and support tickets",
    permissions: ["portal.view"],
  },
];

/** Resolve the effective permission set for a user */
export function resolvePermissions(
  roleKeys: { permissions: string }[],
  customPermissions?: string | null
): string[] {
  const set = new Set<string>();
  roleKeys.forEach((r) => {
    try {
      (JSON.parse(r.permissions) as string[]).forEach((p) => set.add(p));
    } catch { /* ignore malformed */ }
  });
  if (customPermissions) {
    try {
      (JSON.parse(customPermissions) as string[]).forEach((p) => set.add(p));
    } catch { /* ignore malformed */ }
  }
  return [...set];
}

export function can(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
