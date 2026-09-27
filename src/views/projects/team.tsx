"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiClientError, relativeTime, formatDate } from "@/lib/api-client";
import { PageHeader, EmptyState, ErrorState } from "@/components/shared";
import { UserAvatar } from "./tasks";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, FolderKanban, ListTodo, Settings, UserPlus, Users } from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  title?: string | null;
  avatarColor: string;
  roles: { key: string; label: string }[];
  skills: string[];
  lastLoginAt?: string | null;
  joinedAt: string;
  openTasks: number;
  overdueTasks: number;
  activeProjects: number;
  load: string;
};

const LOAD_STYLES: Record<string, string> = {
  AVAILABLE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  NORMAL: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  BUSY: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  OVERLOADED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const LOAD_BAR: Record<string, string> = {
  AVAILABLE: "[&>div]:bg-emerald-400",
  NORMAL: "[&>div]:bg-cyan-400",
  BUSY: "[&>div]:bg-amber-400",
  OVERLOADED: "[&>div]:bg-rose-400",
};

export function TeamView({ navigate }: { navigate: (p: string) => void }) {
  const { data: session } = useSession();
  const perms = session?.user?.permissions || [];
  const canManage = perms.includes("team.manage") || perms.includes("settings.manage");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setErrorMsg(null);
    try {
      const d = await api.get<{ team: TeamMember[] }>("/api/team");
      setTeam(d.team);
    } catch (e) {
      setError(true);
      if (e instanceof ApiClientError) setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const summary = useMemo(() => ({
    total: team.length,
    overloaded: team.filter((m) => m.load === "OVERLOADED").length,
    busy: team.filter((m) => m.load === "BUSY").length,
    totalOpenTasks: team.reduce((a, m) => a + m.openTasks, 0),
  }), [team]);

  return (
    <div>
      <PageHeader
        title="Team"
        description="Who is doing what — workload balance, skills and availability across APEX."
        actions={canManage ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("settings")}
              className="gap-2"
            >
              <UserPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Invite member</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("settings")}
              aria-label="Team settings"
              className="h-9 w-9"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        ) : undefined}
      />

      {/* Header summary */}
      {!loading && !error && team.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5 text-xs">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/70 border border-border">
            <Users className="w-3.5 h-3.5 text-cyan-300" />
            <span className="font-semibold">{summary.total}</span> members
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/70 border border-border">
            <ListTodo className="w-3.5 h-3.5 text-violet-300" />
            <span className="font-semibold">{summary.totalOpenTasks}</span> open tasks
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/70 border border-border">
            <FolderKanban className="w-3.5 h-3.5 text-emerald-300" />
            <span className="font-semibold">{summary.busy}</span> busy
          </span>
          <span className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border",
            summary.overloaded > 0 ? "bg-rose-500/10 border-rose-500/30 text-rose-300" : "bg-secondary/70 border-border",
          )}>
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="font-semibold">{summary.overloaded}</span> overloaded
          </span>
        </div>
      )}

      {error ? (
        <ErrorState message={errorMsg ?? "Team could not be loaded."} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      ) : team.length === 0 ? (
        <EmptyState
          icon={<Users className="w-5 h-5" />}
          title="No active members"
          description="Active team members will appear here with their live workload."
          action={canManage ? (
            <Button onClick={() => navigate("settings")}>
              <UserPlus className="w-4 h-4 mr-2" /> Add first member
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {team.map((m) => (
            <div key={m.id} className="apex-panel p-4 space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar name={m.name} color={m.avatarColor} className="w-10 h-10 text-xs" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.title ?? m.email}</p>
                  </div>
                </div>
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0", LOAD_STYLES[m.load] ?? LOAD_STYLES.NORMAL)}>
                  {m.load.replace("_", "-")}
                </span>
              </div>

              <div className="flex flex-wrap gap-1">
                {m.roles.map((r) => (
                  <span key={r.key} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                    {r.label}
                  </span>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Workload</span>
                  <span className="font-medium">{m.openTasks}/10</span>
                </div>
                <Progress value={Math.min(100, (m.openTasks / 10) * 100)} className={cn("h-1.5", LOAD_BAR[m.load])} />
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <button
                  onClick={() => navigate("tasks")}
                  className="rounded-lg bg-secondary/50 border border-border/60 p-2 hover:border-primary/40 transition-colors"
                  title="Open tasks view"
                >
                  <p className="text-sm font-semibold">{m.openTasks}</p>
                  <p className="text-[10px] text-muted-foreground">Open</p>
                </button>
                <div className={cn("rounded-lg border p-2", m.overdueTasks > 0 ? "bg-rose-500/8 border-rose-500/25" : "bg-secondary/50 border-border/60")}>
                  <p className={cn("text-sm font-semibold", m.overdueTasks > 0 && "text-rose-300")}>{m.overdueTasks}</p>
                  <p className="text-[10px] text-muted-foreground">Overdue</p>
                </div>
                <div className="rounded-lg bg-secondary/50 border border-border/60 p-2">
                  <p className="text-sm font-semibold">{m.activeProjects}</p>
                  <p className="text-[10px] text-muted-foreground">Projects</p>
                </div>
              </div>

              {m.skills.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.skills.map((s) => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-300">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-1 border-t border-border/60">
                <Clock className="w-3 h-3" />
                Last login {m.lastLoginAt ? relativeTime(m.lastLoginAt) : "never"}
                <span className="opacity-50">· joined {formatDate(m.joinedAt)}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
