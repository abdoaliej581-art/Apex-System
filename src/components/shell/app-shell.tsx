"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Bell, ChevronLeft, Home, Link2, LogOut, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
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
function SidebarNav({ path, navigate, collapsed, onNavigate }: {
  path: string; navigate: (p: string) => void; collapsed: boolean; onNavigate?: () => void;
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
                  <Icon className={cn("w-4 h-4 shrink-0", active && "text-primary")} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
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

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: NotificationItem[]; unread: number }>("/api/notifications");
      setItems(data.items);
    } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(t);
  }, [open]);

  const unread = items.filter((i) => !i.isRead).length;

  const markAll = async () => {
    try {
      await api.put("/api/notifications", { markAllRead: true });
      setItems((prev) => prev.map((i) => ({ ...i, isRead: true })));
    } catch { /* silent */ }
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
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={markAll}>Mark all read</Button>
          )}
        </div>
        <ScrollArea className="h-[320px]">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className={cn("px-4 py-3 border-b border-border/60", !n.isRead && "bg-primary/5")}>
                <div className="flex items-start gap-2.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", n.isRead ? "bg-muted-foreground/40" : "bg-cyan-400")} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[11px] text-muted-foreground/70 mt-1">{relativeTime(n.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const go = (view: string) => {
    setOpen(false);
    setQ("");
    setResults(null);
    navigate(view);
  };

  const total = results?.groups.reduce((a, g) => a + g.items.length, 0) ?? 0;

  return (
    <Popover open={open && q.trim().length >= 2} onOpenChange={(o) => { setOpen(o); if (!o) { /* keep query */ } }}>
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search leads, clients, projects, invoices…"
          className="pl-9 h-9 bg-secondary/50 border-border/70"
          aria-label="Global search"
        />
      </div>
      <PopoverContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
        className="w-[--radix-popover-trigger-width] min-w-[420px] p-0 max-h-[420px] overflow-y-auto apex-scroll"
      >
        {loading && <p className="text-sm text-muted-foreground text-center py-6">Searching…</p>}
        {!loading && results && total === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No results for “{q}”.</p>
        )}
        {!loading && results && total > 0 && (
          <div className="py-1">
            {results.groups.map((g) => (
              <div key={g.label}>
                <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{g.label}</p>
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    onClick={() => go(g.view)}
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
      </PopoverContent>
    </Popover>
  );
}

// ============ Shell ============
export function AppShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const { path, navigate } = useHashRoute();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = session?.user;
  const isPortalUser = !!user?.roleKeys?.includes("CLIENT");

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
        <SidebarNav path={path} navigate={navigate} collapsed={collapsed} />
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
          <SidebarNav path={path} navigate={navigate} collapsed={false} onNavigate={() => setMobileOpen(false)} />
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
          <div className="flex items-center gap-1.5">
            {isPortalUser && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-primary/40 bg-primary/10 text-[10px] font-bold tracking-[0.14em] text-primary">
                <Home className="w-3 h-3" /> CLIENT PORTAL
              </span>
            )}
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-lg pl-1.5 pr-2.5 py-1.5 hover:bg-accent transition-colors" aria-label="Account menu">
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
                    <p className="text-[10px] text-muted-foreground">{isPortalUser ? "Client Portal" : user?.roleKeys?.[0]?.replace(/_/g, " ") || "Member"}</p>
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
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })} className="text-rose-300 focus:text-rose-300">
                  <LogOut className="w-4 h-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Mobile search (hidden for portal users — internal modules are out of scope) */}
        {!isPortalUser && (
          <div className="md:hidden px-4 pt-3">
            <GlobalSearch />
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 pb-10">{children}</main>

        {/* Sticky footer (never floats) */}
        <footer className="mt-auto border-t border-border px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          {isPortalUser ? (
            <p><span className="text-foreground/80 font-semibold tracking-wider">APEX</span> Client Portal — your projects, invoices and support in one place</p>
          ) : (
            <p><span className="text-foreground/80 font-semibold tracking-wider">APEX</span> SYSTEM — Internal Business Operating System</p>
          )}
          <p>One System. One Workflow.</p>
        </footer>
      </div>
    </div>
  );
}
