import { useQuery, useMutation, type UseQueryResult } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCents, dollarsToCents } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { Business, Category } from "@shared/schema";
import { ChevronDown, ChevronRight, Briefcase, User, Trash2, Plus, CheckCircle2, ArrowDownLeft, ArrowUpRight } from "lucide-react";

const $ = (c: number) => formatCents(c, { abs: true });
const $s = (c: number) => (c < 0 ? "-" : "") + formatCents(c, { abs: true });
const shortDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Tab = "sort" | "inout" | "owe";

export default function BooksPage() {
  const [loc] = useLocation();
  const initial: Tab = loc.includes("owe") ? "owe" : loc.includes("inout") ? "inout" : "sort";
  const [tab, setTab] = useState<Tab>(initial);
  useEffect(() => { setTab(initial); }, [initial]);
  const review = useQuery<ReviewResp>({ queryKey: ["/api/books/review"] });
  const tabs: { id: Tab; label: string }[] = [
    { id: "sort", label: `Sort charges${review.data ? ` (${review.data.count})` : ""}` },
    { id: "inout", label: "Money in & out" },
    { id: "owe", label: "What I own & owe" },
  ];
  return (
    <div className="px-4 md:px-10 py-6 md:py-8 max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">My Books</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Your personal money, the simple way. Like QuickBooks, without the accounting words.</p>
      </div>
      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted/60">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
            className={`rounded-md px-2 py-2 text-[12px] sm:text-[13px] font-medium leading-tight ${tab === t.id ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "sort" && <SortTab q={review} />}
      {tab === "inout" && <InOutTab onSort={() => setTab("sort")} />}
      {tab === "owe" && <OweTab />}
    </div>
  );
}

// ================= Sort charges =================
type Item = { id: number; date: string; amount: number; description: string; accountName: string };
type Group = {
  key: string; match: string; dir: "out" | "biz" | "in"; name: string; count: number; total: number; lastDate: string;
  accounts: string[]; items: Item[];
  suggestion: { kind: "business" | "personal"; businessId?: number; categoryId?: number; label: string; times: number } | null;
  currentCategoryId: number | null;
};
type ReviewResp = { groups: Group[]; count: number; total: number };

function invalidateAll() {
  for (const k of ["/api/books/review", "/api/books/pnl", "/api/books/balance-sheet", "/api/plan", "/api/transactions", "/api/reimbursements/summary", "/api/guide", "/api/dashboard"])
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(k) });
}

function SortTab({ q }: { q: UseQueryResult<ReviewResp> }) {
  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const d = q.data;
  if (q.isLoading || !d) return <Skeleton className="h-64" />;
  if (!d.groups.length) return (
    <Card className="p-8 text-center">
      <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
      <div className="font-medium">All sorted</div>
      <p className="text-[13px] text-muted-foreground">New charges show up here after each bank sync or upload.</p>
    </Card>
  );
  const sections: { dir: Group["dir"]; title: string; sub: string }[] = [
    { dir: "biz", title: "Which business was this for?", sub: "Already marked business. Pick which one so you know who owes you." },
    { dir: "out", title: "Business or personal?", sub: "Tap who it was for. It applies to every charge in the group." },
    { dir: "in", title: "What was this money coming in?", sub: "So paychecks count as income and money you moved doesn't." },
  ];
  return (
    <div className="space-y-5">
      <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-1">
        <div><span className="text-2xl font-semibold tabular-nums">{d.count}</span> <span className="text-[13px] text-muted-foreground">to sort</span></div>
        <div className="text-[13px] text-muted-foreground">Business charges on your personal cards get added to what each business owes you.</div>
      </Card>
      {sections.map((s) => {
        const gs = d.groups.filter((g) => g.dir === s.dir);
        if (!gs.length) return null;
        return (
          <div key={s.dir} className="space-y-2">
            <div>
              <div className="font-medium text-[14px]">{s.title}</div>
              <div className="text-[12px] text-muted-foreground">{s.sub}</div>
            </div>
            {gs.map((g) => <GroupCard key={g.key} g={g} businesses={businesses.filter((b) => !b.archived)} categories={categories.filter((c) => !c.archived)} />)}
          </div>
        );
      })}
    </div>
  );
}

function GroupCard({ g, businesses, categories }: { g: Group; businesses: Business[]; categories: Category[] }) {
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const { toast } = useToast();
  const ids = g.items.map((i) => i.id);
  const decide = useMutation({
    mutationFn: async (body: any) => (await apiRequest("POST", "/api/books/review/decide", { ids, remember: remember ? g.match : null, ...body })).json(),
    onSuccess: (r: any, body: any) => {
      invalidateAll();
      const label = body.kind === "business" ? businesses.find((b) => b.id === body.businessId)?.name
        : body.kind === "transfer" ? "money moved / paid back" : categories.find((c) => c.id === body.categoryId)?.name || "personal";
      toast({
        title: `${g.name}: ${g.count} sorted as ${label}`,
        description: r.alsoMatched ? `Also sorted ${r.alsoMatched} more like it.` : remember ? "Future charges like this will sort themselves." : undefined,
        action: <ToastAction altText="Undo" onClick={async () => { await apiRequest("POST", "/api/books/review/reopen", { ids, alsoIds: r.alsoIds || [], dir: g.dir, rule: remember ? g.match : null }); invalidateAll(); }}>Undo</ToastAction>,
      });
    },
  });
  const spendCats = categories.filter((c) => !c.isIncome && c.name !== "Transfers");
  const sug = g.suggestion;
  return (
    <Card className="p-3 sm:p-4" data-testid={`group-${g.key}`}>
      <div className="flex items-start gap-3">
        <button onClick={() => setOpen(!open)} className="mt-0.5 text-muted-foreground" aria-label="Show charges">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <button onClick={() => setOpen(!open)} className="font-medium text-[14px] truncate text-left">{g.name}</button>
            <span className={`tabular-nums font-medium shrink-0 ${g.dir === "in" ? "text-success" : ""}`}>{g.dir === "in" ? "+" : ""}{$(g.total)}</span>
          </div>
          <div className="text-[12px] text-muted-foreground truncate">
            {g.count} {g.count === 1 ? "charge" : "charges"} · {g.accounts.join(", ")} · last {shortDate(g.lastDate)}
          </div>
          {sug && (
            <div className="text-[12px] mt-1 text-primary">Last time you picked: {sug.label}</div>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 ml-7 border-t pt-2 space-y-1">
          {g.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-3 text-[12px]">
              <span className="truncate text-muted-foreground">{shortDate(i.date)} · {i.description} · {i.accountName}</span>
              <span className="tabular-nums shrink-0">{$(i.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 ml-7 flex flex-wrap gap-2">
        {g.dir === "in" ? (
          <>
            {categories.filter((c) => c.isIncome).slice(0, 4).map((c) => (
              <Button key={c.id} size="sm" variant="outline" className="h-8" disabled={decide.isPending}
                onClick={() => decide.mutate({ kind: "personal", categoryId: c.id })}><ArrowDownLeft className="h-3.5 w-3.5 mr-1" />{c.name === "Salary" ? "Paycheck" : c.name}</Button>
            ))}
            <Button size="sm" variant="outline" className="h-8" disabled={decide.isPending}
              onClick={() => decide.mutate({ kind: "transfer" })}>Business paid me back</Button>
            <Button size="sm" variant="outline" className="h-8" disabled={decide.isPending}
              onClick={() => decide.mutate({ kind: "transfer" })}>Moved my own money</Button>
          </>
        ) : (
          <>
            {businesses.map((b) => (
              <Button key={b.id} size="sm" variant={sug?.kind === "business" && sug.businessId === b.id ? "default" : "outline"} className="h-8"
                disabled={decide.isPending} onClick={() => decide.mutate({ kind: "business", businessId: b.id })} data-testid={`biz-${b.id}`}>
                <Briefcase className="h-3.5 w-3.5 mr-1" />{b.name}
              </Button>
            ))}
            <Select onValueChange={(v) => decide.mutate({ kind: "personal", categoryId: Number(v) })}>
              <SelectTrigger className={`h-8 w-auto gap-1 text-[13px] ${sug?.kind === "personal" ? "border-primary" : ""}`} data-testid="select-personal">
                <User className="h-3.5 w-3.5" /><SelectValue placeholder={sug?.kind === "personal" ? `Personal: ${sug.label}` : "Personal..."} />
              </SelectTrigger>
              <SelectContent>
                {sug?.kind === "personal" && sug.categoryId && <SelectItem value={String(sug.categoryId)}>{sug.label} (last time)</SelectItem>}
                {spendCats.filter((c) => c.id !== sug?.categoryId).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      <label className="mt-2 ml-7 flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
        <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
        Do this automatically for future "{g.name}" charges
      </label>
    </Card>
  );
}

// ================= Money in & out (P&L) =================
type Line = { key: string; name: string; total: number; byMonth: Record<string, number>; count: number };
type Pnl = {
  start: string; end: string; months: string[]; income: Line[]; expenses: Line[];
  totalIncome: number; totalExpense: number; net: number;
  totalIncomeByMonth: Record<string, number>; totalExpenseByMonth: Record<string, number>; netByMonth: Record<string, number>;
  unreviewed: number;
};
function iso(d: Date) { return d.toISOString().slice(0, 10); }
function periods() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const u = (yy: number, mm: number, dd: number) => iso(new Date(Date.UTC(yy, mm, dd)));
  return [
    { id: "this", label: "This month", start: u(y, m, 1), end: u(y, m + 1, 0) },
    { id: "last", label: "Last month", start: u(y, m - 1, 1), end: u(y, m, 0) },
    { id: "3m", label: "Last 3 months", start: u(y, m - 3, 1), end: u(y, m, 0) },
    { id: "ytd", label: "This year", start: u(y, 0, 1), end: u(y, m + 1, 0) },
    { id: "ly", label: "Last year", start: u(y - 1, 0, 1), end: u(y - 1, 11, 31) },
  ];
}
const monthLabel = (k: string) => new Date(k + "-15T12:00:00").toLocaleDateString("en-US", { month: "short" });

function InOutTab({ onSort }: { onSort: () => void }) {
  const ps = periods();
  const [pid, setPid] = useState("3m");
  const [who, setWho] = useState<string>("personal");
  const [byMonth, setByMonth] = useState(false);
  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });
  const p = ps.find((x) => x.id === pid)!;
  const mode = who === "personal" ? "personal" : "business";
  const bizId = who.startsWith("b") ? who.slice(1) : "";
  const url = `/api/books/pnl?start=${p.start}&end=${p.end}&mode=${mode}${bizId ? `&businessId=${bizId}` : ""}`;
  const q = useQuery<Pnl>({ queryKey: [url] });
  const d = q.data;
  const isBiz = mode === "business";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ps.map((x) => (
          <Button key={x.id} size="sm" variant={pid === x.id ? "default" : "outline"} className="h-8" onClick={() => setPid(x.id)}>{x.label}</Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted-foreground">Showing:</span>
        <Select value={who} onValueChange={setWho}>
          <SelectTrigger className="h-8 w-auto text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="personal">My personal money</SelectItem>
            <SelectItem value="business">All business charges on my cards</SelectItem>
            {businesses.filter((b) => !b.archived).map((b) => <SelectItem key={b.id} value={`b${b.id}`}>{b.name} charges on my cards</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {q.isLoading || !d ? <Skeleton className="h-64" /> : (
        <>
          {!isBiz && d.unreviewed > 0 && (
            <button onClick={onSort} className="w-full text-left rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px]">
              {d.unreviewed} charges aren't sorted yet, so some business costs may be counted here. <span className="underline">Sort them</span>
            </button>
          )}
          <div className={`grid gap-3 ${isBiz ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3"}`}>
            {!isBiz && <Big label="Money in" value={$(d.totalIncome)} tone="good" />}
            <Big label={isBiz ? "Business costs you paid personally" : "Money out"} value={$(d.totalExpense)} />
            {!isBiz && <Big label={d.net >= 0 ? "What's left" : "Short by"} value={$(d.net)} tone={d.net >= 0 ? "good" : "bad"} />}
          </div>
          {d.months.length > 1 && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => setByMonth(!byMonth)}>{byMonth ? "Show totals" : "Show each month"}</Button>
            </div>
          )}
          {byMonth && d.months.length > 1 ? <MonthGrid d={d} isBiz={isBiz} /> : (
            <div className={`grid gap-4 ${isBiz ? "" : "lg:grid-cols-2"}`}>
              {!isBiz && <LineList title="Money in" icon={<ArrowDownLeft className="h-4 w-4 text-success" />} lines={d.income} total={d.totalIncome} range={p} mode={mode} bizId={bizId} />}
              <LineList title={isBiz ? "What it was spent on" : "Money out"} icon={<ArrowUpRight className="h-4 w-4 text-destructive" />} lines={d.expenses} total={d.totalExpense} range={p} mode={mode} bizId={bizId} />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {isBiz ? "Charges you marked as business on your personal cards. Not paid back yet? They show under \"What I own\" as money owed to you."
              : "Card payments and money moved between your own accounts aren't counted, so nothing is counted twice. Business charges are left out."}
          </p>
        </>
      )}
    </div>
  );
}

function Big({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <Card className="p-3 sm:p-4 flex sm:block items-center justify-between gap-2 min-w-0">
      <div className="text-[13px] sm:text-[12px] text-muted-foreground">{label}</div>
      <div className={`text-lg sm:text-xl lg:text-2xl truncate font-semibold tabular-nums ${tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
    </Card>
  );
}

function LineList({ title, icon, lines, total, range, mode, bizId }: { title: string; icon: React.ReactNode; lines: Line[]; total: number; range: { start: string; end: string }; mode: string; bizId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...lines.map((l) => l.total));
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 font-medium text-[14px]">{icon}{title}</div>
        <div className="tabular-nums font-semibold">{$(total)}</div>
      </div>
      {!lines.length && <div className="text-[13px] text-muted-foreground">Nothing in this period.</div>}
      <div className="space-y-2.5">
        {lines.map((l) => (
          <div key={l.key}>
            <button className="w-full text-left" onClick={() => setOpen(open === l.key ? null : l.key)}>
              <div className="flex justify-between text-[13px]">
                <span className={l.key.startsWith("uncat") ? "text-warning" : ""}>{l.name === "Uncategorized" ? "Not sorted yet" : l.name === "Uncategorized income" ? "Deposits not sorted yet" : l.name}</span>
                <span className="tabular-nums">{$s(l.total)}</span>
              </div>
              <div className="h-1.5 rounded bg-muted mt-1"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.max(2, (l.total / max) * 100)}%` }} /></div>
            </button>
            {open === l.key && <Lines range={range} mode={mode} bizId={bizId} k={l.key} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Lines({ range, mode, bizId, k }: { range: { start: string; end: string }; mode: string; bizId: string; k: string }) {
  const url = `/api/books/pnl/lines?start=${range.start}&end=${range.end}&mode=${mode}&key=${encodeURIComponent(k)}${bizId ? `&businessId=${bizId}` : ""}`;
  const q = useQuery<(Item & { amount: number })[]>({ queryKey: [url] });
  if (!q.data) return <Skeleton className="h-10 mt-2" />;
  return (
    <div className="mt-2 mb-1 rounded-md bg-muted/40 p-2 space-y-1 max-h-64 overflow-auto">
      {q.data.slice(0, 60).map((t) => (
        <div key={t.id} className="flex justify-between gap-3 text-[12px]">
          <span className="truncate text-muted-foreground">{shortDate(t.date)} · {t.description} · {t.accountName}</span>
          <span className="tabular-nums shrink-0">{$(t.amount)}</span>
        </div>
      ))}
      {q.data.length > 60 && <div className="text-[11px] text-muted-foreground">+ {q.data.length - 60} more</div>}
    </div>
  );
}

function MonthGrid({ d, isBiz }: { d: Pnl; isBiz: boolean }) {
  const row = (name: string, vals: Record<string, number>, total: number, cls = "") => (
    <tr className={`border-t ${cls}`}>
      <td className="py-1.5 pr-3 sticky left-0 bg-card">{name}</td>
      {d.months.map((m) => <td key={m} className="py-1.5 px-2 text-right tabular-nums">{vals[m] ? $s(vals[m]) : "-"}</td>)}
      <td className="py-1.5 pl-2 text-right tabular-nums font-medium">{$s(total)}</td>
    </tr>
  );
  return (
    <Card className="p-4 overflow-x-auto">
      <table className="w-full text-[12px] sm:text-[13px]">
        <thead><tr className="text-muted-foreground"><th className="text-left font-normal sticky left-0 bg-card"></th>{d.months.map((m) => <th key={m} className="text-right font-normal px-2">{monthLabel(m)}</th>)}<th className="text-right font-normal pl-2">Total</th></tr></thead>
        <tbody>
          {!isBiz && <>
            <tr><td colSpan={d.months.length + 2} className="pt-2 font-medium text-success">Money in</td></tr>
            {d.income.map((l) => <Fragment key={l.key}>{row(l.name, l.byMonth, l.total)}</Fragment>)}
            {row("Total money in", d.totalIncomeByMonth, d.totalIncome, "font-medium")}
          </>}
          <tr><td colSpan={d.months.length + 2} className="pt-3 font-medium">Money out</td></tr>
          {d.expenses.map((l) => <Fragment key={l.key}>{row(l.name === "Uncategorized" ? "Not sorted yet" : l.name, l.byMonth, l.total)}</Fragment>)}
          {row("Total money out", d.totalExpenseByMonth, d.totalExpense, "font-medium")}
          {!isBiz && row("What's left", d.netByMonth, d.net, "font-semibold")}
        </tbody>
      </table>
    </Card>
  );
}

// ================= What I own & owe (balance sheet) =================
type BsItem = { id: number | string; name: string; amount: number; count?: number };
type BsGroup = { name: string; items: BsItem[]; total: number; manual?: boolean };
type ManualItem = { id: string; name: string; side: "asset" | "liability"; group: string; amount: number };
type Bs = { asOf: string; assets: BsGroup[]; liabilities: BsGroup[]; totalAssets: number; totalLiabilities: number; netWorth: number; manual: ManualItem[]; untracked: { id: number; name: string; balance: number }[] };

const QUICK: { label: string; name: string; side: "asset" | "liability"; group: string }[] = [
  { label: "My home's value", name: "Home (estimated value)", side: "asset", group: "Home & vehicles" },
  { label: "A vehicle", name: "Vehicle", side: "asset", group: "Home & vehicles" },
  { label: "My share of a business", name: "Business ownership", side: "asset", group: "Businesses I own" },
  { label: "Other thing I own", name: "", side: "asset", group: "Other things I own" },
  { label: "Car loan / other debt", name: "", side: "liability", group: "Other loans" },
];

function OweTab() {
  const q = useQuery<Bs>({ queryKey: ["/api/books/balance-sheet"] });
  const [draft, setDraft] = useState<ManualItem | null>(null);
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (items: ManualItem[]) => (await apiRequest("POST", "/api/books/balance-items", { items })).json(),
    onSuccess: () => { invalidateAll(); setDraft(null); toast({ title: "Saved" }); },
  });
  const d = q.data;
  if (q.isLoading || !d) return <Skeleton className="h-64" />;
  const hasHome = d.manual.some((m) => /home|house/i.test(m.name));
  const upsert = (it: ManualItem) => save.mutate([...d.manual.filter((m) => m.id !== it.id), it]);
  const remove = (id: string) => save.mutate(d.manual.filter((m) => m.id !== id));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <Big label="What I own" value={$(d.totalAssets)} tone="good" />
        <Big label="What I owe" value={$(d.totalLiabilities)} tone="bad" />
        <Big label="Net worth" value={$s(d.netWorth)} tone={d.netWorth >= 0 ? "good" : "bad"} />
      </div>
      {!hasHome && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px]">
          Your mortgage is counted, but your home's value isn't yet, so net worth looks lower than it really is.{" "}
          <button className="underline" onClick={() => setDraft({ id: "", name: "Home (estimated value)", side: "asset", group: "Home & vehicles", amount: 0 })}>Add your home's value</button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Side title="What I own" groups={d.assets} total={d.totalAssets} manual={d.manual} onEdit={setDraft} onRemove={remove} />
        <Side title="What I owe" groups={d.liabilities} total={d.totalLiabilities} manual={d.manual} onEdit={setDraft} onRemove={remove} />
      </div>

      <Card className="p-4 space-y-3">
        <div>
          <div className="font-medium text-[14px]">Add things your bank doesn't know about</div>
          <div className="text-[12px] text-muted-foreground">Your house, truck, a business you own, or a loan that isn't linked.</div>
        </div>
        {d.untracked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {d.untracked.map((u) => (
              <Button key={u.id} size="sm" variant="outline" className="h-8" onClick={() => setDraft({ id: "", name: u.name, side: u.balance < 0 ? "liability" : "asset", group: u.balance < 0 ? "Other loans" : "Other things I own", amount: Math.abs(u.balance) })}>
                <Plus className="h-3.5 w-3.5 mr-1" />{u.name} {$(u.balance)} <span className="ml-1 text-muted-foreground">(from your bank)</span>
              </Button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {QUICK.map((x) => (
            <Button key={x.label} size="sm" variant="outline" className="h-8" onClick={() => setDraft({ id: "", name: x.name, side: x.side, group: x.group, amount: 0 })}>
              <Plus className="h-3.5 w-3.5 mr-1" />{x.label}
            </Button>
          ))}
        </div>
        {draft && <ItemForm draft={draft} onCancel={() => setDraft(null)} onSave={upsert} saving={save.isPending} />}
      </Card>
      <p className="text-[11px] text-muted-foreground">As of today. Bank balances update with each sync. "Owed to you by your businesses" is business charges on your personal cards that haven't been paid back yet.</p>
    </div>
  );
}

function Side({ title, groups, total, manual, onEdit, onRemove }: { title: string; groups: BsGroup[]; total: number; manual: ManualItem[]; onEdit: (m: ManualItem) => void; onRemove: (id: string) => void }) {
  return (
    <Card className="p-4 min-w-0">
      <div className="flex justify-between font-medium text-[14px] mb-3"><span>{title}</span><span className="tabular-nums">{$(total)}</span></div>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.name}>
            <div className="flex justify-between text-[12px] font-medium text-muted-foreground uppercase tracking-wide"><span>{g.name}</span><span className="tabular-nums">{$(g.total)}</span></div>
            <div className="mt-1 divide-y">
              {g.items.map((i) => {
                const m = g.manual ? manual.find((x) => x.id === i.id) : null;
                return (
                  <div key={String(i.id)} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                    <span className="truncate min-w-0">{i.name}{i.count ? <span className="text-muted-foreground"> · {i.count} charges</span> : null}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className="tabular-nums">{$(i.amount)}</span>
                      {m && <>
                        <button className="text-[11px] underline text-muted-foreground ml-1" onClick={() => onEdit(m)}>edit</button>
                        <button className="text-muted-foreground" onClick={() => { if (confirm(`Remove ${m.name}?`)) onRemove(m.id); }} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                      </>}
                    </span>
                  </div>
                );
              })}
            </div>
            {g.name === "Owed to you by your businesses" && <Link href="/businesses" className="text-[11px] underline text-muted-foreground">See and clear in Reimbursements</Link>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ItemForm({ draft, onCancel, onSave, saving }: { draft: ManualItem; onCancel: () => void; onSave: (m: ManualItem) => void; saving: boolean }) {
  const [name, setName] = useState(draft.name);
  const [amt, setAmt] = useState(draft.amount ? (draft.amount / 100).toFixed(2) : "");
  const valid = name.trim() && Number(amt) > 0;
  return (
    <div className="rounded-md border p-3 grid sm:grid-cols-[1fr_160px_auto] gap-2 items-end">
      <div>
        <div className="text-[12px] text-muted-foreground mb-1">{draft.side === "asset" ? "What is it?" : "Who do you owe?"}</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={draft.side === "asset" ? "e.g. Home, 2023 RAM" : "e.g. TD truck loan"} />
      </div>
      <div>
        <div className="text-[12px] text-muted-foreground mb-1">{draft.side === "asset" ? "Worth about ($)" : "Still owe ($)"}</div>
        <Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-9" disabled={!valid || saving} onClick={() => onSave({ ...draft, id: draft.id || Math.random().toString(36).slice(2, 10), name: name.trim(), amount: dollarsToCents(amt) })}>Save</Button>
        <Button size="sm" variant="ghost" className="h-9" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
