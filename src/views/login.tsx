"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApexLogo } from "@/components/shell/app-shell";
import { Loader2, ShieldCheck } from "lucide-react";

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password. Please check your credentials and try again.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* subtle grid backdrop */}
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(122,152,199,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(122,152,199,0.06) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <ApexLogo size={52} withText={false} />
          <h1 className="mt-4 text-2xl font-bold tracking-[0.2em]">APEX SYSTEM</h1>
          <p className="text-sm text-muted-foreground mt-1.5 text-center">Run APEX. One System. One Workflow.</p>
        </div>

        <form onSubmit={submit} className="apex-panel p-6 space-y-4 apex-glow">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@apex.system"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 bg-secondary/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 bg-secondary/40"
            />
          </div>

          {error && (
            <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={loading} className="w-full h-10 font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            Sign in
          </Button>

          <p className="text-[11px] text-muted-foreground text-center pt-1">
            Internal system — authorized APEX team members only.
          </p>
        </form>
      </div>
    </div>
  );
}
