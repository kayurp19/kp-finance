import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { dollarsToCents, formatDate, formatDateShort, formatCents, todayISO } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Bill, Account } from "@shared/schema";
import {
  Plus, Pencil, Trash2, CheckCircle2, AlertTriangle, CalendarPlus, Copy, Sparkles, CreditCard,
  Home, ChevronDown, ChevronUp, Zap, X, ListChecks,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const GROUPS = ["Housing", "Utilities", "Auto", "Insurance", "Cards & Loans", "Subscriptions", "Family", "Other"];
const FREQS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "semiannual", label: "Every 6 months" },
  { value: "annual", label: "Yearly" },
  { value: "one_time", label: "One time" },
];
const freqLabel = (f: string) => FREQS.find((x) => x.value === f)?.label || f;

type BillItem = Bill & {
  daysUntil: number;
  status: "overdue" | "due_today" | "due_soon" | "upcoming";
  monthly: number;
  accountName: string | null;
  payToAccountName: string | null;
  autoTracked: boolean;
  lastPayment: { date: string; amount: number; auto: boolean } | null;
};
type Overview = {
  today: string;
  items: BillItem[];
  totals: {
    monthlyFixed: number; houseMonthly: number; byGroup: Record<string, number>;
    overdueCount: number; overdueAmount: number; next7Count: number; next7Amount: number; next30Amount: number;
  };
  setup: { key: string; name: string; group: string; frequency: string; keyword: string; hint: string; variable?: boolean; added: boolean }[];
};
type Suggestions = {
  recurring: { key: string; name: string; frequency: string; avgAmount: number; minAmount: number; maxAmount: number; count: number; lastPaidDate: string; nextDueDate: string; accountId: number; accountName: string; group: string; variable: boolean }[];
  cards: { id: number; name: string; type: string; balance: number; lastPayment: { date: string; amount: number } | null }[];
};
type Draft = Partial<Bill> & { name?: string };

function invalidate() {
  for (const k of ["/api/bills/overview", "/api/bills/suggestions", "/api/bills", "/api/dashboard", "/api/bills/upcoming", "/api/plan"]) {
    queryClient.invalidateQueries({ queryKey: [k] });
  }
}

export default function BillsPage() {
  const ov = useQuery<Overview>({ queryKey: ["/api/bills/overview"] });
  const sugg = useQuery<Suggestions>({ queryKey: ["/api/bills/suggestions"] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSetup, setShowSetup] = useState<boolean | null>(null);

  const items = ov.data?.items || [];
  const setupOpen = showSetup ?? items.length < 8;

  const grouped = useMemo(() => {
    const m = new Map<string, BillItem[]>();
    for (const b of items) {
      const g = GROUPS.includes(b.billGroup) ? b.billGroup : "Other";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(b);
    }
    return GROUPS.filter((g) => m.has(g)).map((g) => ({ group: g, bills: m.get(g)!, monthly: m.get(g)!.reduce((s, b) => s + b.monthly, 0) }));
  }, [items]);

  const overdue = items.filter((b) => b.status === "overdue");
  const t = ov.data?.totals;

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Bills</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Every bill in one place. Paid bills check themselves off when the payment shows up at your bank.</p>
        </div>
        <Button onClick={() => setDraft({ frequency: "monthly", billGroup: "Other" })} data-testid="button-add-bill"><Plus className="h-4 w-4 mr-1" />Add bill</Button>
      </div>

      {ov.isLoading ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Bills per month" value={t?.monthlyFixed || 0} note={`${items.length} bills tracked`} />
          <Stat label="House cost per month" value={t?.houseMonthly || 0} note="Housing + utilities" icon={<Home className="h-3.5 w-3.5" />} />
          <Stat label="Due next 7 days" value={t?.next7Amount || 0} note={`${t?.next7Count || 0} bills`} tone={t?.next7Count ? "warn" : undefined} />
          <Stat label="Overdue" value={t?.overdueAmount || 0} note={`${t?.overdueCount || 0} bills`} tone={t?.overdueCount ? "bad" : "good"} />
        </div>
      )}

      {overdue.length > 0 && (
        <Card className="p-4 border-destructive/50" data-testid="card-overdue">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[14px]">Past due and no payment seen yet</div>
              <p className="text-[12px] text-muted-foreground mb-2">If you already paid, tap Mark paid. Otherwise pay it today to avoid late fees.</p>
              <div className="space-y-1.5">
                {overdue.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate"><span className="font-medium">{b.name}</span> · was due {formatDateShort(b.nextDueDate)} ({Math.abs(b.daysUntil)}d ago)</span>
                    <span className="flex items-center gap-2 shrink-0"><Money cents={b.amount} abs size="sm" /><PayButton bill={b} /></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden" data-testid="card-setup">
        <button className="w-full flex items-center justify-between px-5 py-4 hover-elevate" onClick={() => setShowSetup(!setupOpen)}>
          <div className="flex items-center gap-2 text-left">
            <ListChecks className="h-4 w-4 text-primary" />
            <div>
              <div className="font-medium text-[14px]">Get every bill in here</div>
              <div className="text-[12px] text-muted-foreground">Bills found in your bank activity, card due dates, and a checklist of common home bills</div>
            </div>
          </div>
          {setupOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {setupOpen && (
          <div className="border-t border-border divide-y divide-border">
            <FoundInBank sugg={sugg.data} onAdd={setDraft} />
            <CardDueDates sugg={sugg.data} onAdd={setDraft} />
            <Checklist setup={ov.data?.setup || []} onAdd={setDraft} accounts={accounts} />
          </div>
        )}
      </Card>

      <CalendarCard />

      {ov.isLoading ? (
        <Skeleton className="h-40" />
      ) : !items.length ? (
        <Card className="py-12 px-6 text-center text-[13px] text-muted-foreground">
          No bills yet. Start with the suggestions above, or tap Add bill.
        </Card>
      ) : (
        grouped.map((g) => (
          <div key={g.group}>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</h2>
              <span className="text-[12px] text-muted-foreground">{formatCents(g.monthly, { abs: true })}/mo</span>
            </div>
            <Card className="divide-y divide-border">
              {g.bills.map((b) => <BillRow key={b.id} bill={b} onEdit={() => setDraft(b)} />)}
            </Card>
          </div>
        ))
      )}

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        {draft && <BillFormDialog draft={draft} accounts={accounts} onClose={() => setDraft(null)} />}
      </Dialog>
    </div>
  );
}

function Stat({ label, value, note, tone, icon }: { label: string; value: number; note: string; tone?: "good" | "warn" | "bad"; icon?: React.ReactNode }) {
  const color = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "";
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-semibold mt-1 tabular-nums ${color}`}>{formatCents(value, { abs: true })}</div>
      <div className="text-[11px] text-muted-foreground">{note}</div>
    </Card>
  );
}

function PayButton({ bill }: { bill: BillItem }) {
  const { toast } = useToast();
  const pay = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/bills/${bill.id}/pay`, { paidDate: todayISO() }),
    onSuccess: () => { invalidate(); toast({ title: `${bill.name} marked paid` }); },
  });
  return (
    <Button variant="outline" size="sm" className="h-7" onClick={() => pay.mutate()} disabled={pay.isPending} data-testid={`button-pay-${bill.id}`}>
      <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Mark paid</span>
    </Button>
  );
}

function StatusPill({ b }: { b: BillItem }) {
  if (b.status === "overdue") return <Badge variant="destructive" className="h-5 text-[10px]">Overdue {Math.abs(b.daysUntil)}d</Badge>;
  if (b.status === "due_today") return <Badge className="h-5 text-[10px] bg-warning text-black">Due today</Badge>;
  if (b.status === "due_soon") return <Badge className="h-5 text-[10px] bg-warning/20 text-warning border-0">In {b.daysUntil}d</Badge>;
  return <span className="text-[11px] text-muted-foreground">in {b.daysUntil}d</span>;
}

function BillRow({ bill, onEdit }: { bill: BillItem; onEdit: () => void }) {
  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/bills/${bill.id}`),
    onSuccess: invalidate,
  });
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5" data-testid={`bill-${bill.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[14px]">{bill.name}</span>
          <StatusPill b={bill} />
          {bill.autopay && <Badge variant="secondary" className="h-5 text-[10px]">Autopay</Badge>}
          {bill.autoTracked && <span title="Checks itself off when the payment shows up at your bank"><Zap className="h-3.5 w-3.5 text-primary" /></span>}
        </div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          Due {formatDate(bill.nextDueDate)} · {freqLabel(bill.frequency)}
          {bill.payToAccountName ? ` · pays ${bill.payToAccountName}` : bill.accountName ? ` · from ${bill.accountName}` : ""}
          {bill.lastPayment ? ` · last paid ${formatDateShort(bill.lastPayment.date)}${bill.lastPayment.auto ? " (seen at bank)" : ""}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <div className="text-right">
          <div className="text-[14px] font-medium tabular-nums">{bill.variableAmount ? "~" : ""}{formatCents(bill.amount, { abs: true })}</div>
          {bill.frequency !== "monthly" && bill.frequency !== "one_time" && <div className="text-[10px] text-muted-foreground">{formatCents(bill.monthly, { abs: true })}/mo</div>}
        </div>
        <div><PayButton bill={bill} /></div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} data-testid={`button-edit-bill-${bill.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:inline-flex" onClick={() => { if (confirm(`Delete ${bill.name}?`)) del.mutate(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function FoundInBank({ sugg, onAdd }: { sugg?: Suggestions; onAdd: (d: Draft) => void }) {
  const dismiss = useMutation({
    mutationFn: async (key: string) => apiRequest("POST", "/api/bills/suggestions/dismiss", { key }),
    onSuccess: invalidate,
  });
  const list = sugg?.recurring || [];
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-1"><Sparkles className="h-4 w-4 text-primary" /><span className="font-medium text-[13px]">Repeating charges found in your bank activity</span></div>
      <p className="text-[12px] text-muted-foreground mb-3">These come out regularly. Add the real bills; tap the X on anything that isn't one.</p>
      {!sugg ? <Skeleton className="h-16" /> : !list.length ? (
        <div className="text-[12px] text-muted-foreground">Nothing new found. As more bank activity syncs, more will show up here.</div>
      ) : (
        <div className="space-y-1.5">
          {list.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">{s.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {freqLabel(s.frequency)} · {s.variable ? `${formatCents(s.minAmount, { abs: true })}–${formatCents(s.maxAmount, { abs: true })}` : formatCents(s.avgAmount, { abs: true })} · {s.count} times · last {formatDateShort(s.lastPaidDate)} · {s.accountName}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="outline" className="h-7" onClick={() => onAdd({
                  name: s.name, amount: s.avgAmount, frequency: s.frequency, nextDueDate: s.nextDueDate, billGroup: s.group,
                  variableAmount: s.variable, matchKeyword: s.key, accountId: s.accountId,
                })}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Not a bill" onClick={() => dismiss.mutate(s.key)}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CardDueDates({ sugg, onAdd }: { sugg?: Suggestions; onAdd: (d: Draft) => void }) {
  const list = sugg?.cards || [];
  if (sugg && !list.length) return null;
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-1"><CreditCard className="h-4 w-4 text-primary" /><span className="font-medium text-[13px]">Credit card and loan due dates</span></div>
      <p className="text-[12px] text-muted-foreground mb-3">Add each card's due date once. When the payment posts at the card, it checks off and rolls to next month.</p>
      <div className="flex flex-wrap gap-2">
        {list.map((c) => (
          <Button key={c.id} size="sm" variant="outline" className="h-8 max-w-full" onClick={() => onAdd({
            name: `${c.name} payment`,
            amount: c.type === "loan" ? (c.lastPayment?.amount ?? undefined) : Math.abs(Math.min(0, c.balance)),
            nextDueDate: c.lastPayment ? nextMonthISO(c.lastPayment.date) : undefined,
            frequency: "monthly",
            billGroup: c.type === "loan" ? "Housing" : "Cards & Loans", variableAmount: c.type !== "loan", payToAccountId: c.id,
          })}>
            <Plus className="h-3.5 w-3.5 mr-1 shrink-0" /><span className="truncate">{c.name}</span> <span className="ml-1 text-muted-foreground shrink-0">{c.type === "loan" && c.lastPayment ? formatCents(c.lastPayment.amount, { abs: true }) + "/mo" : formatCents(Math.abs(c.balance), { abs: true })}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function nextMonthISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

function Checklist({ setup, onAdd, accounts }: { setup: Overview["setup"]; onAdd: (d: Draft) => void; accounts: Account[] }) {
  const done = setup.filter((s) => s.added).length;
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2"><Home className="h-4 w-4 text-primary" /><span className="font-medium text-[13px]">Common home bills checklist</span></div>
        <span className="text-[11px] text-muted-foreground">{done} of {setup.length}</span>
      </div>
      <p className="text-[12px] text-muted-foreground mb-3">The ones people forget: water, internet, insurance, taxes. Tap one to add it. Skip any that don't apply.</p>
      <div className="flex flex-wrap gap-2">
        {setup.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={s.added ? "secondary" : "outline"}
            className="h-8"
            disabled={s.added}
            title={s.hint}
            onClick={() => {
              const loan = s.key === "mortgage" ? accounts.find((a) => a.type === "loan" && /mortgage/i.test(a.name)) : undefined;
              onAdd({ name: s.name, frequency: s.frequency, billGroup: s.group, matchKeyword: s.keyword || null, variableAmount: !!s.variable, payToAccountId: loan?.id ?? null, notes: s.hint || null });
            }}
          >
            {s.added ? <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-success" /> : <Plus className="h-3.5 w-3.5 mr-1" />}{s.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CalendarCard() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const link = useQuery<{ url: string; webcal: string }>({ queryKey: ["/api/bills/calendar-link"], enabled: open });
  return (
    <Card className="p-0 overflow-hidden" data-testid="card-calendar">
      <button className="w-full flex items-center justify-between px-5 py-4 hover-elevate" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2 text-left">
          <CalendarPlus className="h-4 w-4 text-primary" />
          <div>
            <div className="font-medium text-[14px]">Get reminders on your phone</div>
            <div className="text-[12px] text-muted-foreground">Bills show up in your iPhone or Outlook calendar with an alert before each due date</div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="border-t border-border px-5 py-4 space-y-3 text-[13px]">
          {link.data ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={link.data.url} className="text-[12px] font-mono" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={() => { navigator.clipboard.writeText(link.data!.url); toast({ title: "Link copied" }); }}><Copy className="h-4 w-4 mr-1" />Copy</Button>
              </div>
              <a href={link.data.webcal} className="inline-flex"><Button size="sm"><CalendarPlus className="h-4 w-4 mr-1" />Add to calendar on this device</Button></a>
              <div className="grid sm:grid-cols-2 gap-3 text-[12px] text-muted-foreground">
                <div className="rounded-md border border-border p-3">
                  <div className="font-medium text-foreground mb-1">iPhone</div>
                  Open this page on your iPhone and tap "Add to calendar on this device". Or: Settings › Apps › Calendar › Calendar Accounts › Add Account › Other › Add Subscribed Calendar, then paste the link.
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="font-medium text-foreground mb-1">Outlook</div>
                  Calendar › Add calendar › Subscribe from web, paste the link, name it "Bills".
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">Alerts come {"N"} days before (set per bill) and again on the due date. Paid bills drop off on the next calendar refresh. Keep this link private; it shows bill names and amounts.</p>
            </>
          ) : <Skeleton className="h-10" />}
        </div>
      )}
    </Card>
  );
}

function BillFormDialog({ draft, accounts, onClose }: { draft: Draft; accounts: Account[]; onClose: () => void }) {
  const isEdit = !!draft.id;
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: draft.name || "",
    billGroup: draft.billGroup || "Other",
    amount: draft.amount ? (Math.abs(draft.amount) / 100).toFixed(2) : "",
    variableAmount: !!draft.variableAmount,
    frequency: draft.frequency || "monthly",
    nextDueDate: draft.nextDueDate || "",
    autopay: !!draft.autopay,
    reminderDaysBefore: String(draft.reminderDaysBefore ?? 3),
    accountId: draft.accountId ? String(draft.accountId) : "",
    payToAccountId: draft.payToAccountId ? String(draft.payToAccountId) : "",
    matchKeyword: draft.matchKeyword || "",
    payee: draft.payee || "",
    notes: draft.notes || "",
  });
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const debtAccounts = accounts.filter((a) => a.type === "credit_card" || a.type === "loan");
  const payAccounts = accounts.filter((a) => a.type === "checking" || a.type === "savings" || a.type === "credit_card");

  const save = useMutation({
    mutationFn: async () => {
      if (!form.nextDueDate) throw new Error("Pick the next due date");
      const payload: any = {
        name: form.name.trim(),
        billGroup: form.billGroup,
        amount: dollarsToCents(form.amount || "0"),
        variableAmount: form.variableAmount,
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
        dueDay: Number(form.nextDueDate.slice(8, 10)),
        autopay: form.autopay,
        reminderDaysBefore: Math.max(0, Number(form.reminderDaysBefore) || 0),
        accountId: form.accountId ? Number(form.accountId) : null,
        payToAccountId: form.payToAccountId ? Number(form.payToAccountId) : null,
        matchKeyword: form.matchKeyword.trim() || null,
        payee: form.payee.trim() || null,
        notes: form.notes.trim() || null,
        archived: false,
      };
      if (isEdit) await apiRequest("PATCH", `/api/bills/${draft.id}`, payload);
      else await apiRequest("POST", "/api/bills", payload);
      await apiRequest("POST", "/api/bills/auto-match", {});
    },
    onSuccess: () => { invalidate(); toast({ title: isEdit ? "Bill updated" : "Bill added" }); onClose(); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{isEdit ? "Edit bill" : "Add bill"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_150px] gap-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Water bill" data-testid="input-bill-name" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.billGroup} onValueChange={(v) => set("billGroup", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{form.variableAmount ? "Typical amount ($)" : "Amount ($)"}</Label>
            <Input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0.00" data-testid="input-bill-amount" />
            <label className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
              <Switch checked={form.variableAmount} onCheckedChange={(v) => set("variableAmount", v)} className="scale-75 origin-left" />Amount changes each time
            </label>
          </div>
          <div>
            <Label>How often</Label>
            <Select value={form.frequency} onValueChange={(v) => set("frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FREQS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Next due date</Label>
            <Input type="date" value={form.nextDueDate} onChange={(e) => set("nextDueDate", e.target.value)} data-testid="input-bill-due" />
          </div>
          <div>
            <Label>Remind me (days before)</Label>
            <Input type="number" min={0} max={30} value={form.reminderDaysBefore} onChange={(e) => set("reminderDaysBefore", e.target.value)} />
          </div>
        </div>
        <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="text-[13px]">On autopay</span>
          <Switch checked={form.autopay} onCheckedChange={(v) => set("autopay", v)} />
        </label>

        <div className="rounded-md border border-dashed border-border p-3 space-y-3">
          <div className="text-[12px] font-medium flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" />Check it off automatically</div>
          {(form.billGroup === "Cards & Loans" || form.payToAccountId) ? (
            <div>
              <Label className="text-[11px]">This bill pays which card or loan?</Label>
              <Select value={form.payToAccountId || "none"} onValueChange={(v) => set("payToAccountId", v === "none" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Pick account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {debtAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">When a payment posts to this account near the due date, the bill is marked paid.</p>
            </div>
          ) : null}
          {!form.payToAccountId && (
            <div>
              <Label className="text-[11px]">Words on your bank statement</Label>
              <Input value={form.matchKeyword} onChange={(e) => set("matchKeyword", e.target.value)} placeholder="e.g. national grid, spectrum, allstate" />
              <p className="text-[10px] text-muted-foreground mt-1">When a charge with these words posts near the due date, the bill is marked paid.</p>
            </div>
          )}
          <div>
            <Label className="text-[11px]">Usually paid from</Label>
            <Select value={form.accountId || "none"} onValueChange={(v) => set("accountId", v === "none" ? "" : v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {payAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Account #, website, phone" />
        </div>
      </div>
      <DialogFooter className="gap-2">
        {isEdit && <PaymentsHistory billId={draft.id!} />}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending} data-testid="button-save-bill">
          {save.isPending ? "Saving…" : isEdit ? "Save" : "Add bill"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PaymentsHistory({ billId }: { billId: number }) {
  const q = useQuery<{ id: number; paidDate: string; amount: number; transactionId: number | null }[]>({ queryKey: [`/api/bills/${billId}/payments`] });
  const undo = useMutation({
    mutationFn: async (pid: number) => apiRequest("DELETE", `/api/bills/payments/${pid}`),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: [`/api/bills/${billId}/payments`] }); },
  });
  const last = q.data?.[0];
  if (!last) return <div className="mr-auto" />;
  return (
    <div className="mr-auto text-[11px] text-muted-foreground flex items-center gap-2">
      Last paid {formatDateShort(last.paidDate)} · {formatCents(last.amount, { abs: true })}
      <button className="underline" onClick={() => undo.mutate(last.id)}>Undo</button>
    </div>
  );
}
