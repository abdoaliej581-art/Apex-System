import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api-helpers";

export async function GET(_req: NextRequest) {
  try {
    const { session } = await requirePermission("dashboard.view");
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const in7Days = new Date(endOfDay.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      paymentsThisMonth, outstandingAgg, newLeads, activeLeads,
      proposalsAwaiting, activeProjects, tasksDueToday, overdueTasks,
      upcomingMeetings, openTickets, pipelineRaw, recentActivities,
      todayFollowUps, overdueFollowUps, recentClients, teamRaw,
      recentPayments, expensesThisMonthAgg, outstandingCount,
      publishedContentThisMonth, scheduledContent, activeCampaigns,
      urgentOpenTickets, unassignedOpenTickets, activePlans, recentTickets,
    ] = await Promise.all([
      db.payment.aggregate({ _sum: { amount: true }, where: { date: { gte: startOfMonth } } }),
      db.invoice.aggregate({ _sum: { total: true }, where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } }),
      db.lead.count({ where: { createdAt: { gte: startOfMonth }, deletedAt: null } }),
      db.lead.count({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION"] }, deletedAt: null } }),
      db.proposal.count({ where: { status: { in: ["SENT", "VIEWED"] } } }),
      db.project.count({ where: { status: { in: ["PLANNING", "ACTIVE", "REVIEW"] }, archivedAt: null } }),
      db.task.count({ where: { dueDate: { gte: startOfDay, lt: endOfDay }, status: { notIn: ["DONE"] }, deletedAt: null } }),
      db.task.count({ where: { dueDate: { lt: startOfDay }, status: { notIn: ["DONE"] }, deletedAt: null } }),
      db.meeting.count({ where: { date: { gte: now, lte: in7Days }, status: "SCHEDULED" } }),
      db.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
      db.lead.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { estimatedBudget: true },
        where: { deletedAt: null },
      }),
      db.activity.findMany({
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { actor: { select: { name: true, avatarColor: true } } },
      }),
      db.followUp.count({ where: { dueAt: { gte: startOfDay, lt: endOfDay }, status: "PENDING" } }),
      db.followUp.count({ where: { dueAt: { lt: startOfDay }, status: "PENDING" } }),
      db.client.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, companyName: true, clientNumber: true, industry: true, createdAt: true } }),
      db.user.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, title: true, avatarColor: true,
          assignedTasks: { where: { status: { notIn: ["DONE"] }, deletedAt: null }, select: { id: true, priority: true } },
        },
      }),
      db.payment.findMany({
        orderBy: { date: "desc" },
        take: 5,
        include: {
          invoice: { select: { invoiceNumber: true, currency: true } },
          client: { select: { companyName: true } },
        },
      }),
      db.expense.aggregate({ _sum: { amount: true }, where: { date: { gte: startOfMonth } } }),
      db.invoice.count({ where: { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: now } } }),
      db.content.count({ where: { status: "PUBLISHED", publishDate: { gte: startOfMonth } } }),
      db.content.count({ where: { status: "SCHEDULED", publishDate: { gte: now } } }),
      db.campaign.count({ where: { status: { in: ["PLANNING", "ACTIVE"] } } }),
      db.ticket.count({ where: { deletedAt: null, priority: "URGENT", status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
      db.ticket.count({ where: { deletedAt: null, assignedToId: null, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
      db.maintenancePlan.count({ where: { deletedAt: null, status: "ACTIVE" } }),
      db.ticket.findMany({
        where: { deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } },
        orderBy: { updatedAt: "desc" },
        take: 4,
        include: {
          client: { select: { companyName: true } },
        },
      }),
    ]);

    const wonCount = pipelineRaw.find((p) => p.status === "WON")?._count._all ?? 0;
    const lostCount = pipelineRaw.find((p) => p.status === "LOST")?._count._all ?? 0;
    const closedCount = wonCount + lostCount;

    const teamWorkload = teamRaw.map((u) => ({
      id: u.id, name: u.name, title: u.title, avatarColor: u.avatarColor,
      openTasks: u.assignedTasks.length,
      urgent: u.assignedTasks.filter((t) => t.priority === "URGENT").length,
      load: u.assignedTasks.length >= 8 ? "OVERLOADED" : u.assignedTasks.length >= 5 ? "BUSY" : u.assignedTasks.length >= 2 ? "NORMAL" : "AVAILABLE",
    })).sort((a, b) => b.openTasks - a.openTasks);

    return ok({
      stats: {
        revenueThisMonth: paymentsThisMonth._sum.amount ?? 0,
        outstanding: outstandingAgg._sum.total ?? 0,
        newLeads, activeLeads, proposalsAwaiting, activeProjects,
        tasksDueToday, overdueTasks, upcomingMeetings, openTickets,
        todayFollowUps, overdueFollowUps,
      },
      pipeline: pipelineRaw.map((p) => ({ status: p.status, count: p._count._all, value: p._sum.estimatedBudget ?? 0 })),
      conversion: closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : null,
      activities: recentActivities.map((a) => ({
        id: a.id, type: a.type, title: a.title, entityType: a.entityType, entityId: a.entityId,
        actorName: a.actor?.name || a.actorName || "System", actorColor: a.actor?.avatarColor || "#22d3ee",
        createdAt: a.createdAt,
      })),
      recentClients,
      teamWorkload,
      finance: {
        recentPayments: recentPayments.map((p) => ({
          id: p.id, amount: p.amount, date: p.date,
          invoiceNumber: p.invoice?.invoiceNumber ?? null,
          currency: p.invoice?.currency ?? "EGP",
          clientName: p.client?.companyName ?? null,
        })),
        expensesThisMonth: expensesThisMonthAgg._sum.amount ?? 0,
        overdueInvoices: outstandingCount,
      },
      marketing: {
        publishedThisMonth: publishedContentThisMonth,
        scheduledAhead: scheduledContent,
        activeCampaigns,
      },
      support: {
        urgentOpen: urgentOpenTickets,
        unassignedOpen: unassignedOpenTickets,
        activePlans,
        recentTickets: recentTickets.map((t) => ({
          id: t.id, ticketNumber: t.ticketNumber, subject: t.subject,
          status: t.status, priority: t.priority, updatedAt: t.updatedAt,
          clientName: t.client?.companyName ?? null,
        })),
      },
      permissions: session.user.permissions,
    });
  } catch (e) {
    return handleError(e);
  }
}
