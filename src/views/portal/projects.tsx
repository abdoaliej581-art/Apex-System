"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  FolderKanban, CalendarClock, User, Users, Loader2, RefreshCw, ChevronRight,
  ListChecks, Layers, X, Paperclip,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, StatusBadge, PriorityBadge, ListSkeleton } from "@/components/shared";
import { FileAttachments } from "@/components/shared/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api, relativeTime } from "@/lib/api-client";
import { qs } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";

type PortalProject = {
  id: string; projectNumber: string; name: string; description: string | null; type: string;
  status: string; priority: string; progress: number; health: string;
  startDate: string | null; deadline: string | null; updatedAt: string;
  manager: { name: string; avatarColor: string } | null;
  _count: { tasks: number };
};

type ProjectsResponse = { items: PortalProject[]; total: number; page: number; pageSize: number };

type ProjectDetail = {
  project: PortalProject & {
    createdAt: string;
    phases: { name: string; status: string; progress: number; taskCount: number }[];
    tasks: { id: string; title: string; status: string; priority: string; dueDate: string | null; assignee: { name: string } | null }[];
  };
  teamSize: number;
};

const STATUS_FILTERS = ["", "PLANNING", "ACTIVE", "ON_HOLD", "REVIEW", "COMPLETED"];
const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function PortalProjectsView(_props: ViewProps) {
  const { data: session } = useSession();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<ProjectsResponse>(`/api/portal/projects${qs({ q: debouncedQ, status, page, pageSize })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your projects.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, status, page]);

  useEffect(() => { load(); }, [load, reloadKey]);

  // Detail loading whenever the sheet target changes
  useEffect(() => {
    if (!detailId) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api.get<ProjectDetail>(`/api/portal/projects/${detailId}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setDetailError(err instanceof Error ? err.message : "Failed to load project."); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detailId]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const hasFilters = debouncedQ !== "" || status !== "";

  return (
    <div>
      <PageHeader
        title="My Projects"
        description="Live progress on everything we are building for you."
        actions={<Button variant="ghost" size="icon" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh projects"><RefreshCw className="w-4 h-4" /></Button>}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your projects…" className="sm:max-w-xs bg-secondary/40" aria-label="Search projects" />
        <div className="flex gap-1.5 overflow-x-auto apex-scroll pb-1" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button key={s || "all"} onClick={() => { setStatus(s); setPage(1); }}
              className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                status === s ? "bg-primary/15 text-primary border-primary/40" : "text-muted-foreground border-border hover:border-primary/30 hover:text-foreground")}>
              {s ? s.replace(/_/g, " ") : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={<FolderKanban className="w-5 h-5" />}
          title={hasFilters ? "No projects match your filters" : "No projects yet"}
          description={hasFilters ? "Try adjusting the search or status filter." : "Once we kick off your first project it will appear here with live progress."} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.items.map((p) => (
              <button key={p.id} onClick={() => setDetailId(p.id)}
                className="apex-panel p-4 text-left hover:border-primary/40 transition-colors group"
                aria-label={`Open project ${p.name}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{p.projectNumber}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-3.5 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className={cn("h-full rounded-full",
                      p.health === "DELAYED" ? "bg-rose-400" : p.health === "AT_RISK" ? "bg-amber-400" : "bg-cyan-400")}
                      style={{ width: `${Math.min(100, Math.max(0, p.progress))}%` }} />
                  </div>
                  <span className="text-xs font-semibold tabular-nums">{p.progress}%</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
                  {p.manager && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[8px] font-bold"
                        style={{ backgroundColor: `${p.manager.avatarColor}22`, color: p.manager.avatarColor }}>
                        {p.manager.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <User className="w-3 h-3" /> {p.manager.name}
                    </span>
                  )}
                  <span className="flex items-center gap-1"><ListChecks className="w-3 h-3" /> {p._count.tasks} tasks</span>
                  {p.deadline && <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Due {dateShort(p.deadline)}</span>}
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* Detail sheet */}
      <Sheet open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-border">
            {detailLoading || !detail ? (
              <>
                <SheetTitle className="flex items-center gap-2">
                  {detailLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                  {detailLoading ? "Loading project…" : "Project"}
                </SheetTitle>
                <SheetDescription className="sr-only">Project details</SheetDescription>
              </>
            ) : detailError ? (
              <>
                <SheetTitle>Project unavailable</SheetTitle>
                <SheetDescription>{detailError}</SheetDescription>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <SheetTitle className="truncate">{detail.project.name}</SheetTitle>
                    <SheetDescription className="font-mono text-xs mt-0.5">
                      {detail.project.projectNumber} · Updated {relativeTime(detail.project.updatedAt)}
                    </SheetDescription>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setDetailId(null)} aria-label="Close details">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </>
            )}
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            {detailLoading && (
              <div className="p-5 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-secondary/30 animate-pulse" />)}
              </div>
            )}
            {detailError && !detailLoading && (
              <div className="p-5"><ErrorState message={detailError} onRetry={() => setDetailId((id) => id)} /></div>
            )}
            {detail && !detailLoading && (
              <div className="px-5 py-4 space-y-5">
                {/* Summary */}
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.project.status} />
                  <PriorityBadge priority={detail.project.priority} />
                  <span className={cn("text-[11px] px-2 py-0.5 rounded-md border",
                    detail.project.health === "ON_TRACK" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                    detail.project.health === "AT_RISK" ? "bg-amber-500/10 text-amber-300 border-amber-500/30" :
                    "bg-rose-500/10 text-rose-300 border-rose-500/30")}>
                    {detail.project.health.replace(/_/g, " ")}
                  </span>
                </div>
                {detail.project.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.project.description}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Progress</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${detail.project.progress}%` }} />
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{detail.project.progress}%</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Team</p>
                    <p className="text-sm font-semibold mt-1 flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-primary" /> {detail.teamSize} people</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Started</p>
                    <p className="text-sm font-semibold mt-1">{dateShort(detail.project.startDate)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Deadline</p>
                    <p className="text-sm font-semibold mt-1">{dateShort(detail.project.deadline)}</p>
                  </div>
                </div>

                {/* Phases */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Layers className="w-4 h-4 text-primary" /> Phases</h3>
                  {detail.project.phases.length === 0 ? (
                    <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">No phases defined yet.</p>
                  ) : (
                    <ol className="space-y-2">
                      {detail.project.phases.map((ph) => (
                        <li key={ph.name} className="rounded-lg border border-border bg-card/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{ph.name}</p>
                            <StatusBadge status={ph.status} />
                          </div>
                          <div className="mt-2 flex items-center gap-2.5">
                            <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                              <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${ph.progress}%` }} />
                            </div>
                            <span className="text-[11px] tabular-nums text-muted-foreground">{ph.taskCount} task{ph.taskCount === 1 ? "" : "s"}</span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <Separator />

                {/* Tasks */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><ListChecks className="w-4 h-4 text-primary" /> Tasks ({detail.project.tasks.length})</h3>
                  {detail.project.tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-4 text-center">No tasks on this project yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.project.tasks.map((t) => (
                        <li key={t.id} className="rounded-lg border border-border bg-card/40 px-3 py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm truncate">{t.title}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {t.assignee ? `Assigned to ${t.assignee.name}` : "Unassigned"}
                              {t.dueDate ? ` · due ${dateShort(t.dueDate)}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <PriorityBadge priority={t.priority} />
                            <StatusBadge status={t.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Files (§72) — deliverables from APEX + client's own briefs */}
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Paperclip className="w-4 h-4 text-primary" /> Files</h3>
                  <FileAttachments
                    entityType="PROJECT"
                    entityId={detail.project.id}
                    apiBase="/api/portal/files"
                    canUploadOverride
                    canDeleteOverride={(f) => f.uploader?.id === session?.user?.id}
                    uploadHint="Attach a brief, asset or reference for this project"
                  />
                </div>

                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1">
                  <ChevronRight className="w-3 h-3" /> Questions about this project? Open a ticket from the Support tab.
                </p>
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
