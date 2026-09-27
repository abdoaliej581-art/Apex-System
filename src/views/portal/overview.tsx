"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  FolderKanban, LifeBuoy, Receipt, Wrench, Wallet, CalendarClock, ArrowRight,
  Building2, HandCoins, CheckCircle2, RefreshCw, Clock, AlertTriangle, TrendingUp,
} from "lucide-react";
import { PageHeader, EmptyState, ErrorState, StatusBadge, PriorityBadge, StatCard, CardsSkeleton } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, relativeTime } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ViewProps } from "@/views/registry";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";

type OverviewData = {
  client: {
    id: string; clientNumber: string; companyName: string; industry: string | null;
    location: string | null; email: string | null; phone: string | null; status: string;
  } | null;
  kpis: {
    activeProjects: number; completedProjects: number; openTickets: number;
    outstanding: number; overdueCount: number;
    lastPayment: { amount: number; method: string; paidAt: string; invoiceNumber: string | null } | null;
    nextMeeting: { title: string; date: string; startTime: string } | null;
  } | null;
  projects: { id: string; projectNumber: string; name: string; status: string; progress: number; health: string; deadline: string | null }[];
  invoices: { id: string; invoiceNumber: string; status: string; total: number; paidAmount: number; currency: string; issueDate: string; dueDate: string | null }[];
  tickets: { id: string; ticketNumber: string; subject: string; status: string; priority: string; updatedAt: string }[];
  maintenance: { id: string; plan: string; includedHours: number | null; usedHours: number; endDate: string | null } | null;
};

// ============ Maintenance hour usage chart ============
type MaintenanceData = {
  plan: {
    id: string; tier: string; status: string;
    includedHours: number | null; usedHours: number;
    startDate: string; endDate: string | null;
    project: { id: string; name: string; projectNumber: string } | null;
    overBudget: boolean; remaining: number | null; consumptionPct: number | null;
  } | null;
  usageTrend: { month: string; hours: number; cumulative: number }[];
  includedLine: number | null;
  hourLogs: { id: string; hours: number; note: string | null; spentOn: string; loggedByName: string | null }[];
};

function MaintenanceChartSection() {
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<MaintenanceData>("/api/portal/maintenance")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="apex-panel p-4 md:p-5" aria-label="Maintenance plan">
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Maintenance Plan</h2>
        </div>
        <div className="space-y-2">
          <div className="h-4 rounded bg-secondary/60 w-2/3 animate-pulse" />
          <div className="h-36 rounded-lg bg-secondary/40 animate-pulse" />
        </div>
      </section>
    );
  }

  if (!data?.plan) return null;

  const { plan, usageTrend, includedLine, hourLogs } = data;
  const isOverBudget = plan.overBudget;
  const pct = plan.consumptionPct ?? 0;
  const hasChart = usageTrend.length > 1 && usageTrend.some((d) => d.hours > 0);

  return (
    <section className="apex-panel p-4 md:p-5" aria-labelledby="portal-maint-h">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          <h2 id="portal-maint-h" className="text-sm font-semibold">Maintenance Plan</h2>
          <span className={cn(
            "text-[10px] font-bold px-1.5 py-0.5 rounded",
            plan.tier === "PREMIUM" ? "bg-violet-500/15 text-violet-300" :
            plan.tier === "STANDARD" ? "bg-sky-500/15 text-sky-300" :
            plan.tier === "BASIC" ? "bg-slate-500/15 text-slate-300" :
            "bg-cyan-500/15 text-cyan-300"
          )}>{plan.tier}</span>
        </div>
        {plan.project && (
          <p className="text-[11px] text-muted-foreground">{plan.project.name}</p>
        )}
      </div>

      {/* Hours gauge */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">Hours used</span>
          <span className={cn("font-semibold tabular-nums", isOverBudget ? "text-rose-300" : "text-foreground")}>
            {plan.usedHours}h{plan.includedHours !== null ? ` / ${plan.includedHours}h included` : " (unlimited)"}
          </span>
        </div>
        <Progress
          value={plan.includedHours ? Math.min(100, pct) : 0}
          className={cn("h-2.5", isOverBudget ? "[&>*]:bg-rose-400" : pct >= 80 ? "[&>*]:bg-amber-400" : "[&>*]:bg-cyan-400")}
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1.5">
          <span>{plan.includedHours ? `${pct}% used` : "Unlimited plan"}</span>
          {plan.remaining !== null && !isOverBudget && (
            <span className="text-emerald-300">{plan.remaining}h remaining</span>
          )}
          {isOverBudget && (
            <span className="text-rose-300 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {(plan.usedHours - (plan.includedHours ?? 0)).toFixed(1)}h over budget
            </span>
          )}
        </div>
      </div>

      {/* Usage chart */}
      {hasChart ? (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-3">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Cumulative hours by month</p>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={usageTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="maintGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false} tickLine={false} width={32}
                tickFormatter={(v: number) => `${v}h`}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(val: number, name: string) => [
                  `${val}h`,
                  name === "cumulative" ? "Total used" : "This month"
                ]}
              />
              {includedLine !== null && (
                <ReferenceLine
                  y={includedLine}
                  stroke="#f87171"
                  strokeDasharray="4 3"
                  label={{ value: `Cap: ${includedLine}h`, position: "right", fontSize: 10, fill: "#f87171" }}
                />
              )}
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="#a78bfa"
                strokeWidth={2}
                fill="url(#maintGrad)"
                dot={{ r: 3, fill: "#a78bfa", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "#a78bfa" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-center h-24 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          No usage logged yet — hours will appear here as work progresses.
        </div>
      )}

      {/* Recent log entries */}
      {hourLogs.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-2">Recent hours logged</p>
          <div className="space-y-1.5">
            {hourLogs.slice(-5).reverse().map((log) => (
              <div key={log.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 px-3 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs truncate">{log.note || "Work session"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(log.spentOn).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {log.loggedByName && ` · ${log.loggedByName}`}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-violet-300 shrink-0">{log.hours}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.endDate && (
        <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1">
          <CalendarClock className="w-3 h-3" />
          Plan active until {new Date(plan.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </section>
  );
}

const money = (n: number) => n.toLocaleString("en-EG", { maximumFractionDigits: 0 });
const dateShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function PortalOverviewView({ navigate }: ViewProps) {
  const { data: session } = useSession();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OverviewData>("/api/portal/overview"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your workspace overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Overview" description="Your workspace at a glance." />
        <CardsSkeleton count={4} />
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <PageHeader title="Overview" description="Your workspace at a glance." />
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }
  if (!data?.client || !data.kpis) {
    return (
      <div>
        <PageHeader title="Overview" description="Your workspace at a glance." />
        <EmptyState
          icon={<Building2 className="w-5 h-5" />}
          title="Account not linked to a company"
          description="Your portal account is not linked to a client company yet. Please contact the APEX team so we can finish setting up your access."
        />
      </div>
    );
  }

  const { client, kpis } = data;
  const firstName = (session?.user?.name || "there").split(" ")[0];

  return (
    <div className="space-y-6">
      {/* Hero banner */}
      <section className="apex-panel relative overflow-hidden p-5 md:p-6 apex-glow" aria-labelledby="portal-welcome">
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{ background: "radial-gradient(600px 200px at 85% -20%, rgba(34,211,238,0.16), transparent)" }}
        />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">Client Portal</p>
            <h1 id="portal-welcome" className="text-xl md:text-2xl font-bold mt-1.5 truncate">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {client.companyName} · <span className="font-mono text-xs">{client.clientNumber}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => navigate("portal/tickets")}>
              <LifeBuoy className="w-4 h-4 mr-1.5" /> New Support Ticket
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("portal/invoices")}>
              <Receipt className="w-4 h-4 mr-1.5" /> Invoices
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { load(); }} aria-label="Refresh overview">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* KPI cards */}
      <section aria-label="Key numbers" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active Projects" value={kpis.activeProjects} icon={<FolderKanban className="w-4 h-4" />} accent="cyan"
          sub={kpis.completedProjects > 0 ? `${kpis.completedProjects} completed to date` : "Nothing delivered yet"} />
        <StatCard label="Outstanding" value={`${money(kpis.outstanding)} EGP`} icon={<Wallet className="w-4 h-4" />} accent={kpis.outstanding > 0 ? "amber" : "emerald"}
          sub={kpis.overdueCount > 0 ? <span className="text-rose-300">{kpis.overdueCount} overdue invoice{kpis.overdueCount > 1 ? "s" : ""}</span> : kpis.lastPayment ? `Last payment ${dateShort(kpis.lastPayment.paidAt)}` : "No payments recorded"} />
        <StatCard label="Open Tickets" value={kpis.openTickets} icon={<LifeBuoy className="w-4 h-4" />} accent={kpis.openTickets > 0 ? "rose" : "emerald"}
          sub={kpis.openTickets > 0 ? "Our team is on it" : "All clear — nothing open"} />
        <StatCard label="Maintenance" value={data.maintenance ? `${data.maintenance.usedHours}/${data.maintenance.includedHours ?? "∞"}h` : "—"} icon={<Wrench className="w-4 h-4" />} accent="violet"
          sub={data.maintenance ? `${data.maintenance.plan} plan` : "No active plan"} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Projects */}
        <section className="apex-panel p-4 md:p-5" aria-labelledby="portal-projects-h">
          <div className="flex items-center justify-between mb-4">
            <h2 id="portal-projects-h" className="text-sm font-semibold flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-primary" /> Your Projects
            </h2>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={() => navigate("portal/projects")}>
              View all <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          {data.projects.length === 0 ? (
            <EmptyState icon={<FolderKanban className="w-5 h-5" />} title="No projects yet"
              description="When we start working together, your projects and their live progress will appear here." />
          ) : (
            <ul className="space-y-3">
              {data.projects.map((p) => (
                <li key={p.id}>
                  <button onClick={() => navigate("portal/projects")}
                    className="w-full text-left rounded-lg border border-border bg-card/40 hover:border-primary/40 hover:bg-card/70 transition-colors p-3.5"
                    aria-label={`Open project ${p.name}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{p.projectNumber}</p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all",
                          p.health === "DELAYED" ? "bg-rose-400" : p.health === "AT_RISK" ? "bg-amber-400" : "bg-cyan-400")}
                          style={{ width: `${Math.min(100, Math.max(0, p.progress))}%` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums">{p.progress}%</span>
                    </div>
                    {p.deadline && (
                      <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" /> Due {dateShort(p.deadline)}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Invoices */}
        <section className="apex-panel p-4 md:p-5" aria-labelledby="portal-invoices-h">
          <div className="flex items-center justify-between mb-4">
            <h2 id="portal-invoices-h" className="text-sm font-semibold flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" /> Recent Invoices
            </h2>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={() => navigate("portal/invoices")}>
              View all <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          {data.invoices.length === 0 ? (
            <EmptyState icon={<Receipt className="w-5 h-5" />} title="No invoices yet"
              description="Issued invoices and their payment status will show up here." />
          ) : (
            <ul className="divide-y divide-border/60">
              {data.invoices.map((inv) => {
                const remaining = Math.max(0, inv.total - inv.paidAmount);
                return (
                  <li key={inv.id}>
                    <button onClick={() => navigate("portal/invoices")}
                      className="w-full text-left py-3 flex items-center justify-between gap-3 hover:bg-accent/40 rounded-md px-2 -mx-2 transition-colors"
                      aria-label={`Open invoice ${inv.invoiceNumber}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium font-mono">{inv.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Issued {dateShort(inv.issueDate)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums">{money(inv.total)} {inv.currency}</p>
                        {remaining > 0 && inv.status !== "CANCELLED" ? (
                          <p className="text-[11px] text-amber-300 mt-0.5">{money(remaining)} remaining</p>
                        ) : inv.status === "PAID" ? (
                          <p className="text-[11px] text-emerald-300 mt-0.5 flex items-center justify-end gap-1"><CheckCircle2 className="w-3 h-3" /> Paid</p>
                        ) : null}
                      </div>
                      <StatusBadge status={inv.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {kpis.nextMeeting && (
            <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3 flex items-start gap-2.5">
              <CalendarClock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{kpis.nextMeeting.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Next meeting · {dateShort(kpis.nextMeeting.date)} at {kpis.nextMeeting.startTime}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Support tickets strip */}
      <section className="apex-panel p-4 md:p-5" aria-labelledby="portal-tickets-h">
        <div className="flex items-center justify-between mb-4">
          <h2 id="portal-tickets-h" className="text-sm font-semibold flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-primary" /> Active Support
          </h2>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={() => navigate("portal/tickets")}>
            View all <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
        {data.tickets.length === 0 ? (
          <EmptyState icon={<LifeBuoy className="w-5 h-5" />} title="No open tickets"
            description="Need help with something? Open a ticket and our team will pick it up."
            action={<Button size="sm" onClick={() => navigate("portal/tickets")}><HandCoins className="w-4 h-4 mr-1.5" /> Open a ticket</Button>} />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.tickets.map((t) => (
              <li key={t.id}>
                <button onClick={() => navigate("portal/tickets")}
                  className="w-full text-left rounded-lg border border-border bg-card/40 hover:border-primary/40 hover:bg-card/70 transition-colors p-3.5"
                  aria-label={`Open ticket ${t.subject}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium truncate">{t.subject}</p>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-muted-foreground font-mono">{t.ticketNumber}</span>
                    <span className="text-[11px] text-muted-foreground">{relativeTime(t.updatedAt)}</span>
                  </div>
                  <div className="mt-2"><StatusBadge status={t.status} /></div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Maintenance plan with hours chart */}
      <MaintenanceChartSection />
    </div>
  );
}
