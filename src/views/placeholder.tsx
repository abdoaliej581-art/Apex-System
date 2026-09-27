"use client";

import { PageHeader, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Hammer, LayoutDashboard } from "lucide-react";

export function PlaceholderView({
  module, phase, description, navigate,
}: { module: string; phase: string; description: string; navigate: (p: string) => void }) {
  return (
    <div>
      <PageHeader title={module} description={description} />
      <EmptyState
        icon={<Hammer className="w-5 h-5" />}
        title={`${module} module is under active development`}
        description={`This module belongs to ${phase} of the APEX SYSTEM roadmap and is being built module-by-module on top of the same database and permission foundation. No fake data is ever shown (§54).`}
        action={
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-cyan-300 border-cyan-500/30 bg-cyan-500/10">{phase}</Badge>
            <Button variant="outline" onClick={() => navigate("dashboard")}>
              <LayoutDashboard className="w-4 h-4 mr-2" /> Back to Dashboard
            </Button>
          </div>
        }
      />
    </div>
  );
}
