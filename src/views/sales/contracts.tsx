"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, Field } from "@/components/shared";
import { api, qs, formatDate, relativeTime } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  FileSignature, Plus, MoreHorizontal, Pencil, Trash2, Eye, Send, PenLine, PlayCircle,
  CheckCheck, XCircle, RefreshCw, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ================= Types & helpers =================

type Party = { id: string; companyName: string } | null | undefined;

type ContractListRow = {
  id: string; contractNumber: string; title: string; status: string;
  startDate?: string | null; endDate?: string | null; signedDate?: string | null; createdAt: string;
  documentUrl?: string | null;
  client?: Party; project?: { id: string; name: string } | null;
  proposal?: { id: string; proposalNumber: string; title: string } | null;
};

type ActivityRow = { id: string; type: string; title: string; description?: string | null; actorName: string; actorColor: string; createdAt: string };

type ContractDetail = ContractListRow & {
  clientId?: string | null; projectId?: string | null; proposalId?: string | null;
  scope?: string | null; deliverables?: string | null; timeline?: string | null;
  paymentTerms?: string | null; revisionTerms?: string | null; maintenanceTerms?: string | null; notes?: string | null;
  client?: Party; project?: { id: string; name: string; projectNumber?: string } | null;
  proposal?: { id: string; proposalNumber: string; title: string } | null;
  activities: ActivityRow[];
};

type Option = { id: string; label: string };

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

function toDateInput(d: string | Date): string {
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

/** Allowed next statuses per current status (mirrors server transitions) */
const NEXT_STATUSES: Record<string, { to: string; label: string }[]> = {
  DRAFT: [
    { to: "SENT", label: "Send contract" },
    { to: "CANCELLED", label: "Cancel" },
  ],
  SENT: [
    { to: "SIGNED", label: "Mark signed" },
    { to: "CANCELLED", label: "Cancel" },
  ],
  SIGNED: [
    { to: "ACTIVE", label: "Activate" },
    { to: "CANCELLED", label: "Cancel" },
  ],
  ACTIVE: [
    { to: "COMPLETED", label: "Mark completed" },
    { to: "CANCELLED", label: "Cancel" },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

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

function ContractDetailSheet({ id, open, onOpenChange, onChanged, canEdit, canDelete, onDeleteRequest }: {
  id: string | null; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void;
  canEdit: boolean; canDelete: boolean; onDeleteRequest: (row: ContractListRow) => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDetail(await api.get<ContractDetail>(`/api/contracts/${id}`));
    } catch (e) {
      toast({ title: "Could not load contract", description: e instanceof Error ? e.message : undefined });
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
      await api.patch(`/api/contracts/${id}`, { status });
      toast({ title: successTitle });
      await loadDetail();
      onChanged();
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setActing(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        {loading || !detail ? (
          <div className="p-6"><ListSkeleton rows={8} /></div>
        ) : (
          <>
            <SheetHeader className="p-5 pb-3 border-b border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <FileSignature className="w-4 h-4 text-primary shrink-0" /> {detail.contractNumber}
                  </SheetTitle>
                  <SheetDescription className="mt-1 line-clamp-2">{detail.title}</SheetDescription>
                </div>
                <StatusBadge status={detail.status} />
              </div>
              {canEdit && (NEXT_STATUSES[detail.status]?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {NEXT_STATUSES[detail.status].map((s) => (
                    <Button
                      key={s.to}
                      size="sm"
                      variant={s.to === "CANCELLED" ? "outline" : "default"}
                      className={cn(s.to === "CANCELLED" && "text-rose-300 hover:text-rose-200", s.to === "SIGNED" && "bg-emerald-600 hover:bg-emerald-600/90 text-white")}
                      onClick={() => act(s.to, s.label)}
                      disabled={acting}
                    >
                      {s.to === "SENT" && <Send className="w-3.5 h-3.5 mr-1.5" />}
                      {s.to === "SIGNED" && <PenLine className="w-3.5 h-3.5 mr-1.5" />}
                      {s.to === "ACTIVE" && <PlayCircle className="w-3.5 h-3.5 mr-1.5" />}
                      {s.to === "COMPLETED" && <CheckCheck className="w-3.5 h-3.5 mr-1.5" />}
                      {s.to === "CANCELLED" && <XCircle className="w-3.5 h-3.5 mr-1.5" />}
                      {s.label}
                    </Button>
                  ))}
                </div>
              )}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto apex-scroll p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Client</p>
                  <p className="font-medium">{detail.client?.companyName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Project</p>
                  <p className="font-medium">{detail.project?.name ?? "Unlinked"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Start</p>
                  <p className="font-medium">{formatDate(detail.startDate)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">End</p>
                  <p className="font-medium">{formatDate(detail.endDate)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Signed</p>
                  <p className="font-medium">{formatDate(detail.signedDate)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Proposal</p>
                  <p className="font-medium">{detail.proposal?.proposalNumber ?? "Unlinked"}</p>
                </div>
              </div>

              {detail.documentUrl && (
                <a href={detail.documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Open contract document
                </a>
              )}

              <DetailBlock label="Scope">{detail.scope}</DetailBlock>
              <DetailBlock label="Deliverables">{detail.deliverables}</DetailBlock>
              <DetailBlock label="Timeline">{detail.timeline}</DetailBlock>
              <DetailBlock label="Payment terms">{detail.paymentTerms}</DetailBlock>
              <DetailBlock label="Revision terms">{detail.revisionTerms}</DetailBlock>
              <DetailBlock label="Maintenance terms">{detail.maintenanceTerms}</DetailBlock>
              <DetailBlock label="Internal notes">{detail.notes}</DetailBlock>

              {canDelete && detail.status === "DRAFT" && (
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDeleteRequest(detail)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete draft
                </Button>
              )}

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">History</p>
                {detail.activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No history recorded yet.</p>
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
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ================= Main view =================

export function ContractsView({ navigate }: { navigate: (p: string) => void }) {
  void navigate;
  const { toast } = useToast();
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const canCreate = perms.includes("contracts.create");
  const canEdit = perms.includes("contracts.edit");
  const canDelete = perms.includes("contracts.delete");

  const [rows, setRows] = useState<ContractListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [clientOpts, setClientOpts] = useState<Option[]>([]);
  const [projectOpts, setProjectOpts] = useState<Option[]>([]);
  const [proposalOpts, setProposalOpts] = useState<Option[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", clientId: "", projectId: "", proposalId: "",
    scope: "", deliverables: "", timeline: "", paymentTerms: "",
    revisionTerms: "", maintenanceTerms: "", startDate: "", endDate: "", notes: "",
  });

  const [detailId, setDetailId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState<ContractListRow | null>(null);

  const load = useCallback(async (opts?: { page?: number; status?: string; q?: string }) => {
    const p = opts?.page ?? page;
    const st = opts?.status ?? statusFilter;
    const q = opts?.q ?? query;
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: ContractListRow[]; total: number }>(
        `/api/contracts${qs({ page: p, pageSize, status: st === "ALL" ? undefined : st, q: q || undefined })}`
      );
      setRows(data.items);
      setTotal(data.total);
      setPage(p);
    } catch (e) {
      setError(true);
      toast({ title: "Could not load contracts", description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, query, pageSize, toast]);

  useEffect(() => { load({ page: 1, status: statusFilter, q: query }); }, [statusFilter, query]);

  useEffect(() => {
    Promise.all([
      toOptions("/api/clients?pageSize=100", "companyName"),
      toOptions("/api/projects?pageSize=100", "name"),
      toOptions("/api/proposals?pageSize=100&status=ACCEPTED", "title"),
    ]).then(([c, p, pr]) => { setClientOpts(c); setProjectOpts(p); setProposalOpts(pr); });
  }, []);

  const onSearchInput = (v: string) => {
    setSearch(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(v), 300);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      title: "", clientId: "", projectId: "", proposalId: "",
      scope: "", deliverables: "", timeline: "", paymentTerms: "",
      revisionTerms: "", maintenanceTerms: "", startDate: "", endDate: "", notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = async (row: ContractListRow) => {
    try {
      const d = await api.get<ContractDetail>(`/api/contracts/${row.id}`);
      setEditingId(row.id);
      setForm({
        title: d.title, clientId: d.clientId ?? "", projectId: d.projectId ?? "", proposalId: d.proposalId ?? "",
        scope: d.scope ?? "", deliverables: d.deliverables ?? "", timeline: d.timeline ?? "",
        paymentTerms: d.paymentTerms ?? "", revisionTerms: d.revisionTerms ?? "", maintenanceTerms: d.maintenanceTerms ?? "",
        startDate: d.startDate ? toDateInput(d.startDate) : "", endDate: d.endDate ? toDateInput(d.endDate) : "",
        notes: d.notes ?? "",
      });
      setDialogOpen(true);
    } catch (e) {
      toast({ title: "Could not load contract", description: e instanceof Error ? e.message : undefined });
    }
  };

  const submit = async () => {
    if (form.title.trim().length < 2) return toast({ title: "Title is required" });
    if (!form.clientId) return toast({ title: "Client is required" });
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        clientId: form.clientId,
        projectId: form.projectId || null,
        proposalId: form.proposalId || null,
        scope: form.scope || null,
        deliverables: form.deliverables || null,
        timeline: form.timeline || null,
        paymentTerms: form.paymentTerms || null,
        revisionTerms: form.revisionTerms || null,
        maintenanceTerms: form.maintenanceTerms || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        notes: form.notes || null,
      };
      if (editingId) {
        await api.patch(`/api/contracts/${editingId}`, payload);
        toast({ title: "Contract updated" });
      } else {
        await api.post("/api/contracts", payload);
        toast({ title: "Contract created as draft" });
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (row: ContractListRow, status: string) => {
    try {
      await api.patch(`/api/contracts/${row.id}`, { status });
      toast({ title: `Contract ${status.toLowerCase()}` });
      load();
    } catch (e) {
      toast({ title: "Status change failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/api/contracts/${deleting.id}`);
      toast({ title: "Draft deleted" });
      setDeleting(null);
      if (detailId === deleting.id) setSheetOpen(false);
      load();
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : undefined });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Contracts"
        description="Signed agreements with scope, terms and a clean Draft → Signed → Active lifecycle."
        actions={canCreate && <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Contract</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input placeholder="Search number or title…" value={search} onChange={(e) => onSearchInput(e.target.value)} className="sm:max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SENT">Sent</SelectItem>
            <SelectItem value="SIGNED">Signed</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => load()} />
      ) : total === 0 ? (
        <EmptyState
          icon={<FileSignature className="w-5 h-5" />}
          title={query || statusFilter !== "ALL" ? "No contracts match your filters" : "No contracts yet"}
          description={query || statusFilter !== "ALL" ? "Try adjusting the search or status filter." : "Draft your first client agreement with scope and terms."}
          action={canCreate && !(query || statusFilter !== "ALL") ? <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> New Contract</Button> : undefined}
        />
      ) : (
        <div className="apex-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Contract #</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium hidden lg:table-cell">Client</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">Project</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Status</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">Start</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">End</th>
                <th className="px-4 py-3 font-medium hidden xl:table-cell">Signed</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{r.contractNumber}</td>
                  <td className="px-4 py-3">
                    <button className="text-left font-medium hover:text-primary transition-colors" onClick={() => { setDetailId(r.id); setSheetOpen(true); }}>
                      {r.title}
                    </button>
                    <p className="text-[11px] text-muted-foreground mt-0.5 lg:hidden">{r.client?.companyName ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground">{r.client?.companyName ?? "—"}</td>
                  <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground">{r.project?.name ?? "—"}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground whitespace-nowrap">{formatDate(r.startDate)}</td>
                  <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground whitespace-nowrap">{formatDate(r.endDate)}</td>
                  <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground whitespace-nowrap">{formatDate(r.signedDate)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="View" onClick={() => { setDetailId(r.id); setSheetOpen(true); }}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {canEdit && (NEXT_STATUSES[r.status]?.length ?? 0) > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Status actions">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {NEXT_STATUSES[r.status].map((s, i) => (
                              <div key={s.to}>
                                {i > 0 && s.to === "CANCELLED" && <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                  className={cn(s.to === "CANCELLED" && "text-destructive focus:text-destructive")}
                                  onClick={() => changeStatus(r, s.to)}
                                >
                                  {s.label}
                                </DropdownMenuItem>
                              </div>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {canEdit && ["DRAFT", "SENT"].includes(r.status) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(r)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {canDelete && r.status === "DRAFT" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Delete draft" onClick={() => setDeleting(r)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm mt-4">
          <p className="text-muted-foreground">Page {page} of {totalPages} · {total} contracts</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => load({ page: page - 1 })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => load({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit contract" : "New contract"}</DialogTitle>
            <DialogDescription>Terms are locked once the contract is signed.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto apex-scroll pr-1 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Title" required>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. E-commerce Platform — Master Agreement" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date">
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </Field>
                <Field label="End date">
                  <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </Field>
              </div>
            </div>
            {clientOpts.length > 0 ? (
              <Field label="Client" required>
                <Select value={form.clientId || "NONE"} onValueChange={(v) => setForm({ ...form, clientId: v === "NONE" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {clientOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                Client list is unavailable (clients.view permission required). Ask an admin to create contracts or grant you access.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {projectOpts.length > 0 && (
                <Field label="Linked project">
                  <Select value={form.projectId || "NONE"} onValueChange={(v) => setForm({ ...form, projectId: v === "NONE" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="NONE">None</SelectItem>
                      {projectOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {proposalOpts.length > 0 && (
                <Field label="Linked proposal" hint="Accepted proposals only">
                  <Select value={form.proposalId || "NONE"} onValueChange={(v) => setForm({ ...form, proposalId: v === "NONE" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="NONE">None</SelectItem>
                      {proposalOpts.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <Field label="Scope"><Textarea rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="What the engagement covers" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Deliverables"><Textarea rows={2} value={form.deliverables} onChange={(e) => setForm({ ...form, deliverables: e.target.value })} placeholder="Tangible outputs" /></Field>
              <Field label="Timeline"><Textarea rows={2} value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="Milestones and duration" /></Field>
              <Field label="Payment terms"><Textarea rows={2} value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="e.g. 40% / 30% / 30%" /></Field>
              <Field label="Revision terms"><Textarea rows={2} value={form.revisionTerms} onChange={(e) => setForm({ ...form, revisionTerms: e.target.value })} placeholder="Included revision rounds" /></Field>
              <Field label="Maintenance terms"><Textarea rows={2} value={form.maintenanceTerms} onChange={(e) => setForm({ ...form, maintenanceTerms: e.target.value })} placeholder="Warranty and support period" /></Field>
              <Field label="Internal notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || clientOpts.length === 0}>
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              {editingId ? "Save changes" : "Create contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <ContractDetailSheet
        id={detailId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => load()}
        canEdit={canEdit}
        canDelete={canDelete}
        onDeleteRequest={(row) => setDeleting(row)}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.contractNumber} — ${deleting.title}` : ""} will be permanently removed. Only drafts can be deleted.
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
