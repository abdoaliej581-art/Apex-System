import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError, paginationFrom } from "@/lib/api-helpers";

// Portal-visible invoice statuses: DRAFT invoices are internal-only (they have not
// been issued to the client yet), everything else is real client-facing history.
const PORTAL_INVOICE_STATUSES = ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"];

// GET /api/portal/invoices — invoices of the signed-in client company ONLY (§72)
export async function GET(req: NextRequest) {
  try {
    const { clientId } = await requirePortal();
    const { page, pageSize, skip, take, sp } = paginationFrom(req);
    const status = (sp.get("status") || "").trim();
    const q = (sp.get("q") || "").trim();

    const where: Prisma.InvoiceWhereInput = {
      clientId, // hard scope
      status: { in: PORTAL_INVOICE_STATUSES },
    };
    if (status) where.status = status;
    if (q) where.invoiceNumber = { contains: q };

    const [rows, total, outstandingAgg, paidAgg, byStatus, orgSetting, client] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: [{ issueDate: "desc" }],
        skip, take,
        select: {
          id: true, invoiceNumber: true, status: true, total: true, paidAmount: true,
          currency: true, issueDate: true, dueDate: true,
          project: { select: { name: true, projectNumber: true } },
        },
      }),
      db.invoice.count({ where }),
      db.invoice.aggregate({
        where: { clientId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
        _sum: { total: true, paidAmount: true },
      }),
      db.invoice.aggregate({
        where: { clientId, status: { in: PORTAL_INVOICE_STATUSES } },
        _sum: { paidAmount: true },
      }),
      db.invoice.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { clientId, status: { in: PORTAL_INVOICE_STATUSES } },
      }),
      // Public-safe organization identity for invoice print headers (§72)
      db.setting.findUnique({ where: { key: "organization" } }),
      db.client.findUnique({ where: { id: clientId }, select: { companyName: true } }),
    ]);

    const orgRaw = orgSetting?.value ? (JSON.parse(orgSetting.value) as Record<string, unknown>) : null;
    const org = orgRaw
      ? {
          name: (orgRaw.name as string) || "APEX",
          email: (orgRaw.email as string) || null,
          phone: (orgRaw.phone as string) || null,
          address: (orgRaw.address as string) || null,
          currency: (orgRaw.currency as string) || "EGP",
        }
      : { name: "APEX", email: null, phone: null, address: null, currency: "EGP" };

    return ok({
      items: rows,
      total, page, pageSize,
      org,
      clientName: client?.companyName ?? "Client",
      summary: {
        outstanding: Math.max(0, (outstandingAgg._sum.total ?? 0) - (outstandingAgg._sum.paidAmount ?? 0)),
        paidTotal: paidAgg._sum.paidAmount ?? 0,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
