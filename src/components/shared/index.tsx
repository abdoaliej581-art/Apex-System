"use client";

import { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Inbox, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------- Page header (§68) ----------
export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ---------- Empty state (§51) ----------
export function EmptyState({
  icon, title, description, action,
}: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 rounded-xl border border-dashed border-border bg-card/40">
      <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-primary mb-4">
        {icon ?? <Inbox className="w-5 h-5" />}
      </div>
      <h3 className="font-medium">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------- Error state (§53) ----------
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl border border-destructive/30 bg-destructive/5">
      <AlertTriangle className="w-8 h-8 text-destructive mb-3" />
      <h3 className="font-medium">{message || "Something went wrong while loading this view."}</h3>
      <p className="text-sm text-muted-foreground mt-1">Please try again. If the problem persists, contact the system administrator.</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCcw className="w-4 h-4 mr-2" /> Retry
        </Button>
      )}
    </div>
  );
}

// ---------- Loading skeleton ----------
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

// ---------- Status / Priority badges (never color-only, §58) ----------
const STATUS_STYLES: Record<string, string> = {
  // generic
  NEW: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  CONTACTED: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  QUALIFIED: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  MEETING: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  PROPOSAL_SENT: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  NEGOTIATION: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  WON: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  LOST: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  ACTIVE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  INACTIVE: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  ARCHIVED: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  PLANNING: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  ON_HOLD: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  REVIEW: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  COMPLETED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  CANCELLED: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  ON_TRACK: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  AT_RISK: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  DELAYED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  BACKLOG: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  TODO: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  IN_PROGRESS: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  BLOCKED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  DONE: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  DRAFT: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  SENT: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  VIEWED: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  ACCEPTED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  REJECTED: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  EXPIRED: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  SIGNED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  PARTIALLY_PAID: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  PAID: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  OVERDUE: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  OPEN: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  WAITING_CLIENT: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  CLOSED: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  PENDING: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  SCHEDULED: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  RESCHEDULED: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  PUBLISHED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  SCHEDULED_CONTENT: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  IDEA: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  PAUSED: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  APPROVED: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  EXPIRED_PLAN: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const style = STATUS_STYLES[status] || "bg-secondary text-secondary-foreground border-border";
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap", style, className)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status.replace(/_/g, " ")}
    </span>
  );
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  MEDIUM: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  HIGH: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  URGENT: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium", PRIORITY_STYLES[priority] || PRIORITY_STYLES.MEDIUM, className)}>
      {priority}
    </span>
  );
}

// ---------- Stat card ----------
export function StatCard({
  label, value, sub, icon, accent,
}: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: "cyan" | "emerald" | "amber" | "rose" | "violet" }) {
  const accents: Record<string, string> = {
    cyan: "text-cyan-300 bg-cyan-500/10",
    emerald: "text-emerald-300 bg-emerald-500/10",
    amber: "text-amber-300 bg-amber-500/10",
    rose: "text-rose-300 bg-rose-500/10",
    violet: "text-violet-300 bg-violet-500/10",
  };
  return (
    <div className="apex-panel p-4 flex items-start justify-between gap-3 hover:border-primary/30 transition-colors">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold mt-1.5 truncate">{value}</p>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </div>
      {icon && (
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", accents[accent || "cyan"])}>
          {icon}
        </div>
      )}
    </div>
  );
}

// ---------- Simple field primitives used across forms ----------
export function Field({ label, children, required, hint }: { label: string; children: ReactNode; required?: boolean; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
