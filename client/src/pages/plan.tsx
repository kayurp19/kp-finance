import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents, dollarsToCents } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, AlertTriangle, XCircle, Home, Wallet, Calculator, PiggyBank, Pencil, ArrowRight,
} from "lucide-react";

type Plan = {
  today: string;
  months: { key: string; label: string; income: number; spending: number; everyday: number; count: number }[];
  monthsUsed: string[];
  income: number; incomeIsOverride: boolean; incomeAverage: number;
  fixed: number; everyday: number; need: number; leftover: number;
  houseMonthly: number; byGroup: Record<string, number>;
  topCategories: { name: string; monthly: number }[];
  cash: number; cashAccounts: { id: number; name: string; balance: number }[];
  cardDebt: number; unbilledCardDebt: number; billsNext30: number; buffer: number; safeToSpend: number;
  billsCount: number; overdueCount: number; cardGaps: number; uncategorized90: number;
};

const $ = (c: number) => formatCents(c, { abs: true });
const $s = (c: number) => (c < 0 ? "-" : "") + formatCents(c, { abs: true });

export default function PlanPage() {
  const q = useQuery<Plan>({ queryKey: ["/api/plan"] });
  const p = q.data;

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Plan & Afford</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">What you need each month, what's safe to spend right now, and whether you can afford something.</p>
      </div>

      {q.isLoading || !p ? <Skeleton className="h-64" /> : (
        <>
          <Checklist p={p} />
          <div className="grid lg:grid-cols-2 gap-4">
            <MonthCard p={p} />
            <RightNowCard p={p} />
          </div>
          <AffordCalculator p={p} />
          <div className="grid lg:grid-cols-2 gap-4">
            <HouseCard p={p} />
            <WhereItGoes p={p} />
          </div>
          <MonthsTable p={p} />
        </>
      )}
    </div>
  );
}

function Checklist({ p }: { p: Plan }) {
  const steps = [
    { done: p.billsCount >= 8, text: p.billsCount ? `Add all your bills (${p.billsCount} so far): water, internet, insurance, taxes` : "Add your bills: water, internet, insurance, taxes", href: "/bills" },
    { done: p.cardGaps === 0, text: p.cardGaps ? `Set due dates for ${p.cardGaps} credit card${p.cardGaps > 1 ? "s" : ""} / loans` : "Card and loan due dates set", href: "/bills" },
    { done: p.overdueCount === 0, text: p.overdueCount ? `${p.overdueCount} bill${p.overdueCount > 1 ? "s" : ""} past due. Pay or mark paid` : "No past-due bills", href: "/bills" },
    { done: p.uncategorized90 < 20, text: p.uncategorized90 ? `Sort ${p.uncategorized90} uncategorized transactions from the last 90 days` : "Transactions sorted", href: "/transactions?uncategorized=1" },
    { done: false, text: "Turn on phone reminders (one-time, 1 minute)", href: "/bills", optional: true },
  ];
  const remaining = steps.filter((s) => !s.done && !s.optional).length;
  if (remaining === 0) return null;
  return (
    <Card className="p-5" data-testid="card-checklist">
      <div className="font-medium text-[14px] mb-0.5">Finish setting up</div>
      <p className="text-[12px] text-muted-foreground mb-3">The numbers below get more accurate with each step.</p>
      <div className="space-y-1">
        {steps.map((s, i) => (
          <Link key={i} href={s.href}>
            <a className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover-elevate text-[13px]">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.text}</span>
              {!s.done && <ArrowRight className="h-3.5 w-3.5 ml-auto text-muted-foreground" />}
            </a>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Row({ label, value, sub, bold, tone }: { label: string; value: string; sub?: string; bold?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className={`flex items-baseline justify-between py-1.5 ${bold ? "border-t border-border mt-1 pt-2.5" : ""}`}>
      <div>
        <div className={`text-[13px] ${bold ? "font-semibold" : ""}`}>{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <div className={`tabular-nums ${bold ? "text-lg font-semibold" : "text-[14px]"} ${tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function MonthCard({ p }: { p: Plan }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(Math.round(p.income / 100)));
  const save = useMutation({
    mutationFn: async (monthlyIncome: number | null) => apiRequest("POST", "/api/plan/settings", { monthlyIncome }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/plan"] }); setEditing(false); toast({ title: "Saved" }); },
  });
  return (
    <Card className="p-5" data-testid="card-month">
      <div className="flex items-center gap-2 mb-3"><Wallet className="h-4 w-4 text-primary" /><span className="font-medium text-[14px]">Your month</span></div>
      <div className="flex items-baseline justify-between py-1.5">
        <div>
          <div className="text-[13px]">Money coming in</div>
          <div className="text-[11px] text-muted-foreground">
            {p.incomeIsOverride ? `Your number (bank average ${$(p.incomeAverage)})` : `Average of ${p.monthsUsed.join(", ") || "recent months"}`}
          </div>
        </div>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input className="h-8 w-28 text-right" type="number" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
            <Button size="sm" className="h-8" onClick={() => save.mutate(dollarsToCents(val))}>Save</Button>
          </div>
        ) : (
          <button className="flex items-center gap-1.5 tabular-nums text-[14px] text-success" onClick={() => setEditing(true)} title="Set your own monthly income">
            {$(p.income)}<Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
      {p.incomeIsOverride && !editing && (
        <button className="text-[11px] underline text-muted-foreground" onClick={() => save.mutate(null)}>Use bank average instead</button>
      )}
      <Row label="Bills" sub={p.billsCount ? "Home, utilities, insurance, loans (monthly equivalent)" : "Add bills to see this"} value={"-" + $(p.fixed)} />
      <Row label="Everyday spending" sub="Everything else incl. card purchases (3-month average)" value={"-" + $(p.everyday)} />
      <Row label="You need each month" value={$(p.need)} bold />
      <Row label={p.leftover >= 0 ? "Left over each month" : "Short each month"} value={$s(p.leftover)} tone={p.leftover >= 0 ? "good" : "bad"} bold />
      <p className="text-[11px] text-muted-foreground mt-2">
        Card payments and transfers between your accounts aren't counted, so nothing is double-counted. Business-tagged spending is excluded.
      </p>
    </Card>
  );
}

function RightNowCard({ p }: { p: Plan }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(Math.round(p.buffer / 100)));
  const save = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/plan/settings", { buffer: dollarsToCents(val) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/plan"] }); setEditing(false); toast({ title: "Cushion updated" }); },
  });
  return (
    <Card className="p-5" data-testid="card-right-now">
      <div className="flex items-center gap-2 mb-3"><PiggyBank className="h-4 w-4 text-primary" /><span className="font-medium text-[14px]">Safe to spend right now</span></div>
      <Row label="Cash in checking & savings" sub={p.cashAccounts.map((a) => a.name.replace(/\s*\(\d{4}\)$/, "")).join(", ")} value={$s(p.cash)} />
      <Row label="Bills due in the next 30 days" value={"-" + $(p.billsNext30)} />
      <div className="flex items-baseline justify-between py-1.5">
        <div>
          <div className="text-[13px]">Cushion you never touch</div>
          <div className="text-[11px] text-muted-foreground">For surprises</div>
        </div>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input className="h-8 w-24 text-right" type="number" value={val} onChange={(e) => setVal(e.target.value)} />
            <Button size="sm" className="h-8" onClick={() => save.mutate()}>Save</Button>
          </div>
        ) : (
          <button className="flex items-center gap-1.5 tabular-nums text-[14px]" onClick={() => setEditing(true)}>-{$(p.buffer)}<Pencil className="h-3 w-3 text-muted-foreground" /></button>
        )}
      </div>
      <Row label="Safe to spend" value={$s(p.safeToSpend)} tone={p.safeToSpend >= 0 ? "good" : "bad"} bold />
      {p.unbilledCardDebt > 0 && (
        <div className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-[12px]">
          <span className="font-medium">You owe {$(p.cardDebt)} on credit cards.</span>{" "}
          {p.unbilledCardDebt === p.cardDebt
            ? "Add each card's due date on the Bills page so payments are counted here."
            : `${$(p.unbilledCardDebt)} of that has no due date set yet.`}
          {" "}If you paid every card in full today, you'd have {$s(p.cash - p.billsNext30 - p.cardDebt)}.
        </div>
      )}
    </Card>
  );
}

function pmt(principal: number, aprPct: number, months: number) {
  if (months <= 0) return 0;
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

function AffordCalculator({ p }: { p: Plan }) {
  const [mode, setMode] = useState<"cash" | "monthly" | "finance">("cash");
  const [what, setWhat] = useState("");
  const [price, setPrice] = useState("");
  const [monthly, setMonthly] = useState("");
  const [down, setDown] = useState("");
  const [apr, setApr] = useState("7.9");
  const [months, setMonths] = useState("60");

  const result = useMemo(() => {
    const priceC = dollarsToCents(price || "0");
    const downC = dollarsToCents(down || "0");
    let monthlyC = 0, upfront = 0, totalCost = 0, interest = 0;
    if (mode === "cash") { upfront = priceC; totalCost = priceC; }
    else if (mode === "monthly") { monthlyC = dollarsToCents(monthly || "0"); upfront = downC; totalCost = 0; }
    else {
      const n = Math.max(1, Number(months) || 1);
      const principal = Math.max(0, priceC - downC);
      monthlyC = Math.round(pmt(principal, Number(apr) || 0, n));
      upfront = downC;
      totalCost = downC + monthlyC * n;
      interest = totalCost - priceC;
    }
    if (!upfront && !monthlyC) return null;

    const reasons: string[] = [];
    let level: "yes" | "tight" | "no" = "yes";
    const safeAfter = p.safeToSpend - upfront;
    const leftoverAfter = p.leftover - monthlyC;

    if (upfront > 0) {
      if (safeAfter >= 0) reasons.push(`After paying ${$(upfront)} you'd still have ${$(safeAfter)} safe to spend, with your bills and ${$(p.buffer)} cushion covered.`);
      else if (safeAfter + p.buffer >= 0) { level = "tight"; reasons.push(`Paying ${$(upfront)} would dip ${$(-safeAfter)} into your ${$(p.buffer)} cushion.`); }
      else { level = "no"; reasons.push(`You're ${$(-safeAfter)} short after covering bills due in the next 30 days and your cushion.`); }
    }
    if (monthlyC > 0) {
      const comfy = Math.max(20000, Math.round(p.income * 0.1));
      if (leftoverAfter >= comfy) reasons.push(`${$(monthlyC)}/mo fits. You'd still have ${$(leftoverAfter)} left over each month.`);
      else if (leftoverAfter >= 0) { if (level === "yes") level = "tight"; reasons.push(`${$(monthlyC)}/mo leaves only ${$(leftoverAfter)} a month for everything unexpected.`); }
      else { level = "no"; reasons.push(`${$(monthlyC)}/mo would put you ${$(-leftoverAfter)} short every month.`); }
    }
    if (p.leftover <= 0) { level = "no"; reasons.push(`Right now you spend ${$(-p.leftover)} more than comes in each month. Fix that first.`); }

    let saveFor: string | null = null;
    if (upfront > 0 && level !== "yes" && p.leftover > 0) {
      const gap = Math.max(0, upfront - Math.max(0, p.safeToSpend));
      const n = Math.ceil(gap / p.leftover);
      saveFor = `If you set aside your ${$(p.leftover)} monthly leftover, you could pay cash in about ${n} month${n === 1 ? "" : "s"}.`;
    }
    if (p.cardDebt > 0 && upfront > 0 && level === "yes" && p.cardDebt > upfront) {
      reasons.push(`You carry ${$(p.cardDebt)} on cards. Paying cards down first usually saves more than you'd earn anywhere else.`);
    }
    return { level, reasons, saveFor, monthlyC, upfront, totalCost, interest };
  }, [mode, price, monthly, down, apr, months, p]);

  const tone = result?.level === "yes" ? "border-success/60" : result?.level === "tight" ? "border-warning/60" : result ? "border-destructive/60" : "";

  return (
    <Card className="p-5" data-testid="card-afford">
      <div className="flex items-center gap-2 mb-1"><Calculator className="h-4 w-4 text-primary" /><span className="font-medium text-[14px]">Can I afford it?</span></div>
      <p className="text-[12px] text-muted-foreground mb-4">Uses your real balances, upcoming bills, and monthly leftover.</p>
      <div className="grid md:grid-cols-[1fr_1fr] gap-5">
        <div className="space-y-3">
          <div>
            <Label className="text-[12px]">What is it?</Label>
            <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. New TV, trip, truck" data-testid="input-afford-what" />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {(["cash", "monthly", "finance"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`text-[12px] py-1.5 rounded ${mode === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`} data-testid={`mode-${m}`}>
                {m === "cash" ? "Pay now" : m === "monthly" ? "Monthly cost" : "Finance it"}
              </button>
            ))}
          </div>
          {mode !== "monthly" && (
            <div>
              <Label className="text-[12px]">Price ($)</Label>
              <Input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" data-testid="input-afford-price" />
            </div>
          )}
          {mode === "monthly" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px]">Per month ($)</Label>
                <Input type="number" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="e.g. 85" />
              </div>
              <div>
                <Label className="text-[12px]">Upfront ($)</Label>
                <Input type="number" inputMode="decimal" value={down} onChange={(e) => setDown(e.target.value)} placeholder="0" />
              </div>
            </div>
          )}
          {mode === "finance" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[12px]">Down ($)</Label>
                <Input type="number" inputMode="decimal" value={down} onChange={(e) => setDown(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label className="text-[12px]">APR %</Label>
                <Input type="number" step="0.1" value={apr} onChange={(e) => setApr(e.target.value)} />
              </div>
              <div>
                <Label className="text-[12px]">Months</Label>
                <Input type="number" value={months} onChange={(e) => setMonths(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <div className={`rounded-lg border-2 p-4 ${tone || "border-dashed border-border"}`} data-testid="afford-result">
          {!result ? (
            <div className="text-[13px] text-muted-foreground h-full flex items-center">Enter a price to see if it fits.</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {result.level === "yes" ? <CheckCircle2 className="h-5 w-5 text-success" /> : result.level === "tight" ? <AlertTriangle className="h-5 w-5 text-warning" /> : <XCircle className="h-5 w-5 text-destructive" />}
                <span className="font-semibold text-[15px]">
                  {result.level === "yes" ? "Yes, you can afford it" : result.level === "tight" ? "Possible, but tight" : "Not right now"}
                  {what ? ` - ${what}` : ""}
                </span>
              </div>
              <ul className="text-[13px] space-y-1.5 list-disc pl-5">
                {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              {mode === "finance" && result.monthlyC > 0 && (
                <div className="text-[12px] text-muted-foreground border-t border-border pt-2">
                  Payment {$(result.monthlyC)}/mo · total paid {$(result.totalCost)} · interest {$(Math.max(0, result.interest))}
                </div>
              )}
              {result.saveFor && <div className="text-[12px] rounded-md bg-muted px-3 py-2">{result.saveFor}</div>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function HouseCard({ p }: { p: Plan }) {
  const parts = ["Housing", "Utilities"].map((g) => ({ g, v: p.byGroup[g] || 0 }));
  return (
    <Card className="p-5" data-testid="card-house">
      <div className="flex items-center gap-2 mb-3"><Home className="h-4 w-4 text-primary" /><span className="font-medium text-[14px]">House cost per month</span></div>
      <div className="text-2xl font-semibold tabular-nums">{$(p.houseMonthly)}</div>
      <div className="text-[12px] text-muted-foreground mb-3">Mortgage, insurance, taxes, and utilities from your bills, spread per month</div>
      {parts.map((x) => <Row key={x.g} label={x.g} value={$(x.v)} />)}
      {p.houseMonthly === 0 && (
        <Link href="/bills"><a className="text-[12px] underline text-primary">Add mortgage, water, electric, internet, insurance, taxes →</a></Link>
      )}
    </Card>
  );
}

function WhereItGoes({ p }: { p: Plan }) {
  const max = Math.max(1, ...p.topCategories.map((c) => c.monthly));
  return (
    <Card className="p-5" data-testid="card-where">
      <div className="font-medium text-[14px] mb-1">Where everyday money goes</div>
      <div className="text-[12px] text-muted-foreground mb-3">Average per month, not counting bills</div>
      {!p.topCategories.length ? <div className="text-[12px] text-muted-foreground">Not enough data yet.</div> : (
        <div className="space-y-2">
          {p.topCategories.map((c) => (
            <div key={c.name}>
              <div className="flex justify-between text-[12px] mb-0.5"><span>{c.name}</span><span className="tabular-nums">{$(c.monthly)}</span></div>
              <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${(c.monthly / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MonthsTable({ p }: { p: Plan }) {
  return (
    <Card className="p-5" data-testid="card-months">
      <div className="font-medium text-[14px] mb-3">Last 3 months</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="text-left font-medium pb-2">Month</th><th className="text-right font-medium pb-2">In</th><th className="text-right font-medium pb-2">Out</th><th className="text-right font-medium pb-2">Net</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {p.months.map((m) => (
              <tr key={m.key} className="border-t border-border">
                <td className="py-2">{m.label}{m.count < 15 && <span className="text-[10px] text-muted-foreground ml-1">(little data)</span>}</td>
                <td className="text-right text-success">{$(m.income)}</td>
                <td className="text-right">{$(m.spending)}</td>
                <td className={`text-right ${m.income - m.spending >= 0 ? "text-success" : "text-destructive"}`}>{$s(m.income - m.spending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
