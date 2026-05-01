import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Money } from "@/components/Money";
import { formatDateShort, daysBetween, todayISO } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Briefcase, AlertCircle, Plus, Sparkles, FileQuestion, TrendingUp, TrendingDown, Zap, CheckCircle2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Account, Bill, Transaction } from "@shared/schema";

type Period = "week" | "month" | "year";

interface DashboardData {
  accounts: Account[];
  period: Period;
  periodLabel: string;
  prevLabel: string;
  startCur: string;
  endCur: string;
  totalSpentMonth: number;
  totalSpentLastMonth: number;
  incomeMonth: number;
  expensesMonth: number;
  netMonth: number;
  incomeLastMonth: number;
  expensesLastMonth: number;
  netLastMonth: number;
  projectedNet: number;
  daysInMonth: number;
  dayOfMonth: number;
  businessPaidPeriod: number;
  breakdown: Array<{ categoryId: number | null; categoryName: string; color: string; amount: number }>;
  recent: Transaction[];
  upcomingBills: Bill[];
  businessOwedTotal: number;
  businessSummary: Array<{ businessId: number; businessName: string; owedAmount: number; owedCount: number }>;
  unassignedOwed: { amount: number; count: number };
  uncategorizedCount: number;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("month");
  const { data, isLoading } = useQuery<DashboardData>({ queryKey: ["/api/dashboard", { period }] });

  if (isLoading && !data) return <DashboardSkeleton />;
  if (!data) return null;

  // Empty-state onboarding
  if (data.accounts.length === 0) {
    return <EmptyOnboarding />;
  }

  const netDelta = data.netMonth - data.netLastMonth;
  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  const maxBreakdown = data.breakdown[0]?.amount || 1;
  const top5 = data.breakdown.slice(0, 5);
  const projectionLabel = period === "week" ? "week" : period === "year" ? "year" : "month";

  return (
    <div className="px-6 md:px-10 py-8 space-y-7 max-w-7xl">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">{monthName} {new Date().getFullYear()}</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodToggle value={period} onChange={setPeriod} />
          {data.uncategorizedCount > 0 && (
            <Link href="/transactions?uncategorized=1">
              <a className="inline-flex items-center gap-2 text-[13px] px-3 py-1.5 rounded-md bg-warning/10 text-warning hover-elevate" data-testid="link-uncategorized">
                <FileQuestion className="h-3.5 w-3.5" />
                {data.uncategorizedCount} need a category
              </a>
            </Link>
          )}
        </div>
      </header>

      {/* Hero: Net this period — Income / Expenses / Net */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Net {data.periodLabel}</div>
            <div className="text-[11px] text-muted-foreground/80 mt-0.5">Personal · business excluded</div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <HeroStat
            label="Income"
            cents={data.incomeMonth}
            tone="success"
            testid="stat-income"
          />
          <HeroStat
            label="Expenses"
            cents={data.expensesMonth}
            tone="destructive"
            testid="stat-expenses"
          />
          <div data-testid="stat-net">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Net</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <Money
                cents={data.netMonth}
                size="3xl"
                className={cn("font-semibold", data.netMonth >= 0 ? "text-success" : "text-destructive")}
              />
            </div>
            {data.businessOwedTotal > 0 && (
              <div className="text-[11px] text-muted-foreground mt-1">
                + <Money cents={data.businessOwedTotal} abs size="xs" className="text-warning font-medium" /> owed back from businesses
              </div>
            )}
          </div>
        </div>

        {/* vs previous period */}
        <div className="mt-5 pt-4 border-t border-border/60 flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">vs. {data.prevLabel}:</span>
          <span className="text-foreground/90">net was <Money cents={data.netLastMonth} colored size="sm" className="font-medium" /></span>
          {netDelta !== 0 && (
            <span className={cn("inline-flex items-center gap-1", netDelta > 0 ? "text-success" : "text-destructive")}>
              {netDelta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {netDelta > 0 ? "up " : "down "}<Money cents={netDelta} abs size="sm" />
            </span>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Where it went */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[15px] font-semibold">Where it went</h2>
              <p className="text-[12px] text-muted-foreground">Top categories {data.periodLabel}</p>
            </div>
          </div>
          {top5.length === 0 ? (
            <p className="text-[13px] text-muted-foreground italic py-4">No expenses {data.periodLabel} yet.</p>
          ) : (
            <div className="space-y-3">
              {top5.map((b) => {
                const pct = (b.amount / maxBreakdown) * 100;
                const totalPct = data.expensesMonth > 0 ? Math.round((b.amount / data.expensesMonth) * 100) : 0;
                return (
                  <div key={String(b.categoryId)} data-testid={`row-category-${b.categoryId}`}>
                    <div className="flex items-center justify-between text-[13px] mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                        <span className="font-medium">{b.categoryName}</span>
                        <span className="text-muted-foreground text-[11px]">{totalPct}%</span>
                      </div>
                      <Money cents={b.amount} abs size="sm" />
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: b.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Business owed */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5" /> Owed by businesses
              </div>
              <div className="text-[11px] text-muted-foreground/80 mt-0.5">Paid from personal cards</div>
            </div>
          </div>
          <div className="mt-3">
            <Money cents={data.businessOwedTotal} size="2xl" className="font-semibold text-warning" />
          </div>
          {data.businessPaidPeriod > 0 && (
            <div className="text-[11px] text-muted-foreground mt-1">
              <Money cents={data.businessPaidPeriod} abs size="xs" className="font-medium" /> paid {data.periodLabel}
            </div>
          )}
          <div className="mt-3 space-y-1">
            {data.businessSummary.filter(b => b.owedAmount > 0).slice(0, 4).map((b) => (
              <Link key={b.businessId} href={`/transactions?businessId=${b.businessId}`}>
                <a className="flex items-center justify-between text-[12px] py-0.5 rounded hover-elevate px-1 -mx-1" data-testid={`link-business-${b.businessId}`}>
                  <span className="text-muted-foreground">{b.businessName}</span>
                  <Money cents={b.owedAmount} abs size="xs" className="font-medium" />
                </a>
              </Link>
            ))}
            {data.businessSummary.every(b => b.owedAmount === 0) && (
              <div className="text-[11px] text-muted-foreground italic">Nothing owed right now</div>
            )}
          </div>
          {data.unassignedOwed.count > 0 && (
            <Link href="/transactions?business=true&unassigned=1">
              <a className="mt-3 flex items-center gap-1.5 text-[11px] text-warning hover:underline" data-testid="link-unassigned-business">
                <AlertCircle className="h-3 w-3" />
                {data.unassignedOwed.count} unassigned · <Money cents={data.unassignedOwed.amount} abs size="xs" />
              </a>
            </Link>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Account balances */}
        <Card className="p-6 lg:col-span-1">
          <h2 className="text-[15px] font-semibold mb-4">Accounts</h2>
          <div className="space-y-2.5">
            {data.accounts.map((a) => (
              <Link key={a.id} href={`/accounts/${a.id}`}>
                <a className="flex items-center justify-between py-1.5 px-1 -mx-1 rounded hover-elevate" data-testid={`account-${a.id}`}>
                  <div>
                    <div className="text-[13px] font-medium">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">{a.type.replace("_", " ")}{a.last4 ? ` · ${a.last4}` : ""}</div>
                  </div>
                  <AccountBalanceLabel account={a} />
                </a>
              </Link>
            ))}
          </div>
        </Card>

        {/* Upcoming bills */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold">Upcoming bills (14 days)</h2>
            <Link href="/bills"><a className="text-[12px] text-primary hover:underline">View all</a></Link>
          </div>
          {data.upcomingBills.length === 0 ? (
            <p className="text-[13px] text-muted-foreground italic">No bills due soon.</p>
          ) : (
            <div className="space-y-2">
              {data.upcomingBills.slice(0, 6).map((b) => {
                const days = daysBetween(todayISO(), b.nextDueDate);
                return (
                  <div key={b.id} className="flex items-center justify-between text-[13px] py-1.5 border-b border-border/50 last:border-0">
                    <div>
                      <div className="font-medium">{b.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDateShort(b.nextDueDate)} · {days <= 0 ? "due today" : `in ${days} day${days === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <Money cents={b.amount} abs size="sm" />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Recent transactions */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <Link href="/transactions"><a className="text-[12px] text-primary hover:underline">All transactions</a></Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="text-[13px] text-muted-foreground italic">No transactions yet.</p>
          ) : (
            <div className="space-y-2">
              {data.recent.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-[13px] py-1.5 border-b border-border/50 last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.description}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDateShort(t.date)}{t.isBusinessExpense ? " · business" : ""}</div>
                  </div>
                  <Money cents={t.amount} expense colored={t.amount > 0} size="sm" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Net Worth Trajectory hint */}
      <Card className="p-4 bg-muted/30 border-dashed">
        <div className="flex items-start gap-3 text-[13px]">
          {data.projectedNet >= 0 ? (
            <TrendingUp className="h-4 w-4 text-success shrink-0 mt-0.5" />
          ) : (
            <TrendingDown className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          )}
          <div>
            <span className="text-muted-foreground">If this {projectionLabel}'s pace continues, you'll end the {projectionLabel} at </span>
            <Money
              cents={data.projectedNet}
              colored
              size="sm"
              className="font-semibold"
            />
            <span className="text-muted-foreground"> · {data.dayOfMonth} of {data.daysInMonth} days elapsed</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function HeroStat({ label, cents, tone, testid }: { label: string; cents: number; tone: "success" | "destructive"; testid: string }) {
  const toneClass = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className="mt-1.5">
        <Money cents={cents} abs size="2xl" className={cn("font-semibold", toneClass)} />
      </div>
    </div>
  );
}

function PeriodToggle({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  const opts: { v: Period; label: string }[] = [
    { v: "week", label: "Week" },
    { v: "month", label: "Month" },
    { v: "year", label: "Year" },
  ];
  return (
    <div className="inline-flex items-center bg-muted rounded-md p-0.5" role="tablist" data-testid="period-toggle">
      {opts.map((o) => (
        <button
          key={o.v}
          role="tab"
          aria-selected={value === o.v}
          onClick={() => onChange(o.v)}
          data-testid={`period-${o.v}`}
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

function AccountBalanceLabel({ account }: { account: Account }) {
  const isCC = account.type === "credit_card";
  if (isCC) {
    const owed = Math.abs(Math.min(0, account.currentBalance));
    return (
      <div className="text-right">
        <Money cents={owed} abs size="sm" className="text-destructive font-medium" />
        <div className="text-[10px] text-muted-foreground">owed</div>
      </div>
    );
  }
  return <Money cents={account.currentBalance} colored={account.currentBalance < 0} size="sm" className="font-medium" />;
}

interface YtdResult {
  accountsCreated: number;
  transactionsImported: number;
  transactionsCategorized: number;
  transfersTagged: number;
  perAccount: Array<{ name: string; transactions: number; inflow: number; outflow: number }>;
  warnings: string[];
}

function EmptyOnboarding() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [result, setResult] = useState<YtdResult | null>(null);

  const ytdMutation = useMutation<YtdResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup/ytd", {});
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries();
      toast({ title: "YTD setup complete", description: `${data.transactionsImported} transactions imported across ${data.accountsCreated} accounts.` });
    },
    onError: (e: any) => {
      toast({ title: "Setup failed", description: e.message, variant: "destructive" });
    },
  });

  if (result) {
    return (
      <div className="px-6 md:px-10 py-12 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <h1 className="text-xl font-semibold">YTD setup complete</h1>
        </div>
        <p className="text-muted-foreground text-[14px] mb-6">
          {result.transactionsImported} transactions imported across {result.accountsCreated} accounts. {result.transactionsCategorized} auto-categorized. {result.transfersTagged} inter-account transfers detected.
        </p>
        <Card className="p-4 mb-6">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium mb-3">Per account</div>
          <div className="space-y-2">
            {result.perAccount.map((a) => (
              <div key={a.name} className="flex justify-between text-[13px]">
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground">
                  {a.transactions} txns &middot; <span className="text-success">+${a.inflow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> / <span className="text-destructive">${a.outflow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Button onClick={() => window.location.reload()} data-testid="button-reload-after-ytd">Open dashboard</Button>
      </div>
    );
  }

  return (
    <div className="px-6 md:px-10 py-12 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Welcome to KP Finance</h1>
      </div>
      <p className="text-muted-foreground text-[14px] mb-6">Get organized in one click.</p>

      <Card className="p-5 mb-6 border-primary/30 bg-primary/[0.03]">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-[14px]">Set up my 2026 YTD</div>
            <div className="text-[13px] text-muted-foreground mt-1 mb-4">
              Imports all your statements in one shot: Chase, KeyBank, Amex, TD, Discover, Citi, NBT, plus Roth IRA and mortgage. ~547 transactions across 11 accounts. Auto-categorized. Inter-account transfers flagged. One-time only.
            </div>
            <Button
              onClick={() => ytdMutation.mutate()}
              disabled={ytdMutation.isPending}
              data-testid="button-setup-ytd"
            >
              {ytdMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Importing&hellip;</>
              ) : (
                <>Run YTD setup</>
              )}
            </Button>
          </div>
        </div>
      </Card>

      <p className="text-[12px] text-muted-foreground mb-3">Or set up manually:</p>
      <ol className="space-y-3">
        <Step n={1} title="Add your accounts" desc="Checking, savings, credit cards. We'll track balances.">
          <Link href="/accounts"><Button data-testid="button-onboard-accounts" size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" />Add account</Button></Link>
        </Step>
        <Step n={2} title="Import a statement" desc="Drop a CSV or PDF from your bank. We'll auto-categorize what we can.">
          <Link href="/import"><Button data-testid="button-onboard-import" size="sm" variant="outline">Import file</Button></Link>
        </Step>
        <Step n={3} title="Reconcile and review" desc="Tag what's personal vs business. Confirm balances match your statements." />
      </ol>
    </div>
  );
}

function Step({ n, title, desc, children }: { n: number; title: string; desc: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-4 p-4 bg-card border border-card-border rounded-xl">
      <div className="h-7 w-7 rounded-full bg-primary/10 text-primary font-mono text-[13px] flex items-center justify-center font-medium shrink-0">{n}</div>
      <div className="flex-1">
        <div className="font-medium text-[14px]">{title}</div>
        <div className="text-[13px] text-muted-foreground mt-0.5">{desc}</div>
      </div>
      {children && <div className="shrink-0 self-center">{children}</div>}
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="px-6 md:px-10 py-8 space-y-6 max-w-7xl">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-40" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
