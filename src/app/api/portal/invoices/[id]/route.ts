import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePortal, ok, handleError, ApiError } from "@/lib/api-helpers";

// GET /api/portal/invoices/[id] — invoice detail with items + payment history (§72)
// Scope: invoice must belong to the portal user's client company AND must not be
// a DRAFT (drafts are internal work-in-progress, never shown to clients).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { clientId } = await requirePortal();
    const { id } = await params;

    const invoice = await db.invoice.findFirst({
      where: { id, clientId, status: { notIn: ["DRAFT"] } },
      select: {
        id: true, invoiceNumber: true, status: true, currency: true,
        issueDate: true, dueDate: true, subtotal: true, discountAmount: true,
        taxPercent: true, total: true, paidAmount: true, paymentTerms: true, notes: true,
        project: { select: { name: true, projectNumber: true } },
        items: { orderBy: { order: "asc" }, select: { id: true, description: true, quantity: true, unitPrice: true, total: true } },
        payments: {
          orderBy: { date: "desc" },
          select: { id: true, amount: true, method: true, reference: true, date: true },
        },
      },
    });

    if (!invoice) throw new ApiError(404, "NOT_FOUND", "Invoice not found among your company's invoices.");

    return ok({
      invoice,
      outstanding: Math.max(0, invoice.total - invoice.paidAmount),
    });
  } catch (e) {
    return handleError(e);
  }
}
