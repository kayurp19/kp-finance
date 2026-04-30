import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Mail, KeyRound, Bell, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type SettingsResp = {
  dailyDigest: boolean;
  weeklyDigest: boolean;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const settingsQ = useQuery<SettingsResp>({ queryKey: ["/api/settings"] });

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const pwMut = useMutation({
    mutationFn: async () => {
      if (next !== confirm) throw new Error("New passwords don't match");
      if (next.length < 6) throw new Error("New password must be at least 6 characters");
      return apiRequest("POST", "/api/change-password", { current, next });
    },
    onSuccess: () => {
      toast({ title: "Password updated" });
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't update password",
        description: e?.message ?? "Try again",
        variant: "destructive",
      }),
  });

  const digestMut = useMutation({
    mutationFn: async (data: { dailyDigest?: boolean; weeklyDigest?: boolean }) =>
      apiRequest("POST", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Account, notifications, and email setup.
        </p>
      </div>

      <Card data-testid="card-password">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Change password
          </CardTitle>
          <CardDescription>
            Used to log in to KP Finance. Minimum 6 characters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-pw">Current password</Label>
            <Input
              id="current-pw"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              data-testid="input-current-password"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="next-pw">New password</Label>
              <Input
                id="next-pw"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm new</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
          </div>
          <div className="pt-1">
            <Button
              onClick={() => pwMut.mutate()}
              disabled={
                !current || !next || !confirm || pwMut.isPending
              }
              data-testid="button-save-password"
            >
              {pwMut.isPending ? "Saving…" : "Update password"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-notifications">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Email digests
          </CardTitle>
          <CardDescription>
            Get a recap delivered to {`kayur@sundhm.com`}. Requires SMTP setup
            below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Daily digest</div>
              <div className="text-xs text-muted-foreground">
                Yesterday's transactions, bills due, business owed.
              </div>
            </div>
            <Switch
              checked={settingsQ.data?.dailyDigest ?? false}
              onCheckedChange={(v) => digestMut.mutate({ dailyDigest: v })}
              data-testid="switch-daily-digest"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Weekly digest</div>
              <div className="text-xs text-muted-foreground">
                Spending breakdown, top categories, upcoming bills.
              </div>
            </div>
            <Switch
              checked={settingsQ.data?.weeklyDigest ?? false}
              onCheckedChange={(v) => digestMut.mutate({ weeklyDigest: v })}
              data-testid="switch-weekly-digest"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-smtp">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Email delivery (SMTP)
          </CardTitle>
          <CardDescription>
            Required for digest delivery. Configure via environment variables on
            Railway.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Setup pending</AlertTitle>
            <AlertDescription className="space-y-1.5 mt-2 text-xs">
              <p>
                Set the following on your Railway service to enable transactional
                email:
              </p>
              <ul className="list-disc pl-5 space-y-0.5 font-mono">
                <li>SMTP_HOST</li>
                <li>SMTP_PORT</li>
                <li>SMTP_USER</li>
                <li>SMTP_PASS</li>
                <li>SMTP_FROM (e.g., KP Finance &lt;kp@sundhm.com&gt;)</li>
              </ul>
              <p className="pt-1">
                A worker will run the digest send on a daily cron.
              </p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card data-testid="card-about">
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>App</span>
            <span className="text-foreground">KP Finance</span>
          </div>
          <div className="flex justify-between">
            <span>Owner</span>
            <span className="text-foreground">kayur@sundhm.com</span>
          </div>
          <div className="flex justify-between">
            <span>Version</span>
            <span className="text-foreground font-mono">1.0.0</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
