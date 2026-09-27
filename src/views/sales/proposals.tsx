"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field } from "@/components/shared";
import { api, qs, formatCurrency, formatDate, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Plus, MoreHorizontal, Pencil, Trash2, Eye, Send, CheckCheck, XCircle,
  Clock, ArrowRight, Wand2, Building2, FolderKanban, UserCheck, ListChecks, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ================= Types =================

type Party = { id: string; companyName: string } | null | undefined;

type ProposalListRow = {
  id: string; proposalNumber: string; title: string; status: string;
  currency: string; subtotal: number; discountAmount: number; taxPercent: number; total: number;
  validUntil?: string | null; sentAt?: string | null; respondedAt?: string | null; createdAt: string;
  lead?: Party; client?: Party; _count?: { items: number };
};

type ProposalItemRow = { id: string; description: string; quantity: number; unitPrice: number; total: number; order: number };

type ActivityRow = { id: string; type: string; title: string; description?: string | null; actorName: string; actorColor: string; createdAt: string };

type ProposalDetail = ProposalListRow & {
  leadId?: string | null; clientId?: string | null;
  problem?: string | null; solution?: string | null; scope?: string | null; timeline?: string | null;
  deliverables?: string | null; paymentTerms?: string | null; revisionPolicy?: string | null;
  maintenanceTerms?: string | null; terms?: string | null; notes?: string | null;
  items: ProposalItemRow[];
  lead?: (Party & { contactName?: string | null; email?: string | null; phone?: string | null });
  client?: (Party & { email?: string | null; phone?: string | null });
  activities: ActivityRow[];
};

type ItemDraft = { description: string; quantity: string; unitPrice: string };

type Option = { id: string; label: string };

// ================= Helpers =================

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the server formula: total = subtotal - discount + subtotal * tax% / 100 */
function previewTotals(items: ItemDraft[], discount: number, taxPercent: number) {
  const subtotal = round2(items.reduce((s, i) => s + num(i.quantity) * num(i.unitPrice), 0));
  const tax = round2((subtotal * taxPercent) / 100);
  return { subtotal, tax, total: round2(subtotal - discount + tax) };
}

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["items", "leads", "clients", "projects", "team"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

function toOptions(url: string, labelKey: string): Promise<Option[]> {
  return api.get<unknown>(url)
    .then((data) => extractList(data).map((x) => ({ id: String(x.id), label: String(x[labelKey] ?? x.name ?? x.companyName ?? "") })).filter((o) => o.label))
    .catch(() => []);
}

function parseDeliverables(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

const ACTIVE_STATUSES = ["DRAFT", "SENT", "VIEWED"];
const STEP_ORDER = ["DRAFT", "SENT", "VIEWED"];
const TERMINALS: Record<string, { label: string; tone: string }> = {
  ACCEPTED: { label: "Accepted", tone: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  REJECTED: { label: "Rejected", tone: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  EXPIRED: { label: "Expired", tone: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
};

function toDateInput(d: string | Date): string {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

// ================= Items editor =================

function ItemsEditor({ items, onChange, currency, disabled }: {
  items: ItemDraft[]; onChange: (items: ItemDraft[]) => void; currency: string; disabled?: boolean;
}) {
  const totals = previewTotals(items, 0, 0);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="hidden md:grid grid-cols-[1fr_90px_120px_110px_36px] gap-2 px-3 py-2 bg-secondary/50 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        <span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Line total</span><span />
      </div>
      <div className="divide-y divide-border max-h-72 overflow-y-auto apex-scroll">
        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_72px_64px] md:grid-cols-[1fr_90px_120px_110px_36px] gap-2 px-3 py-2 items-center">
            <Input
              value={item.description}
              disabled={disabled}
              onChange={(e) => onChange(items.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)))}
              placeholder={`Item ${idx + 1} — e.g. Landing page design`}
              className="col-span-3 md:col-span-1 h-8 text-sm"
            />
            <Input
              type="number" min={0} step={0.5} value={item.quantity} disabled={disabled}
              onChange={(e) => onChange(items.map((it, i) => (i === idx ? { ...it, quantity: e.target.value } : it)))}
              className="h-8 text-sm" aria-label="Quantity"
            />
            <Input
              type="number" min={0} step={0.01} value={item.unitPrice} disabled={disabled}
              onChange={(e) => onChange(items.map((it, i) => (i === idx ? { ...it, unitPrice: e.target.value } : it)))}
              className="h-8 text-sm" aria-label="Unit price"
            />
            <span className="hidden md:block text-sm font-medium text-right tabular-nums">
              {formatCurrency(round2(num(item.quantity) * num(item.unitPrice)), currency)}
            </span>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive justify-self-end"
              disabled={disabled || items.length <= 1}
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              title="Remove item"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 border-t border-border">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...items, { description: "", quantity: "1", unitPrice: "0" }])}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add item
        </Button>
        <p className="text-xs text-muted-foreground">Items subtotal: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(totals.subtotal, currency)}</span></p>
      </div>
    </div>
  );
}

// ================= Status stepper =================

function StatusStepper({ status }: { status: string }) {
  const currentIdx = STEP_ORDER.indexOf(status);
  const terminal = TERMINALS[status];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {STEP_ORDER.map((step, i) => {
        const done = currentIdx >= 0 && i <= currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium",
                done ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground",
                isCurrent && "apex-glow"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", done ? "bg-primary" : "bg-muted-foreground/50")} />
              {step.charAt(0) + step.slice(1).toLowerCase()}
            </span>
            {i < STEP_ORDER.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/50" />}
          </div>
        );
      })}
      {terminal ? (
        <div className="flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold", terminal.tone)}>
            <CheckCheck className="w-3 h-3" /> {terminal.label}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
          <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-dashed border-border text-[11px] text-muted-foreground">Pending decision</span>
        </div>
      )}
    </div>
  );
}

// ================= Convert dialog (§62) =================

const PROJECT_TYPES = ["BUSINESS_WEBSITE", "ECOMMERCE", "WEB_APP", "MOBILE_APP", "UI_UX_DESIGN", "SEO", "BRANDING", "MAINTENANCE", "OTHER"];

function ConvertDialog({ proposal, open, onClose, onConverted, navigate }: {
  proposal: ProposalDetail | null; open: boolean;
  onClose: () => void; onConverted: () => void; navigate: (p: string) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [managers, setManagers] = useState<Option[]>([]);
  const source = proposal?.lead ?? proposal?.client ?? null;
  const [form, setForm] = useState({
    createClient: true, companyName: "", email: "", phone: "", contactName: "",
    createProject: true, projectName: "", projectType: "BUSINESS_WEBSITE", managerId: "", notifyPm: true,
  });

  useEffect(() => {
    if (!open || !proposal) return;
    setForm({
      createClient: !proposal.clientId,
      companyName: proposal.lead?.companyName ?? proposal.client?.companyName ?? "",
      email: proposal.lead?.email ?? proposal.client?.email ?? "",
      phone: proposal.lead?.phone ?? proposal.client?.phone ?? "",
      contactName: proposal.lead?.contactName ?? "",
      createProject: !proposal.clientId,
      projectName: proposal.title,
      projectType: "BUSINESS_WEBSITE",
      managerId: "",
      notifyPm: true,
    });
    // Manager options degrade silently when team.view is not granted
    api.get<{ team: { id: string; name: string }[] }>("/api/team")
      .then((d) => setManagers((d.team ?? []).map((m) => ({ id: m.id, label: m.name }))))
      .catch(() => setManagers([]));
  }, [open, proposal]);

  const convert = async () => {
    if (!proposal) return;
    if (form.createClient && form.companyName.trim().length < 2) {
      return toast({ title: "Company name is required" });
    }
    if (form.createProject && form.projectName.trim().length < 2) {
      return toast({ title: "Project name is required" });
    }
    setSaving(true);
    try {
      const res = await api.post<{ clientId: string | null; projectId: string | null; clientNumber: string | null; projectNumber: string | null }>(
        "/api/conversions",
        {
          proposalId: proposal.id,
          options: {
            createClient: form.createClient,
            client: form.createClient
              ? { companyName: form.companyName.trim(), email: form.email.trim() || undefined, phone: form.phone.trim() || undefined }
              : undefined,
            contact: form.createClient && form.contactName.trim()
              ? { name: form.contactName.trim(), email: form.email.trim() || undefined, phone: form.phone.trim() || undefined }
              : undefined,
            createProject: form.createProject,
            project: form.createProject
              ? { name: form.projectName.trim(), type: form.projectType, managerId: form.managerId || undefined }
              : undefined,
            notifyProjectManager: form.notifyPm,
          },
        }
      );
      toast({
        title: "Proposal accepted — converted",
        description: [res.clientNumber ? `Client ${res.clientNumber}` : null, res.projectNumber ? `Project ${res.projectNumber}` : null].filter(Boolean).join(" · ") || "No records created",
      });
      onConverted();
      onClose();
      navigate("crm/clients");
    } catch (e) {
      toast({ title: "Conversion failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const acceptOnly = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await api.patch(`/api/proposals/${proposal.id}`, { status: "ACCEPTED" });
      toast({ title: "Proposal accepted" });
      onConverted();
      onClose();
    } catch (e) {
      toast({ title: "Could not accept proposal", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="w-4 h-4 text-primary" /> Convert to Client &amp; Project</DialogTitle>
          <DialogDescription>
            Accepting <span className="text-foreground font-medium">{proposal?.proposalNumber}</span> can create the client record
            {source ? <> from <span className="text-foreground font-medium">{source.companyName}</span></> : null} and kick off delivery.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto apex-scroll pr-1 space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Create client</p>
              <p className="text-xs text-muted-foreground mt-0.5">Company record with numbering, ready for projects and invoices.</p>
            </div>
            <Switch checked={form.createClient} onCheckedChange={(v) => setForm({ ...form, createClient: v })} />
          </div>
          {form.createClient && (
            <div className="space-y-3">
              <Field label="Company name" required>
                <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Company name" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Email">
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hello@company.com" />
                </Field>
                <Field label="Phone">
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+20 10 1234 5678" />
                </Field>
              </div>
              <Field label="Primary contact name">
                <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Person we deal with" />
              </Field>
            </div>
          )}
          <Separator />
          <div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium flex items-center gap-2"><FolderKanban className="w-4 h-4 text-primary" /> Create project</p>
                <p className="text-xs text-muted-foreground mt-0.5">Includes the onboarding checklist and PM notification.</p>
              </div>
              <Switch
                checked={form.createProject}
                onCheckedChange={(v) => setForm({ ...form, createProject: v, notifyPm: v ? form.notifyPm : false })}
                disabled={!form.createClient}
              />
            </div>
            {proposal?.clientId && (
              <p className="text-xs text-muted-foreground mt-1.5 px-1">
                This proposal is already linked to a client — create new delivery projects from the Projects module.
              </p>
            )}
          </div>
          {form.createProject && (
            <div className="space-y-3">
              <Field label="Project name" required>
                <Input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Project type">
                  <Select value={form.projectType} onValueChange={(v) => setForm({ ...form, projectType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                {managers.length > 0 && (
                  <Field label="Project manager">
                    <Select value={form.managerId || "NONE"} onValueChange={(v) => setForm({ ...form, managerId: v === "NONE" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent className="max-h-60">
                        <SelectItem value="NONE">Unassigned</SelectItem>
                        {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <p className="text-sm">Notify the project manager</p>
                <Switch checked={form.notifyPm} onCheckedChange={(v) => setForm({ ...form, notifyPm: v })} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={acceptOnly} disabled={saving}>Mark accepted only</Button>
          <Button onClick={convert} disabled={saving || (!form.createClient && !form.createProject)}>
            <UserCheck className="w-4 h-4 mr-2" /> {saving ? "Converting…" : "Accept & Convert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= Detail sheet =================

function DetailBlock({ label, children }: { label: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  );
}

function ProposalDetailSheet({ id, open, onOpenChange, onChanged, onConvert, canEdit, canDelete, onDeleteRequest }: {
  id: string | null; open: boolean; onOpenChange: (o: boolean) => void;
  onChanged: () => void; onConvert: (p: ProposalDetail) => void;
  canEdit: boolean; canDelete: boolean; onDeleteRequest: (row: ProposalListRow) => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDetail(await api.get<ProposalDetail>(`/api/proposals/${id}`));
    } catch (e) {
      toast({ title: "Could not load proposal", description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    if (open && id) loadDetail();
    if (!open) setDetail(null);
  }, [open, id, loadDetail]);

  const act = async (status: string, successTitle: string) => {
    if (!id) return;
    setActing(true);
    try {
      await api.patch(`/api/proposals/${id}`, { status });
      toast({ title: successTitle });
      await loadDetail();
      onChanged();
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setActing(false);
    }
  };

  const currency = detail?.currency ?? "EGP";
  const active = detail ? ACTIVE_STATUSES.includes(detail.status) : false;
  const expired = detail?.validUntil ? new Date(detail.validUntil) < new Date() && active : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        {loading || !detail ? (
          <div className="p-6"><ListSkeleton rows={8} /></div>
        ) : (
          <>
            <SheetHeader className="p-5 pb-3 border-b border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <FileText className="w-4 h-4 text-primary shrink-0" /> {detail.proposalNumber}
                  </SheetTitle>
                  <SheetDescription className="mt-1 line-clamp-2">{detail.title}</SheetDescription>
                </div>
                <StatusBadge status={detail.status} />
              </div>
              <div className="mt-3"><StatusStepper status={detail.status} /></div>
              {canEdit && ACTIVE_STATUSES.includes(detail.status) && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {detail.status === "DRAFT" && (
                    <Button size="sm" onClick={() => act("SENT", "Proposal sent")} disabled={acting}>
                      <Send className="w-3.5 h-3.5 mr-1.5" /> Send proposal
                    </Button>
                  )}
                  {detail.status === "SENT" && (
                    <Button size="sm" variant="outline" onClick={() => act("VIEWED", "Marked as viewed")} disabled={acting}>
                      <Eye className="w-3.5 h-3.5 mr-1.5" /> Mark viewed
                    </Button>
                  )}
                  {detail.status !== "DRAFT" && (
                    <>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600/90 text-white" onClick={() => onConvert(detail)} disabled={acting}>
                        <CheckCheck className="w-3.5 h-3.5 mr-1.5" /> Accept
                      </Button>
                      <Button size="sm" variant="outline" className="text-rose-300 hover:text-rose-200" onClick={() => act("REJECTED", "Proposal rejected")} disabled={acting}>
                        <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject
                      </Button>
                      <Button size="sm" variant="ghost" className="text-amber-300 hover:text-amber-200" onClick={() => act("EXPIRED", "Proposal marked expired")} disabled={acting}>
                        <Clock className="w-3.5 h-3.5 mr-1.5" /> Expire
                      </Button>
                    </>
                  )}
                </div>
              )}
              {detail.status === "ACCEPTED" && detail.clientId && (
                <p className="text-xs text-emerald-300 mt-3 flex items-center gap-1.5">
                  <CheckCheck className="w-3.5 h-3.5" /> Accepted and linked to a client — delivery can start.
                </p>
              )}
              {detail.status === "ACCEPTED" && !detail.clientId && (
                <p className="text-xs text-amber-300 mt-3 flex items-start gap-1.5">
                  <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Accepted without a client record. Use “Accept &amp; Convert” at the accept step, or convert the linked lead from CRM.
                </p>
              )}
            </SheetHeader>

            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-5 mt-3 w-fit">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="activity">Activity ({detail.activities.length})</TabsTrigger>
              </TabsList>
              <div className="flex-1 overflow-y-auto apex-scroll p-5 pt-3 space-y-5">
                <TabsContent value="details" className="mt-0 space-y-5">
                  {/* Meta */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Lead / Client</p>
                      <p className="font-medium">{detail.lead?.companyName ?? detail.client?.companyName ?? "Unlinked"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Valid until</p>
                      <p className={cn("font-medium", expired && "text-rose-400")}>
                        {formatDate(detail.validUntil)}{expired && " · expired"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Sent</p>
                      <p className="font-medium">{formatDate(detail.sentAt)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Responded</p>
                      <p className="font-medium">{formatDate(detail.respondedAt)}</p>
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="rounded-lg border border-border p-4 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Financials</p>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(detail.subtotal, currency)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{formatCurrency(detail.discountAmount, currency)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax ({detail.taxPercent}%)</span><span className="tabular-nums">{formatCurrency(round2((detail.subtotal * detail.taxPercent) / 100), currency)}</span></div>
                    <Separator className="my-2" />
                    <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums text-primary">{formatCurrency(detail.total, currency)}</span></div>
                  </div>

                  {/* Items */}
                  {detail.items.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Line items</p>
                      <div className="rounded-lg border border-border divide-y divide-border">
                        {detail.items.map((it) => (
                          <div key={it.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate">{it.description}</p>
                              <p className="text-[11px] text-muted-foreground">{it.quantity} × {formatCurrency(it.unitPrice, currency)}</p>
                            </div>
                            <span className="font-medium tabular-nums shrink-0">{formatCurrency(it.total, currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  <DetailBlock label="Problem">{detail.problem}</DetailBlock>
                  <DetailBlock label="Solution">{detail.solution}</DetailBlock>
                  <DetailBlock label="Scope">{detail.scope}</DetailBlock>
                  <DetailBlock label="Timeline">{detail.timeline}</DetailBlock>
                  {parseDeliverables(detail.deliverables).length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Deliverables</p>
                      <ul className="text-sm space-y-1">
                        {parseDeliverables(detail.deliverables).map((d, i) => (
                          <li key={i} className="flex items-start gap-2"><ListChecks className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" /> {d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <DetailBlock label="Payment terms">{detail.paymentTerms}</DetailBlock>
                  <DetailBlock label="Revision policy">{detail.revisionPolicy}</DetailBlock>
                  <DetailBlock label="Maintenance terms">{detail.maintenanceTerms}</DetailBlock>
                  <DetailBlock label="Terms">{detail.terms}</DetailBlock>
                  <DetailBlock label="Internal notes">{detail.notes}</DetailBlock>

                  {canDelete && detail.status === "DRAFT" && (
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteRequest(detail)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete draft
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="activity" className="mt-0">
                  {detail.activities.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {detail.activities.map((a) => (
                        <div key={a.id} className="flex gap-3">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border"
                            style={{ backgroundColor: `${a.actorColor}22`, color: a.actorColor, borderColor: `${a.actorColor}55` }}
                          >
                            {a.actorName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm leading-snug">{a.title}</p>
                            {a.description && <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>}
                            <p className="text-[11px] text-muted-foreground mt-0.5">{a.actorName} · {relativeTime(a.createdAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ================= Main view =================

export function ProposalsView({ navigate }: { navigate: (p: string) => void }) {
  const { toast } = useToast();
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const canCreate = perms.includes("proposals.create");
  const canEdit = perms.includes("proposals.edit");
  const canDelete = perms.includes("proposals.delete");

  const [rows, setRows] = useState<ProposalListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Builder
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", leadId: "", clientId: "", problem: "", solution: "", scope: "",
    deliverables: "", timeline: "", validUntil: "", currency: "EGP",
    discountAmount: "0", taxPercent: "0", paymentTerms: "", revisionPolicy: "",
    maintenanceTerms: "", terms: "", notes: "",
  });
  const [items, setItems] = useState<ItemDraft[]>([{ description: "", quantity: "1", unitPrice: "0" }]);
  const [leadOpts, setLeadOpts] = useState<Option[]>([]);
  const [clientOpts, setClientOpts] = useState<Option[]>([]);

  // Detail sheet / convert / delete
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<ProposalDetail | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProposalListRow | null>(null);

  const load = useCallback(async (opts?: { page?: number; status?: string; q?: string }) => {
    const p = opts?.page ?? page;
    const st = opts?.status ?? statusFilter;
    const q = opts?.q ?? query;
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: ProposalListRow[]; total: number }>(
        `/api/proposals${qs({ page: p, pageSize, status: st === "ALL" ? undefined : st, q: q || undefined })}`
      );
      setRows(data.items);
      setTotal(data.total);
      setPage(p);
    } catch (e) {
      setError(true);
      toast({ title: "Could not load proposals", description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, query, pageSize, toast]);

  useEffect(() => { load({ page: 1, status: statusFilter, q: query }); }, [statusFilter, query]);

  useEffect(() => {
    Promise.all([toOptions("/api/leads?pageSize=100", "companyName"), toOptions("/api/clients?pageSize=100", "companyName")])
      .then(([l, c]) => { setLeadOpts(l); setClientOpts(c); });
  }, []);

  const onSearchInput = (v: string) => {
    setSearch(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(v), 300);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      title: "", leadId: "", clientId: "", problem: "", solution: "", scope: "",
      deliverables: "", timeline: "", validUntil: "", currency: "EGP",
      discountAmount: "0", taxPercent: "0", paymentTerms: "", revisionPolicy: "",
      maintenanceTerms: "", terms: "", notes: "",
    });
    setItems([{ description: "", quantity: "1", unitPrice: "0" }]);
    setBuilderOpen(true);
  };

  const openEdit = async (row: ProposalListRow) => {
    try {
      const d = await api.get<ProposalDetail>(`/api/proposals/${row.id}`);
      setEditingId(row.id);
      setForm({
        title: d.title, leadId: d.leadId ?? "", clientId: d.clientId ?? "",
        problem: d.problem ?? "", solution: d.solution ?? "", scope: d.scope ?? "",
        deliverables: parseDeliverables(d.deliverables).join("\n"),
        timeline: d.timeline ?? "",
        validUntil: d.validUntil ? toDateInput(d.validUntil) : "",
        currency: d.currency, discountAmount: String(d.discountAmount), taxPercent: String(d.taxPercent),
        paymentTerms: d.paymentTerms ?? "", revisionPolicy: d.revisionPolicy ?? "",
        maintenanceTerms: d.maintenanceTerms ?? "", terms: d.terms ?? "", notes: d.notes ?? "",
      });
      setItems(
        d.items.length > 0
          ? d.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) }))
          : [{ description: "", quantity: "1", unitPrice: "0" }]
      );
      setBuilderOpen(true);
    } catch (e) {
      toast({ title: "Could not load proposal", description: e instanceof Error ? e.message : undefined });
    }
  };

  const submitBuilder = async () => {
    if (form.title.trim().length < 2) return toast({ title: "Title is required" });
    const cleaned = items.filter((i) => i.description.trim());
    if (cleaned.length === 0) return toast({ title: "Add at least one item with a description" });
    for (const i of cleaned) {
      if (num(i.quantity) <= 0) return toast({ title: `Quantity for "${i.description}" must be greater than 0` });
      if (num(i.unitPrice) < 0) return toast({ title: `Unit price for "${i.description}" cannot be negative` });
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        leadId: form.leadId || null,
        clientId: form.clientId || null,
        problem: form.problem || null,
        solution: form.solution || null,
        scope: form.scope || null,
        timeline: form.timeline || null,
        deliverables: form.deliverables.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        validUntil: form.validUntil || null,
        currency: form.currency,
        discountAmount: num(form.discountAmount),
        taxPercent: num(form.taxPercent),
        paymentTerms: form.paymentTerms || null,
        revisionPolicy: form.revisionPolicy || null,
        maintenanceTerms: form.maintenanceTerms || null,
        terms: form.terms || null,
        notes: form.notes || null,
        items: cleaned.map((i) => ({ description: i.description.trim(), quantity: num(i.quantity), unitPrice: num(i.unitPrice) })),
      };
      if (editingId) {
        await api.patch(`/api/proposals/${editingId}`, payload);
        toast({ title: "Proposal updated" });
      } else {
        await api.post("/api/proposals", payload);
        toast({ title: "Proposal created as draft" });
      }
      setBuilderOpen(false);
      load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/proposals/${deleting.id}`);
      toast({ title: "Draft deleted" });
      setDeleting(null);
      if (detailId === deleting.id) setSheetOpen(false);
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const totals = previewTotals(items, num(form.discountAmount), num(form.taxPercent));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Build priced proposals with line items, terms and a full Draft → Sent → Accepted lifecycle."
        actions={canCreate && <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Proposal</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input placeholder="Search number or title…" value={search} onChange={(e) => onSearchInput(e.target.value)} className="sm:max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="VIEWED">Viewed</SelectItem>
            <SelectItem value="ACCEPTED">Accepted</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="EXPIRED">Expired</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => load()} />
      ) : total === 0 ? (
        <EmptyState
          icon={<FileText className="w-5 h-5" />}
          title={query || statusFilter !== "ALL" ? "No proposals match your filters" : "No proposals yet"}
          description={query || statusFilter !== "ALL" ? "Try adjusting the search or status filter." : "Build your first proposal with priced line items and terms."}
          action={canCreate && !(query || statusFilter !== "ALL") ? <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Proposal</Button> : undefined}
        />
      ) : (
        <div className="apex-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Proposal #</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Lead / Client</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Status</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">Sent</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">Valid until</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const expired = r.validUntil ? new Date(r.validUntil) < new Date() && ACTIVE_STATUSES.includes(r.status) : false;
                return (
                  <tr key={r.id} className="hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{r.proposalNumber}</td>
                    <td className="px-4 py-3">
                      <button className="text-left font-medium hover:text-primary transition-colors" onClick={() => { setDetailId(r.id); setSheetOpen(true); }}>
                        {r.title}
                      </button>
                      <p className="text-[11px] text-muted-foreground mt-0.5 lg:hidden">{r.lead?.companyName ?? r.client?.companyName ?? "Unlinked"}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{r.lead?.companyName ?? r.client?.companyName ?? "Unlinked"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap">{formatCurrency(r.total, r.currency)}</td>
                    <td className="px-4 py-3 hidden md:table-cell"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground whitespace-nowrap">{formatDate(r.sentAt)}</td>
                    <td className={cn("px-4 py-3 hidden xl:table-cell whitespace-nowrap", expired ? "text-rose-400" : "text-muted-foreground")}>
                      {formatDate(r.validUntil)}{expired && " · expired"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="View" onClick={() => { setDetailId(r.id); setSheetOpen(true); }}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {canEdit && !["ACCEPTED", "REJECTED"].includes(r.status) && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(r)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {canDelete && r.status === "DRAFT" && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Delete draft" onClick={() => setDeleting(r)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!canEdit && !canDelete && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end"><DropdownMenuItem disabled>No actions available</DropdownMenuItem></DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm mt-4">
          <p className="text-muted-foreground">Page {page} of {totalPages} · {total} proposals</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => load({ page: page - 1 })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => load({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {/* Builder dialog */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit proposal" : "New proposal"}</DialogTitle>
            <DialogDescription>Totals are always recalculated on the server from the line items below.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto apex-scroll pr-1 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Title" required>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Nile Trading — E-commerce Platform" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Currency">
                  <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EGP">EGP</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="SAR">SAR</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Valid until">
                  <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {leadOpts.length > 0 ? (
                <Field label="Linked lead">
                  <Select value={form.leadId || "NONE"} onValueChange={(v) => setForm({ ...form, leadId: v === "NONE" ? "" : v, clientId: "" })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="NONE">None</SelectItem>
                      {leadOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Linked lead" hint="Lead list unavailable — the proposal will be unlinked">
                  <Input value={form.leadId} disabled placeholder="Unavailable without leads.view" />
                </Field>
              )}
              {clientOpts.length > 0 ? (
                <Field label="Linked client">
                  <Select value={form.clientId || "NONE"} onValueChange={(v) => setForm({ ...form, clientId: v === "NONE" ? "" : v, leadId: "" })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="NONE">None</SelectItem>
                      {clientOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Linked client" hint="Client list unavailable — the proposal will be unlinked">
                  <Input value={form.clientId} disabled placeholder="Unavailable without clients.view" />
                </Field>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Line items</p>
              <ItemsEditor items={items} onChange={setItems} currency={form.currency} />
              <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Discount amount">
                    <Input type="number" min={0} step={0.01} value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} />
                  </Field>
                  <Field label="Tax percent">
                    <Input type="number" min={0} max={100} step={0.01} value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
                  </Field>
                </div>
                <Separator className="my-3" />
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(totals.subtotal, form.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Tax ({num(form.taxPercent)}%)</span><span className="tabular-nums">{formatCurrency(totals.tax, form.currency)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums text-primary">{formatCurrency(totals.total, form.currency)}</span></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Problem"><Textarea rows={2} value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} placeholder="What the client is struggling with" /></Field>
              <Field label="Solution"><Textarea rows={2} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} placeholder="How APEX solves it" /></Field>
            </div>
            <Field label="Scope"><Textarea rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="What is included and what is not" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Deliverables" hint="Comma or newline separated">
                <Textarea rows={2} value={form.deliverables} onChange={(e) => setForm({ ...form, deliverables: e.target.value })} placeholder="5 pages design, CMS setup, 1 month support" />
              </Field>
              <Field label="Timeline"><Textarea rows={2} value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="e.g. 4 weeks from kickoff" /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Payment terms"><Textarea rows={2} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. 50% upfront, 50% on delivery" /></Field>
              <Field label="Revision policy"><Textarea rows={2} value={form.revisionPolicy} onChange={(e) => setForm({ ...form, revisionPolicy: e.target.value })} placeholder="e.g. 2 revision rounds included" /></Field>
              <Field label="Maintenance terms"><Textarea rows={2} value={form.maintenanceTerms} onChange={(e) => setForm({ ...form, maintenanceTerms: e.target.value })} placeholder="e.g. 3 months free bug fixes" /></Field>
              <Field label="Terms"><Textarea rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Validity, ownership, confidentiality…" /></Field>
            </div>
            <Field label="Internal notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes the client will never see" /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button onClick={submitBuilder} disabled={saving}>
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              {editingId ? "Save changes" : "Create proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <ProposalDetailSheet
        id={detailId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => load()}
        canEdit={canEdit}
        canDelete={canDelete}
        onDeleteRequest={(row) => setDeleting(row)}
        onConvert={(p) => { setConvertTarget(p); setConvertOpen(true); }}
      />

      {/* Convert dialog */}
      <ConvertDialog
        proposal={convertTarget}
        open={convertOpen}
        onClose={() => { setConvertOpen(false); setConvertTarget(null); setSheetOpen(false); load(); }}
        onConverted={() => load()}
        navigate={navigate}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.proposalNumber} — ${deleting.title}` : ""} will be permanently removed. Only drafts can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
