// Bills engine (auto-paid matching, suggestions, calendar feed) + monthly plan / affordability.
import crypto from "crypto";
import { sqlite, storage, advanceDueDate } from "./storage";
import { detectRecurring } from "./recurring";
import { isTransferDescription, todayNY, addDaysISO, daysBetweenISO } from "./money";
import type { Bill } from "@shared/schema";

export const BILL_GROUPS = ["Housing", "Utilities", "Auto", "Insurance", "Cards & Loans", "Subscriptions", "Family", "Other"] as const;

export function monthlyEquivalent(b: { amount: number; frequency: string }): number {
  const f: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, annual: 1 / 12, one_time: 0 };
  return Math.round(Math.abs(b.amount) * (f[b.frequency] ?? 1));
}

// Common household bills to check off. Amounts/due dates are filled in by the user.
export const BILL_TEMPLATES = [
  { key: "mortgage", name: "Mortgage", group: "Housing", frequency: "monthly", keyword: "", hint: "NBT mortgage payment" },
  { key: "home_ins", name: "Home insurance", group: "Housing", frequency: "annual", keyword: "", hint: "Skip if it's paid through your mortgage escrow" },
  { key: "prop_tax", name: "Property tax (town/county)", group: "Housing", frequency: "annual", keyword: "", hint: "Skip if escrowed" },
  { key: "school_tax", name: "School tax", group: "Housing", frequency: "annual", keyword: "", hint: "Skip if escrowed" },
  { key: "water", name: "Water / sewer", group: "Utilities", frequency: "quarterly", keyword: "", hint: "Village or water authority" },
  { key: "electric_gas", name: "Electric & gas", group: "Utilities", frequency: "monthly", keyword: "national grid", hint: "Amount varies" , variable: true },
  { key: "internet", name: "Cable / internet", group: "Utilities", frequency: "monthly", keyword: "", hint: "Spectrum, Verizon, etc." },
  { key: "phone", name: "Cell phone", group: "Utilities", frequency: "monthly", keyword: "", hint: "" },
  { key: "trash", name: "Trash pickup", group: "Utilities", frequency: "quarterly", keyword: "", hint: "" },
  { key: "car_pay", name: "Car payment", group: "Auto", frequency: "monthly", keyword: "", hint: "2023 RAM loan" },
  { key: "car_ins", name: "Car insurance", group: "Auto", frequency: "monthly", keyword: "allstate", hint: "" },
  { key: "life_ins", name: "Life insurance", group: "Insurance", frequency: "monthly", keyword: "", hint: "" },
  { key: "health_ins", name: "Health insurance", group: "Insurance", frequency: "monthly", keyword: "", hint: "" },
  { key: "pool", name: "Pool / home services", group: "Housing", frequency: "monthly", keyword: "", hint: "" },
];

function billAccount(b: Bill) {
  return b.payToAccountId ? storage.getAccount(b.payToAccountId) : undefined;
}

// Auto-mark bills paid when a matching transaction shows up.
// - Card/loan bills (payToAccountId): any payment credited to that account in the window.
// - Other bills: an outflow whose description contains the match keyword, amount within 30% (any amount if variable).
export function autoMatchBills(): { matched: number } {
  const today = todayNY();
  let matched = 0;
  const linked = new Set(
    (sqlite.prepare("SELECT transaction_id FROM bill_payments WHERE transaction_id IS NOT NULL").all() as any[]).map((r) => r.transaction_id)
  );
  for (const id of JSON.parse(storage.getSetting("bill_match_ignored") || "[]")) linked.add(id);
  for (const b0 of storage.listBills()) {
    let b = b0;
    const acct = billAccount(b);
    const kw = (b.matchKeyword || "").trim().toLowerCase();
    if (!acct && !kw) continue;
    for (let guard = 0; guard < 24; guard++) {
      const from = addDaysISO(b.nextDueDate, -14);
      const to = addDaysISO(b.nextDueDate, 7);
      if (from > today) break;
      let rows: any[];
      if (acct) {
        // Payments to cards/loans: inflow on the card. Some banks report loan payments as negative; accept both for loans.
        rows = sqlite.prepare(
          `SELECT id, date, amount, description FROM transactions WHERE account_id = ? AND date BETWEEN ? AND ? ORDER BY date`
        ).all(acct.id, from, to) as any[];
        rows = rows.filter((t) =>
          acct.type === "loan"
            ? /payment|pmt|xfer/i.test(t.description)
            : t.amount > 0 && (isTransferDescription(t.description) || /payment|pymt|pmt|thank\s*you/i.test(t.description))
        );
      } else {
        rows = sqlite.prepare(
          `SELECT id, date, amount, description FROM transactions WHERE amount < 0 AND lower(description) LIKE ? AND date BETWEEN ? AND ? ORDER BY date`
        ).all(`%${kw}%`, from, to) as any[];
        if (!b.variableAmount && b.amount) {
          rows = rows.filter((t) => Math.abs(Math.abs(t.amount) - Math.abs(b.amount)) <= Math.max(500, Math.abs(b.amount) * 0.3));
        }
      }
      const hit = rows.find((t) => !linked.has(t.id));
      if (!hit) break;
      linked.add(hit.id);
      const paidAmt = Math.abs(hit.amount);
      sqlite.prepare("INSERT INTO bill_payments (bill_id, paid_date, amount, transaction_id) VALUES (?,?,?,?)").run(b.id, hit.date, paidAmt, hit.id);
      const next = advanceDueDate(b.nextDueDate, b.frequency, b.dueDay);
      const upd: any = { nextDueDate: next, lastPaidDate: hit.date };
      if (b.frequency === "one_time") upd.archived = true;
      if (b.variableAmount) {
        const recent = sqlite.prepare("SELECT amount FROM bill_payments WHERE bill_id = ? ORDER BY paid_date DESC LIMIT 3").all(b.id) as any[];
        if (recent.length) upd.amount = Math.round(recent.reduce((s, r) => s + r.amount, 0) / recent.length);
      }
      storage.updateBill(b.id, upd);
      matched++;
      if (b.frequency === "one_time") break;
      b = storage.getBill(b.id)!;
    }
  }
  return { matched };
}

export function billStatus(b: Bill, today = todayNY()) {
  const daysUntil = daysBetweenISO(today, b.nextDueDate);
  const status = daysUntil < 0 ? "overdue" : daysUntil === 0 ? "due_today" : daysUntil <= Math.max(3, b.reminderDaysBefore) ? "due_soon" : "upcoming";
  return { daysUntil, status };
}

export function billsOverview() {
  autoMatchBills();
  const today = todayNY();
  const bills = storage.listBills();
  const accts = new Map(storage.listAccounts().map((a) => [a.id, a]));
  const items = bills.map((b) => {
    const st = billStatus(b, today);
    const lastPay = sqlite.prepare("SELECT paid_date, amount, transaction_id FROM bill_payments WHERE bill_id = ? ORDER BY paid_date DESC LIMIT 1").get(b.id) as any;
    return {
      ...b,
      ...st,
      monthly: monthlyEquivalent(b),
      accountName: b.accountId ? accts.get(b.accountId)?.name || null : null,
      payToAccountName: b.payToAccountId ? accts.get(b.payToAccountId)?.name || null : null,
      autoTracked: !!(b.payToAccountId || (b.matchKeyword || "").trim()),
      lastPayment: lastPay ? { date: lastPay.paid_date, amount: lastPay.amount, auto: !!lastPay.transaction_id } : null,
    };
  });
  const byGroup: Record<string, number> = {};
  for (const i of items) byGroup[i.billGroup || "Other"] = (byGroup[i.billGroup || "Other"] || 0) + i.monthly;
  const in30 = addDaysISO(today, 30);
  return {
    today,
    items,
    totals: {
      monthlyFixed: items.reduce((s, i) => s + i.monthly, 0),
      houseMonthly: (byGroup["Housing"] || 0) + (byGroup["Utilities"] || 0),
      byGroup,
      overdueCount: items.filter((i) => i.status === "overdue").length,
      overdueAmount: items.filter((i) => i.status === "overdue").reduce((s, i) => s + i.amount, 0),
      next7Count: items.filter((i) => i.daysUntil >= 0 && i.daysUntil <= 7).length,
      next7Amount: items.filter((i) => i.daysUntil >= 0 && i.daysUntil <= 7).reduce((s, i) => s + i.amount, 0),
      next30Amount: items.filter((i) => i.nextDueDate <= in30).reduce((s, i) => s + i.amount, 0),
    },
    setup: BILL_TEMPLATES.map((t) => ({
      ...t,
      added: bills.some((b) => b.name.toLowerCase() === t.name.toLowerCase()),
    })),
  };
}

// Recurring charges seen in transactions that aren't bills yet.
export function billSuggestions() {
  const groupFor = (cat: string | null, name: string) => {
    const n = (name + " " + (cat || "")).toLowerCase();
    if (/insur|allstate|geico|progressive|state farm/.test(n)) return "Insurance";
    if (/util|grid|water|electric|spectrum|verizon|comcast|internet|phone|t-mobile|at&t/.test(n)) return "Utilities";
    if (/mortgage|rent|pool|lawn/.test(n)) return "Housing";
    if (/subscr|netflix|spotify|hulu|openai|chatgpt|apple|google|amazon prime|youtube/.test(n)) return "Subscriptions";
    if (/auto|car|gas|monro/.test(n)) return "Auto";
    return "Other";
  };
  const dismissed = new Set(JSON.parse(storage.getSetting("bill_suggestions_dismissed") || "[]"));
  // Hide anything an existing bill already covers (by its match keyword or name).
  const billKeys = storage.listBills().filter((b: any) => !b.archived)
    .flatMap((b: any) => [b.matchKeyword, b.name].filter(Boolean).map((x: string) => x.toLowerCase().trim()))
    .filter((x: string) => x.length >= 4);
  const covered = (g: any) => {
    const hay = (g.key + " " + g.cleanName).toLowerCase();
    return billKeys.some((k: string) => hay.includes(k) || k.includes(g.cleanName.toLowerCase().trim()));
  };
  // Not bills: interest, fees, investment reinvestments, gas fill-ups.
  const NOT_BILL = /interest charge|finance charge|late fee|annual fee|reinvest|dividend|cash advance|sunoco|shell|mobil|speedway|fastrac|kwik/i;
  const tidy = (n: string) => n.replace(/^(sp\s+aff|sp|bt|aplpay|tst|sq)\s+/i, "").replace(/\s+/g, " ").trim();
  return detectRecurring()
    .filter((g) => !covered(g) && !NOT_BILL.test(g.key + " " + g.cleanName))
    .filter((g) => !g.isAlreadyTracked && !dismissed.has(g.key))
    .filter((g) => !isTransferDescription(g.key) && !isTransferDescription(g.cleanName))
    .filter((g) => g.count >= 3)
    .sort((a, b) => b.avgAmountCents - a.avgAmountCents)
    .slice(0, 25)
    .map((g) => ({
      key: g.key,
      name: tidy(g.cleanName),
      frequency: g.frequency,
      avgAmount: g.avgAmountCents,
      minAmount: g.minAmountCents,
      maxAmount: g.maxAmountCents,
      count: g.count,
      lastPaidDate: g.lastPaidDate,
      nextDueDate: g.predictedNextDate,
      accountId: g.primaryAccountId,
      accountName: g.primaryAccountName,
      group: groupFor(g.category, g.cleanName),
      variable: g.maxAmountCents - g.minAmountCents > Math.max(500, g.avgAmountCents * 0.1),
    }));
}

export function dismissSuggestion(key: string) {
  const arr = JSON.parse(storage.getSetting("bill_suggestions_dismissed") || "[]");
  if (!arr.includes(key)) arr.push(key);
  storage.setSetting("bill_suggestions_dismissed", JSON.stringify(arr));
}

// Card and loan accounts without a payment bill yet -> one-click "track due date".
export function cardBillGaps() {
  const bills = storage.listBills();
  const covered = new Set(bills.map((b) => b.payToAccountId).filter(Boolean));
  return storage.listAccounts()
    .filter((a) => !a.archived && (a.type === "credit_card" || a.type === "loan") && !covered.has(a.id))
    .map((a) => {
      // Latest payment day; loans may report payments as negatives and split principal/extra, so sum that day.
      const last = (a.type === "loan"
        ? sqlite.prepare("SELECT date, SUM(ABS(amount)) AS amount FROM transactions WHERE account_id = ? AND (lower(description) LIKE '%payment%' OR lower(description) LIKE '%xfer%') AND lower(description) NOT LIKE '%unscheduled%' GROUP BY date ORDER BY date DESC LIMIT 1")
        : sqlite.prepare("SELECT date, amount FROM transactions WHERE account_id = ? AND amount > 0 ORDER BY date DESC LIMIT 1")
      ).get(a.id) as any;
      return { id: a.id, name: a.name, type: a.type, balance: a.currentBalance, lastPayment: last ? { date: last.date, amount: last.amount } : null };
    });
}

// ===== Calendar feed =====
export function calendarKey(): string {
  let k = storage.getSetting("calendar_feed_key");
  if (!k) {
    k = crypto.randomBytes(18).toString("base64url");
    storage.setSetting("calendar_feed_key", k);
  }
  return k;
}
export function rotateCalendarKey(): string {
  const k = crypto.randomBytes(18).toString("base64url");
  storage.setSetting("calendar_feed_key", k);
  return k;
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/-/g, "");
const money = (c: number) => "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildIcs(): string {
  autoMatchBills();
  const bills = storage.listBills();
  const today = todayNY();
  const until = addDaysISO(today, 400);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KP Finance//Bills//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:KP Finance Bills", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];
  for (const b of bills) {
    let due = b.nextDueDate;
    for (let n = 0; n < 60 && due <= until; n++) {
      const end = addDaysISO(due, 1);
      const remind = Math.max(1, b.reminderDaysBefore || 3);
      const title = `${b.autopay ? "Autopay: " : "Pay: "}${b.name} ${b.variableAmount ? "~" : ""}${money(b.amount)}`;
      const desc = [
        b.autopay ? "Set to autopay. Make sure the account has enough money." : "Not on autopay. Pay this before the due date.",
        b.payee ? `Payee: ${b.payee}` : "",
        b.notes || "",
        "Open KP Finance: https://kp.sundhm.com/#/bills",
      ].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:kpbill-${b.id}-${due}@kp.sundhm.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(due)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${icsEscape(title)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(title)}`, `TRIGGER:-P${remind}DT15H`, "END:VALARM",
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape("Due today: " + title)}`, "TRIGGER:PT9H", "END:VALARM",
        "END:VEVENT",
      );
      if (b.frequency === "one_time") break;
      const next = advanceDueDate(due, b.frequency, b.dueDay);
      if (next === due) break;
      due = next;
    }
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 line folding at 75 octets
  return lines.map((l) => {
    if (l.length <= 74) return l;
    const parts: string[] = [];
    for (let i = 0; i < l.length; i += 73) parts.push((i ? " " : "") + l.slice(i, i + 73));
    return parts.join("\r\n");
  }).join("\r\n") + "\r\n";
}

// ===== Monthly plan & affordability =====
export function buildPlan() {
  const today = todayNY();
  const cats = storage.listCategories();
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const transfers = cats.find((c) => c.name === "Transfers");
  const accounts = storage.listAccounts().filter((a) => !a.archived);
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const flowAccountIds = new Set(accounts.filter((a) => !["loan", "investment"].includes(a.type)).map((a) => a.id));

  const isTransfer = (t: any) => (transfers && t.categoryId === transfers.id) || isTransferDescription(t.description);
  const isIncome = (t: any) => {
    if (isTransfer(t)) return false;
    const c = t.categoryId != null ? catMap.get(t.categoryId) : null;
    if (c) return c.isIncome;
    return t.amount > 0 && acctById.get(t.accountId)?.type !== "credit_card";
  };
  const isExpense = (t: any) => {
    if (isTransfer(t)) return false;
    const c = t.categoryId != null ? catMap.get(t.categoryId) : null;
    if (c) return !c.isIncome && t.amount < 0;
    return t.amount < 0;
  };

  // Last 3 full months that have data
  const [ty, tm] = today.split("-").map(Number);
  const months: { key: string; start: string; end: string; label: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const e = new Date(Date.UTC(ty, tm - i, 0));
    months.push({
      key: d.toISOString().slice(0, 7),
      start: d.toISOString().slice(0, 10),
      end: e.toISOString().slice(0, 10),
      label: d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
    });
  }
  const billTxIds = new Set(
    (sqlite.prepare("SELECT transaction_id FROM bill_payments WHERE transaction_id IS NOT NULL").all() as any[]).map((r) => r.transaction_id)
  );
  const monthStats = months.map((m) => {
    const txs = storage.listTransactions({ startDate: m.start, endDate: m.end, excludeBusiness: true }).filter((t) => flowAccountIds.has(t.accountId));
    const income = txs.filter(isIncome).reduce((s, t) => s + Math.abs(t.amount), 0);
    const exp = txs.filter(isExpense);
    const spending = exp.reduce((s, t) => s + Math.abs(t.amount), 0);
    const billPaid = exp.filter((t) => billTxIds.has(t.id)).reduce((s, t) => s + Math.abs(t.amount), 0);
    return { ...m, count: txs.length, income, spending, everyday: Math.max(0, spending - billPaid) };
  });
  const usable = monthStats.filter((m) => m.count >= 15).slice(0, 3);
  const avg = (k: "income" | "spending" | "everyday") => (usable.length ? Math.round(usable.reduce((s, m) => s + m[k], 0) / usable.length) : 0);

  // Top everyday categories (avg/mo) for the "where it goes" list
  const catTotals = new Map<string, number>();
  for (const m of usable) {
    const txs = storage.listTransactions({ startDate: m.start, endDate: m.end, excludeBusiness: true }).filter((t) => flowAccountIds.has(t.accountId));
    for (const t of txs.filter(isExpense)) {
      if (billTxIds.has(t.id)) continue;
      const name = t.categoryId ? catMap.get(t.categoryId)?.name || "Other" : "Uncategorized";
      catTotals.set(name, (catTotals.get(name) || 0) + Math.abs(t.amount));
    }
  }
  const topCategories = Array.from(catTotals.entries())
    .map(([name, total]) => ({ name, monthly: Math.round(total / Math.max(1, usable.length)) }))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 8);

  const bills = billsOverview();
  const overrideIncome = storage.getSetting("plan_monthly_income");
  const buffer = Number(storage.getSetting("plan_buffer") || "100000"); // cents; default $1,000
  const income = overrideIncome ? Number(overrideIncome) : avg("income");
  // Credit-card bills are excluded here: the card purchases are already in everyday spending.
  const cardIds = new Set(accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const isCardBill = (b: any) => b.payToAccountId && cardIds.has(b.payToAccountId);
  const nonCardBills = bills.items.filter((b: any) => !isCardBill(b));
  const fixed = nonCardBills.reduce((s: number, b: any) => s + (b.monthly || 0), 0);
  // If bills aren't set up yet, everyday spending includes those bills already; avoid double counting.
  const everyday = nonCardBills.length ? avg("everyday") : avg("spending");
  const need = (nonCardBills.length ? fixed : 0) + everyday;
  const leftover = income - need;

  const cashAccounts = accounts.filter((a) => a.type === "checking" || a.type === "savings" || a.type === "cash");
  const cash = cashAccounts.reduce((s, a) => s + a.currentBalance, 0);
  const cards = accounts.filter((a) => a.type === "credit_card");
  const cardDebt = cards.reduce((s, a) => s + Math.abs(Math.min(0, a.currentBalance)), 0);
  const billsNext30 = bills.totals.next30Amount;
  // Card balances that are already a bill are inside billsNext30; only count the rest separately.
  const billedCards = new Set(bills.items.map((b: any) => b.payToAccountId).filter(Boolean));
  const unbilledCardDebt = cards.filter((a) => !billedCards.has(a.id)).reduce((s, a) => s + Math.abs(Math.min(0, a.currentBalance)), 0);
  // Safe to spend = cash on hand minus bills due in the next 30 days minus your cushion.
  // Card balances without a bill set up are shown separately (they may not all be due now).
  const safeToSpend = cash - billsNext30 - buffer;

  return {
    today,
    months: monthStats.slice(0, 3).reverse(),
    monthsUsed: usable.map((m) => m.label),
    income,
    incomeIsOverride: !!overrideIncome,
    incomeAverage: avg("income"),
    fixed,
    everyday,
    need,
    leftover,
    houseMonthly: bills.totals.houseMonthly,
    cardBillsMonthly: bills.items.filter(isCardBill).reduce((s: number, b: any) => s + (b.monthly || 0), 0),
    byGroup: bills.totals.byGroup,
    topCategories,
    cash,
    cashAccounts: cashAccounts.map((a) => ({ id: a.id, name: a.name, balance: a.currentBalance })),
    cardDebt,
    unbilledCardDebt,
    billsNext30,
    buffer,
    safeToSpend,
    billsCount: bills.items.length,
    overdueCount: bills.totals.overdueCount,
    cardGaps: cardBillGaps().length,
    uncategorized90: (sqlite.prepare("SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NULL AND is_business_expense = 0 AND date >= ?").get(addDaysISO(today, -90)) as any).n as number,
  };
}
