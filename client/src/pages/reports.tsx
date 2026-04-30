import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import type { Transaction, Category } from "@shared/schema";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, CartesianGrid } from "recharts";

type Range = "this_month" | "last_month" | "ytd" | "last_3" | "last_12" | "all";

export default function ReportsPage() {
  const [range, setRange] = useState<Range>("this_month");
  const { startDate, endDate, label } = useMemo(() => computeRange(range), [range]);
  const { data: txs = [], isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", { startDate, endDate, excludeBusiness: true }],
  });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  // Spending by category
  const catTotals = new Map<number | null, number>();
  let totalIn = 0, totalOut = 0;
  txs.forEach((t) => {
    if (t.amount >= 0) totalIn += t.amount;
    else {
      totalOut += Math.abs(t.amount);
      catTotals.set(t.categoryId, (catTotals.get(t.categoryId) || 0) + Math.abs(t.amount));
    }
  });
  const catData = Array.from(catTotals.entries())
    .map(([id, amount]) => {
      const c = id ? categories.find((c) => c.id === id) : null;
      return { id, name: c?.name || "Uncategorized", color: c?.color || "#94a3b8", amount };
    })
    .sort((a, b) => b.amount - a.amount);

  // Top merchants (by description)
  const merchTotals = new Map<string, number>();
  txs.forEach((t) => {
    if (t.amount >= 0) return;
    const key = (t.merchant || t.description).slice(0, 40);
    merchTotals.set(key, (merchTotals.get(key) || 0) + Math.abs(t.amount));
  });
  const topMerchants = Array.from(merchTotals.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10);

  // Income vs expense by month bucket (for ranges > 1 month)
  const monthly: Record<string, { month: string; income: number; expense: number }> = {};
  txs.forEach((t) => {
    const m = t.date.slice(0, 7);
    if (!monthly[m]) monthly[m] = { month: m, income: 0, expense: 0 };
    if (t.amount >= 0) monthly[m].income += t.amount / 100;
    else monthly[m].expense += Math.abs(t.amount) / 100;
  });
  const monthlyArr = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Personal expenses · business excluded · {label}</p>
        </div>
        <Select value={range} onValueChange={(v: any) => setRange(v)}>
          <SelectTrigger className="w-48" data-testid="select-range"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="last_3">Last 3 months</SelectItem>
            <SelectItem value="last_12">Last 12 months</SelectItem>
            <SelectItem value="ytd">Year to date</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5"><div className="text-[12px] uppercase tracking-wide text-muted-foreground">Income</div><Money cents={totalIn} size="2xl" className="font-semibold mt-2 text-success" /></Card>
        <Card className="p-5"><div className="text-[12px] uppercase tracking-wide text-muted-foreground">Spending</div><Money cents={totalOut} size="2xl" className="font-semibold mt-2 text-destructive" /></Card>
        <Card className="p-5"><div className="text-[12px] uppercase tracking-wide text-muted-foreground">Net</div><Money cents={totalIn - totalOut} colored size="2xl" className="font-semibold mt-2" /></Card>
      </div>

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
                      <span className="text-muted-foreground text-[10px]">{((c.amount / totalOut) * 100).toFixed(0)}%</span>
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

      {monthlyArr.length > 1 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold mb-3">Income vs spending</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyArr}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: any) => `$${Number(v).toFixed(2)}`} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="income" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}

function computeRange(range: Range): { startDate: string; endDate: string; label: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const monthName = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });
  switch (range) {
    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(today), label: monthName(start) };
    }
    case "last_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end), label: monthName(start) };
    }
    case "last_3": {
      const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      return { startDate: fmt(start), endDate: fmt(today), label: "Last 3 months" };
    }
    case "last_12": {
      const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      return { startDate: fmt(start), endDate: fmt(today), label: "Last 12 months" };
    }
    case "ytd": {
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: fmt(start), endDate: fmt(today), label: `${today.getFullYear()} YTD` };
    }
    case "all":
    default:
      return { startDate: "", endDate: fmt(today), label: "All time" };
  }
}
