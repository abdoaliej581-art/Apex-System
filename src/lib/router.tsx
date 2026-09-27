"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Hash-based SPA router (sandbox exposes a single route `/`).
 * `#/crm/leads` → path "crm/leads"
 * `#/crm/leads?entity=abc123` → path "crm/leads", entityId "abc123"
 */
export function normalizePath(hash: string): string {
  // Strip query part before normalising the path
  const withoutQuery = hash.split("?")[0];
  const p = withoutQuery.replace(/^#\/?/, "").replace(/\/+$/, "").trim();
  return p || "dashboard";
}

function extractEntityId(hash: string): string | null {
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return null;
  const sp = new URLSearchParams(hash.slice(qIdx + 1));
  return sp.get("entity") ?? null;
}

export function useHashRoute() {
  const [path, setPath] = useState<string>("dashboard");
  const [entityId, setEntityId] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      setPath(normalizePath(window.location.hash));
      setEntityId(extractEntityId(window.location.hash));
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const navigate = useCallback((to: string) => {
    // `to` may include a ?entity= query: "crm/leads?entity=abc123"
    const toPath = normalizePath(`#/${to}`);
    const curPath = normalizePath(window.location.hash);
    const target = `#/${to.replace(/^\/+/, "")}`;
    // Only skip if path AND full query are identical
    if (curPath === toPath && window.location.hash === target) return;
    window.location.hash = target;
  }, []);

  return { path, navigate, entityId };
}
