"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, ErrorState, StatCard } from "@/components/shared";
import { api, formatCurrency, initials } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, Users, Target, Percent, FileSpreadsheet, Banknote, AlertCircle,
  Receipt, FolderKanban, LifeBuoy, Megaphone, RefreshCcw, Lock, Activity,
  BarChart3, Trophy, Clock, Flame, UserCheck, Globe, Wallet, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Dist = { status?: string; health?: string; platform?: string; count: number };

type ReportData = {
  range: string;
  since: string;
  generatedAt: string;
  sections: Record<string, boolean>;
  kpis: Record<string, number | null>;
  sales: { funnel: { status: string; count: number; value: number }[]; openValue: number };
  finance: {
    revenueByMonth: { month: string; invoiced: number; collected: number }[];
    invoiceStatus: Dist[];
    expensesByCategory: { category: string; amount: number; count: number }[];
  };
  delivery: { projectsByStatus: Dist[]; projectsByHealth: Dist[]; tasksByStatus: Dist[] };
  team: { leaderboard: { id: string; name: string; title: string | null; avatarColor: string | null; done: number; open: number; overdue: number }[] };
  support: { ticketsByStatus: Dist[]; avgResolutionHours: number | null; urgentOpen: number; unassignedOpen: number };
  marketing: { contentByStatus: Dist[]; contentByPlatform: Dist[]; campaignsByStatus: { status: string; count: number; budget: number }[] };
  activity: { total: number; thisWeek: number };
};

const RANGE_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "all", label: "All time" },
];

// Solid bar colors per status (never color-only — always paired with the label text, §58)
const BAR_COLORS: Record<string, string> = {
  NEW: "bg-sky-500", CONTACTED: "bg-indigo-500", QUALIFIED: "bg-cyan-500",
  MEETING: "bg-blue-500", PROPOSAL_SENT: "bg-violet-500", NEGOTIATION: "bg-amber-500",
  WON: "bg-emerald-500", LOST: "bg-rose-500",
  DRAFT: "bg-slate-500", SENT: "bg-sky-500", PARTIALLY_PAID: "bg-amber-500",
  PAID: "bg-emerald-500", OVERDUE: "bg-rose-500", CANCELLED: "bg-slate-600",
  PLANNING: "bg-sky-500", ACTIVE: "bg-emerald-500", ON_HOLD: "bg-amber-500",
  REVIEW: "bg-violet-500", COMPLETED: "bg-teal-500",
  ON_TRACK: "bg-emerald-500", AT_RISK: "bg-amber-500", DELAYED: "bg-rose-500",
  BACKLOG: "bg-slate-500", TODO: "bg-sky-500", IN_PROGRESS: "bg-cyan-500",
  BLOCKED: "bg-rose-500", DONE: "bg-emerald-500",
  OPEN: "bg-sky-500", WAITING_CLIENT: "bg-amber-500", RESOLVED: "bg-emerald-500", CLOSED: "bg-slate-600",
  IDEA: "bg-slate-500", APPROVED: "bg-cyan-500", SCHEDULED: "bg-amber-500", PUBLISHED: "bg-emerald-500", ARCHIVED: "bg-slate-600",
  INSTAGRAM: "bg-fuchsia-500", FACEBOOK: "bg-blue-500", LINKEDIN: "bg-sky-600", YOUTUBE: "bg-red-500", OTHER: "bg-slate-500",
  HOSTING: "bg-cyan-500", DOMAIN: "bg-sky-500", SOFTWARE: "bg-violet-500", MARKETING: "bg-fuchsia-500", OPERATIONS: "bg-emerald-500",
};

const barColor = (key?: string) => BAR_COLORS[key || ""] || "bg-cyan-500";

const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ---------- Section building blocks ----------

function SectionCard({
  title, icon, locked, lockHint, children, className,
}: {
  title: string; icon: React.ReactNode; locked?: boolean; lockHint?: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("apex-panel p-5 flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-secondary text-primary flex items-center justify-center shrink-0">{icon}</div>
          <h3 className="font-medium text-sm md:text-base truncate">{title}</h3>
        </div>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground border border-border rounded-md px-2 py-0.5">
            <Lock className="w-3 h-3" /> Restricted
          </span>
        )}
      </div>
      {locked ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {lockHint || "Your role does not include permission for this section."}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

function BarList({ rows }: { rows: { label: string; sub?: string; value: number; color: string; display: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No records in this period.</p>;
  }
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="group">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium">{r.label}{r.sub && <span className="text-muted-foreground ml-1.5 font-normal">{r.sub}</span>}</span>
            <span className="text-muted-foreground tabular-nums">{r.display}</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", r.color)}
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium", color)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {label} <span className="tabular-nums opacity-90">· {count}</span>
    </span>
  );
}

const CHIP_COLORS: Record<string, string> = {
  NEW: "text-sky-300 bg-sky-500/10 border-sky-500/30", CONTACTED: "text-indigo-300 bg-indigo-500/10 border-indigo-500/30",
  QUALIFIED: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30", MEETING: "text-blue-300 bg-blue-500/10 border-blue-500/30",
  PROPOSAL_SENT: "text-violet-300 bg-violet-500/10 border-violet-500/30", NEGOTIATION: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  WON: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", LOST: "text-rose-300 bg-rose-500/10 border-rose-500/30",
  PLANNING: "text-sky-300 bg-sky-500/10 border-sky-500/30", ACTIVE: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  ON_HOLD: "text-amber-300 bg-amber-500/10 border-amber-500/30", COMPLETED: "text-teal-300 bg-teal-500/10 border-teal-500/30",
  CANCELLED: "text-slate-400 bg-slate-500/10 border-slate-500/30",
  ON_TRACK: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", AT_RISK: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  DELAYED: "text-rose-300 bg-rose-500/10 border-rose-500/30",
  BACKLOG: "text-slate-300 bg-slate-500/10 border-slate-500/30", TODO: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  IN_PROGRESS: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30", BLOCKED: "text-rose-300 bg-rose-500/10 border-rose-500/30",
  DONE: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  OPEN: "text-sky-300 bg-sky-500/10 border-sky-500/30", WAITING_CLIENT: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  RESOLVED: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", CLOSED: "text-slate-400 bg-slate-500/10 border-slate-500/30",
  IDEA: "text-slate-300 bg-slate-500/10 border-slate-500/30", DRAFT: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  REVIEW: "text-violet-300 bg-violet-500/10 border-violet-500/30", APPROVED: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30",
  SCHEDULED: "text-amber-300 bg-amber-500/10 border-amber-500/30", PUBLISHED: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  ARCHIVED: "text-slate-400 bg-slate-500/10 border-slate-500/30",
};

export function ReportsView() {
  const [range, setRange] = useState("90");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await api.get<ReportData>(`/api/reports?range=${range}`));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Reports" description="Cross-module intelligence built only from real records." />
        <div className="animate-pulse space-y-4">
          <div className="flex gap-2">{RANGE_OPTIONS.map((r) => <div key={r.value} className="h-8 w-24 rounded-md bg-secondary" />)}</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-secondary" />)}</div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 rounded-xl bg-secondary" />)}</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Reports" description="Cross-module intelligence built only from real records." />
        <ErrorState message="Failed to load the report." onRetry={load} />
      </div>
    );
  }

  const k = data.kpis;
  const kpiCards: { label: string; value: string; sub?: string; icon: React.ReactNode; accent: "cyan" | "emerald" | "amber" | "rose" | "violet" }[] = [];
  if (k.newLeads !== null) kpiCards.push({ label: "New leads", value: String(k.newLeads), sub: k.conversionRate !== null ? `${k.wonLeads} won` : undefined, icon: <Users className="w-4 h-4" />, accent: "cyan" });
  if (k.conversionRate !== null) kpiCards.push({ label: "Conversion rate", value: `${k.conversionRate}%`, sub: `${k.wonLeads} won · ${(k.newLeads ?? 0) - k.wonLeads!} lost/open`, icon: <Percent className="w-4 h-4" />, accent: "violet" });
  if (k.activeClients !== null) kpiCards.push({ label: "Active clients", value: String(k.activeClients), icon: <Target className="w-4 h-4" />, accent: "emerald" });
  if (k.invoiced !== null) kpiCards.push({ label: "Invoiced (EGP)", value: k.invoiced.toLocaleString("en-EG", { maximumFractionDigits: 2 }), icon: <FileSpreadsheet className="w-4 h-4" />, accent: "cyan" });
  if (k.collected !== null) kpiCards.push({ label: "Collected (EGP)", value: k.collected.toLocaleString("en-EG", { maximumFractionDigits: 2 }), icon: <Banknote className="w-4 h-4" />, accent: "emerald" });
  if (k.outstanding !== null) kpiCards.push({ label: "Outstanding (EGP)", value: k.outstanding.toLocaleString("en-EG", { maximumFractionDigits: 2 }), icon: <AlertCircle className="w-4 h-4" />, accent: "amber" });
  if (k.expenses !== null) kpiCards.push({ label: "Expenses (EGP)", value: k.expenses.toLocaleString("en-EG", { maximumFractionDigits: 2 }), icon: <Receipt className="w-4 h-4" />, accent: "rose" });
  if (k.activeProjects !== null) kpiCards.push({ label: "Active projects", value: String(k.activeProjects), sub: k.tasksDone !== null ? `${k.tasksDone} tasks done` : undefined, icon: <FolderKanban className="w-4 h-4" />, accent: "violet" });
  if (k.openTickets !== null) kpiCards.push({ label: "Open tickets", value: String(k.openTickets), icon: <LifeBuoy className="w-4 h-4" />, accent: "rose" });
  if (k.publishedContent !== null) kpiCards.push({ label: "Published content", value: String(k.publishedContent), icon: <Megaphone className="w-4 h-4" />, accent: "emerald" });

  const revMax = Math.max(...data.finance.revenueByMonth.map((m) => Math.max(m.invoiced, m.collected)), 1);
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

  const hasAnySection =
    data.sections.sales || data.sections.finance || data.sections.delivery || data.sections.team ||
    data.sections.support || data.sections.marketing || data.sections.activity;

  const rangeLabel = RANGE_OPTIONS.find((r) => r.value === data.range)?.label || data.range;

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Cross-module intelligence built only from real records — nothing estimated, nothing mocked."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={cn(
                    "px-3 h-8 text-xs font-medium transition-colors",
                    range === r.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="icon" onClick={load} aria-label="Refresh report" className="h-8 w-8">
              <RefreshCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
        }
      />

      {!hasAnySection ? (
        <EmptyState
          icon={<TrendingUp className="w-5 h-5" />}
          title="No report sections available"
          description="Your role does not include visibility into any reporting module. Ask an administrator to grant reports access to specific modules."
        />
      ) : (
        <>
          {/* Period caption */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-4">
            <span className="inline-flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-primary" /> Period: last {rangeLabel === "All time" ? "all time" : rangeLabel}</span>
            <span>·</span>
            <span>Generated {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
            <span>·</span>
            <span>All numbers are live aggregates — refresh to update</span>
          </div>

          {/* KPI strip */}
          {kpiCards.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
              {kpiCards.map((c) => <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub} icon={c.icon} accent={c.accent} />)}
            </div>
          ) : null}

          {/* Section grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* SALES FUNNEL */}
            {data.sections.sales && (
              <SectionCard title={`Sales pipeline — ${rangeLabel}`} icon={<Users className="w-4 h-4" />}>
                <BarList
                  rows={data.sales.funnel.map((f) => ({
                    label: pretty(f.status),
                    sub: f.value > 0 ? formatCurrency(f.value) : undefined,
                    value: f.count,
                    color: barColor(f.status),
                    display: `${f.count} ${f.count === 1 ? "lead" : "leads"}`,
                  }))}
                />
                <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-2 text-xs text-muted-foreground">
                  <Wallet className="w-3.5 h-3.5 text-primary" />
                  Open pipeline value: <span className="font-semibold text-foreground">{formatCurrency(data.sales.openValue)}</span>
                </div>
              </SectionCard>
            )}

            {/* REVENUE TREND */}
            {data.sections.finance && (
              <SectionCard
                title="Revenue trend — last 6 months"
                icon={<BarChart3 className="w-4 h-4" />}
                locked={!data.sections.invoices && !data.sections.payments}
                lockHint="Invoicing or payments permission is required to view revenue."
              >
                {data.sections.invoices || data.sections.payments ? (
                  <>
                    <div className="flex items-end gap-3 sm:gap-5 h-44 px-1">
                      {data.finance.revenueByMonth.map((m) => (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end min-w-0">
                          <div className="w-full flex items-end justify-center gap-1 sm:gap-1.5 h-full">
                            {data.sections.invoices && (
                              <div
                                className="w-3 sm:w-5 rounded-t bg-cyan-500/80 hover:bg-cyan-400 transition-colors"
                                style={{ height: `${Math.max(2, (m.invoiced / revMax) * 100)}%` }}
                                title={`Invoiced ${monthLabel(m.month)}: ${formatCurrency(m.invoiced)}`}
                              />
                            )}
                            {data.sections.payments && (
                              <div
                                className="w-3 sm:w-5 rounded-t bg-emerald-500/80 hover:bg-emerald-400 transition-colors"
                                style={{ height: `${Math.max(2, (m.collected / revMax) * 100)}%` }}
                                title={`Collected ${monthLabel(m.month)}: ${formatCurrency(m.collected)}`}
                              />
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{monthLabel(m.month)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-4 text-[11px] text-muted-foreground">
                      {data.sections.invoices && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/80" /> Invoiced</span>}
                      {data.sections.payments && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" /> Collected</span>}
                      <span className="ml-auto">Hover bars for exact amounts</span>
                    </div>
                  </>
                ) : null}
              </SectionCard>
            )}

            {/* EXPENSES */}
            {data.sections.expenses && (
              <SectionCard title={`Expenses by category — ${rangeLabel}`} icon={<Receipt className="w-4 h-4" />}>
                <BarList
                  rows={data.finance.expensesByCategory.map((c) => ({
                    label: pretty(c.category),
                    sub: `${c.count} ${c.count === 1 ? "record" : "records"}`,
                    value: c.amount,
                    color: barColor(c.category),
                    display: formatCurrency(c.amount),
                  }))}
                />
              </SectionCard>
            )}

            {/* DELIVERY */}
            {(data.sections.projects || data.sections.tasks) && (
              <SectionCard
                title="Delivery health"
                icon={<FolderKanban className="w-4 h-4" />}
                locked={!data.sections.projects && !data.sections.tasks}
              >
                {data.sections.projects && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Projects by status</p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {data.delivery.projectsByStatus.map((p) => (
                        <Chip key={p.status} label={pretty(p.status!)} count={p.count} color={CHIP_COLORS[p.status!] || CHIP_COLORS.ACTIVE} />
                      ))}
                    </div>
                    {data.delivery.projectsByHealth.length > 0 && (
                      <>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Active project health</p>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {data.delivery.projectsByHealth.map((p) => (
                            <Chip key={p.health} label={pretty(p.health!)} count={p.count} color={CHIP_COLORS[p.health!] || CHIP_COLORS.ACTIVE} />
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
                {data.sections.tasks && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Tasks by status</p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.delivery.tasksByStatus.map((t) => (
                        <Chip key={t.status} label={pretty(t.status!)} count={t.count} color={CHIP_COLORS[t.status!] || CHIP_COLORS.ACTIVE} />
                      ))}
                    </div>
                  </>
                )}
                {data.delivery.projectsByStatus.length === 0 && data.delivery.tasksByStatus.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No projects or tasks yet.</p>
                )}
              </SectionCard>
            )}

            {/* TEAM LEADERBOARD */}
            {data.sections.team && (
              <SectionCard title="Team leaderboard — tasks completed" icon={<Trophy className="w-4 h-4" />}>
                {data.team.leaderboard.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No team members yet.</p>
                ) : (
                  <div className="space-y-2">
                    {data.team.leaderboard.map((u, i) => (
                      <div key={u.id} className="flex items-center gap-3 py-1.5">
                        <span className={cn("w-5 text-xs font-semibold tabular-nums", i === 0 ? "text-amber-300" : "text-muted-foreground")}>{i + 1}</span>
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                          style={{ backgroundColor: u.avatarColor || "#0e7490" }}
                        >
                          {initials(u.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{u.name}</p>
                          {u.title && <p className="text-[11px] text-muted-foreground truncate">{u.title}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[11px] font-medium"><CheckCircle2 className="w-3 h-3" />{u.done}</span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 text-[11px] font-medium">{u.open} open</span>
                          {u.overdue > 0 && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 text-[11px] font-medium"><Flame className="w-3 h-3" />{u.overdue}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {/* SUPPORT */}
            {data.sections.support && (
              <SectionCard title="Support performance" icon={<LifeBuoy className="w-4 h-4" />}>
                <BarList
                  rows={data.support.ticketsByStatus.map((t) => ({
                    label: pretty(t.status!),
                    value: t.count,
                    color: barColor(t.status!),
                    display: String(t.count),
                  }))}
                />
                <div className="mt-4 pt-3 border-t border-border/60 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-semibold flex items-center justify-center gap-1.5"><Clock className="w-4 h-4 text-cyan-300" />{data.support.avgResolutionHours !== null ? `${data.support.avgResolutionHours}h` : "—"}</p>
                    <p className="text-[11px] text-muted-foreground">Avg resolution</p>
                  </div>
                  <div>
                    <p className={cn("text-lg font-semibold flex items-center justify-center gap-1.5", data.support.urgentOpen > 0 && "text-rose-300")}><Flame className="w-4 h-4" />{data.support.urgentOpen}</p>
                    <p className="text-[11px] text-muted-foreground">Urgent open</p>
                  </div>
                  <div>
                    <p className={cn("text-lg font-semibold flex items-center justify-center gap-1.5", data.support.unassignedOpen > 0 && "text-amber-300")}><UserCheck className="w-4 h-4" />{data.support.unassignedOpen}</p>
                    <p className="text-[11px] text-muted-foreground">Unassigned</p>
                  </div>
                </div>
              </SectionCard>
            )}

            {/* MARKETING */}
            {data.sections.marketing && (
              <SectionCard
                title="Marketing pulse"
                icon={<Megaphone className="w-4 h-4" />}
                locked={!data.sections.content && !data.sections.campaigns}
              >
                {data.sections.content && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Content by status</p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {data.marketing.contentByStatus.map((c) => (
                        <Chip key={c.status} label={pretty(c.status!)} count={c.count} color={CHIP_COLORS[c.status!] || CHIP_COLORS.ACTIVE} />
                      ))}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Platforms</p>
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {data.marketing.contentByPlatform.map((c) => (
                        <Chip key={c.platform} label={pretty(c.platform!)} count={c.count} color={CHIP_COLORS[c.platform!] || CHIP_COLORS.ACTIVE} />
                      ))}
                    </div>
                  </>
                )}
                {data.sections.campaigns && (
                  <div className={cn("pt-2", data.sections.content && "mt-3 border-t border-border/60")}>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Campaigns</p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.marketing.campaignsByStatus.map((c) => (
                        <Chip key={c.status} label={pretty(c.status)} count={c.count} color={CHIP_COLORS[c.status] || CHIP_COLORS.ACTIVE} />
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>
            )}

            {/* ACTIVITY */}
            {data.sections.activity && (
              <SectionCard title="Workspace activity" icon={<Activity className="w-4 h-4" />}>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-secondary/30 p-4 text-center">
                    <p className="text-2xl font-semibold text-cyan-300">{data.activity.total}</p>
                    <p className="text-xs text-muted-foreground mt-1">Total activity events</p>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/30 p-4 text-center">
                    <p className="text-2xl font-semibold text-emerald-300">{data.activity.thisWeek}</p>
                    <p className="text-xs text-muted-foreground mt-1">Events this week</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Open the Activity page for the full chronological feed.
                </p>
              </SectionCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
