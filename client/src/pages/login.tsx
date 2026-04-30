import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { useLocation } from "wouter";

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const ok = await login(password);
    setSubmitting(false);
    if (!ok) setError("Wrong password. Try again.");
    else setLocation("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo className="h-10 w-10 text-primary mb-3" />
          <h1 className="text-xl font-semibold">KP Finance</h1>
          <p className="text-sm text-muted-foreground mt-1">Personal money tracker</p>
        </div>
        <form onSubmit={submit} className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <div>
            <label className="text-[13px] font-medium block mb-2">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              data-testid="input-password"
              placeholder="Enter your password"
            />
          </div>
          {error && (
            <div className="text-[13px] text-destructive" data-testid="text-login-error">{error}</div>
          )}
          <Button type="submit" disabled={submitting} className="w-full" data-testid="button-login">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-[11px] text-muted-foreground text-center mt-6">
          Private account · session expires in 30 days
        </p>
      </div>
    </div>
  );
}
