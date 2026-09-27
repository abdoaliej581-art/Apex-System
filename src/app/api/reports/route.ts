import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

const LEAD_OPEN_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION"];
const OPEN_TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"];
const ACTIVE_PROJECT_STATUSES = ["PLANNING", "ACTIVE", "REVIEW"];
const INVOICED_STATUSES = ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"];

/** Last N month keys (YYYY-MM) ending with the current month, oldest first. */
function lastMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * GET /api/reports?range=30|90|365|all
 * Cross-module intelligence report built ONLY from real records (§54).
 * Every section is additionally gated by the caller's own permissions so a
 * Sales user never sees finance internals, a Developer never sees the funnel, etc.
 */
export async function GET(req: NextRequest) {
  try {
    const { session } = await requirePermission("reports.view");
    const perms = new Set(session.user.permissions || []);
    const sp = req.nextUrl.searchParams;
    const rangeParam = sp.get("range") || "90";
    const days = rangeParam === "all" ? null : [30, 90, 365].includes(Number(rangeParam)) ? Number(rangeParam) : 90;
    const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : new Date("2000-01-01T00:00:00.000Z");
    const since6m = new Date();
    since6m.setMonth(since6m.getMonth() - 5);
    since6m.setDate(1);
    since6m.setHours(0, 0, 0, 0);

    const can = (p: string) => perms.has(p);
    const showSales = can("leads.view");
    const showInvoices = can("invoices.view");
    const showPayments = can("payments.view");
    const showExpenses = can("expenses.view");
    const showFinance = showInvoices || showPayments || showExpenses;
    const showProjects = can("projects.view");
    const showTasks = can("tasks.view");
    const showDelivery = showProjects || showTasks;
    const showTeam = showTasks;
    const showTickets = can("tickets.view");
    const showContent = can("content.view");
    const showCampaigns = can("campaigns.view");
    const showMarketing = showContent || showCampaigns;
    const showActivity = can("activities.view");
    const showClients = can("clients.view");

    const [
      funnelRaw, wonLeads, lostLeads, activeClients,
      invoicedAgg, outstandingAgg, collectedAgg, expensesAgg,
      invoices6m, payments6m, invoiceStatusRaw, expensesByCategoryRaw,
      projectsStatusRaw, projectsHealthRaw, tasksStatusRaw,
      teamRaw,
      ticketsStatusRaw, closedTickets, urgentOpen, unassignedOpen,
      contentStatusRaw, contentPlatformRaw, campaignsStatusRaw,
      activityTotal, activityWeek,
    ] = await Promise.all([
      showSales
        ? db.lead.groupBy({ by: ["status"], _count: { _all: true }, _sum: { estimatedBudget: true }, where: { deletedAt: null, createdAt: { gte: since } } })
        : Promise.resolve(null),
      showSales ? db.lead.count({ where: { deletedAt: null, status: "WON", createdAt: { gte: since } } }) : Promise.resolve(0),
      showSales ? db.lead.count({ where: { deletedAt: null, status: "LOST", createdAt: { gte: since } } }) : Promise.resolve(0),
      showClients ? db.client.count({ where: { archivedAt: null, status: "ACTIVE" } }) : Promise.resolve(0),

      showInvoices ? db.invoice.aggregate({ _sum: { total: true }, where: { createdAt: { gte: since }, status: { in: INVOICED_STATUSES } } }) : Promise.resolve(null),
      showInvoices ? db.invoice.aggregate({ _sum: { total: true }, where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } }) : Promise.resolve(null),
      showPayments ? db.payment.aggregate({ _sum: { amount: true }, where: { date: { gte: since } } }) : Promise.resolve(null),
      showExpenses ? db.expense.aggregate({ _sum: { amount: true }, where: { date: { gte: since } } }) : Promise.resolve(null),

      showInvoices
        ? db.invoice.findMany({ where: { issueDate: { gte: since6m }, status: { in: INVOICED_STATUSES } }, select: { issueDate: true, total: true } })
        : Promise.resolve(null),
      showPayments
        ? db.payment.findMany({ where: { date: { gte: since6m } }, select: { date: true, amount: true } })
        : Promise.resolve(null),
      showInvoices
        ? db.invoice.groupBy({ by: ["status"], _count: { _all: true }, _sum: { total: true }, where: { createdAt: { gte: since } } })
        : Promise.resolve(null),
      showExpenses
        ? db.expense.groupBy({ by: ["category"], _sum: { amount: true }, _count: { _all: true }, where: { date: { gte: since } } })
        : Promise.resolve(null),

      showProjects
        ? db.project.groupBy({ by: ["status"], _count: { _all: true }, where: { archivedAt: null } })
        : Promise.resolve(null),
      showProjects
        ? db.project.groupBy({ by: ["health"], _count: { _all: true }, where: { archivedAt: null, status: { in: ACTIVE_PROJECT_STATUSES } } })
        : Promise.resolve(null),
      showTasks
        ? db.task.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } })
        : Promise.resolve(null),

      showTeam
        ? db.user.findMany({
            where: { isActive: true },
            select: {
              id: true, name: true, title: true, avatarColor: true,
              assignedTasks: {
                where: { deletedAt: null },
                select: { status: true, dueDate: true, completedAt: true },
              },
            },
          })
        : Promise.resolve(null),

      showTickets
        ? db.ticket.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } })
        : Promise.resolve(null),
      showTickets
        ? db.ticket.findMany({
            where: { deletedAt: null, closedAt: { not: null }, createdAt: { gte: since } },
            select: { createdAt: true, closedAt: true },
          })
        : Promise.resolve(null),
      showTickets ? db.ticket.count({ where: { deletedAt: null, status: { in: OPEN_TICKET_STATUSES }, priority: "URGENT" } }) : Promise.resolve(0),
      showTickets ? db.ticket.count({ where: { deletedAt: null, status: { in: OPEN_TICKET_STATUSES }, assignedToId: null } }) : Promise.resolve(0),

      showContent
        ? db.content.groupBy({ by: ["status"], _count: { _all: true } })
        : Promise.resolve(null),
      showContent
        ? db.content.groupBy({ by: ["platform"], _count: { _all: true }, where: { status: { not: "ARCHIVED" } } })
        : Promise.resolve(null),
      showCampaigns
        ? db.campaign.groupBy({ by: ["status"], _count: { _all: true }, _sum: { budget: true } })
        : Promise.resolve(null),

      showActivity ? db.activity.count() : Promise.resolve(0),
      showActivity ? db.activity.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }) : Promise.resolve(0),
    ]);

    const won = wonLeads;
    const closed = won + lostLeads;
    const conversionRate = closed > 0 ? Math.round((won / closed) * 100) : null;

    // ---- Revenue trend: fixed 6-month window, invoiced vs collected ----
    const monthKeys = lastMonthKeys(6);
    const invoicedByMonth: Record<string, number> = {};
    const collectedByMonth: Record<string, number> = {};
    monthKeys.forEach((k) => { invoicedByMonth[k] = 0; collectedByMonth[k] = 0; });
    (invoices6m ?? []).forEach((inv) => {
      const d = new Date(inv.issueDate);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (k in invoicedByMonth) invoicedByMonth[k] = r2(invoicedByMonth[k] + inv.total);
    });
    (payments6m ?? []).forEach((p) => {
      const d = new Date(p.date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (k in collectedByMonth) collectedByMonth[k] = r2(collectedByMonth[k] + p.amount);
    });
    const revenueByMonth = monthKeys.map((k) => ({ month: k, invoiced: invoicedByMonth[k], collected: collectedByMonth[k] }));

    // ---- Team leaderboard (range-scoped completions) ----
    const leaderboard = (teamRaw ?? [])
      .map((u) => {
        const done = u.assignedTasks.filter((t) => t.status === "DONE" && t.completedAt && t.completedAt >= since).length;
        const open = u.assignedTasks.filter((t) => t.status !== "DONE").length;
        const now = Date.now();
        const overdue = u.assignedTasks.filter((t) => t.status !== "DONE" && t.dueDate && new Date(t.dueDate).getTime() < now).length;
        return { id: u.id, name: u.name, title: u.title, avatarColor: u.avatarColor, done, open, overdue };
      })
      .sort((a, b) => b.done - a.done || b.open - a.open)
      .slice(0, 8);

    // ---- Support: avg resolution hours ----
    const resolutions = (closedTickets ?? [])
      .map((t) => (t.closedAt ? (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) / 3600000 : 0))
      .filter((h) => h >= 0);
    const avgResolutionHours = resolutions.length > 0 ? Math.round((resolutions.reduce((a, b) => a + b, 0) / resolutions.length) * 10) / 10 : null;

    type DistRow = Record<string, string | number> & { _count: { _all: number } };
    const toDist = (raw: DistRow[] | null, key: string) =>
      (raw ?? []).map((row) => ({ [key]: row[key], count: row._count._all }));

    return ok({
      range: days === null ? "all" : String(days),
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      sections: {
        sales: showSales, clients: showClients, finance: showFinance,
        invoices: showInvoices, payments: showPayments, expenses: showExpenses,
        delivery: showDelivery, projects: showProjects, tasks: showTasks,
        team: showTeam, support: showTickets, marketing: showMarketing,
        content: showContent, campaigns: showCampaigns, activity: showActivity,
      },
      kpis: {
        newLeads: showSales ? funnelRaw?.reduce((a, row) => a + row._count._all, 0) ?? 0 : null,
        wonLeads: showSales ? won : null,
        conversionRate: showSales ? conversionRate : null,
        activeClients: showClients ? activeClients : null,
        invoiced: showInvoices ? r2(invoicedAgg?._sum.total ?? 0) : null,
        collected: showPayments ? r2(collectedAgg?._sum.amount ?? 0) : null,
        outstanding: showInvoices ? r2(outstandingAgg?._sum.total ?? 0) : null,
        expenses: showExpenses ? r2(expensesAgg?._sum.amount ?? 0) : null,
        activeProjects: showProjects ? projectsStatusRaw?.filter((p) => ACTIVE_PROJECT_STATUSES.includes(p.status)).reduce((a, p) => a + p._count._all, 0) ?? 0 : null,
        tasksDone: showTasks ? tasksStatusRaw?.find((t) => t.status === "DONE")?._count._all ?? 0 : null,
        openTickets: showTickets ? ticketsStatusRaw?.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).reduce((a, t) => a + t._count._all, 0) ?? 0 : null,
        publishedContent: showContent ? contentStatusRaw?.find((c) => c.status === "PUBLISHED")?._count._all ?? 0 : null,
      },
      sales: {
        funnel: (funnelRaw ?? [])
          .map((row) => ({ status: row.status, count: row._count._all, value: r2(row._sum.estimatedBudget ?? 0) }))
          .sort((a, b) => {
            const order = [...LEAD_OPEN_STATUSES, "WON", "LOST"];
            return order.indexOf(a.status) - order.indexOf(b.status);
          }),
        openValue: r2((funnelRaw ?? []).filter((row) => LEAD_OPEN_STATUSES.includes(row.status)).reduce((a, row) => a + (row._sum.estimatedBudget ?? 0), 0)),
      },
      finance: {
        revenueByMonth,
        invoiceStatus: toDist(invoiceStatusRaw as unknown as DistRow[], "status"),
        expensesByCategory: (expensesByCategoryRaw ?? [])
          .map((row) => ({ category: row.category, amount: r2(row._sum.amount ?? 0), count: row._count._all }))
          .sort((a, b) => b.amount - a.amount),
      },
      delivery: {
        projectsByStatus: toDist(projectsStatusRaw as unknown as DistRow[], "status"),
        projectsByHealth: toDist(projectsHealthRaw as unknown as DistRow[], "health"),
        tasksByStatus: toDist(tasksStatusRaw as unknown as DistRow[], "status"),
      },
      team: { leaderboard },
      support: {
        ticketsByStatus: toDist(ticketsStatusRaw as unknown as DistRow[], "status"),
        avgResolutionHours,
        urgentOpen,
        unassignedOpen,
      },
      marketing: {
        contentByStatus: toDist(contentStatusRaw as unknown as DistRow[], "status"),
        contentByPlatform: toDist(contentPlatformRaw as unknown as DistRow[], "platform"),
        campaignsByStatus: (campaignsStatusRaw ?? []).map((row) => ({ status: row.status, count: row._count._all, budget: r2(row._sum.budget ?? 0) })),
      },
      activity: { total: activityTotal, thisWeek: activityWeek },
    });
  } catch (e) {
    return handleError(e);
  }
}
