// Detect recurring bills from transaction history.
//
// Heuristic: group expenses (negative amounts) by a normalized merchant key,
// and flag groups that:
//   - have 3+ payments
//   - average interval matches monthly (~25-35d), quarterly (~85-95d), or annual (~360-380d)
//   - amounts are within ~25% of each other (utilities/cable vary monthly)
//
// For each recurring group return:
//   - clean merchant name (from rules) or normalized key
//   - average amount
//   - frequency
//   - next predicted due date (last paid + avg interval)
//   - list of payments (date, amount, account) so user sees the mess

import { storage } from "./storage";
import { suggestMerchant } from "./merchant-rules";
import type { Transaction } from "@shared/schema";

export interface RecurringPayment {
  date: string;
  amountCents: number;
  accountId: number;
  accountName: string;
  transactionId: number;
}

export interface RecurringGroup {
  key: string;                // normalized merchant key
  cleanName: string;          // display name
  category: string | null;    // suggested category
  count: number;              // how many payments seen
  avgAmountCents: number;
  minAmountCents: number;
  maxAmountCents: number;
  totalCents: number;         // total spend YTD on this merchant
  frequency: "monthly" | "quarterly" | "annual";
  avgIntervalDays: number;
  lastPaidDate: string;
  predictedNextDate: string;
  primaryAccountId: number;   // most-used account
  primaryAccountName: string;
  uniqueAccountCount: number; // how many different accounts paid this
  payments: RecurringPayment[];
  isAlreadyTracked: boolean;  // true if there's already a Bill row for this
}

const MONTHLY_MIN = 25, MONTHLY_MAX = 35;
const QUARTERLY_MIN = 80, QUARTERLY_MAX = 100;
const ANNUAL_MIN = 350, ANNUAL_MAX = 380;

function normalizeKey(description: string): string {
  // Strip dates, card-last-4, store numbers, location codes, then keep first
  // 1-3 alphabetic tokens as the key.
  let s = description.toLowerCase();
  // Remove things like "03/12", "card 7208", state abbrev at end, store #s.
  s = s.replace(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g, " ");
  s = s.replace(/\bcard\s*\d{4}\b/g, " ");
  s = s.replace(/#\s*\d+/g, " ");
  s = s.replace(/\b\d{3,}\b/g, " ");
  s = s.replace(/[^a-z0-9 &]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Tokens that are noise.
  const NOISE = new Set([
    "card", "purchase", "payment", "ppd", "id", "web", "ach", "pmt",
    "online", "remote", "deposit", "venmo", "the", "of", "co", "inc", "llc",
    "us", "usa", "ny", "ca", "tx", "fl", "nj", "pa", "va", "md", "il", "mi",
    "to", "for", "visa", "direct", "ending", "in", "from", "atm", "withdraw",
    "service", "fee", "dept",
  ]);
  const tokens = s.split(" ").filter((t) => t.length >= 2 && !NOISE.has(t));
  return tokens.slice(0, 3).join(" ").trim();
}

function frequencyFromInterval(days: number): "monthly" | "quarterly" | "annual" | null {
  if (days >= MONTHLY_MIN && days <= MONTHLY_MAX) return "monthly";
  if (days >= QUARTERLY_MIN && days <= QUARTERLY_MAX) return "quarterly";
  if (days >= ANNUAL_MIN && days <= ANNUAL_MAX) return "annual";
  return null;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((db - da) / 86400000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function detectRecurring(): RecurringGroup[] {
  // Pull all expense transactions (negative amounts), excluding transfers.
  const txns = storage.listTransactions({}) as Transaction[];
  const accounts = storage.listAccounts();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const bills = storage.listBills();
  const trackedKeys = new Set<string>();
  for (const b of bills) {
    if (b.payee) trackedKeys.add(normalizeKey(b.payee));
    trackedKeys.add(normalizeKey(b.name));
  }

  // Group by normalized key.
  type Bucket = {
    key: string;
    cleanName: string;
    category: string | null;
    payments: RecurringPayment[];
  };
  const buckets = new Map<string, Bucket>();

  for (const t of txns) {
    if (t.amount >= 0) continue; // only outflows
    // Skip obvious internal transfers and credit card payments to self.
    const desc = t.description || "";
    const lower = desc.toLowerCase();
    if (/payment\s+to\s+chase|payment\s+thank\s+you|autopay|transfer|td\s+bank\s+payment/i.test(lower)) {
      // Most credit card auto-payments — skip as they double-count.
      continue;
    }
    const key = normalizeKey(desc);
    if (!key || key.length < 3) continue;

    const suggestion = suggestMerchant(desc);
    const cleanName = suggestion.cleanName || key.replace(/\b\w/g, (c) => c.toUpperCase());

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, cleanName, category: suggestion.category || null, payments: [] };
      buckets.set(key, bucket);
    }
    const acct = accountMap.get(t.accountId);
    bucket.payments.push({
      date: t.date,
      amountCents: Math.abs(t.amount),
      accountId: t.accountId,
      accountName: acct?.name || `Account ${t.accountId}`,
      transactionId: t.id,
    });
  }

  const groups: RecurringGroup[] = [];

  for (const bucket of buckets.values()) {
    const ps = bucket.payments
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    if (ps.length < 3) continue;

    // Compute intervals between consecutive payments.
    const intervals: number[] = [];
    for (let i = 1; i < ps.length; i++) {
      intervals.push(daysBetween(ps[i - 1].date, ps[i].date));
    }
    const avgInterval = Math.round(intervals.reduce((s, n) => s + n, 0) / intervals.length);
    const freq = frequencyFromInterval(avgInterval);
    if (!freq) continue;

    // Amount stats.
    const amounts = ps.map((p) => p.amountCents);
    const minAmt = Math.min(...amounts);
    const maxAmt = Math.max(...amounts);
    const avgAmt = Math.round(amounts.reduce((s, n) => s + n, 0) / amounts.length);
    // Reject if max is more than 2x min — too volatile to be recurring.
    if (maxAmt > minAmt * 2.5) continue;

    // Find primary account.
    const acctCounts = new Map<number, { count: number; name: string }>();
    for (const p of ps) {
      const e = acctCounts.get(p.accountId) || { count: 0, name: p.accountName };
      e.count += 1;
      acctCounts.set(p.accountId, e);
    }
    let primary = { id: ps[0].accountId, name: ps[0].accountName, count: 0 };
    for (const [id, info] of acctCounts) {
      if (info.count > primary.count) primary = { id, name: info.name, count: info.count };
    }

    const lastPaid = ps[ps.length - 1].date;
    const predictedNext = addDays(lastPaid, avgInterval);

    groups.push({
      key: bucket.key,
      cleanName: bucket.cleanName,
      category: bucket.category,
      count: ps.length,
      avgAmountCents: avgAmt,
      minAmountCents: minAmt,
      maxAmountCents: maxAmt,
      totalCents: amounts.reduce((s, n) => s + n, 0),
      frequency: freq,
      avgIntervalDays: avgInterval,
      lastPaidDate: lastPaid,
      predictedNextDate: predictedNext,
      primaryAccountId: primary.id,
      primaryAccountName: primary.name,
      uniqueAccountCount: acctCounts.size,
      payments: ps,
      isAlreadyTracked: trackedKeys.has(bucket.key),
    });
  }

  // Sort by total annualized spend descending (biggest impact first).
  groups.sort((a, b) => b.totalCents - a.totalCents);
  return groups;
}
