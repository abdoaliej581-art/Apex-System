"use client";

import type { ComponentType } from "react";
import { DashboardView } from "@/views/dashboard";
import { LoginView } from "@/views/login";

import { LeadsView } from "@/views/crm/leads";
import { PipelineView } from "@/views/crm/pipeline";
import { FollowUpsView } from "@/views/crm/followups";
import { ClientsView } from "@/views/crm/clients";

import { MeetingsView } from "@/views/sales/meetings";
import { ProposalsView } from "@/views/sales/proposals";
import { QuotationsView } from "@/views/sales/quotations";
import { ContractsView } from "@/views/sales/contracts";

import { ProjectsView } from "@/views/projects/projects";
import { TasksView } from "@/views/projects/tasks";
import { TeamView } from "@/views/projects/team";
import { CalendarView } from "@/views/projects/calendar";

import { InvoicesView } from "@/views/finance/invoices";
import { PaymentsView } from "@/views/finance/payments";
import { ExpensesView } from "@/views/finance/expenses";

import { ContentView } from "@/views/marketing/content";
import { CampaignsView } from "@/views/marketing/campaigns";

import { TicketsView } from "@/views/support/tickets";
import { MaintenanceView } from "@/views/support/maintenance";

import { ReportsView } from "@/views/company/reports";
import { AuditView } from "@/views/company/audit";
import { ActivityFeedView } from "@/views/company/activity";
import { KnowledgeView } from "@/views/company/knowledge";
import { FilesView } from "@/views/company/files";

import { SettingsView } from "@/views/system/settings";
import { AutomationsView } from "@/views/system/automations";

import { PortalOverviewView } from "@/views/portal/overview";
import { PortalProjectsView } from "@/views/portal/projects";
import { PortalInvoicesView } from "@/views/portal/invoices";
import { PortalTicketsView } from "@/views/portal/tickets";

/**
 * Central SPA view registry (hash path → component).
 * Every module view receives `navigate` for cross-navigation.
 * IMPORTANT: do not add/remove view files without updating this registry.
 */
export type ViewProps = { navigate: (path: string) => void };

export const VIEW_REGISTRY: Record<string, ComponentType<ViewProps>> = {
  dashboard: DashboardView,

  // CRM
  "crm/leads": LeadsView,
  "crm/pipeline": PipelineView,
  "crm/followups": FollowUpsView,
  "crm/clients": ClientsView,

  // Sales
  "sales/meetings": MeetingsView,
  "sales/proposals": ProposalsView,
  "sales/quotations": QuotationsView,
  "sales/contracts": ContractsView,

  // Delivery
  projects: ProjectsView,
  tasks: TasksView,
  team: TeamView,
  calendar: CalendarView,

  // Finance
  "finance/invoices": InvoicesView,
  "finance/payments": PaymentsView,
  "finance/expenses": ExpensesView,

  // Marketing (Phase 6)
  "marketing/content": ContentView,
  "marketing/campaigns": CampaignsView,

  // Support (Phase 7)
  "support/tickets": TicketsView,
  "support/maintenance": MaintenanceView,

  // Company / Intelligence (Phase 8)
  reports: ReportsView,
  audit: AuditView,
  activity: ActivityFeedView,
  knowledge: KnowledgeView,
  files: FilesView,
  settings: SettingsView,
  automations: AutomationsView,

  // Client Portal (§72) — CLIENT role only, server-scoped by requirePortal()
  portal: PortalOverviewView,
  "portal/projects": PortalProjectsView,
  "portal/invoices": PortalInvoicesView,
  "portal/tickets": PortalTicketsView,
};

export { LoginView };
