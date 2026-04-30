import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/Money";
import { TransactionRow } from "@/components/TransactionRow";
import type { Transaction, Account, Category, Business } from "@shared/schema";
import { Briefcase, Download, Search, X } from "lucide-react";
import { formatCents, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function TransactionsPage() {
  // Read query params from hash (after the path)
  const initial = useMemo(() => parseHashParams(), []);
  const [accountId, setAccountId] = useState<string>(initial.accountId || "all");
  const [categoryId, setCategoryId] = useState<string>(initial.uncategorized ? "uncategorized" : (initial.categoryId || "all"));
  const [search, setSearch] = useState(initial.search || "");
  const [businessFilter, setBusinessFilter] = useState<string>(initial.business === "true" ? "business" : (initial.businessId ? `b:${initial.businessId}` : "all"));
  const [startDate, setStartDate] = useState(initial.startDate || "");
  const [endDate, setEndDate] = useState(initial.endDate || "");

  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });

  const filterParams: any = {};
  if (accountId !== "all") filterParams.accountId = Number(accountId);
  if (categoryId === "uncategorized") filterParams.categoryId = "uncategorized";
  else if (categoryId !== "all") filterParams.categoryId = Number(categoryId);
  if (startDate) filterParams.startDate = startDate;
  if (endDate) filterParams.endDate = endDate;
  if (search) filterParams.search = search;
  if (businessFilter === "business") filterParams.isBusinessExpense = true;
  if (businessFilter === "personal") filterParams.excludeBusiness = true;

  const { data: txs, isLoading } = useQuery<Transaction[]>({ queryKey: ["/api/transactions", filterParams] });

  let filtered = txs || [];
  if (businessFilter.startsWith("b:")) {
    const bid = Number(businessFilter.slice(2));
    filtered = filtered.filter((t) => t.businessId === bid);
  }
  if (initial.unassigned && businessFilter === "business") {
    filtered = filtered.filter((t) => !t.businessId);
  }

  const totalIn = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  const exportCSV = () => {
    const rows = [
      ["Date", "Description", "Merchant", "Account", "Category", "Business", "Amount", "Reconciled", "Reimbursed"],
      ...filtered.map((t) => [
        t.date,
        t.description,
        t.merchant || "",
        accounts.find((a) => a.id === t.accountId)?.name || "",
        categories.find((c) => c.id === t.categoryId)?.name || "",
        t.isBusinessExpense ? (businesses.find((b) => b.id === t.businessId)?.name || "Unassigned") : "",
        (t.amount / 100).toFixed(2),
        t.reconciled ? "yes" : "",
        t.reimbursedAt ? "yes" : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kp-finance-transactions-${todayISO()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setAccountId("all"); setCategoryId("all"); setSearch(""); setBusinessFilter("all"); setStartDate(""); setEndDate("");
  };

  const hasFilters = accountId !== "all" || categoryId !== "all" || search || businessFilter !== "all" || startDate || endDate;

  return (
    <div className="px-6 md:px-10 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Transactions</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">{filtered.length} transactions · <Money cents={totalIn} abs size="xs" className="text-success" /> in · <Money cents={totalOut} abs size="xs" className="text-destructive" /> out</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filtered.length} data-testid="button-export-csv"><Download className="h-4 w-4 mr-1" />Export CSV</Button>
      </div>

      <Card className="p-3 mb-4">
        <DatePresetRow startDate={startDate} endDate={endDate} onPick={(s, e) => { setStartDate(s); setEndDate(e); }} />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
          <div className="col-span-2 lg:col-span-2 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description or merchant…" className="pl-8" data-testid="input-search" />
          </div>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger data-testid="select-filter-account"><SelectValue placeholder="Account" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger data-testid="select-filter-category"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="uncategorized">Uncategorized</SelectItem>
              {categories.filter((c) => !c.archived).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={businessFilter} onValueChange={setBusinessFilter}>
            <SelectTrigger data-testid="select-filter-business"><SelectValue placeholder="Business" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Personal + business</SelectItem>
              <SelectItem value="personal">Personal only</SelectItem>
              <SelectItem value="business">Business only</SelectItem>
              {businesses.filter((b) => !b.archived).map((b) => <SelectItem key={b.id} value={`b:${b.id}`}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="col-span-2 lg:col-span-1 grid grid-cols-2 gap-1">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="From" data-testid="input-start-date" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="To" data-testid="input-end-date" />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-[11px]"><X className="h-3 w-3 mr-1" />Clear filters</Button>
          </div>
        )}
      </Card>

      <Card>
        <div className="grid grid-cols-12 gap-3 px-5 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-card-border">
          <div className="col-span-2 md:col-span-1">Date</div>
          <div className="col-span-6 md:col-span-5">Description</div>
          <div className="col-span-2 hidden md:block">Category</div>
          <div className="col-span-2 hidden md:block">Tag</div>
          <div className="col-span-3 md:col-span-1 text-right">Amount</div>
          <div className="col-span-1"></div>
        </div>
        {isLoading ? (
          <div className="p-5 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : !filtered.length ? (
          <div className="p-12 text-center text-[13px] text-muted-foreground">
            {hasFilters ? "No transactions match those filters." : "No transactions yet. Import a CSV to get started."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((t) => (
              <TransactionRow key={t.id} tx={t} categories={categories} accounts={accounts} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DatePresetRow({
  startDate, endDate, onPick,
}: { startDate: string; endDate: string; onPick: (s: string, e: string) => void }) {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startOfWeek = (d: Date) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  };

  const presets: { key: string; label: string; range: () => [string, string] }[] = [
    { key: "week", label: "This Week", range: () => {
      const ws = startOfWeek(today);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      return [fmt(ws), fmt(we)];
    }},
    { key: "month", label: "This Month", range: () => {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return [fmt(s), fmt(e)];
    }},
    { key: "last_month", label: "Last Month", range: () => {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return [fmt(s), fmt(e)];
    }},
    { key: "year", label: "This Year", range: () => {
      const s = new Date(today.getFullYear(), 0, 1);
      return [fmt(s), fmt(today)];
    }},
    { key: "all", label: "All Time", range: () => ["", ""] },
  ];

  // Determine which preset (if any) currently matches
  const activeKey = (() => {
    for (const p of presets) {
      const [s, e] = p.range();
      if (s === startDate && e === endDate) return p.key;
    }
    if (startDate || endDate) return "custom";
    return "all";
  })();

  return (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap" data-testid="transactions-presets">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mr-1">Range</span>
      {presets.map((p) => {
        const isActive = activeKey === p.key;
        return (
          <button
            key={p.key}
            onClick={() => { const [s, e] = p.range(); onPick(s, e); }}
            data-testid={`preset-${p.key}`}
            className={cn(
              "text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        );
      })}
      {activeKey === "custom" && (
        <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-muted text-foreground">Custom</span>
      )}
    </div>
  );
}

function parseHashParams(): Record<string, string> {
  const hash = window.location.hash; // e.g. #/transactions?accountId=1
  const q = hash.indexOf("?");
  if (q === -1) return {};
  const params = new URLSearchParams(hash.slice(q + 1));
  const out: Record<string, string> = {};
  params.forEach((v, k) => { out[k] = v; });
  return out;
}
