"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApexLogo } from "@/components/shell/app-shell";
import { Loader2, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import { api } from "@/lib/api-client";

/** Shared chrome so all three screens look identical. */
function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
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
        {children}
      </div>
    </div>
  );
}

/** "Forgot your password?" — request a reset link. */
function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", { email: email.trim().toLowerCase() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame>
      <div className="apex-panel p-6 space-y-4 apex-glow">
        <div className="flex items-center gap-2.5">
          <KeyRound className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Reset your password</h2>
        </div>

        {sent ? (
          <div className="space-y-4">
            <Alert className="border-emerald-500/30 bg-emerald-500/8">
              <AlertDescription className="text-emerald-200 text-sm">
                If an account exists for that email, a reset link is on its way. The link expires in
                1&nbsp;hour and can be used once.
              </AlertDescription>
            </Alert>
            <Button type="button" variant="outline" className="w-full" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@apex.system"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send reset link
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to sign in
            </Button>
          </form>
        )}
      </div>
    </AuthFrame>
  );
}

/** Redeem a reset token: /#/reset-password?token=… */
function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { token, password });
      setDone(true);
      setTimeout(() => router.refresh(), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const strength = (() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();

  return (
    <AuthFrame>
      <div className="apex-panel p-6 space-y-4 apex-glow">
        <div className="flex items-center gap-2.5">
          <KeyRound className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Choose a new password</h2>
        </div>

        {done ? (
          <Alert className="border-emerald-500/30 bg-emerald-500/8">
            <AlertDescription className="text-emerald-200 text-sm">
              Password updated. Taking you to sign in…
            </AlertDescription>
          </Alert>
        ) : !token ? (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription className="text-sm">
                This reset link is incomplete. Please request a new one.
              </AlertDescription>
            </Alert>
            <Button type="button" variant="outline" className="w-full" onClick={() => router.refresh()}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {password.length > 0 && (
                <div className="flex gap-1 pt-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="h-1 flex-1 rounded-full transition-colors"
                      style={{
                        backgroundColor:
                          i < strength
                            ? strength <= 2 ? "#f87171" : strength <= 3 ? "#fbbf24" : "#34d399"
                            : "rgba(148,163,184,0.2)",
                      }}
                    />
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground pt-0.5">
                At least 8 characters with upper case, lower case and a number.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update password
            </Button>
          </form>
        )}
      </div>
    </AuthFrame>
  );
}

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "reset">("signin");

  // A reset link arrives as /#/reset-password?token=…
  const [token] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const m = window.location.hash.match(/token=([a-f0-9]{64})/);
    if (m) return m[1];
    const u = new URLSearchParams(window.location.search).get("token");
    return u && /^[a-f0-9]{64}$/.test(u) ? u : "";
  });

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

  if (mode === "forgot") return <ForgotPasswordForm onBack={() => setMode("signin")} />;
  if (mode === "reset" || token) return <ResetPasswordForm token={token} />;

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

          <button
            type="button"
            onClick={() => setMode("forgot")}
            className="w-full text-center text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Forgot your password?
          </button>

          <p className="text-[11px] text-muted-foreground text-center pt-1">
            Internal system — authorized APEX team members only.
          </p>
        </form>
      </div>
    </div>
  );
}
