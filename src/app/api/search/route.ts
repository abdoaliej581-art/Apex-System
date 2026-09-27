import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api-helpers";

/** Global search across core business entities (§42) — permission-aware */
export async function GET(req: NextRequest) {
  try {
    const { session } = await requireAuth();
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    if (q.length < 2) return ok({ groups: [] });
    const like = { contains: q };

    const perms = session.user.permissions;
    const groups: { label: string; view: string; items: { id: string; title: string; subtitle?: string }[] }[] = [];

    if (perms.includes("leads.view")) {
      const leads = await db.lead.findMany({
        where: { deletedAt: null, OR: [{ companyName: like }, { contactName: like }, { leadNumber: like }, { email: like }, { phone: like }] },
        take: 5, select: { id: true, companyName: true, leadNumber: true, contactName: true },
      });
      if (leads.length) groups.push({ label: "Leads", view: "crm/leads", items: leads.map((l) => ({ id: l.id, title: l.companyName, subtitle: `${l.leadNumber} · ${l.contactName}` })) });
    }
    if (perms.includes("clients.view")) {
      const clients = await db.client.findMany({
        where: { OR: [{ companyName: like }, { clientNumber: like }, { email: like }] },
        take: 5, select: { id: true, companyName: true, clientNumber: true, industry: true },
      });
      if (clients.length) groups.push({ label: "Clients", view: "crm/clients", items: clients.map((c) => ({ id: c.id, title: c.companyName, subtitle: c.clientNumber })) });
    }
    if (perms.includes("projects.view")) {
      const projects = await db.project.findMany({
        where: { archivedAt: null, OR: [{ name: like }, { projectNumber: like }] },
        take: 5, select: { id: true, name: true, projectNumber: true, status: true },
      });
      if (projects.length) groups.push({ label: "Projects", view: "projects", items: projects.map((p) => ({ id: p.id, title: p.name, subtitle: `${p.projectNumber} · ${p.status}` })) });
    }
    if (perms.includes("tasks.view")) {
      const tasks = await db.task.findMany({
        where: { deletedAt: null, title: like },
        take: 5, select: { id: true, title: true, status: true },
      });
      if (tasks.length) groups.push({ label: "Tasks", view: "tasks", items: tasks.map((t) => ({ id: t.id, title: t.title, subtitle: t.status })) });
    }
    if (perms.includes("invoices.view")) {
      const invoices = await db.invoice.findMany({
        where: { OR: [{ invoiceNumber: like }, { notes: like }] },
        take: 5, select: { id: true, invoiceNumber: true, total: true, status: true },
      });
      if (invoices.length) groups.push({ label: "Invoices", view: "finance/invoices", items: invoices.map((i) => ({ id: i.id, title: i.invoiceNumber, subtitle: `${i.total} · ${i.status}` })) });
    }
    if (perms.includes("tickets.view")) {
      const tickets = await db.ticket.findMany({
        where: { OR: [{ subject: like }, { ticketNumber: like }] },
        take: 5, select: { id: true, subject: true, ticketNumber: true, status: true },
      });
      if (tickets.length) groups.push({ label: "Tickets", view: "support/tickets", items: tickets.map((t) => ({ id: t.id, title: t.subject, subtitle: `${t.ticketNumber} · ${t.status}` })) });
    }
    if (perms.includes("kb.view")) {
      const articles = await db.knowledgeArticle.findMany({
        where: { deletedAt: null, OR: [{ title: like }, { content: like }] },
        take: 5, select: { id: true, title: true, category: true },
      });
      if (articles.length) groups.push({ label: "Knowledge Base", view: "knowledge", items: articles.map((a) => ({ id: a.id, title: a.title, subtitle: a.category })) });
    }

    return ok({ groups });
  } catch (e) {
    return handleError(e);
  }
}
