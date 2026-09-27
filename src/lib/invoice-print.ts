// ============ Invoice print / PDF export (§12, §80 print-stylesheet approach) ============
// Renders a clean, print-optimized invoice document (white paper, A4-friendly)
// into a dedicated print root, then invokes the browser print dialog — from
// which any platform can "Save as PDF". Used by internal Finance and the
// Client Portal alike. No extra page routes (sandbox constraint honored).

export type InvoicePrintOrg = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export type InvoicePrintPayment = {
  id: string;
  amount: number;
  method: string;
  reference?: string | null;
  date: string;
};

export type InvoicePrintData = {
  invoice: {
    invoiceNumber: string;
    issueDate: string;
    dueDate?: string | null;
    status: string;
    currency: string;
    subtotal: number;
    discountAmount: number;
    taxPercent: number;
    total: number;
    paidAmount: number;
    paymentTerms?: string | null;
    notes?: string | null;
  };
  clientName: string;
  projectName?: string | null;
  items: { id: string; description: string; quantity: number; unitPrice: number; total: number }[];
  payments: InvoicePrintPayment[];
  generatedBy?: string;
};

const money = (n: number, currency: string) =>
  `${(n ?? 0).toLocaleString("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const dateStr = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildInvoiceHtml(data: InvoicePrintData & { org: InvoicePrintOrg }): string {
  const { invoice: inv, org } = data;
  const outstanding = Math.max(0, inv.total - inv.paidAmount);
  const taxBase = inv.subtotal - inv.discountAmount;
  const taxAmount = Math.round((taxBase * inv.taxPercent) / 100 * 100) / 100;

  const contactBits = [org.email, org.phone, org.address].filter(Boolean).map(esc);

  const itemRows = data.items.length
    ? data.items.map((it) => `
        <tr>
          <td>${esc(it.description)}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">${money(it.unitPrice, inv.currency)}</td>
          <td class="num strong">${money(it.total, inv.currency)}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="empty">No line items</td></tr>`;

  const paymentRows = data.payments.length
    ? data.payments.map((p) => `
        <tr>
          <td>${dateStr(p.date)}</td>
          <td>${esc(p.method.replace(/_/g, " "))}${p.reference ? ` · ${esc(p.reference)}` : ""}</td>
          <td class="num strong">${money(p.amount, inv.currency)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="empty">No payments recorded yet</td></tr>`;

  return `
  <div class="doc">
    <header>
      <div class="org">
        <div class="org-name">${esc(org.name)}</div>
        ${contactBits.length ? `<div class="org-contact">${contactBits.join(" · ")}</div>` : ""}
      </div>
      <div class="meta">
        <h1>INVOICE</h1>
        <table class="meta-table">
          <tr><th>Number</th><td>${esc(inv.invoiceNumber)}</td></tr>
          <tr><th>Issued</th><td>${dateStr(inv.issueDate)}</td></tr>
          <tr><th>Due</th><td>${dateStr(inv.dueDate)}</td></tr>
          <tr><th>Status</th><td><span class="status">${esc(inv.status.replace(/_/g, " "))}</span></td></tr>
        </table>
      </div>
    </header>

    <section class="billto">
      <p class="label">BILLED TO</p>
      <p class="client">${esc(data.clientName)}</p>
      ${data.projectName ? `<p class="project">Project: ${esc(data.projectName)}</p>` : ""}
    </section>

    <table class="items">
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <section class="totals">
      <table>
        <tr><td>Subtotal</td><td class="num">${money(inv.subtotal, inv.currency)}</td></tr>
        ${inv.discountAmount > 0 ? `<tr><td>Discount</td><td class="num">−${money(inv.discountAmount, inv.currency)}</td></tr>` : ""}
        ${inv.taxPercent > 0 ? `<tr><td>Tax (${inv.taxPercent}%)</td><td class="num">${money(taxAmount, inv.currency)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td class="num">${money(inv.total, inv.currency)}</td></tr>
        <tr class="paid"><td>Paid</td><td class="num">−${money(inv.paidAmount, inv.currency)}</td></tr>
        <tr class="due"><td>${outstanding > 0 ? "Amount due" : "Fully paid"}</td><td class="num">${outstanding > 0 ? money(outstanding, inv.currency) : "✓"}</td></tr>
      </table>
    </section>

    <section class="payments">
      <h2>Payment history</h2>
      <table>
        <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
        <tbody>${paymentRows}</tbody>
      </table>
    </section>

    ${(inv.paymentTerms || inv.notes) ? `
    <section class="footnotes">
      ${inv.paymentTerms ? `<p><span class="label">Terms:</span> ${esc(inv.paymentTerms)}</p>` : ""}
      ${inv.notes ? `<p><span class="label">Notes:</span> ${esc(inv.notes)}</p>` : ""}
    </section>` : ""}

    <footer>
      ${esc(org.name)} · ${data.generatedBy ? `Issued by ${esc(data.generatedBy)} · ` : ""}Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} by APEX SYSTEM
    </footer>
  </div>`;
}

/**
 * Print (or save as PDF) the given invoice. Uses a dedicated print root with
 * @media print isolation so the SPA shell never appears on paper.
 */
export function printInvoice(data: InvoicePrintData & { org: InvoicePrintOrg }): void {
  const PRINT_STYLE = `
    <style>
      @media print {
        body > *:not(#apex-print-root) { display: none !important; }
        #apex-print-root { display: block !important; }
      }
      #apex-print-root { display: none; }
      #apex-print-root .doc {
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: #101828; background: #fff; max-width: 800px; margin: 0 auto;
        padding: 40px 48px; font-size: 13px; line-height: 1.55;
      }
      #apex-print-root header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #101828; padding-bottom: 20px; }
      #apex-print-root .org-name { font-size: 26px; font-weight: 700; letter-spacing: 0.06em; }
      #apex-print-root .org-contact { color: #475467; margin-top: 6px; font-size: 12px; }
      #apex-print-root .meta { text-align: right; }
      #apex-print-root .meta h1 { font-size: 22px; letter-spacing: 0.18em; margin: 0 0 10px; }
      #apex-print-root .meta-table th { text-align: right; color: #667085; font-weight: 500; padding: 2px 0 2px 12px; }
      #apex-print-root .meta-table td { text-align: right; font-weight: 600; padding: 2px 0 2px 10px; }
      #apex-print-root .status { display: inline-block; border: 1px solid #101828; border-radius: 4px; padding: 1px 8px; font-size: 11px; letter-spacing: 0.08em; }
      #apex-print-root .billto { margin: 28px 0; }
      #apex-print-root .label { color: #667085; font-size: 10px; letter-spacing: 0.14em; margin: 0 0 3px; }
      #apex-print-root .client { font-size: 17px; font-weight: 700; margin: 0; }
      #apex-print-root .project { color: #475467; margin: 3px 0 0; }
      #apex-print-root table { width: 100%; border-collapse: collapse; }
      #apex-print-root .items th { background: #f2f4f7; text-align: left; padding: 9px 12px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #475467; border-bottom: 1px solid #d0d5dd; }
      #apex-print-root .items td { padding: 10px 12px; border-bottom: 1px solid #eaecf0; }
      #apex-print-root .num { text-align: right; white-space: nowrap; }
      #apex-print-root .strong { font-weight: 600; }
      #apex-print-root .empty { text-align: center; color: #98a2b3; font-style: italic; }
      #apex-print-root .totals { display: flex; justify-content: flex-end; margin: 18px 0 6px; }
      #apex-print-root .totals table { width: auto; min-width: 320px; }
      #apex-print-root .totals td { padding: 5px 12px; }
      #apex-print-root .totals .grand td { border-top: 2px solid #101828; font-weight: 700; font-size: 14px; padding-top: 9px; }
      #apex-print-root .totals .paid td { color: #067647; }
      #apex-print-root .totals .due td { font-weight: 700; border-top: 1px solid #d0d5dd; }
      #apex-print-root .payments { margin-top: 26px; }
      #apex-print-root .payments h2 { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #475467; margin: 0 0 8px; }
      #apex-print-root .payments th { text-align: left; background: #f2f4f7; padding: 7px 12px; font-size: 11px; color: #475467; border-bottom: 1px solid #d0d5dd; }
      #apex-print-root .payments td { padding: 7px 12px; border-bottom: 1px solid #eaecf0; }
      #apex-print-root .footnotes { margin-top: 22px; color: #475467; font-size: 12px; }
      #apex-print-root .footnotes .label { color: #667085; }
      #apex-print-root footer { margin-top: 34px; padding-top: 12px; border-top: 1px solid #eaecf0; color: #98a2b3; font-size: 11px; text-align: center; }
      @page { margin: 14mm; }
    </style>`;

  const root = document.createElement("div");
  root.id = "apex-print-root";
  root.innerHTML = buildInvoiceHtml(data);
  document.body.appendChild(root);

  const cleanup = () => {
    document.getElementById("apex-print-root")?.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Fallback cleanup in case afterprint does not fire
  setTimeout(() => document.getElementById("apex-print-root")?.remove(), 60_000);

  const style = document.createElement("style");
  style.innerHTML = PRINT_STYLE;
  root.appendChild(style);

  window.print();
}
