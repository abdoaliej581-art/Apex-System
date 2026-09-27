"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton } from "@/components/shared";
import { api, qs, formatDateTime, relativeTime, initials } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShieldCheck, RotateCcw, ChevronDown, ChevronRight, Clock, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

type AuditRow = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

type AuditSummary = {
  today: number;
  actions: string[];
  entityTypes: string[];
  topActors: { actorName: string | null; count: number }[];
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  UPDATE: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  STATUS_CHANGE: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  DELETE: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  ARCHIVE: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  LOGIN: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  SEND: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  FINANCE_ACTION: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  MARKETING_ACTION: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30",
  REPLY: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  INTERNAL_NOTE: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  CONVERT: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

const actionBadge = (a: string) => ACTION_COLORS[a] || "bg-secondary text-secondary-foreground border-border";

const ACTOR_DOT_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#06b6d4"];

function actorColor(name: string | null): string {
  if (!name) return "#475569";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACTOR_DOT_COLORS[h % ACTOR_DOT_COLORS.length];
}

export function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("ALL");
  const [entityType, setEntityType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: AuditRow[]; total: number; summary: AuditSummary }>(
        `/api/audit${qs({
          q: q || undefined,
          action: action === "ALL" ? undefined : action,
          entityType: entityType === "ALL" ? undefined : entityType,
          from: from || undefined,
          to: to || undefined,
          page,
          pageSize,
        })}`
      );
      setRows(data.items);
      setTotal(data.total);
      setSummary(data.summary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, action, entityType, from, to, page, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, action, entityType, from, to]);

  const resetFilters = () => {
    setQ(""); setAction("ALL"); setEntityType("ALL"); setFrom(""); setTo("");
  };

  const hasFilters = q || action !== "ALL" || entityType !== "ALL" || from || to;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Who did what, when and from where — complete traceability of every sensitive action (§66)."
      />

      {/* Summary strip */}
      {summary && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary/40">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <span className="font-semibold tabular-nums">{total.toLocaleString("en")}</span> events match
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary/40">
            <Clock className="w-3.5 h-3.5 text-cyan-300" />
            <span className="font-semibold tabular-nums">{summary.today}</span> today
          </span>
          {summary.topActors.slice(0, 3).map((t) => (
            <span key={t.actorName || "system"} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-secondary/40">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: actorColor(t.actorName) }} />
              {t.actorName || "System"}: <span className="font-semibold tabular-nums">{t.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="apex-panel p-4 mb-5">
        <div className="flex items-center gap-2 mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <Filter className="w-3.5 h-3.5" /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search actor name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9"
              aria-label="Search actor name"
            />
          </div>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-9" aria-label="Filter by action"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All actions</SelectItem>
              {(summary?.actions || []).map((a) => (
                <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-9" aria-label="Filter by entity type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All entities</SelectItem>
              {(summary?.entityTypes || []).map((e) => (
                <SelectItem key={e} value={e}>{e.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" aria-label="From date" />
          <div className="flex gap-2">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 flex-1" aria-label="To date" />
            {hasFilters && (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={resetFilters} aria-label="Reset filters">
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={8} />
      ) : error ? (
        <ErrorState message="Failed to load the audit log." onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="w-5 h-5" />}
          title={hasFilters ? "No events match your filters" : "No audit events yet"}
          description={hasFilters ? "Try widening the date range or clearing filters." : "Sensitive actions will appear here automatically as the team works."}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                  <TableHead className="w-9"></TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-secondary/30"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      <TableCell className="w-9 pr-0">
                        {r.metadata ? (
                          expanded === r.id ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm">{formatDateTime(r.createdAt)}</div>
                        <div className="text-[11px] text-muted-foreground">{relativeTime(r.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                            style={{ backgroundColor: actorColor(r.actorName) }}
                          >
                            {initials(r.actorName)}
                          </span>
                          <span className="text-sm font-medium">{r.actorName || "System"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap", actionBadge(r.action))}>
                          {r.action.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{r.entityType.replace(/_/g, " ")}</div>
                        {r.entityId && <div className="text-[11px] text-muted-foreground font-mono truncate max-w-40">{r.entityId}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{r.ip || "—"}</TableCell>
                    </TableRow>
                    {expanded === r.id && r.metadata && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-secondary/20 px-4 py-3">
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Metadata</p>
                          <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-foreground/90">
                            {JSON.stringify(r.metadata, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2.5">
            {rows.map((r) => (
              <button
                key={r.id}
                className="w-full text-left apex-panel p-4"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium", actionBadge(r.action))}>
                    {r.action.replace(/_/g, " ")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{relativeTime(r.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                    style={{ backgroundColor: actorColor(r.actorName) }}
                  >
                    {initials(r.actorName)}
                  </span>
                  <span className="text-sm font-medium">{r.actorName || "System"}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.entityType.replace(/_/g, " ")} · {r.ip || "—"}
                </p>
                {expanded === r.id && r.metadata && (
                  <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-all bg-secondary/40 rounded-md p-2 max-h-40 overflow-y-auto">
                    {JSON.stringify(r.metadata, null, 2)}
                  </pre>
                )}
              </button>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en")}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="tabular-nums px-1">Page {page} / {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
