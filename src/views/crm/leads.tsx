"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Plus, Search, X, ChevronLeft, ChevronRight, MoreHorizontal, Pencil,
  ArrowRightLeft, Trash2, Users, ExternalLink, UserX, Upload,
  FileUp, AlertTriangle, CheckCircle2, Download, Info,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, PriorityBadge, Field } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { api, qs, formatCurrency, formatDate, relativeTime } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";
import {
  LeadDetailDrawer, LeadFormDialog, ConvertLeadDialog, LostReasonDialog,
  LEAD_STATUSES, LEAD_SOURCES, PRIORITIES, UserAvatar,
  humanLabel, isOverdueDate,
  type Lead, type TeamMember,
} from "@/views/crm/lead-detail";

type LeadsResponse = { items: Lead[]; total: number; page: number; pageSize: number };

type Filters = {
  q: string;
  status: string;
  source: string;
  priority: string;
  assignedToId: string;
};

const EMPTY_FILTERS: Filters = { q: "", status: "", source: "", priority: "", assignedToId: "" };
const PAGE_SIZE = 25;

export function LeadsView({ navigate, entityId }: ViewProps) {
  const { data: session } = useSession();
  const permissions = session?.user?.permissions ?? [];
  const { toast } = useToast();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamAccess, setTeamAccess] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [deleteLead, setDeleteLead] = useState<Lead | null>(null);
  const [lostTarget, setLostTarget] = useState<Lead | null>(null);
  const [moving, setMoving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Auto-open entity detail when navigated here from global search
  useEffect(() => {
    if (entityId) {
      setDetailId(entityId);
      setDetailOpen(true);
    }
  }, [entityId]);

  // Debounce the search query (300 ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQ(filters.q.trim());
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters.q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<LeadsResponse>(
        `/api/leads${qs({ q: debouncedQ, status: filters.status, source: filters.source, priority: filters.priority, assignedToId: filters.assignedToId, page, pageSize: PAGE_SIZE })}`
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, filters.status, filters.source, filters.priority, filters.assignedToId, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ team: TeamMember[] }>("/api/team")
      .then((d) => { if (!cancelled) { setTeam(d.team); setTeamAccess(true); } })
      .catch(() => { if (!cancelled) setTeamAccess(false); });
    return () => { cancelled = true; };
  }, []);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== ""),
    [filters]
  );

  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };

  const openDetail = (lead: Lead) => { setDetailId(lead.id); setDetailOpen(true); };

  const moveLead = (lead: Lead, status: string) => {
    if (status === lead.status) return;
    if (status === "LOST") { setLostTarget(lead); return; }
    setMoving(true);
    api.patch<Lead>(`/api/leads/${lead.id}`, { status })
      .then(() => {
        toast({ title: "Lead moved", description: `${lead.companyName} → ${humanLabel(status)}` });
        load();
      })
      .catch((err) => toast({ title: "Move failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" }))
      .finally(() => setMoving(false));
  };

  const confirmDelete = () => {
    if (!deleteLead) return;
    const target = deleteLead;
    api.delete(`/api/leads/${target.id}`)
      .then(() => {
        toast({ title: "Lead deleted", description: `${target.companyName} was removed.` });
        setDeleteLead(null);
        load();
      })
      .catch((err) => {
        toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" });
        setDeleteLead(null);
      });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const assigneeName = (id: string | null) => team.find((t) => t.id === id)?.name ?? null;

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Create, qualify and assign sales opportunities with full activity history."
        actions={
          permissions.includes("leads.create") ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="w-4 h-4 mr-2" /> Import CSV
              </Button>
              <Button onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Lead</Button>
            </div>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-2.5 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Search company, contact, phone, email…"
            className="pl-9 h-9 bg-secondary/50"
            aria-label="Search leads"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select value={filters.status || "ALL"} onValueChange={(v) => { setFilters((f) => ({ ...f, status: v === "ALL" ? "" : v })); setPage(1); }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{humanLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.source || "ALL"} onValueChange={(v) => { setFilters((f) => ({ ...f, source: v === "ALL" ? "" : v })); setPage(1); }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All sources</SelectItem>
              {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{humanLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.priority || "ALL"} onValueChange={(v) => { setFilters((f) => ({ ...f, priority: v === "ALL" ? "" : v })); setPage(1); }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All priorities</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          {teamAccess ? (
            <Select value={filters.assignedToId || "ALL"} onValueChange={(v) => { setFilters((f) => ({ ...f, assignedToId: v === "ALL" ? "" : v })); setPage(1); }}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All assignees</SelectItem>
                <SelectItem value="UNASSIGNED"><span className="inline-flex items-center gap-1.5"><UserX className="w-3.5 h-3.5" /> Unassigned</span></SelectItem>
                {team.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <div className="hidden sm:block" />
          )}
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={clearFilters}>
            <X className="w-4 h-4 mr-1.5" /> Clear
          </Button>
        )}
      </div>

      {/* Body states */}
      {loading && <ListSkeleton rows={8} />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          icon={<Users className="w-5 h-5" />}
          title={hasActiveFilters ? "No leads match your filters" : "No leads yet"}
          description={hasActiveFilters ? "Try adjusting or clearing the filters to see more results." : "Create your first lead to start filling the pipeline."}
          action={
            hasActiveFilters
              ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
              : permissions.includes("leads.create")
                ? <Button onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Lead</Button>
                : undefined
          }
        />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <div className="apex-panel overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="hidden md:table-cell w-[130px]">Lead #</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="hidden sm:table-cell">Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Priority</TableHead>
                  <TableHead className="hidden xl:table-cell">Source</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Budget</TableHead>
                  <TableHead className="hidden md:table-cell">Assigned</TableHead>
                  <TableHead className="hidden sm:table-cell">Next follow-up</TableHead>
                  <TableHead className="hidden xl:table-cell">Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((lead) => {
                  const followUpOverdue = isOverdueDate(lead.nextFollowUpAt) && !["WON", "LOST"].includes(lead.status);
                  const canConvert = ["WON", "NEGOTIATION"].includes(lead.status) && !lead.convertedClientId && permissions.includes("clients.create");
                  return (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(lead)}
                      aria-label={`Open lead ${lead.companyName}`}
                    >
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground font-mono" dir="ltr">{lead.leadNumber}</TableCell>
                      <TableCell>
                        <div className="font-medium truncate max-w-[220px]">{lead.companyName}</div>
                        <div className="text-[11px] text-muted-foreground md:hidden">{lead.leadNumber}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="text-sm truncate max-w-[140px]">{lead.contactName}</div>
                        <div className="text-[11px] text-muted-foreground" dir="ltr">{lead.phone}</div>
                      </TableCell>
                      <TableCell><StatusBadge status={lead.status} /></TableCell>
                      <TableCell className="hidden lg:table-cell"><PriorityBadge priority={lead.priority} /></TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">{humanLabel(lead.source)}</TableCell>
                      <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums">
                        {lead.estimatedBudget != null ? formatCurrency(lead.estimatedBudget) : "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {lead.assignedTo ? (
                          <span className="inline-flex items-center gap-2" title={lead.assignedTo.name}>
                            <UserAvatar name={lead.assignedTo.name} color={lead.assignedTo.avatarColor} size={24} />
                            <span className="text-xs truncate max-w-[90px]">{lead.assignedTo.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {lead.nextFollowUpAt ? (
                          <span className={cn("text-xs", followUpOverdue && "text-rose-300 font-medium")}>
                            {formatDate(lead.nextFollowUpAt)}{followUpOverdue ? " · overdue" : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">{relativeTime(lead.createdAt)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${lead.companyName}`}>
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {permissions.includes("leads.edit") && (
                              <DropdownMenuItem onClick={() => setEditLead(lead)}>
                                <Pencil className="w-4 h-4 mr-2" /> Edit
                              </DropdownMenuItem>
                            )}
                            {permissions.includes("leads.edit") && (
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger disabled={moving}>
                                  <ArrowRightLeft className="w-4 h-4 mr-2" /> Move to…
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {LEAD_STATUSES.filter((s) => s !== lead.status).map((s) => (
                                    <DropdownMenuItem key={s} onClick={() => moveLead(lead, s)}>
                                      {humanLabel(s)}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )}
                            {canConvert && (
                              <DropdownMenuItem onClick={() => setConvertLead(lead)}>
                                <ExternalLink className="w-4 h-4 mr-2" /> Convert to client
                              </DropdownMenuItem>
                            )}
                            {permissions.includes("leads.delete") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-rose-300 focus:text-rose-300" onClick={() => setDeleteLead(lead)}>
                                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Page {data.page} of {totalPages} · {data.total} lead{data.total === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <LeadDetailDrawer
        leadId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onChanged={load}
        navigate={navigate}
        permissions={permissions}
      />

      {/* New lead */}
      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={load} />

      {/* Edit lead */}
      {editLead && (
        <LeadFormDialog open onOpenChange={(o) => !o && setEditLead(null)} lead={editLead} onSaved={load} />
      )}

      {/* Convert */}
      {convertLead && (
        <ConvertLeadDialog
          open
          onOpenChange={(o) => !o && setConvertLead(null)}
          lead={convertLead}
          onConverted={() => { setConvertLead(null); load(); navigate("crm/clients"); }}
        />
      )}

      {/* Lost reason */}
      {lostTarget && (
        <LostReasonDialog
          open
          onOpenChange={(o) => !o && setLostTarget(null)}
          companyName={lostTarget.companyName}
          onConfirm={(reason) => {
            const target = lostTarget;
            setLostTarget(null);
            api.patch(`/api/leads/${target.id}`, { status: "LOST", lostReason: reason })
              .then(() => { toast({ title: "Lead moved", description: `${target.companyName} → Lost` }); load(); })
              .catch((err) => toast({ title: "Move failed", description: err instanceof Error ? err.message : "Something went wrong.", variant: "destructive" }));
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteLead !== null} onOpenChange={(o) => !o && setDeleteLead(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLead?.companyName} ({deleteLead?.leadNumber}) will be removed from the pipeline. This action is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
              Delete lead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV Import */}
      {importOpen && (
        <ImportLeadsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={() => { setImportOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ===================================================================
// ImportLeadsDialog — CSV → preview table → bulk import
// ===================================================================

const CSV_COLUMNS = [
  { key: "companyName", label: "Company Name", required: true },
  { key: "contactName", label: "Contact Name", required: true },
  { key: "phone", label: "Phone", required: true },
  { key: "email", label: "Email", required: false },
  { key: "industry", label: "Industry", required: false },
  { key: "location", label: "Location", required: false },
  { key: "source", label: "Source", required: false },
  { key: "serviceInterest", label: "Service Interest", required: false },
  { key: "estimatedBudget", label: "Budget", required: false },
  { key: "priority", label: "Priority", required: false },
  { key: "notes", label: "Notes", required: false },
] as const;

type CsvRow = Record<string, string>;
type ParsedRow = {
  companyName: string; contactName: string; phone: string;
  email?: string; industry?: string; location?: string;
  source?: string; serviceInterest?: string; estimatedBudget?: string;
  priority?: string; notes?: string;
  _rowIndex: number;
  _errors: string[];
};

function parseCSV(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase().replace(/\s+/g, ""));
  return lines.slice(1).map((line) => {
    // Basic CSV parsing — handles quoted fields containing commas
    const cols: string[] = [];
    let cur = "", inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { cols.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cols.push(cur);
    const row: CsvRow = {};
    header.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
    return row;
  });
}

// Map common header variants to our field names
const HEADER_ALIASES: Record<string, string> = {
  company: "companyName", "company name": "companyName", companyname: "companyName",
  contact: "contactName", "contact name": "contactName", contactname: "contactName",
  name: "contactName",
  phone: "phone", mobile: "phone", tel: "phone", telephone: "phone",
  email: "email",
  industry: "industry",
  location: "location", city: "location", country: "location",
  source: "source",
  service: "serviceInterest", "service interest": "serviceInterest", serviceinterest: "serviceInterest",
  budget: "estimatedBudget", "estimated budget": "estimatedBudget", estimatedbudget: "estimatedBudget",
  priority: "priority",
  notes: "notes", note: "notes", comments: "notes",
};

function mapRow(raw: CsvRow): ParsedRow {
  const mapped: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const canonical = HEADER_ALIASES[k] ?? k;
    mapped[canonical] = v;
  }
  const errors: string[] = [];
  if (!mapped.companyName?.trim()) errors.push("Company name is required");
  else if (mapped.companyName.trim().length < 2) errors.push("Company name must be ≥ 2 chars");
  if (!mapped.contactName?.trim()) errors.push("Contact name is required");
  else if (mapped.contactName.trim().length < 2) errors.push("Contact name must be ≥ 2 chars");
  if (!mapped.phone?.trim()) errors.push("Phone is required");
  else if (mapped.phone.trim().length < 7) errors.push("Phone must be ≥ 7 chars");

  return {
    companyName: mapped.companyName ?? "",
    contactName: mapped.contactName ?? "",
    phone: mapped.phone ?? "",
    email: mapped.email || undefined,
    industry: mapped.industry || undefined,
    location: mapped.location || undefined,
    source: mapped.source || undefined,
    serviceInterest: mapped.serviceInterest || undefined,
    estimatedBudget: mapped.estimatedBudget || undefined,
    priority: mapped.priority || undefined,
    notes: mapped.notes || undefined,
    _rowIndex: 0,
    _errors: errors,
  };
}

const TEMPLATE_CSV = `Company Name,Contact Name,Phone,Email,Industry,Location,Source,Service Interest,Budget,Priority,Notes
Nile Digital Co.,Ahmed Hassan,+20 100 123 4567,ahmed@nile.eg,Technology,Cairo,INSTAGRAM,Website Redesign,50000,HIGH,Met at DevCon
Cairo Retail Group,Sara Mohamed,+20 111 987 6543,sara@cairoretail.com,Retail,Cairo,REFERRAL,E-commerce Platform,80000,MEDIUM,
`;

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "apex-leads-import-template.csv"; a.click();
  URL.revokeObjectURL(url);
}

function ImportLeadsDialog({ open, onOpenChange, onImported }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [result, setResult] = useState<{ created: number; failed: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    setFileError(null);
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setFileError("Please upload a .csv file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFileError("File is too large. Maximum 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rawRows = parseCSV(text);
      if (rawRows.length === 0) { setFileError("No data rows found in the file. Check the CSV has a header row."); return; }
      if (rawRows.length > 200) { setFileError("Maximum 200 rows per import. Please split the file."); return; }
      const parsed = rawRows.map((r, i) => ({ ...mapRow(r), _rowIndex: i + 1 }));
      setRows(parsed);
      setStep("preview");
    };
    reader.onerror = () => setFileError("Failed to read the file.");
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const doImport = async () => {
    const validRows = rows.filter((r) => r._errors.length === 0);
    if (validRows.length === 0) return;
    setImporting(true);
    setImportProgress(0);
    try {
      // Simulate progress (actual call is a single POST)
      const progressTimer = setInterval(() => setImportProgress((p) => Math.min(p + 15, 85)), 120);
      const res = await api.post<{ created: number; failed: number; total: number }>(
        "/api/leads/import",
        { rows: validRows.map(({ _rowIndex: _r, _errors: _e, ...rest }) => rest) }
      );
      clearInterval(progressTimer);
      setImportProgress(100);
      setResult(res);
      setStep("result");
      toast({ title: `${res.created} lead${res.created === 1 ? "" : "s"} imported successfully` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Import failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setStep("upload"); setRows([]); setFileError(null); setResult(null); setImportProgress(0); };

  const validCount = rows.filter((r) => r._errors.length === 0).length;
  const errorCount = rows.filter((r) => r._errors.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            Import leads from CSV
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1 — Upload */}
        {step === "upload" && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex gap-2.5">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Upload a CSV file with your leads. Required columns: <strong className="text-foreground">Company Name, Contact Name, Phone</strong>.</p>
                <p>Optional: Email, Industry, Location, Source, Service Interest, Budget, Priority, Notes.</p>
              </div>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-secondary/40"
              )}
            >
              <FileUp className={cn("w-8 h-8 mx-auto mb-3", dragging ? "text-primary" : "text-muted-foreground")} />
              <p className="font-medium">Drop your CSV file here</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse — max 200 rows, 2 MB</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }}
              />
            </div>

            {fileError && (
              <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{fileError}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" className="text-xs gap-1.5" onClick={downloadTemplate}>
                <Download className="w-3.5 h-3.5" /> Download template
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* STEP 2 — Preview */}
        {step === "preview" && (
          <div className="flex flex-col min-h-0 gap-4">
            {/* Summary bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">{rows.length} row{rows.length === 1 ? "" : "s"} found</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-medium">
                {validCount} valid
              </span>
              {errorCount > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 font-medium">
                  {errorCount} with errors (will be skipped)
                </span>
              )}
            </div>

            <ScrollArea className="flex-1 max-h-[340px] rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 sticky top-0">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Company</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Contact</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Phone</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Source</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Priority</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._rowIndex} className={cn("border-b border-border/60", row._errors.length > 0 && "bg-rose-500/5")}>
                      <td className="px-3 py-2 text-muted-foreground">{row._rowIndex}</td>
                      <td className="px-3 py-2 font-medium max-w-[140px] truncate">{row.companyName || <span className="text-rose-300 italic">missing</span>}</td>
                      <td className="px-3 py-2 hidden sm:table-cell max-w-[120px] truncate">{row.contactName || <span className="text-rose-300 italic">missing</span>}</td>
                      <td className="px-3 py-2 hidden sm:table-cell">{row.phone || <span className="text-rose-300 italic">missing</span>}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">{row.source || "—"}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">{row.priority || "MEDIUM"}</td>
                      <td className="px-3 py-2">
                        {row._errors.length === 0 ? (
                          <span className="text-emerald-300 text-[10px] font-medium">✓ valid</span>
                        ) : (
                          <span className="text-rose-300 text-[10px]" title={row._errors.join(", ")}>⚠ {row._errors[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={reset}>Choose another file</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button
                  disabled={validCount === 0 || importing}
                  onClick={doImport}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-[140px]"
                >
                  {importing ? (
                    <>
                      <span className="w-4 h-4 mr-2 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
                      Importing…
                    </>
                  ) : (
                    `Import ${validCount} lead${validCount === 1 ? "" : "s"}`
                  )}
                </Button>
              </div>
            </div>
            {importing && <Progress value={importProgress} className="h-1.5" />}
          </div>
        )}

        {/* STEP 3 — Result */}
        {step === "result" && result && (
          <div className="py-4 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            <div>
              <p className="text-lg font-semibold">Import complete</p>
              <p className="text-sm text-muted-foreground mt-1">
                {result.created} lead{result.created === 1 ? "" : "s"} created
                {result.failed > 0 && `, ${result.failed} skipped due to errors`}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
              <div className="rounded-lg bg-secondary/50 border border-border p-3 text-center">
                <p className="text-xl font-bold">{result.total}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Total rows</p>
              </div>
              <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/25 p-3 text-center">
                <p className="text-xl font-bold text-emerald-300">{result.created}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Created</p>
              </div>
              <div className="rounded-lg bg-rose-500/8 border border-rose-500/25 p-3 text-center">
                <p className={cn("text-xl font-bold", result.failed > 0 ? "text-rose-300" : "text-muted-foreground/50")}>{result.failed}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Skipped</p>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={() => { reset(); onOpenChange(false); onImported(); }}>
                View leads
              </Button>
              <Button variant="ghost" onClick={reset}>Import another file</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
