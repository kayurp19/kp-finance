import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Landmark, RefreshCw, AlertTriangle, CheckCircle2, Trash2, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Money } from "@/components/Money";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Account } from "@shared/schema";

type SfAccount = {
  id: number;
  name: string;
  orgName: string | null;
  balance: number | null;
  balanceDate: string | null;
  mappedAccountId: number | null;
  mappedAccountName: string | null;
  suggestedAccountId: number | null;
  ignored: boolean;
  stale: boolean;
};
type SfStatus = {
  lastSyncAll: string | null;
  connections: {
    id: number;
    label: string;
    createdAt: string;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    errors: string[];
    accounts: SfAccount[];
  }[];
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ["/api/simplefin/status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
}

export function BankSyncCard() {
  const { toast } = useToast();
  const statusQ = useQuery<SfStatus>({ queryKey: ["/api/simplefin/status"] });
  const accountsQ = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("Kayur");
  const [showConnect, setShowConnect] = useState(false);

  const connectMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/simplefin/connect", { token, label })).json(),
    onSuccess: (r: any) => {
      setToken("");
      setShowConnect(false);
      invalidateAll();
      toast({ title: "Bank sync connected", description: `Found ${r.sync?.accountsSeen ?? 0} accounts. Confirm the matches below.` });
    },
    onError: (e: any) => toast({ title: "Couldn't connect", description: e.message, variant: "destructive" }),
  });

  const syncMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/simplefin/sync", {})).json(),
    onSuccess: (r: any) => {
      invalidateAll();
      const imported = (r.results || []).reduce((s: number, x: any) => s + x.imported, 0);
      const matched = (r.results || []).reduce((s: number, x: any) => s + x.matchedExisting, 0);
      toast({ title: "Sync complete", description: `${imported} new transactions${matched ? `, ${matched} matched to uploaded statements` : ""}.` });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const status = statusQ.data;
  const conns = status?.connections || [];
  const accounts = (accountsQ.data || []).filter((a) => !a.archived);

  return (
    <Card data-testid="card-bank-sync">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-muted-foreground" />
          Bank sync (SimpleFIN)
        </CardTitle>
        <CardDescription>
          Pulls balances and posted transactions from your banks once a day. Statement uploads still work; overlapping rows are matched, not doubled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {conns.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] text-muted-foreground">Last sync: {when(status?.lastSyncAll || null)}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowConnect((v) => !v)} data-testid="button-add-connection">
                <Plus className="h-4 w-4 mr-1" />Add connection
              </Button>
              <Button size="sm" onClick={() => syncMut.mutate()} disabled={syncMut.isPending} data-testid="button-sync-now">
                <RefreshCw className={`h-4 w-4 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`} />
                {syncMut.isPending ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          </div>
        )}

        {(conns.length === 0 || showConnect) && (
          <div className="rounded-md border border-dashed border-border p-4 space-y-3">
            <ol className="text-[13px] text-muted-foreground list-decimal pl-5 space-y-1">
              <li>In SimpleFIN Bridge, open My Account and click <span className="font-medium text-foreground">New app connection</span>.</li>
              <li>Name it "KP Finance" and copy the setup token.</li>
              <li>Paste it here. The token works once and is exchanged for a private access key stored only on this server.</li>
            </ol>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
              <div>
                <Label className="text-[12px]">Whose banks</Label>
                <Select value={label} onValueChange={setLabel}>
                  <SelectTrigger data-testid="select-connection-label"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Kayur">Kayur</SelectItem>
                    <SelectItem value="Wife">Wife</SelectItem>
                    <SelectItem value="Joint">Joint</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px]">Setup token</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste setup token"
                  data-testid="input-setup-token"
                />
              </div>
            </div>
            <Button onClick={() => connectMut.mutate()} disabled={!token.trim() || connectMut.isPending} data-testid="button-connect-simplefin">
              {connectMut.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}

        {conns.map((c) => (
          <ConnectionBlock key={c.id} conn={c} accounts={accounts} />
        ))}
      </CardContent>
    </Card>
  );
}

function ConnectionBlock({ conn, accounts }: { conn: SfStatus["connections"][number]; accounts: Account[] }) {
  const { toast } = useToast();
  const removeMut = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/simplefin/connections/${conn.id}`),
    onSuccess: () => { invalidateAll(); toast({ title: "Connection removed" }); },
  });
  const pending = conn.accounts.filter((a) => !a.mappedAccountId && !a.ignored);

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-sm font-medium">{conn.label}'s banks</div>
          <div className="text-[12px] text-muted-foreground">
            {conn.accounts.length} accounts · synced {when(conn.lastSyncAt)}
            {pending.length ? ` · ${pending.length} need a match` : ""}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { if (confirm("Remove this SimpleFIN connection? Imported transactions stay.")) removeMut.mutate(); }}
          data-testid={`button-remove-connection-${conn.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {conn.errors.length > 0 && (
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>A bank needs attention</AlertTitle>
          <AlertDescription className="text-[12px] space-y-1">
            {conn.errors.map((e, i) => <div key={i}>{e}</div>)}
            <div>Fix it at SimpleFIN Bridge (My Account → reconnect that bank), then click Sync now.</div>
          </AlertDescription>
        </Alert>
      )}
      <div className="divide-y divide-border">
        {conn.accounts.map((a) => (
          <SfAccountRow key={a.id} a={a} accounts={accounts} owner={conn.label} />
        ))}
      </div>
    </div>
  );
}

function SfAccountRow({ a, accounts, owner }: { a: SfAccount; accounts: Account[]; owner: string }) {
  const { toast } = useToast();
  const [choice, setChoice] = useState<string>(
    a.mappedAccountId ? String(a.mappedAccountId) : a.suggestedAccountId ? String(a.suggestedAccountId) : ""
  );
  const [newType, setNewType] = useState("checking");
  // Keep the picker in sync after the server changes the link (e.g. "Create as new").
  useEffect(() => {
    setChoice(a.mappedAccountId ? String(a.mappedAccountId) : a.suggestedAccountId ? String(a.suggestedAccountId) : "");
  }, [a.mappedAccountId, a.suggestedAccountId]);

  const mapMut = useMutation({
    mutationFn: async (body: any) => apiRequest("PATCH", `/api/simplefin/accounts/${a.id}`, body),
    onSuccess: () => { invalidateAll(); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const createMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/simplefin/accounts/${a.id}/create-account`, { type: newType, owner }),
    onSuccess: () => { invalidateAll(); toast({ title: "Account created and linked" }); },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const linked = !!a.mappedAccountId;
  const dirty = choice !== (a.mappedAccountId ? String(a.mappedAccountId) : "");

  return (
    <div className="px-4 py-3 space-y-2" data-testid={`sf-account-${a.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate">{a.name}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            {a.orgName}
            {linked && !a.stale && <Badge variant="secondary" className="h-5 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />Linked</Badge>}
            {a.stale && <Badge variant="destructive" className="h-5 text-[10px]">Not updated in 2+ days</Badge>}
            {a.ignored && <Badge variant="outline" className="h-5 text-[10px]">Ignored</Badge>}
          </div>
        </div>
        {a.balance !== null && <Money cents={a.balance} size="sm" className="shrink-0" />}
      </div>
      {!a.ignored && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={choice || "none"} onValueChange={(v) => setChoice(v === "none" ? "" : v)}>
            <SelectTrigger className="h-8 w-56 text-[12px]" data-testid={`select-map-${a.id}`}><SelectValue placeholder="Match to account" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not linked</SelectItem>
              {accounts.map((k) => (
                <SelectItem key={k.id} value={String(k.id)}>{k.name}{k.last4 ? ` ••${k.last4}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(dirty || (!linked && choice)) && (
            <Button size="sm" className="h-8" onClick={() => mapMut.mutate({ mappedAccountId: choice ? Number(choice) : null })} disabled={mapMut.isPending}>
              {mapMut.isPending ? "Linking…" : !linked && choice && !dirty ? "Confirm match" : "Save"}
            </Button>
          )}
          {!linked && !choice && !createMut.isSuccess && (
            <>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="h-8 w-32 text-[12px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                  <SelectItem value="credit_card">Credit card</SelectItem>
                  <SelectItem value="loan">Loan</SelectItem>
                  <SelectItem value="investment">Investment</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-8" onClick={() => createMut.mutate()} disabled={createMut.isPending || createMut.isSuccess}>
                {createMut.isPending ? "Creating…" : "Create as new"}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => mapMut.mutate({ ignored: true })}>Ignore</Button>
            </>
          )}
        </div>
      )}
      {a.ignored && (
        <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => mapMut.mutate({ ignored: false })}>Un-ignore</Button>
      )}
    </div>
  );
}

// Small dashboard banner when bank sync has errors or stale accounts.
export function BankSyncAlert() {
  const statusQ = useQuery<SfStatus>({ queryKey: ["/api/simplefin/status"] });
  const conns = statusQ.data?.connections || [];
  const errors = conns.flatMap((c) => c.errors);
  const stale = conns.flatMap((c) => c.accounts.filter((a) => a.mappedAccountId && a.stale));
  const unmatched = conns.flatMap((c) => c.accounts.filter((a) => !a.mappedAccountId && !a.ignored));
  if (!errors.length && !stale.length && !unmatched.length) return null;
  return (
    <a href="#/settings" className="block" data-testid="banner-bank-sync">
      <Alert className="border-amber-500/50">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle>Bank sync needs a look</AlertTitle>
        <AlertDescription className="text-[12px]">
          {errors.length ? `${errors.length} bank message${errors.length > 1 ? "s" : ""}. ` : ""}
          {stale.length ? `${stale.map((s) => s.mappedAccountName || s.name).join(", ")} not updated in 2+ days. ` : ""}
          {unmatched.length ? `${unmatched.length} account${unmatched.length > 1 ? "s" : ""} waiting to be matched. ` : ""}
          Open Settings.
        </AlertDescription>
      </Alert>
    </a>
  );
}
