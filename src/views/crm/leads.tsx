"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Plus, Search, X, ChevronLeft, ChevronRight, MoreHorizontal, Pencil,
  ArrowRightLeft, Trash2, Users, ExternalLink, UserX,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge, PriorityBadge } from "@/components/shared";
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

export function LeadsView({ navigate }: ViewProps) {
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
            <Button onClick={() => setFormOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Lead</Button>
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
    </div>
  );
}
