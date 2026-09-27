"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, ListSkeleton } from "@/components/shared";
import { api, qs, relativeTime, initials } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Activity, Search, Users, Building2, FolderKanban, ListChecks, FileSpreadsheet,
  CreditCard, LifeBuoy, Megaphone, BarChart3, FileText, Calculator, FileSignature,
  Handshake, AlarmClock, Wrench, Receipt, Settings, RotateCcw, CalendarDays, ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ActivityItem = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  entityType: string;
  entityId: string;
  actorName: string;
  actorColor: string;
  createdAt: string;
};

const ENTITY_ICONS: Record<string, LucideIcon> = {
  LEAD: Users, CLIENT: Building2, CONTACT: Users, PROJECT: FolderKanban,
  PROJECT_PHASE: ListChecks, TASK: ListChecks, INVOICE: FileSpreadsheet,
  PAYMENT: CreditCard, EXPENSE: Receipt, TICKET: LifeBuoy, TICKET_MESSAGE: LifeBuoy,
  MAINTENANCE_PLAN: Wrench, CONTENT: Megaphone, CAMPAIGN: BarChart3,
  PROPOSAL: FileText, QUOTATION: Calculator, CONTRACT: FileSignature,
  MEETING: Handshake, FOLLOW_UP: AlarmClock, SETTING: Settings,
};

const ENTITY_TYPES = Object.keys(ENTITY_ICONS);

const ICON_TINTS: Record<string, string> = {
  LEAD: "text-sky-300 bg-sky-500/10", CLIENT: "text-emerald-300 bg-emerald-500/10",
  PROJECT: "text-violet-300 bg-violet-500/10", TASK: "text-cyan-300 bg-cyan-500/10",
  INVOICE: "text-cyan-300 bg-cyan-500/10", PAYMENT: "text-emerald-300 bg-emerald-500/10",
  TICKET: "text-rose-300 bg-rose-500/10", CONTENT: "text-fuchsia-300 bg-fuchsia-500/10",
  CAMPAIGN: "text-fuchsia-300 bg-fuchsia-500/10", PROPOSAL: "text-violet-300 bg-violet-500/10",
  QUOTATION: "text-amber-300 bg-amber-500/10", CONTRACT: "text-emerald-300 bg-emerald-500/10",
  MEETING: "text-sky-300 bg-sky-500/10", FOLLOW_UP: "text-amber-300 bg-amber-500/10",
  MAINTENANCE_PLAN: "text-teal-300 bg-teal-500/10", EXPENSE: "text-rose-300 bg-rose-500/10",
  SETTING: "text-slate-300 bg-slate-500/10",
};

function entityIcon(entityType: string): { Icon: LucideIcon; tint: string } {
  return {
    Icon: ENTITY_ICONS[entityType] || Activity,
    tint: ICON_TINTS[entityType] || "text-cyan-300 bg-cyan-500/10",
  };
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yest = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
}

export function ActivityFeedView() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [entityType, setEntityType] = useState("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  const pageSize = 30;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ items: ActivityItem[]; total: number }>(
        `/api/activities${qs({
          q: q || undefined,
          entityType: entityType === "ALL" ? undefined : entityType,
          page: "1",
          pageSize: String(pageSize),
        })}`
      );
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [q, entityType, reloadKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, entityType]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await api.get<{ items: ActivityItem[]; total: number }>(
        `/api/activities${qs({
          q: q || undefined,
          entityType: entityType === "ALL" ? undefined : entityType,
          page: String(next),
          pageSize: String(pageSize),
        })}`
      );
      setItems((prev) => [...prev, ...data.items]);
      setPage(next);
    } catch {
      // keep current list on failure — a toast would be noise for pagination
    } finally {
      setLoadingMore(false);
    }
  };

  const hasFilters = q || entityType !== "ALL";

  // Group items by calendar day
  const groups: { label: string; items: ActivityItem[] }[] = [];
  items.forEach((item) => {
    const label = dayLabel(new Date(item.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  });

  return (
    <div>
      <PageHeader
        title="Activity"
        description="The full chronological story of the workspace — every deal moved, task done, invoice sent and note added (§67)."
      />

      {/* Filters */}
      <div className="apex-panel p-4 mb-5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search activity titles and descriptions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8 h-9"
            aria-label="Search activity"
          />
        </div>
        <div className="flex gap-2">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-9 w-full sm:w-52" aria-label="Filter by entity type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All entity types</SelectItem>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => { setQ(""); setEntityType("ALL"); setReloadKey((k) => k + 1); }}
              aria-label="Reset filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={10} />
      ) : error ? (
        <ErrorState message="Failed to load the activity feed." onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Activity className="w-5 h-5" />}
          title={hasFilters ? "No activity matches your filters" : "No activity yet"}
          description={hasFilters ? "Try a different search or entity type." : "As the team works, every meaningful event will appear here."}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            {total.toLocaleString("en")} events — showing {items.length}
          </p>

          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 mb-2 bg-background/90 backdrop-blur-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary">{g.label}</span>
                </div>
                <div className="relative pl-1">
                  {g.items.map((item, idx) => {
                    const { Icon, tint } = entityIcon(item.entityType);
                    return (
                      <div key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {/* timeline line */}
                        <div className="absolute left-[15px] top-9 bottom-0 w-px bg-border/70" hidden={idx === g.items.length - 1} />
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                          style={{ backgroundColor: item.actorColor || "#0e7490" }}
                          title={item.actorName}
                        >
                          {initials(item.actorName)}
                        </span>
                        <div className="flex-1 min-w-0 rounded-lg border border-border bg-card/50 px-3.5 py-3 hover:border-primary/30 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-snug">{item.title}</p>
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{relativeTime(item.createdAt)}</span>
                          </div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <span className={cn("inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium", tint)}>
                              <Icon className="w-3 h-3" />
                              {item.entityType.replace(/_/g, " ")}
                            </span>
                            <span className="text-[11px] text-muted-foreground">by {item.actorName}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {items.length < total && (
            <div className="flex justify-center mt-5">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="h-9">
                {loadingMore ? "Loading…" : "Load more"}
                <ChevronDown className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
