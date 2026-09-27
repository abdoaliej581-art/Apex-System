"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, StatCard, ErrorState, CardsSkeleton, StatusBadge, EmptyState } from "@/components/shared";
import { api, relativeTime, formatCurrency } from "@/lib/api-client";
import { useSession } from "next-auth/react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Wallet, AlertCircle, UserPlus, Flame, FileText, FolderKanban,
  CalendarClock, ListTodo, LifeBuoy, AlarmClock, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============ Automation health widget (permission-gated §42) ============
type AutomationsHealth = {
  automations: {
    id: string; name: string; trigger: string; isActive: boolean;
    runCount: number; lastRunAt: string | null; description?: string | null;
  }[];
};

function AutomationsHealthCard({ navigate }: { navigate: (p: string) => void }) {
  const [health, setHealth] = useState<AutomationsHealth | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<AutomationsHealth>("/api/automations")
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  const rules = health?.automations ?? [];
  const active = rules.filter((r) => r.isActive).length;
  const paused = rules.length - active;
  const totalRuns = rules.reduce((a, r) => a + r.runCount, 0);
  const lastRun = rules
    .map((r) => r.lastRunAt)
    .filter((v): v is string => !!v)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  const recent = [...rules].sort((a, b) => b.runCount - a.runCount).slice(0, 3);

  return (
    <div className="apex-panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Automation health</h2>
        <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("automations")}>Manage</Button>
      </div>
      {!health ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No automation rules yet — create one to automate alerts.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/25 p-3.5 text-center">
              <p className="text-2xl font-bold text-emerald-300">{active}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Active<br className="hidden sm:block" /> rules</p>
            </div>
            <div className="rounded-lg bg-amber-500/8 border border-amber-500/25 p-3.5 text-center">
              <p className={cn("text-2xl font-bold", paused > 0 ? "text-amber-300" : "text-muted-foreground/60")}>{paused}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Paused<br className="hidden sm:block" /> rules</p>
            </div>
            <div className="rounded-lg bg-cyan-500/8 border border-cyan-500/25 p-3.5 text-center">
              <p className="text-2xl font-bold text-cyan-300">{totalRuns}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Total<br className="hidden sm:block" /> runs</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <Sparkles className={cn("w-3.5 h-3.5 shrink-0", r.isActive ? "text-primary" : "text-muted-foreground/50")} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{r.name}</p>
                    <p className="text-[10px] text-muted-foreground">{r.trigger.replace(/_/g, " ").toLowerCase()}{r.lastRunAt ? ` · last run ${relativeTime(r.lastRunAt)}` : " · never run"}</p>
                  </div>
                </div>
                <span className={cn(
                  "text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap",
                  r.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                )}>
                  {r.isActive ? "ACTIVE" : "PAUSED"}
                </span>
              </div>
            ))}
          </div>
          {lastRun && (
            <p className="text-[10px] text-muted-foreground mt-3">Most recent automation fired {relativeTime(lastRun)}.</p>
          )}
        </>
      )}
    </div>
  );
}

type DashboardData = {
  stats: {
    revenueThisMonth: number; outstanding: number; newLeads: number; activeLeads: number;
    proposalsAwaiting: number; activeProjects: number; tasksDueToday: number; overdueTasks: number;
    upcomingMeetings: number; openTickets: number; todayFollowUps: number; overdueFollowUps: number;
  };
  pipeline: { status: string; count: number; value: number }[];
  conversion: number | null;
  activities: { id: string; type: string; title: string; actorName: string; actorColor: string; createdAt: string }[];
  recentClients: { id: string; companyName: string; clientNumber: string; industry?: string | null }[];
  teamWorkload: { id: string; name: string; title?: string | null; avatarColor: string; openTasks: number; urgent: number; load: string }[];
  finance?: {
    recentPayments: { id: string; amount: number; date: string; invoiceNumber: string | null; currency: string; clientName: string | null }[];
    expensesThisMonth: number;
    overdueInvoices: number;
  };
  marketing?: {
    publishedThisMonth: number;
    scheduledAhead: number;
    activeCampaigns: number;
  };
  support?: {
    urgentOpen: number;
    unassignedOpen: number;
    activePlans: number;
    recentTickets: { id: string; ticketNumber: string; subject: string; status: string; priority: string; updatedAt: string; clientName: string | null }[];
  };
};

const PIPELINE_ORDER = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];

export function DashboardView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const perms = (session?.user?.permissions || []) as string[];
  const can = (p: string) => perms.includes(p);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await api.get<DashboardData>("/api/dashboard"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Your business command center." />
        <CardsSkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) return <ErrorState onRetry={load} />;

  const { stats, pipeline, conversion, activities, teamWorkload } = data;
  const pipelineMap = new Map(pipeline.map((p) => [p.status, p]));
  const maxCount = Math.max(1, ...pipeline.map((p) => p.count));
  const totalLeads = pipeline.reduce((a, p) => a + p.count, 0);
  const pipelineValue = pipeline.filter((p) => !["WON", "LOST"].includes(p.status)).reduce((a, p) => a + p.value, 0);

  const attention: { label: string; value: number; view: string; tone: string }[] = [];
  if (stats.overdueTasks > 0) attention.push({ label: "Overdue tasks", value: stats.overdueTasks, view: "tasks", tone: "text-rose-300" });
  if (stats.overdueFollowUps > 0) attention.push({ label: "Overdue follow-ups", value: stats.overdueFollowUps, view: "crm/followups", tone: "text-rose-300" });
  if (stats.tasksDueToday > 0) attention.push({ label: "Tasks due today", value: stats.tasksDueToday, view: "tasks", tone: "text-amber-300" });
  if (stats.todayFollowUps > 0) attention.push({ label: "Follow-ups today", value: stats.todayFollowUps, view: "crm/followups", tone: "text-amber-300" });
  if (stats.proposalsAwaiting > 0) attention.push({ label: "Proposals awaiting response", value: stats.proposalsAwaiting, view: "sales/proposals", tone: "text-cyan-300" });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Everything happening across APEX — leads, delivery, finance and support at a glance."
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {can("payments.view") && <StatCard label="Revenue this month" value={formatCurrency(stats.revenueThisMonth)} icon={<Wallet className="w-4 h-4" />} accent="emerald" />}
        {can("invoices.view") && <StatCard label="Outstanding payments" value={formatCurrency(stats.outstanding)} icon={<AlertCircle className="w-4 h-4" />} accent="amber" />}
        <StatCard label="New leads" value={stats.newLeads} sub={`${stats.activeLeads} active in pipeline`} icon={<UserPlus className="w-4 h-4" />} accent="cyan" />
        <StatCard label="Active projects" value={stats.activeProjects} icon={<FolderKanban className="w-4 h-4" />} accent="violet" />
        <StatCard label="Proposals awaiting" value={stats.proposalsAwaiting} icon={<FileText className="w-4 h-4" />} accent="cyan" />
        <StatCard label="Tasks due today" value={stats.tasksDueToday} sub={`${stats.overdueTasks} overdue`} icon={<ListTodo className="w-4 h-4" />} accent="amber" />
        <StatCard label="Upcoming meetings" value={stats.upcomingMeetings} sub="next 7 days" icon={<CalendarClock className="w-4 h-4" />} accent="violet" />
        <StatCard label="Open tickets" value={stats.openTickets} icon={<LifeBuoy className="w-4 h-4" />} accent="rose" />
      </div>

      {/* Needs attention */}
      {attention.length > 0 && (
        <div className="mt-4 apex-panel p-4 border-amber-500/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300 mb-3">Needs attention</p>
          <div className="flex flex-wrap gap-2">
            {attention.map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.view)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/70 hover:bg-accent border border-border transition-colors text-sm"
              >
                <span className={cn("font-bold", a.tone)}>{a.value}</span>
                <span className="text-muted-foreground">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Pipeline */}
        <div className="apex-panel p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold">Sales pipeline</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("crm/pipeline")}>Open pipeline</Button>
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            {totalLeads} leads · {formatCurrency(pipelineValue)} estimated value
            {conversion !== null && <> · {conversion}% won vs lost</>}
          </p>

          {totalLeads === 0 ? (
            <EmptyState
              title="No leads yet"
              description="Create your first lead to start filling the pipeline."
              action={<Button size="sm" onClick={() => navigate("crm/leads")}>Create lead</Button>}
            />
          ) : (
            <div className="space-y-3">
              {PIPELINE_ORDER.map((status) => {
                const p = pipelineMap.get(status);
                const count = p?.count ?? 0;
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-28 text-xs text-muted-foreground shrink-0">{status.replace(/_/g, " ")}</span>
                    <div className="flex-1 h-6 rounded-md bg-secondary/50 overflow-hidden">
                      <div
                        className={cn("h-full rounded-md transition-all", status === "WON" ? "bg-emerald-400/80" : status === "LOST" ? "bg-rose-400/70" : "bg-gradient-to-r from-cyan-500/80 to-sky-500/60")}
                        style={{ width: `${Math.max(count === 0 ? 0 : 4, (count / maxCount) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-sm font-medium shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div className="apex-panel p-5 flex flex-col">
          <h2 className="font-semibold mb-4">Recent activity</h2>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No activity recorded yet.</p>
          ) : (
            <ScrollArea className="h-[280px] pr-2">
              <div className="space-y-4">
                {activities.map((a) => (
                  <div key={a.id} className="flex gap-3">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border"
                      style={{ backgroundColor: `${a.actorColor}22`, color: a.actorColor, borderColor: `${a.actorColor}55` }}
                    >
                      {a.actorName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{a.actorName} · {relativeTime(a.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Team workload */}
        <div className="apex-panel p-5">
          <h2 className="font-semibold mb-4">Team workload</h2>
          {teamWorkload.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No active team members.</p>
          ) : (
            <div className="space-y-3.5">
              {teamWorkload.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border"
                    style={{ backgroundColor: `${m.avatarColor}22`, color: m.avatarColor, borderColor: `${m.avatarColor}55` }}
                  >
                    {m.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <span className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                        m.load === "OVERLOADED" ? "bg-rose-500/15 text-rose-300" :
                        m.load === "BUSY" ? "bg-amber-500/15 text-amber-300" :
                        m.load === "NORMAL" ? "bg-cyan-500/15 text-cyan-300" : "bg-emerald-500/15 text-emerald-300"
                      )}>{m.load.replace("_", "-")}</span>
                    </div>
                    <Progress value={(m.openTasks / 10) * 100} className="h-1.5 mt-1.5" />
                    <p className="text-[10px] text-muted-foreground mt-1">{m.openTasks} open tasks{m.urgent > 0 && ` · ${m.urgent} urgent`}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent clients */}
        <div className="apex-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent clients</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("crm/clients")}>View all</Button>
          </div>
          {data.recentClients.length === 0 ? (
            <div className="text-center py-8">
              <Flame className="w-5 h-5 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted-foreground">No clients yet. Win your first lead to convert one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentClients.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-accent/60 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.companyName}</p>
                    <p className="text-[11px] text-muted-foreground">{c.clientNumber}{c.industry ? ` · ${c.industry}` : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick follow-ups */}
        <div className="apex-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Follow-ups</h2>
            <AlarmClock className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-amber-500/8 border border-amber-500/25 p-3.5 text-center">
              <p className="text-2xl font-bold text-amber-300">{stats.todayFollowUps}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Due today</p>
            </div>
            <div className="rounded-lg bg-rose-500/8 border border-rose-500/25 p-3.5 text-center">
              <p className="text-2xl font-bold text-rose-300">{stats.overdueFollowUps}</p>
              <p className="text-[11px] text-muted-foreground mt-1">Overdue</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => navigate("crm/followups")}>
            Manage follow-ups
          </Button>
        </div>

        {/* Recent payments (permission-gated §42) */}
        {can("payments.view") && (
        <div className="apex-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent payments</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("finance/payments")}>View all</Button>
          </div>
          {!data.finance || data.finance.recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No payments recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {data.finance.recentPayments.slice(0, 4).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-accent/60 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.clientName ?? p.invoiceNumber ?? "Payment"}</p>
                    <p className="text-[11px] text-muted-foreground">{p.invoiceNumber} · {relativeTime(p.date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-300 whitespace-nowrap">
                    {formatCurrency(p.amount, p.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {data.finance && (data.finance.overdueInvoices > 0 || data.finance.expensesThisMonth > 0) && (
            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border">
              {data.finance.overdueInvoices > 0 && (
                <button onClick={() => navigate("finance/invoices")} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 hover:bg-rose-500/15 transition-colors">
                  <AlertCircle className="w-3 h-3" /> {data.finance.overdueInvoices} overdue invoice{data.finance.overdueInvoices === 1 ? "" : "s"}
                </button>
              )}
              {data.finance.expensesThisMonth > 0 && (
                <button onClick={() => navigate("finance/expenses")} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-secondary/70 border border-border text-muted-foreground hover:bg-accent transition-colors">
                  Expenses this month: {formatCurrency(data.finance.expensesThisMonth)}
                </button>
              )}
            </div>
          )}
        </div>
        )}

        {/* Marketing pulse (permission-gated §42) */}
        {can("content.view") && (
        <div className="apex-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Marketing pulse</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("marketing/content")}>Open content</Button>
          </div>
          {!data.marketing ? (
            <p className="text-sm text-muted-foreground text-center py-6">Marketing module unavailable.</p>
          ) : data.marketing.publishedThisMonth === 0 && data.marketing.scheduledAhead === 0 && data.marketing.activeCampaigns === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No marketing activity yet — plan your first content.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/25 p-3.5 text-center">
                <p className="text-2xl font-bold text-emerald-300">{data.marketing.publishedThisMonth}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Published<br className="hidden sm:block" /> this month</p>
              </div>
              <div className="rounded-lg bg-cyan-500/8 border border-cyan-500/25 p-3.5 text-center">
                <p className="text-2xl font-bold text-cyan-300">{data.marketing.scheduledAhead}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Scheduled<br className="hidden sm:block" /> ahead</p>
              </div>
              <div className="rounded-lg bg-violet-500/8 border border-violet-500/25 p-3.5 text-center">
                <p className="text-2xl font-bold text-violet-300">{data.marketing.activeCampaigns}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Live<br className="hidden sm:block" /> campaigns</p>
              </div>
            </div>
          )}
          <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => navigate("marketing/campaigns")}>
            View campaigns
          </Button>
        </div>
        )}

        {/* Support radar (permission-gated §42) */}
        {can("tickets.view") && (
        <div className="apex-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Support radar</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("support/tickets")}>Open tickets</Button>
          </div>
          {!data.support ? (
            <p className="text-sm text-muted-foreground text-center py-6">Support module unavailable.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg bg-cyan-500/8 border border-cyan-500/25 p-3.5 text-center">
                  <p className="text-2xl font-bold text-cyan-300">{stats.openTickets}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Open<br className="hidden sm:block" /> tickets</p>
                </div>
                <div className="rounded-lg bg-rose-500/8 border border-rose-500/25 p-3.5 text-center">
                  <p className={cn("text-2xl font-bold", data.support.urgentOpen > 0 ? "text-rose-300" : "text-muted-foreground/60")}>{data.support.urgentOpen}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Urgent<br className="hidden sm:block" /> open</p>
                </div>
                <div className="rounded-lg bg-amber-500/8 border border-amber-500/25 p-3.5 text-center">
                  <p className={cn("text-2xl font-bold", data.support.unassignedOpen > 0 ? "text-amber-300" : "text-muted-foreground/60")}>{data.support.unassignedOpen}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">Un-<br className="hidden sm:block" />assigned</p>
                </div>
              </div>
              {data.support.recentTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No open tickets — clients are happy.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.support.recentTickets.map((t) => (
                    <button key={t.id} onClick={() => navigate("support/tickets")} className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2 hover:border-primary/40 transition-colors text-left">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{t.subject}</p>
                        <p className="text-[10px] text-muted-foreground">{t.ticketNumber}{t.clientName ? ` · ${t.clientName}` : ""} · {relativeTime(t.updatedAt)}</p>
                      </div>
                      <StatusBadge status={t.status} />
                    </button>
                  ))}
                </div>
              )}
              {data.support.activePlans > 0 && (
                <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => navigate("support/maintenance")}>
                  {data.support.activePlans} active maintenance plan{data.support.activePlans === 1 ? "" : "s"}
                </Button>
              )}
            </>
          )}
        </div>
        )}

        {/* Automation health (permission-gated §42) */}
        {can("automations.manage") && <AutomationsHealthCard navigate={navigate} />}
      </div>
    </div>
  );
}
