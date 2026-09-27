import {
  LayoutDashboard, KanbanSquare, Users, AlarmClock, Building2, CalendarDays,
  Handshake, FileText, Calculator, FileSignature, FolderKanban, ListChecks,
  Network, FileSpreadsheet, CreditCard, Receipt, Megaphone, BarChart3,
  LifeBuoy, Wrench, BookOpen, TrendingUp, ShieldCheck, Settings, Sparkles, Activity,
  FolderOpen, Home, type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: string;          // hash path
  label: string;
  icon: LucideIcon;
  permission: string;   // required permission to see the item
  badge?: "followups" | "tickets";
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
      { key: "calendar", label: "Calendar", icon: CalendarDays, permission: "meetings.view" },
    ],
  },
  {
    label: "CRM",
    items: [
      { key: "crm/pipeline", label: "Pipeline", icon: KanbanSquare, permission: "leads.view" },
      { key: "crm/leads", label: "Leads", icon: Users, permission: "leads.view" },
      { key: "crm/followups", label: "Follow-ups", icon: AlarmClock, permission: "followups.view", badge: "followups" },
      { key: "crm/clients", label: "Clients", icon: Building2, permission: "clients.view" },
    ],
  },
  {
    label: "Sales",
    items: [
      { key: "sales/meetings", label: "Meetings", icon: Handshake, permission: "meetings.view" },
      { key: "sales/proposals", label: "Proposals", icon: FileText, permission: "proposals.view" },
      { key: "sales/quotations", label: "Quotations", icon: Calculator, permission: "quotations.view" },
      { key: "sales/contracts", label: "Contracts", icon: FileSignature, permission: "contracts.view" },
    ],
  },
  {
    label: "Delivery",
    items: [
      { key: "projects", label: "Projects", icon: FolderKanban, permission: "projects.view" },
      { key: "tasks", label: "Tasks", icon: ListChecks, permission: "tasks.view" },
      { key: "team", label: "Team", icon: Network, permission: "team.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { key: "finance/invoices", label: "Invoices", icon: FileSpreadsheet, permission: "invoices.view" },
      { key: "finance/payments", label: "Payments", icon: CreditCard, permission: "payments.view" },
      { key: "finance/expenses", label: "Expenses", icon: Receipt, permission: "expenses.view" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { key: "marketing/content", label: "Content", icon: Megaphone, permission: "content.view" },
      { key: "marketing/campaigns", label: "Campaigns", icon: BarChart3, permission: "campaigns.view" },
    ],
  },
  {
    label: "Support",
    items: [
      { key: "support/tickets", label: "Tickets", icon: LifeBuoy, permission: "tickets.view", badge: "tickets" },
      { key: "support/maintenance", label: "Maintenance", icon: Wrench, permission: "maintenance.view" },
    ],
  },
  {
    label: "Company",
    items: [
      { key: "activity", label: "Activity", icon: Activity, permission: "activities.view" },
      { key: "knowledge", label: "Knowledge Base", icon: BookOpen, permission: "kb.view" },
      { key: "files", label: "Files", icon: FolderOpen, permission: "files.view" },
      { key: "reports", label: "Reports", icon: TrendingUp, permission: "reports.view" },
      { key: "audit", label: "Audit Log", icon: ShieldCheck, permission: "audit.view" },
    ],
  },
  {
    label: "System",
    items: [
      { key: "settings", label: "Settings", icon: Settings, permission: "settings.manage" },
      { key: "automations", label: "Automations", icon: Sparkles, permission: "automations.manage" },
    ],
  },
  {
    // Client Portal (§72) — only visible to portal accounts (CLIENT role)
    label: "Client Portal",
    items: [
      { key: "portal", label: "Overview", icon: Home, permission: "portal.view" },
      { key: "portal/projects", label: "My Projects", icon: FolderKanban, permission: "portal.view" },
      { key: "portal/invoices", label: "Invoices", icon: FileSpreadsheet, permission: "portal.view" },
      { key: "portal/tickets", label: "Support", icon: LifeBuoy, permission: "portal.view", badge: "tickets" },
    ],
  },
];

/** Mobile quick access (§50) */
export const MOBILE_ITEMS = ["dashboard", "crm/leads", "tasks", "calendar", "crm/clients"];

export const AUTOMATIONS_ICON = Sparkles;
