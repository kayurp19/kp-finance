import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/format";
import { CheckCircle2, AlertTriangle, Circle, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";

const $ = (c: number) => formatCents(c, { abs: true }).replace(/\.\d\d$/, "");
const $s = (c: number) => (c < 0 ? "-" : "") + $(c);

type Guide = {
  today: string;
  snapshot: { cash: number; cardDebt: number; billsNext30: number; safeToSpend: number; netWorth: number; owedByBiz: number };
  facts: {
    sfConnected: boolean; cashAccounts: number;
    billsCount: number; overdueCount: number; overdueAmount: number; next7Count: number; next7Amount: number; cardGaps: number;
    calendarOn: boolean;
    toSort: number; toSortAmount: number;
    income: number; need: number; leftover: number;
    cushionGoal: number; cushionMonths: number;
    cards: { id: number; name: string; owed: number }[]; cardCount: number;
    feeTotal90: number; lateFees90: number; interest90: number;
    investments: number; hasHome: boolean;
  };
};

type Status = "done" | "todo" | "warn";
type Step = { n: number; title: string; status: Status; now: string; why: string; todo: string[]; href: string; cta: string };

function buildSteps(g: Guide): Step[] {
  const f = g.facts, s = g.snapshot;
  return [
    {
      n: 1, title: "See all your money in one place",
      status: f.sfConnected ? "done" : "todo",
      now: f.sfConnected ? `Your banks are linked. You have ${$(s.cash)} in checking and savings.` : "Your banks aren't linked yet.",
      why: "You can't manage what you can't see. Linked banks update on their own, so you don't have to upload statements.",
      todo: f.sfConnected ? ["When your wife is ready, link her accounts in Settings → Bank sync."] : ["Go to Settings → Bank sync and link your banks."],
      href: "/accounts", cta: "See my accounts",
    },
    {
      n: 2, title: "Never miss a bill",
      status: f.overdueCount > 0 ? "warn" : f.billsCount >= 5 && f.calendarOn && f.cardGaps === 0 ? "done" : "todo",
      now: f.overdueCount > 0
        ? `${f.overdueCount} bill${f.overdueCount > 1 ? "s are" : " is"} past due (${$(f.overdueAmount)}). Pay or mark paid today.`
        : f.billsCount ? `${f.billsCount} bills tracked. ${f.next7Count ? `${f.next7Count} due this week (${$(f.next7Amount)}).` : "Nothing due this week."}` : "No bills added yet.",
      why: "Late fees and missed payments hurt your credit and cost money. In the last 3 months you paid " + $(f.lateFees90) + " in late fees.",
      todo: [
        ...(f.billsCount < 5 ? ["Add your home bills: mortgage, water, electric, internet, insurance, taxes."] : []),
        ...(f.cardGaps > 0 ? [`Add due dates for ${f.cardGaps} credit card${f.cardGaps > 1 ? "s" : ""}/loans (one tap each on the Bills page).`] : []),
        ...(!f.calendarOn ? ["Turn on phone reminders (Bills → Get reminders on your phone)."] : []),
      ].concat(f.billsCount >= 5 && f.calendarOn && f.cardGaps === 0 ? ["You're set. Paid bills check themselves off."] : []),
      href: "/bills", cta: "Open Bills",
    },
    {
      n: 3, title: "Keep business and personal separate",
      status: f.toSort === 0 ? "done" : "todo",
      now: f.toSort ? `${f.toSort} charges (${$(f.toSortAmount)}) need a quick "business or personal" tap.` : "Everything is sorted.",
      why: `Business costs on your personal cards make it look like you spend more than you do. Right now your businesses owe you ${$(s.owedByBiz)} for charges on your cards.`,
      todo: f.toSort ? ["Open My Books → Sort charges. One tap sorts every charge from that store and remembers it next time."] : ["Get paid back: see Reimbursements for what each business owes you."],
      href: "/books", cta: "Sort charges",
    },
    {
      n: 4, title: "Spend less than you make",
      status: f.leftover >= 0 ? "done" : "warn",
      now: `About ${$(f.income)} comes in a month and ${$(f.need)} goes out. ${f.leftover >= 0 ? `That leaves ${$(f.leftover)}.` : `That's ${$(-f.leftover)} short each month.`}`,
      why: "This is the most important number. If it's negative, the gap goes on credit cards.",
      todo: [
        ...(f.toSort ? ["Sort your charges first. Business costs mixed in make this number look worse than it is."] : []),
        "Look at Money in & out to see your biggest costs.",
        "Cancel subscriptions you don't use.",
      ],
      href: "/books/inout", cta: "See money in & out",
    },
    {
      n: 5, title: "Pay down credit cards",
      status: s.cardDebt === 0 ? "done" : "warn",
      now: s.cardDebt ? `You owe ${$(s.cardDebt)} on ${f.cardCount} cards. You paid ${$(f.interest90)} in interest in the last 3 months.` : "No card balances. Nice.",
      why: "Card interest is usually 20-30% a year, so paying it off beats almost any investment.",
      todo: s.cardDebt ? [
        "Pay at least the minimum on every card, on time (set up autopay for the minimum).",
        "Put any extra money toward one card at a time, starting with the highest interest rate.",
        ...(f.cards.length ? ["Biggest balances: " + f.cards.slice(0, 3).map((c) => `${c.name} ${$(c.owed)}`).join(", ") + "."] : []),
        "Try not to add new charges to cards you're paying down.",
      ] : [],
      href: "/books/owe", cta: "See what I owe",
    },
    {
      n: 6, title: "Build a safety cushion",
      status: f.cushionMonths >= 3 ? "done" : "todo",
      now: f.need ? `Goal: 3 months of costs (${$(f.cushionGoal)}). You have ${$(s.cash)}, about ${f.cushionMonths} month${f.cushionMonths === 1 ? "" : "s"}.` : "Add bills and sort charges to see your goal.",
      why: "A cushion covers surprises (car, house, slow business month) so they don't go on a credit card.",
      todo: ["Keep savings in a separate account so it's not spent by accident.", "Set the cushion you never touch on Can I afford it."],
      href: "/plan", cta: "Set my cushion",
    },
    {
      n: 7, title: "Know your net worth",
      status: f.hasHome ? "done" : "todo",
      now: `Right now it shows ${$s(s.netWorth)}.${f.hasHome ? "" : " Your home's value isn't added yet, so this is too low."}`,
      why: "Net worth = what you own minus what you owe. Watching it grow is the best sign you're on track. Banks ask for it on loans.",
      todo: f.hasHome ? ["Update your home and vehicle values once a year."] : ["Add your home's value and your truck in My Books → What I own & owe."],
      href: "/books/owe", cta: "Open what I own & owe",
    },
    {
      n: 8, title: "Save for later",
      status: f.investments > 0 ? "done" : "todo",
      now: f.investments ? `${$(f.investments)} in retirement and investments.` : "No retirement accounts linked.",
      why: "Even small, regular amounts add up over time.",
      todo: ["Once cards are under control, set an automatic monthly amount into your Roth IRA."],
      href: "/accounts", cta: "See accounts",
    },
  ];
}

export default function GuidePage() {
  const q = useQuery<Guide>({ queryKey: ["/api/guide"] });
  const g = q.data;
  return (
    <div className="px-4 md:px-10 py-6 md:py-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Start here</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Your money in plain English: where it is, what's due, and what to do next.</p>
      </div>
      {q.isLoading || !g ? <Skeleton className="h-96" /> : <Body g={g} />}
    </div>
  );
}

function Body({ g }: { g: Guide }) {
  const s = g.snapshot;
  const steps = buildSteps(g);
  const done = steps.filter((x) => x.status === "done").length;
  const firstOpen = steps.find((x) => x.status !== "done")?.n ?? 0;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="In the bank" value={$(s.cash)} sub="checking + savings" href="/accounts" />
        <Tile label="Owe on cards" value={$(s.cardDebt)} sub="all credit cards" tone={s.cardDebt ? "bad" : undefined} href="/books/owe" />
        <Tile label="Bills next 30 days" value={$(s.billsNext30)} sub="from your bill list" href="/bills" />
        <Tile label="Safe to spend" value={$s(s.safeToSpend)} sub="after bills + cushion" tone={s.safeToSpend >= 0 ? "good" : "bad"} href="/plan" />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium text-[14px]">Your money checklist</div>
          <div className="text-[12px] text-muted-foreground">{done} of {steps.length} done</div>
        </div>
        <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-success" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      </Card>

      <div className="space-y-2">
        {steps.map((st) => <StepCard key={st.n} st={st} defaultOpen={st.n === firstOpen} />)}
      </div>

      <Card className="p-4">
        <div className="font-medium text-[14px] mb-2">Where to find things</div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
          {[
            ["What's due and when", "/bills", "Bills"],
            ["Business or personal? Sort charges", "/books", "My Books"],
            ["Money in vs. money out (P&L)", "/books/inout", "My Books → Money in & out"],
            ["What I own & owe (balance sheet)", "/books/owe", "My Books → Own & owe"],
            ["Can I afford this?", "/plan", "Can I afford it?"],
            ["What each business owes me", "/businesses", "Reimbursements"],
            ["Upload a statement", "/import", "Upload statements"],
            ["Link banks / settings", "/settings", "Settings"],
          ].map(([what, href, where]) => (
            <Link key={href + what} href={href} className="flex justify-between gap-3 py-1 border-b border-border/50 hover:text-primary">
              <span>{what}</span><span className="text-muted-foreground shrink-0">{where} <ArrowRight className="inline h-3 w-3" /></span>
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}

function Tile({ label, value, sub, tone, href }: { label: string; value: string; sub: string; tone?: "good" | "bad"; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-3 sm:p-4 hover-elevate cursor-pointer h-full">
        <div className="text-[12px] text-muted-foreground">{label}</div>
        <div className={`text-xl sm:text-2xl font-semibold tabular-nums ${tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </Card>
    </Link>
  );
}

function StepCard({ st, defaultOpen }: { st: Step; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = st.status === "done" ? CheckCircle2 : st.status === "warn" ? AlertTriangle : Circle;
  const color = st.status === "done" ? "text-success" : st.status === "warn" ? "text-warning" : "text-muted-foreground";
  return (
    <Card className="p-0 overflow-hidden" data-testid={`step-${st.n}`}>
      <button className="w-full flex items-start gap-3 p-4 text-left" onClick={() => setOpen(!open)}>
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${color}`} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[14px]">{st.n}. {st.title}</div>
          <div className="text-[13px] text-muted-foreground mt-0.5">{st.now}</div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 mt-1 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pl-12 space-y-3">
          <div className="text-[13px]"><span className="font-medium">Why it matters: </span>{st.why}</div>
          {st.todo.length > 0 && (
            <div>
              <div className="text-[13px] font-medium mb-1">Do this:</div>
              <ul className="list-disc pl-5 space-y-1 text-[13px]">{st.todo.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          <Link href={st.href}><Button size="sm">{st.cta}<ArrowRight className="h-3.5 w-3.5 ml-1" /></Button></Link>
        </div>
      )}
    </Card>
  );
}
