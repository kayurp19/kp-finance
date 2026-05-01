import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { FileText } from "lucide-react";
import type { Transaction, Category } from "@shared/schema";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  Legend, Line, CartesianGrid, ComposedChart, ReferenceLine,
} from "recharts";

type PeriodMode = "week" | "month" | "year" | "custom";

export default function ReportsPage() {
  const [mode, setMode] = useState<PeriodMode>("month");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const { startDate, endDate, label, granularity, bucketCount } = useMemo(
    () => computeRange(mode, customStart, customEnd),
    [mode, customStart, customEnd],
  );

  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", { startDate, endDate, excludeBusiness: true }],
  });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const isIncomeTx = (t: Transaction) => {
    if (t.categoryId != null) {
      const c = catMap.get(t.categoryId);
      if (c) return c.isIncome;
    }
    return t.amount > 0;
  };

  // Income/expense totals
  let totalIn = 0, totalOut = 0;
  const catTotals = new Map<number | null, number>();
  txs.forEach((t) => {
    if (isIncomeTx(t)) {
      totalIn += Math.abs(t.amount);
    } else {
      totalOut += Math.abs(t.amount);
      catTotals.set(t.categoryId, (catTotals.get(t.categoryId) || 0) + Math.abs(t.amount));
    }
  });
  const totalNet = totalIn - totalOut;

  const catData = Array.from(catTotals.entries())
    .map(([id, amount]) => {
      const c = id ? categories.find((c) => c.id === id) : null;
      return { id, name: c?.name || "Uncategorized", color: c?.color || "#94a3b8", amount };
    })
    .sort((a, b) => b.amount - a.amount);

  // Top merchants
  const merchTotals = new Map<string, number>();
  txs.forEach((t) => {
    if (isIncomeTx(t)) return;
    const key = (t.merchant || t.description).slice(0, 40);
    merchTotals.set(key, (merchTotals.get(key) || 0) + Math.abs(t.amount));
  });
  const topMerchants = Array.from(merchTotals.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Income vs expense by bucket — for last N buckets at the chosen granularity
  // Use a separate query for a wider window when granularity is week/month/year so we get N periods.
  const trendRange = useMemo(() => buildTrendRange(granularity, bucketCount), [granularity, bucketCount]);
  const { data: trendTxs = [] } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", { startDate: trendRange.startDate, endDate: trendRange.endDate, excludeBusiness: true }],
  });

  const trendData = useMemo(() => {
    return buildTrendData(trendTxs, isIncomeTx, granularity, bucketCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendTxs, granularity, bucketCount, catMap]);

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Personal · business excluded · {label}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/pfs">
            <Button size="sm" variant="outline" data-testid="button-open-pfs">
              <FileText className="h-4 w-4 mr-1.5" />Personal Financial Statement
            </Button>
          </Link>
          <PeriodToggle value={mode} onChange={setMode} />
          {mode === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 text-[12px] w-[140px]"
                data-testid="input-custom-start"
              />
              <span className="text-[12px] text-muted-foreground">→</span>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 text-[12px] w-[140px]"
                data-testid="input-custom-end"
              />
            </div>
          )}
        </div>
      </div>

      {/* Hero: Income / Expenses / Net */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Income</div>
          <Money cents={totalIn} size="2xl" className="font-semibold mt-2 text-success" />
        </Card>
        <Card className="p-5">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Expenses</div>
          <Money cents={totalOut} size="2xl" className="font-semibold mt-2 text-destructive" />
        </Card>
        <Card className="p-5">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Net</div>
          <Money
            cents={totalNet}
            size="2xl"
            className={cn("font-semibold mt-2", totalNet >= 0 ? "text-success" : "text-destructive")}
          />
        </Card>
      </div>

      {/* Income vs Expense trend chart */}
      <Card className="p-5">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-[15px] font-semibold">Income vs Expense</h2>
            <p className="text-[12px] text-muted-foreground">{trendData.subtitle}</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <LegendDot color="hsl(var(--success))" label="Income" />
            <LegendDot color="hsl(var(--destructive))" label="Expense" filled />
            <LegendDot color="hsl(var(--foreground))" label="Net" line />
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendData.rows} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${v}`} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Tooltip
                formatter={(v: any, name: string) => [`$${Number(v).toFixed(2)}`, name]}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
              />
              <Bar dataKey="income" fill="hsl(var(--success))" name="Income" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenseNeg" fill="hsl(var(--destructive))" name="Expense" radius={[0, 0, 3, 3]} />
              <Line
                type="monotone"
                dataKey="net"
                stroke="hsl(var(--foreground))"
                strokeWidth={2}
                dot={{ r: 3, fill: "hsl(var(--foreground))" }}
                name="Net"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Net by bucket explainer */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-[11px]">
          {trendData.rows.slice(-6).map((r) => (
            <div key={r.label} className="flex flex-col py-1.5 px-2 rounded bg-muted/40">
              <span className="text-muted-foreground">{r.label}</span>
              <Money
                cents={Math.round(r.net * 100)}
                colored
                size="xs"
                className="font-semibold"
              />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold mb-3">Spending by category</h2>
          {isLoading ? <Skeleton className="h-64" /> : catData.length === 0 ? (
            <div className="text-[13px] text-muted-foreground italic py-8 text-center">No spending in this period.</div>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={catData.slice(0, 8)} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={1}>
                      {catData.slice(0, 8).map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => `$${(Number(v) / 100).toFixed(2)}`} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 space-y-1.5">
                {catData.slice(0, 10).map((c) => (
                  <div key={String(c.id)} className="flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                      <span>{c.name}</span>
                      <span className="text-muted-foreground text-[10px]">{totalOut > 0 ? ((c.amount / totalOut) * 100).toFixed(0) : 0}%</span>
                    </div>
                    <Money cents={c.amount} abs size="xs" />
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold mb-3">Top merchants</h2>
          {topMerchants.length === 0 ? (
            <div className="text-[13px] text-muted-foreground italic py-8 text-center">No spending in this period.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topMerchants.map((m) => ({ ...m, amount: m.amount / 100 }))} layout="vertical" margin={{ left: 50 }}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip formatter={(v: any) => `$${Number(v).toFixed(2)}`} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                  <Bar dataKey="amount" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function LegendDot({ color, label, filled, line }: { color: string; label: string; filled?: boolean; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line ? (
        <span className="block w-4 h-0.5" style={{ backgroundColor: color }} />
      ) : (
        <span className="block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color, opacity: filled ? 0.9 : 1 }} />
      )}
      <span>{label}</span>
    </span>
  );
}

function PeriodToggle({ value, onChange }: { value: PeriodMode; onChange: (v: PeriodMode) => void }) {
  const opts: { v: PeriodMode; label: string }[] = [
    { v: "week", label: "Week" },
    { v: "month", label: "Month" },
    { v: "year", label: "Year" },
    { v: "custom", label: "Custom" },
  ];
  return (
    <div className="inline-flex items-center bg-muted rounded-md p-0.5" role="tablist" data-testid="reports-period-toggle">
      {opts.map((o) => (
        <button
          key={o.v}
          role="tab"
          aria-selected={value === o.v}
          onClick={() => onChange(o.v)}
          data-testid={`reports-period-${o.v}`}
          className={cn(
            "text-[12px] font-medium px-3 py-1 rounded transition-colors",
            value === o.v
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// === Date helpers ===

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfISOWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function endOfISOWeek(d: Date) {
  const s = startOfISOWeek(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return e;
}

function computeRange(
  mode: PeriodMode,
  customStart: string,
  customEnd: string,
): { startDate: string; endDate: string; label: string; granularity: "week" | "month" | "year"; bucketCount: number } {
  const today = new Date();
  if (mode === "week") {
    const ws = startOfISOWeek(today);
    const we = endOfISOWeek(today);
    return {
      startDate: fmt(ws),
      endDate: fmt(we),
      label: `Week of ${ws.toLocaleString("en-US", { month: "short", day: "numeric" })}`,
      granularity: "week",
      bucketCount: 12,
    };
  }
  if (mode === "year") {
    const start = new Date(today.getFullYear(), 0, 1);
    return {
      startDate: fmt(start),
      endDate: fmt(today),
      label: `${today.getFullYear()} YTD`,
      granularity: "year",
      bucketCount: 5,
    };
  }
  if (mode === "custom") {
    const s = customStart || fmt(new Date(today.getFullYear(), today.getMonth(), 1));
    const e = customEnd || fmt(today);
    return {
      startDate: s,
      endDate: e,
      label: `${s} → ${e}`,
      granularity: "month",
      bucketCount: 6,
    };
  }
  // month
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    startDate: fmt(start),
    endDate: fmt(today),
    label: today.toLocaleString("en-US", { month: "long", year: "numeric" }),
    granularity: "month",
    bucketCount: 6,
  };
}

function buildTrendRange(granularity: "week" | "month" | "year", buckets: number): { startDate: string; endDate: string } {
  const today = new Date();
  if (granularity === "week") {
    const ws = startOfISOWeek(today);
    const start = new Date(ws);
    start.setDate(start.getDate() - 7 * (buckets - 1));
    return { startDate: fmt(start), endDate: fmt(today) };
  }
  if (granularity === "year") {
    const start = new Date(today.getFullYear() - (buckets - 1), 0, 1);
    return { startDate: fmt(start), endDate: fmt(today) };
  }
  // month
  const start = new Date(today.getFullYear(), today.getMonth() - (buckets - 1), 1);
  return { startDate: fmt(start), endDate: fmt(today) };
}

function buildTrendData(
  txs: Transaction[],
  isIncomeTx: (t: Transaction) => boolean,
  granularity: "week" | "month" | "year",
  buckets: number,
): { rows: Array<{ label: string; income: number; expense: number; expenseNeg: number; net: number }>; subtitle: string } {
  const today = new Date();
  const rows: Array<{ key: string; label: string; income: number; expense: number; expenseNeg: number; net: number }> = [];

  if (granularity === "week") {
    for (let i = buckets - 1; i >= 0; i--) {
      const ws = startOfISOWeek(today);
      ws.setDate(ws.getDate() - i * 7);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      rows.push({
        key: `${fmt(ws)}|${fmt(we)}`,
        label: `${ws.toLocaleString("en-US", { month: "short", day: "numeric" })}`,
        income: 0, expense: 0, expenseNeg: 0, net: 0,
      });
    }
    txs.forEach((t) => {
      const d = new Date(t.date + "T00:00:00");
      const ws = startOfISOWeek(d);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      const k = `${fmt(ws)}|${fmt(we)}`;
      const r = rows.find((x) => x.key === k);
      if (!r) return;
      if (isIncomeTx(t)) r.income += Math.abs(t.amount) / 100;
      else r.expense += Math.abs(t.amount) / 100;
    });
  } else if (granularity === "year") {
    for (let i = buckets - 1; i >= 0; i--) {
      const y = today.getFullYear() - i;
      rows.push({ key: String(y), label: String(y), income: 0, expense: 0, expenseNeg: 0, net: 0 });
    }
    txs.forEach((t) => {
      const y = t.date.slice(0, 4);
      const r = rows.find((x) => x.key === y);
      if (!r) return;
      if (isIncomeTx(t)) r.income += Math.abs(t.amount) / 100;
      else r.expense += Math.abs(t.amount) / 100;
    });
  } else {
    for (let i = buckets - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      rows.push({
        key,
        label: d.toLocaleString("en-US", { month: "short" }),
        income: 0, expense: 0, expenseNeg: 0, net: 0,
      });
    }
    txs.forEach((t) => {
      const k = t.date.slice(0, 7);
      const r = rows.find((x) => x.key === k);
      if (!r) return;
      if (isIncomeTx(t)) r.income += Math.abs(t.amount) / 100;
      else r.expense += Math.abs(t.amount) / 100;
    });
  }

  const finalRows = rows.map((r) => ({
    label: r.label,
    income: round2(r.income),
    expense: round2(r.expense),
    expenseNeg: round2(-r.expense), // negative for chart
    net: round2(r.income - r.expense),
  }));

  const subtitle =
    granularity === "week"
      ? `Last ${buckets} weeks`
      : granularity === "year"
      ? `Last ${buckets} years`
      : `Last ${buckets} months`;

  return { rows: finalRows, subtitle };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
