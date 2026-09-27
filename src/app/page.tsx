"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { useEffect } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { useHashRoute } from "@/lib/router";
import { LoginView } from "@/views/login";
import { VIEW_REGISTRY } from "@/views/registry";
import { EmptyState } from "@/components/shared";
import { ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav-config";

/** Hash path → required permission (single source of truth: nav config). */
const REQUIRED_PERMISSIONS: Record<string, string> = {};
NAV_GROUPS.forEach((g) => g.items.forEach((i) => { REQUIRED_PERMISSIONS[i.key] = i.permission; }));

function AppContent() {
  const { data: session, status } = useSession();
  const { path, navigate } = useHashRoute();

  // Smart landing (§72): the hash router defaults to "dashboard". A CLIENT portal
  // account has no dashboard.view, so on login they would hit the NoAccess panel.
  // Instead, route them to the first nav item their permissions allow (→ portal).
  // Deep links to restricted views still show the NoAccess panel deliberately.
  useEffect(() => {
    if (status !== "authenticated" || !session) return;
    const required = REQUIRED_PERMISSIONS[path];
    const perms = session.user.permissions || [];
    if (path === "dashboard" && required && !perms.includes(required)) {
      const first = NAV_GROUPS.flatMap((g) => g.items).find((i) => perms.includes(i.permission));
      if (first) navigate(first.key);
    }
  }, [session, status, path, navigate]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground tracking-widest">APEX SYSTEM</p>
        </div>
      </div>
    );
  }

  if (!session) return <LoginView />;

  const View = VIEW_REGISTRY[path];
  const required = REQUIRED_PERMISSIONS[path];
  const permitted = !required || (session.user.permissions || []).includes(required);

  return (
    <AppShell>
      {View && !permitted ? (
        <EmptyState
          icon={<ShieldOff className="w-5 h-5" />}
          title="You do not have access to this page"
          description={`Your role does not include the “${required}” permission. If you believe this is a mistake, ask an administrator to update your role.`}
          action={<Button variant="outline" onClick={() => navigate("dashboard")}>Back to Dashboard</Button>}
        />
      ) : View ? (
        <View navigate={navigate} />
      ) : (
        <EmptyState
          icon={<ShieldAlert className="w-5 h-5" />}
          title="Page not found"
          description={`No view is registered for “${path}”.`}
          action={<Button variant="outline" onClick={() => navigate("dashboard")}>Back to Dashboard</Button>}
        />
      )}
    </AppShell>
  );
}

export default function Page() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
}
