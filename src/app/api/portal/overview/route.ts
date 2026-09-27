import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError } from "@/lib/api-helpers";

// GET /api/portal/overview — Client Portal home (§72)
// EVERY query is scoped to the signed-in portal user's client company.
export async function GET(_req: NextRequest) {
  try {
    const { clientId } = await requirePortal();

    const client = await db.client.findUnique({
      where: { id: clientId },
      select: {
        id: true, clientNumber: true, companyName: true, industry: true,
        location: true, email: true, phone: true, status: true,
      },
    });
    if (!client) {
      // Portal user linked to a deleted client — surface a clean state, not a crash
      return ok({ client: null, kpis: null, projects: [], invoices: [], tickets: [], maintenance: null });
    }

    const now = new Date();

    const [
      activeProjects,
      completedProjects,
      openTickets,
      outstandingAgg,
      overdueCount,
      recentInvoices,
      activeTicketRows,
      plans,
      lastPayment,
      nextMeeting,
    ] = await Promise.all([
      db.project.count({ where: { clientId, archivedAt: null, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD", "REVIEW"] } } }),
      db.project.count({ where: { clientId, status: "COMPLETED" } }),
      db.ticket.count({ where: { clientId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } } }),
      db.invoice.aggregate({
        where: { clientId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
        _sum: { total: true, paidAmount: true },
      }),
      db.invoice.count({ where: { clientId, status: "OVERDUE" } }),
      db.invoice.findMany({
        where: { clientId, status: { notIn: ["DRAFT"] } },
        orderBy: { issueDate: "desc" },
        take: 5,
        select: {
          id: true, invoiceNumber: true, status: true, total: true, paidAmount: true,
          currency: true, issueDate: true, dueDate: true,
        },
      }),
      db.ticket.findMany({
        where: { clientId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } },
        orderBy: { updatedAt: "desc" },
        take: 4,
        select: {
          id: true, ticketNumber: true, subject: true, status: true, priority: true, updatedAt: true,
        },
      }),
      db.maintenancePlan.findMany({
        where: { clientId, status: "ACTIVE", deletedAt: null },
        select: {
          id: true, plan: true, includedHours: true, usedHours: true, startDate: true, endDate: true,
        },
        take: 2,
      }),
      db.payment.findFirst({
        where: { clientId },
        orderBy: { date: "desc" },
        select: { id: true, amount: true, method: true, date: true, invoice: { select: { invoiceNumber: true } } },
      }),
      db.meeting.findFirst({
        where: { clientId, date: { gte: now }, status: { in: ["SCHEDULED"] } },
        orderBy: { date: "asc" },
        select: { id: true, title: true, date: true, startTime: true },
      }),
    ]);

    const outstanding = Math.max(0, (outstandingAgg._sum.total ?? 0) - (outstandingAgg._sum.paidAmount ?? 0));

    return ok({
      client,
      kpis: {
        activeProjects,
        completedProjects,
        openTickets,
        outstanding,
        overdueCount,
        lastPayment: lastPayment
          ? { amount: lastPayment.amount, method: lastPayment.method, paidAt: lastPayment.date, invoiceNumber: lastPayment.invoice?.invoiceNumber ?? null }
          : null,
        nextMeeting: nextMeeting
          ? { title: nextMeeting.title, date: nextMeeting.date, startTime: nextMeeting.startTime }
          : null,
      },
      projects: await db.project.findMany({
        where: { clientId, archivedAt: null, status: { notIn: ["CANCELLED"] } },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 4,
        select: { id: true, projectNumber: true, name: true, status: true, progress: true, health: true, deadline: true },
      }),
      invoices: recentInvoices,
      tickets: activeTicketRows,
      maintenance: plans[0] ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
