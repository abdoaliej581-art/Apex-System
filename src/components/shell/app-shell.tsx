"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { Bell, ChevronLeft, Home, Link2, LogOut, Menu, Search, X, Sun, Moon, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NAV_GROUPS } from "@/lib/nav-config";
import { useHashRoute } from "@/lib/router";
import { api, relativeTime } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ============ Logo ============
export function ApexLogo({ size = 32, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="relative flex items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-sky-600 shadow-[0_0_18px_-4px_rgba(34,211,238,0.6)]"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
          <path d="M12 3L21 20H15.5L12 13.2L8.5 20H3L12 3Z" fill="#06202a" />
        </svg>
      </div>
      {withText && (
        <div className="leading-tight">
          <p className="font-bold tracking-[0.18em] text-[13px]">APEX</p>
          <p className="text-[9px] text-muted-foreground tracking-[0.22em] font-medium">SYSTEM</p>
        </div>
      )}
    </div>
  );
}

// ============ Sidebar content ============
function SidebarNav({ path, navigate, collapsed, onNavigate, badgeCounts }: {
  path: string; navigate: (p: string) => void; collapsed: boolean; onNavigate?: () => void;
  badgeCounts?: { followups: number; tickets: number };
}) {
  const { data: session } = useSession();
  const permissions = session?.user?.permissions || [];
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => permissions.includes(i.permission)),
  })).filter((g) => g.items.length > 0);

  return (
    <nav className="flex-1 overflow-y-auto apex-scroll px-2 py-3 space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">{group.label}</p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = path === item.key;
              const badgeCount = item.badge === "followups" ? (badgeCounts?.followups ?? 0)
                : item.badge === "tickets" ? (badgeCounts?.tickets ?? 0) : 0;
              return (
                <button
                  key={item.key}
                  onClick={() => { navigate(item.key); onNavigate?.(); }}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors min-h-[38px]",
                    active
                      ? "bg-primary/12 text-primary font-medium border border-primary/25 shadow-[inset_0_0_20px_-10px_rgba(34,211,238,0.4)]"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border border-transparent",
                    collapsed && "justify-center px-2"
                  )}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  <div className="relative shrink-0">
                    <Icon className={cn("w-4 h-4", active && "text-primary")} />
                    {collapsed && badgeCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-rose-400 text-[9px] font-bold text-white flex items-center justify-center leading-none">
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </div>
                  {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                  {!collapsed && badgeCount > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-400/20 border border-rose-400/40 text-[10px] font-bold text-rose-300 flex items-center justify-center leading-none">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ============ Notifications ============
type NotificationItem = {
  id: string; type: string; title: string; body?: string | null;
  isRead: boolean; createdAt: string; entityType?: string | null; entityId?: string | null;
};

const ENTITY_NAV_MAP: Record<string, string> = {
  LEAD: "crm/leads", CLIENT: "crm/clients", PROJECT: "projects", TASK: "tasks",
  INVOICE: "finance/invoices", TICKET: "support/tickets", MAINTENANCE: "support/maintenance",
  CONTENT: "marketing/content", CAMPAIGN: "marketing/campaigns",
  PROPOSAL: "sales/proposals", CONTRACT: "sales/contracts", MEETING: "sales/meetings",
};

function NotificationsBell() {
  const { navigate } = useHashRoute();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = async () => {
    try {
      const data = await api.get<{ items: NotificationItem[]; unread: number }>("/api/notifications");
      setItems(data.items);
    } catch { /* silent */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [open]);

  const unread = items.filter((i) => !i.isRead).length;

  const markAll = async () => {
    try {
      await api.put("/api/notifications", { markAllRead: true });
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    } catch { /* silent */ }
  };

  const markOne = async (id: string) => {
    try {
      await api.patch(`/api/notifications/${id}`, {});
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, isRead: true } : i));
    } catch { /* silent */ }
  };

  const dismiss = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.delete(`/api/notifications/${id}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch { /* silent */ }
  };

  const handleClick = async (n: NotificationItem) => {
    if (!n.isRead) await markOne(n.id);
    const dest = n.entityType ? ENTITY_NAV_MAP[n.entityType] : null;
    if (dest) { setOpen(false); navigate(dest); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Notifications">
          <Bell className="w-[18px] h-[18px]" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-cyan-400 text-[10px] font-bold text-[#06202a] flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                {unread} new
              </span>
            )}
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={markAll}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[380px]">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No notifications yet.</p>
          ) : (
            <div>
              {items.map((n) => {
                const canNav = !!n.entityType && !!ENTITY_NAV_MAP[n.entityType];
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "px-4 py-3 border-b border-border/60 group flex items-start gap-2.5 transition-colors",
                      !n.isRead && "bg-primary/5",
                      canNav ? "cursor-pointer hover:bg-accent/60" : "cursor-default"
                    )}
                  >
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full mt-2 shrink-0",
                      n.isRead ? "bg-muted-foreground/40" : "bg-cyan-400"
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm leading-snug", !n.isRead && "font-medium")}>{n.title}</p>
                      {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-muted-foreground/70 mt-1">{relativeTime(n.createdAt)}</p>
                    </div>
                    <button
                      onClick={(e) => dismiss(e, n.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive mt-0.5 shrink-0 p-0.5 rounded"
                      aria-label="Dismiss notification"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        {items.length > 0 && (
          <div className="px-4 py-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground text-center">
              Click to navigate · ✕ to dismiss
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============ Global search (§42) ============
type SearchResults = {
  groups: { label: string; view: string; items: { id: string; title: string; subtitle?: string }[] }[];
};

function GlobalSearch() {
  const { navigate } = useHashRoute();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`);
        setResults(data);
      } catch { setResults(null); } finally { setLoading(false); }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const go = (view: string, entityId?: string) => {
    setOpen(false);
    setQ("");
    setResults(null);
    // Navigate to the view, appending the entity id as a sub-hash so views can auto-open the detail
    if (entityId) {
      navigate(`${view}?entity=${entityId}`);
    } else {
      navigate(view);
    }
  };

  const total = results?.groups.reduce((a, g) => a + g.items.length, 0) ?? 0;

  return (
    <Popover open={open && q.trim().length >= 2} onOpenChange={setOpen}>
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { if (q.trim().length >= 2) setOpen(true); }}
          placeholder="Search… (Ctrl+K)"
          className="pl-9 pr-14 h-9 bg-secondary/50 border-border/70"
          aria-label="Global search"
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground/50 font-mono pointer-events-none">
          Ctrl K
        </kbd>
      </div>
      <PopoverContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
        className="w-[--radix-popover-trigger-width] min-w-[420px] p-0 max-h-[420px] overflow-y-auto apex-scroll"
      >
        {loading && <p className="text-sm text-muted-foreground text-center py-6">Searching…</p>}
        {!loading && results && total === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No results for &ldquo;{q}&rdquo;.</p>
        )}
        {!loading && results && total > 0 && (
          <div className="py-1">
            {results.groups.map((g) => (
              <div key={g.label}>
                <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</p>
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => go(g.view, it.id)}
                    className="w-full text-left px-4 py-2 hover:bg-accent transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{it.title}</p>
                      {it.subtitle && <p className="text-xs text-muted-foreground truncate">{it.subtitle}</p>}
                    </div>
                    <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-2 border-t border-border/60 flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">{total} result{total === 1 ? "" : "s"} — click to open detail</p>
          <kbd className="text-[10px] text-muted-foreground/50 font-mono">Esc to close</kbd>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============ Theme toggle ============
function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-9 h-9" />;
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
    </Button>
  );
}

// ============ Keyboard shortcuts modal ============
const SHORTCUTS = [
  { keys: ["Ctrl", "K"], description: "Open global search" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
  { keys: ["Esc"], description: "Close any panel or modal" },
  { keys: ["G", "D"], description: "Go to Dashboard" },
  { keys: ["G", "L"], description: "Go to Leads" },
  { keys: ["G", "P"], description: "Go to Pipeline" },
  { keys: ["G", "C"], description: "Go to Clients" },
  { keys: ["G", "J"], description: "Go to Projects" },
  { keys: ["G", "T"], description: "Go to Tasks" },
  { keys: ["G", "I"], description: "Go to Invoices" },
  { keys: ["G", "K"], description: "Go to Tickets" },
  { keys: ["G", "R"], description: "Go to Reports" },
];

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" /> Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 py-1">
          {SHORTCUTS.map((s) => (
            <div key={s.description} className="flex items-center justify-between gap-4 py-2 border-b border-border/60 last:border-0">
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <div className="flex items-center gap-1 shrink-0">
                {s.keys.map((k, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-[10px] text-muted-foreground/60">then</span>}
                    <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border text-[11px] font-mono font-semibold min-w-[24px] text-center">
                      {k}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground text-center pt-1">
          Navigation shortcuts work from any view — no modifier key needed.
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ============ Shell ============
export function AppShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const { path, navigate } = useHashRoute();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [badgeCounts, setBadgeCounts] = useState({ followups: 0, tickets: 0 });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const user = session?.user;
  const isPortalUser = !!user?.roleKeys?.includes("CLIENT");
  const perms = user?.permissions || [];

  // ── Global keyboard shortcuts ──────────────────────────────────────
  // ? → shortcuts panel | G+D → dashboard | G+L → leads | etc.
  useEffect(() => {
    if (isPortalUser) return;
    let gPressed = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const GO_MAP: Record<string, string> = {
      d: "dashboard", l: "crm/leads", p: "crm/pipeline",
      c: "crm/clients", j: "projects", t: "tasks",
      i: "finance/invoices", k: "support/tickets", r: "reports",
    };

    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs / textareas / contenteditable
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "?") { setShortcutsOpen((o) => !o); return; }

      if (e.key.toLowerCase() === "g" && !gPressed) {
        gPressed = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPressed = false; }, 1200);
        return;
      }

      if (gPressed) {
        const dest = GO_MAP[e.key.toLowerCase()];
        if (dest) { navigate(dest); gPressed = false; if (gTimer) clearTimeout(gTimer); }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); if (gTimer) clearTimeout(gTimer); };
  }, [navigate, isPortalUser]);

  // Fetch sidebar badge counts (overdue follow-ups + open tickets) every 2 minutes
  useEffect(() => {
    if (!session || isPortalUser) return;
    const fetchBadges = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [fu, tk] = await Promise.allSettled([
          perms.includes("followups.view")
            ? api.get<{ total: number }>(`/api/followups?status=PENDING&to=${today}&pageSize=1`)
            : Promise.resolve(null),
          perms.includes("tickets.view")
            ? api.get<{ summary: { byStatus: { status: string; count: number }[] } }>("/api/tickets?pageSize=1")
            : Promise.resolve(null),
        ]);
        const overdueFollowups = fu.status === "fulfilled" && fu.value ? (fu.value.total ?? 0) : 0;
        const openTickets = tk.status === "fulfilled" && tk.value
          ? (tk.value.summary?.byStatus ?? [])
              .filter((s: { status: string }) => ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"].includes(s.status))
              .reduce((a: number, s: { count: number }) => a + s.count, 0)
          : 0;
        setBadgeCounts({ followups: overdueFollowups, tickets: openTickets });
      } catch { /* silent */ }
    };
    fetchBadges();
    const interval = setInterval(fetchBadges, 120000);
    return () => clearInterval(interval);
  }, [session, isPortalUser]);

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200 shrink-0 sticky top-0 h-screen",
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div className={cn("h-16 flex items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-2")}>
          <ApexLogo withText={!collapsed} />
        </div>
        <SidebarNav path={path} navigate={navigate} collapsed={collapsed} badgeCounts={badgeCounts} />
        <div className="p-2 border-t border-sidebar-border">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft className={cn("w-4 h-4 transition-transform", collapsed && "rotate-180")} />
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-[270px] bg-sidebar border-sidebar-border">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="h-16 flex items-center border-b border-sidebar-border px-4">
            <ApexLogo />
          </div>
          <SidebarNav path={path} navigate={navigate} collapsed={false} onNavigate={() => setMobileOpen(false)} badgeCounts={badgeCounts} />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 sticky top-0 z-30 flex items-center gap-3 px-4 md:px-6 bg-background/85 backdrop-blur border-b border-border">
          <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="hidden md:flex flex-1 justify-center">
            {!isPortalUser && <GlobalSearch />}
          </div>
          <div className="flex-1 md:hidden" />
          <div className="flex items-center gap-1">
            {isPortalUser && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-primary/40 bg-primary/10 text-[10px] font-bold tracking-[0.14em] text-primary mr-1">
                <Home className="w-3 h-3" /> CLIENT PORTAL
              </span>
            )}
            {/* Theme toggle */}
            <ThemeToggle />
            {/* Keyboard shortcuts button (internal users only) */}
            {!isPortalUser && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 hidden sm:flex"
                aria-label="Keyboard shortcuts"
                onClick={() => setShortcutsOpen(true)}
              >
                <Keyboard className="w-[18px] h-[18px]" />
              </Button>
            )}
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2.5 rounded-lg pl-1.5 pr-2.5 py-1.5 hover:bg-accent transition-colors"
                  aria-label="Account menu"
                >
                  <Avatar className="w-8 h-8">
                    <AvatarFallback
                      style={{ backgroundColor: `${user?.avatarColor || "#22d3ee"}22`, color: user?.avatarColor || "#22d3ee" }}
                      className="text-xs font-bold border border-current/30"
                    >
                      {(user?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:block text-left leading-tight">
                    <p className="text-[13px] font-medium">{user?.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {isPortalUser ? "Client Portal" : (user?.roleKeys?.[0]?.replace(/_/g, " ") || "Member")}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p>{user?.name}</p>
                  <p className="text-xs font-normal text-muted-foreground">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {user?.title || "APEX Team Member"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {!isPortalUser && (
                  <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
                    <Keyboard className="w-4 h-4 mr-2" /> Keyboard shortcuts
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-rose-300 focus:text-rose-300"
                >
                  <LogOut className="w-4 h-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Mobile search bar */}
        {!isPortalUser && (
          <div className="md:hidden px-4 pt-3">
            <GlobalSearch />
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 pb-10">{children}</main>

        {/* Footer */}
        <footer className="mt-auto border-t border-border px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          {isPortalUser ? (
            <p><span className="text-foreground/80 font-semibold tracking-wider">APEX</span> Client Portal — your projects, invoices and support in one place</p>
          ) : (
            <p><span className="text-foreground/80 font-semibold tracking-wider">APEX</span> SYSTEM — Internal Business Operating System</p>
          )}
          <div className="flex items-center gap-3">
            <p>One System. One Workflow.</p>
            {!isPortalUser && (
              <button
                onClick={() => setShortcutsOpen(true)}
                className="hidden sm:flex items-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="w-3 h-3" />
                <span className="text-[10px]">?</span>
              </button>
            )}
          </div>
        </footer>
      </div>

      {/* Keyboard shortcuts modal */}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
