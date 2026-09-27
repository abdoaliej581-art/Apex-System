"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Hash-based SPA router (sandbox exposes a single route `/`).
 * `#/crm/leads` → path "crm/leads"
 */
export function normalizePath(hash: string): string {
  const p = hash.replace(/^#\/?/, "").replace(/\/+$/, "").trim();
  return p || "dashboard";
}

export function useHashRoute() {
  const [path, setPath] = useState<string>("dashboard");

  useEffect(() => {
    const update = () => setPath(normalizePath(window.location.hash));
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const navigate = useCallback((to: string) => {
    const target = `#/${to.replace(/^\/+/, "")}`;
    if (normalizePath(window.location.hash) === normalizePath(target)) return;
    window.location.hash = target;
  }, []);

  return { path, navigate };
}
