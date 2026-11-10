// "Books": business-vs-personal review queue, P&L and balance sheet.
import { storage, sqlite } from "./storage";
import { isTransferDescription, todayNY, addDaysISO } from "./money";
import * as planner from "./planner";

let ready = false;
export function init() {
  if (ready) return;
  sqlite.exec(`CREATE TABLE IF NOT EXISTS business_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_value TEXT NOT NULL,
    business_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );`);
  const tcols = sqlite.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (!tcols.some((c) => c.name === "reviewed")) sqlite.exec("ALTER TABLE transactions ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0;");
  ready = true;
}

// ---------- merchant keys ----------
const PREFIX = /^(sp|aff|tst|sq|bt|aplpay|pp|paypal|py|pos|dbt|debit|purchase|card|recurring|ach|web|ppd|checkcard|chk)\b\s*/;
export function normalizeDesc(d: string): string {
  return (d || "").toLowerCase().replace(/[^a-z0-9&\s]/g, " ").replace(/\s+/g, " ").trim();
}
export function merchantKey(d: string): string {
  let s = normalizeDesc(d);
  for (let i = 0; i < 4; i++) { const n = s.replace(PREFIX, ""); if (n === s) break; s = n; }
  const words = s.split(" ").filter((w) => w.length >= 3 && !/\d/.test(w));
  return words.slice(0, 2).join(" ") || s.split(" ")[0] || "other";
}
function titleCase(s: string) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

// ---------- business rules ----------
export function listBusinessRules() {
  init();
  return sqlite.prepare("SELECT r.id, r.match_value AS matchValue, r.business_id AS businessId, b.name AS businessName FROM business_rules r LEFT JOIN businesses b ON b.id = r.business_id ORDER BY r.id DESC").all();
}
export function addBusinessRule(matchValue: string, businessId: number) {
  init();
  const v = matchValue.trim().toLowerCase();
  if (!v) return;
  sqlite.prepare("DELETE FROM business_rules WHERE match_value = ?").run(v);
  sqlite.prepare("INSERT INTO business_rules (match_value, business_id, created_at) VALUES (?,?,?)").run(v, businessId, new Date().toISOString());
}
export function deleteBusinessRule(id: number) { init(); sqlite.prepare("DELETE FROM business_rules WHERE id = ?").run(id); }

// Tag not-yet-reviewed spending that matches a business rule. Never touches anything you've decided.
export function applyBusinessRules(): number { return applyBusinessRulesIds().length; }
export function applyBusinessRulesIds(): number[] {
  init();
  const rules = sqlite.prepare("SELECT match_value, business_id FROM business_rules").all() as any[];
  if (!rules.length) return [];
  const hitIds: number[] = [];
  const rows = sqlite.prepare("SELECT id, description FROM transactions WHERE reviewed = 0 AND is_business_expense = 0 AND amount < 0").all() as any[];
  const upd = sqlite.prepare("UPDATE transactions SET is_business_expense = 1, business_id = ?, entity = 'Business' WHERE id = ?");
  let n = 0;
  const tx = sqlite.transaction(() => {
    for (const r of rows) {
      if (isTransferDescription(r.description)) continue;
      const nd = normalizeDesc(r.description);
      const hit = rules.find((ru) => nd.includes(ru.match_value));
      if (hit) { upd.run(hit.business_id, r.id); n++; hitIds.push(r.id); }
    }
  });
  tx();
  return hitIds;
}

// ---------- review queue ----------
function flowAccounts() {
  return storage.listAccounts().filter((a) => !a.archived && !["loan", "investment"].includes(a.type));
}
function transfersId() { return storage.listCategories().find((c) => c.name === "Transfers")?.id ?? -1; }

export function reviewQueue(opts: { days?: number; includeCategorized?: boolean } = {}) {
  init();
  const days = opts.days ?? 365;
  const since = addDaysISO(todayNY(), -days);
  const accts = new Map(flowAccounts().map((a) => [a.id, a]));
  const tid = transfersId();
  const where = opts.includeCategorized ? "" : "AND category_id IS NULL";
  const spend = (sqlite.prepare(
    `SELECT id, date, amount, description, account_id AS accountId, category_id AS categoryId, 'out' AS dir FROM transactions
     WHERE reviewed = 0 AND is_business_expense = 0 AND amount < 0 AND date >= ? AND COALESCE(category_id, -2) <> ? ${where}
     ORDER BY date DESC`
  ).all(since, tid) as any[]);
  // Marked business but no business picked yet (any age, not paid back)
  const noBiz = sqlite.prepare(
    `SELECT id, date, amount, description, account_id AS accountId, category_id AS categoryId, 'biz' AS dir FROM transactions
     WHERE is_business_expense = 1 AND business_id IS NULL AND reimbursed_at IS NULL ORDER BY date DESC`
  ).all() as any[];
  // Money in to a bank account with no category (what was this deposit?)
  const moneyIn = (sqlite.prepare(
    `SELECT id, date, amount, description, account_id AS accountId, category_id AS categoryId, 'in' AS dir FROM transactions
     WHERE reviewed = 0 AND is_business_expense = 0 AND amount > 0 AND category_id IS NULL AND date >= ? ORDER BY date DESC`
  ).all(since) as any[]).filter((t) => accts.get(t.accountId)?.type !== "credit_card");
  const rows = [...spend, ...noBiz, ...moneyIn].filter((t) => accts.has(t.accountId) && !isTransferDescription(t.description));

  // History: what you decided before for each merchant
  const hist = sqlite.prepare(
    `SELECT description, is_business_expense AS biz, business_id AS businessId, category_id AS categoryId FROM transactions
     WHERE (is_business_expense = 1 AND business_id IS NOT NULL) OR (reviewed = 1 AND category_id IS NOT NULL)`
  ).all() as any[];
  const histByKey = new Map<string, { biz: Map<number, number>; cat: Map<number, number> }>();
  for (const h of hist) {
    const k = merchantKey(h.description);
    if (!histByKey.has(k)) histByKey.set(k, { biz: new Map(), cat: new Map() });
    const e = histByKey.get(k)!;
    if (h.biz && h.businessId) e.biz.set(h.businessId, (e.biz.get(h.businessId) || 0) + 1);
    else if (h.categoryId) e.cat.set(h.categoryId, (e.cat.get(h.categoryId) || 0) + 1);
  }
  const top = (m: Map<number, number>) => { let best: [number, number] | null = null; m.forEach((v, k) => { if (!best || v > best[1]) best = [k, v]; }); return best as [number, number] | null; };

  const groups = new Map<string, any>();
  for (const t of rows) {
    const mk = merchantKey(t.description);
    const k = t.dir + ":" + mk;
    if (!groups.has(k)) groups.set(k, { key: k, match: mk, dir: t.dir, name: titleCase(mk), count: 0, total: 0, lastDate: t.date, accounts: new Set<string>(), items: [] as any[] });
    const g = groups.get(k);
    g.count++; g.total += Math.abs(t.amount);
    g.accounts.add(accts.get(t.accountId)!.name);
    g.items.push({ ...t, accountName: accts.get(t.accountId)!.name });
  }
  const bizNames = new Map(storage.listBusinesses().map((b) => [b.id, b.name]));
  const catNames = new Map(storage.listCategories().map((c) => [c.id, c.name]));
  const out = Array.from(groups.values()).map((g) => {
    const h = histByKey.get(g.match);
    const b = h && top(h.biz), c = h && top(h.cat);
    let suggestion: any = null;
    if (b && (!c || b[1] >= c[1])) suggestion = { kind: "business", businessId: b[0], label: bizNames.get(b[0]) || "Business", times: b[1] };
    else if (c) suggestion = { kind: "personal", categoryId: c[0], label: catNames.get(c[0]) || "Personal", times: c[1] };
    // If some items already have a category, offer it as the personal default
    const firstCat = g.items.find((i: any) => i.categoryId)?.categoryId ?? null;
    return { ...g, accounts: Array.from(g.accounts), suggestion, currentCategoryId: firstCat };
  });
  const order: Record<string, number> = { biz: 0, out: 1, in: 2 };
  out.sort((a, b) => order[a.dir] - order[b.dir] || b.total - a.total);
  return { groups: out, count: rows.length, total: rows.reduce((s, t) => s + Math.abs(t.amount), 0) };
}

export function decide(body: { ids: number[]; kind: "personal" | "business" | "transfer"; categoryId?: number | null; businessId?: number | null; remember?: string | null }) {
  init();
  const ids = (body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new Error("No transactions picked");
  const ph = ids.map(() => "?").join(",");
  let ruled = 0;
  let alsoIds: number[] = [];
  if (body.kind === "transfer") {
    const t = transfersId();
    sqlite.prepare(`UPDATE transactions SET category_id = ?, reviewed = 1 WHERE id IN (${ph})`).run(t, ...ids);
    return { updated: ids.length, alsoMatched: 0 };
  }
  if (body.kind === "business") {
    if (!body.businessId) throw new Error("Pick a business");
    sqlite.prepare(`UPDATE transactions SET is_business_expense = 1, business_id = ?, entity = 'Business', reviewed = 1 WHERE id IN (${ph})`).run(body.businessId, ...ids);
    if (body.remember) { addBusinessRule(body.remember, body.businessId); alsoIds = applyBusinessRulesIds(); ruled = alsoIds.length; }
  } else {
    if (body.categoryId) {
      sqlite.prepare(`UPDATE transactions SET is_business_expense = 0, business_id = NULL, entity = 'Personal', category_id = ?, reviewed = 1 WHERE id IN (${ph})`).run(body.categoryId, ...ids);
      if (body.remember) {
        const v = body.remember.trim().toLowerCase();
        const exists = storage.listRules().some((r) => r.matchValue.toLowerCase() === v);
        if (!exists) storage.createRule({ matchType: "contains", matchValue: v, categoryId: body.categoryId, priority: 5 } as any);
        // Fill the same category on other uncategorized personal rows from this merchant
        const others = sqlite.prepare("SELECT id, description FROM transactions WHERE category_id IS NULL AND is_business_expense = 0 AND amount < 0").all() as any[];
        const upd = sqlite.prepare("UPDATE transactions SET category_id = ? WHERE id = ?");
        for (const o of others) if (normalizeDesc(o.description).includes(v) && !isTransferDescription(o.description)) { upd.run(body.categoryId, o.id); ruled++; alsoIds.push(o.id); }
      }
    } else {
      sqlite.prepare(`UPDATE transactions SET is_business_expense = 0, business_id = NULL, entity = 'Personal', reviewed = 1 WHERE id IN (${ph})`).run(...ids);
    }
  }
  return { updated: ids.length, alsoMatched: ruled, alsoIds };
}

// Undo: put transactions back the way they were and forget the remembered rule.
export function reopen(body: { ids: number[]; alsoIds?: number[]; dir?: string; rule?: string | null }) {
  init();
  const ids = (body.ids || []).map(Number).filter(Boolean);
  const also = (body.alsoIds || []).map(Number).filter(Boolean);
  const all = [...ids, ...also];
  if (!all.length) return 0;
  const ph = (a: number[]) => a.map(() => "?").join(",");
  if (body.dir === "biz") {
    sqlite.prepare(`UPDATE transactions SET business_id = NULL, reviewed = 0 WHERE id IN (${ph(ids)}) AND reimbursed_at IS NULL`).run(...ids);
  } else if (ids.length) {
    sqlite.prepare(`UPDATE transactions SET reviewed = 0, is_business_expense = 0, business_id = NULL, entity = 'Personal', category_id = NULL WHERE id IN (${ph(ids)}) AND reimbursed_at IS NULL`).run(...ids);
  }
  if (also.length) sqlite.prepare(`UPDATE transactions SET is_business_expense = 0, business_id = NULL, entity = 'Personal', category_id = CASE WHEN is_business_expense = 1 THEN category_id ELSE NULL END WHERE id IN (${ph(also)}) AND reimbursed_at IS NULL AND reviewed = 0`).run(...also);
  if (body.rule) {
    const v = body.rule.trim().toLowerCase();
    sqlite.prepare("DELETE FROM business_rules WHERE match_value = ?").run(v);
    sqlite.prepare("DELETE FROM category_rules WHERE lower(match_value) = ? AND priority = 5").run(v);
  }
  return all.length;
}

// ---------- Profit & Loss ----------
type Mode = "personal" | "business";
function monthKeys(start: string, end: string) {
  const out: string[] = [];
  let [y, m] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 36) break; }
  return out;
}
export function profitAndLoss(start: string, end: string, mode: Mode = "personal", businessId?: number | null) {
  init();
  const accts = new Map(flowAccounts().map((a) => [a.id, a]));
  const cats = storage.listCategories();
  const catMap = new Map(cats.map((c) => [c.id, c]));
  const tid = transfersId();
  const months = monthKeys(start, end);
  const all = sqlite.prepare(
    `SELECT id, date, amount, description, account_id AS accountId, category_id AS categoryId, is_business_expense AS biz, business_id AS businessId
     FROM transactions WHERE date BETWEEN ? AND ?`
  ).all(start, end) as any[];
  const rows = all.filter((t) => {
    if (!accts.has(t.accountId)) return false;
    if (t.categoryId === tid || isTransferDescription(t.description)) return false;
    if (mode === "personal") return !t.biz;
    return t.biz && (!businessId || t.businessId === businessId);
  });
  type Line = { key: string; name: string; categoryId: number | null; total: number; byMonth: Record<string, number>; count: number };
  const income = new Map<string, Line>(), expense = new Map<string, Line>();
  for (const t of rows) {
    const c = t.categoryId != null ? catMap.get(t.categoryId) : null;
    const acct = accts.get(t.accountId)!;
    // Income = money in that's categorized as income, or uncategorized money into a bank account.
    // Refunds/credits on cards reduce the matching expense line.
    const isInc = c ? (c.isIncome && t.amount > 0) : (t.amount > 0 && acct.type !== "credit_card");
    const bucket = isInc ? income : expense;
    const name = c ? c.name : (isInc ? "Uncategorized income" : "Uncategorized");
    const key = c ? String(c.id) : (isInc ? "uncat-in" : "uncat");
    if (!bucket.has(key)) bucket.set(key, { key, name, categoryId: c?.id ?? null, total: 0, byMonth: {}, count: 0 });
    const l = bucket.get(key)!;
    const v = isInc ? t.amount : -t.amount; // expenses positive; refunds negative
    l.total += v; l.count++;
    const mk = t.date.slice(0, 7);
    l.byMonth[mk] = (l.byMonth[mk] || 0) + v;
  }
  const sortLines = (m: Map<string, Line>) => Array.from(m.values()).filter((l) => l.total !== 0).sort((a, b) => b.total - a.total);
  const inc = sortLines(income), exp = sortLines(expense);
  const sum = (ls: Line[]) => ls.reduce((s, l) => s + l.total, 0);
  const sumM = (ls: Line[]) => Object.fromEntries(months.map((m) => [m, ls.reduce((s, l) => s + (l.byMonth[m] || 0), 0)]));
  const totalIncome = sum(inc), totalExpense = sum(exp);
  const incM = sumM(inc), expM = sumM(exp);
  return {
    start, end, mode, businessId: businessId ?? null, months,
    income: inc, expenses: exp,
    totalIncome, totalExpense, net: totalIncome - totalExpense,
    totalIncomeByMonth: incM, totalExpenseByMonth: expM,
    netByMonth: Object.fromEntries(months.map((m) => [m, incM[m] - expM[m]])),
    unreviewed: mode === "personal" ? reviewQueue().count : 0,
  };
}

export function pnlLines(start: string, end: string, mode: Mode, key: string, businessId?: number | null) {
  const p = profitAndLoss(start, end, mode, businessId);
  void p;
  const accts = new Map(flowAccounts().map((a) => [a.id, a]));
  const tid = transfersId();
  const cats = new Map(storage.listCategories().map((c) => [c.id, c]));
  const all = sqlite.prepare(
    `SELECT id, date, amount, description, account_id AS accountId, category_id AS categoryId, is_business_expense AS biz, business_id AS businessId
     FROM transactions WHERE date BETWEEN ? AND ? ORDER BY date DESC`
  ).all(start, end) as any[];
  return all.filter((t) => {
    if (!accts.has(t.accountId) || t.categoryId === tid || isTransferDescription(t.description)) return false;
    if (mode === "personal" ? t.biz : !(t.biz && (!businessId || t.businessId === businessId))) return false;
    const c = t.categoryId != null ? cats.get(t.categoryId) : null;
    const isInc = c ? (c.isIncome && t.amount > 0) : (t.amount > 0 && accts.get(t.accountId)!.type !== "credit_card");
    const k = c ? String(c.id) : (isInc ? "uncat-in" : "uncat");
    return k === key;
  }).map((t) => ({ ...t, accountName: accts.get(t.accountId)!.name }));
}

// ---------- Balance sheet ----------
type ManualItem = { id: string; name: string; side: "asset" | "liability"; group: string; amount: number };
export function getManualItems(): ManualItem[] {
  try { return JSON.parse(storage.getSetting("balance_sheet_items") || "[]"); } catch { return []; }
}
export function saveManualItems(items: ManualItem[]) {
  const clean = (items || []).map((i) => ({
    id: String(i.id || Math.random().toString(36).slice(2, 10)),
    name: String(i.name || "").slice(0, 80) || "Item",
    side: i.side === "liability" ? "liability" : "asset",
    group: String(i.group || (i.side === "liability" ? "Other debts" : "Other assets")),
    amount: Math.abs(Math.round(Number(i.amount) || 0)),
  })) as ManualItem[];
  storage.setSetting("balance_sheet_items", JSON.stringify(clean));
  return clean;
}

export function getHiddenUntracked(): number[] {
  try { return JSON.parse(storage.getSetting("balance_sheet_hidden") || "[]"); } catch { return []; }
}
export function hideUntracked(id: number) {
  const cur = getHiddenUntracked();
  if (!cur.includes(Number(id))) cur.push(Number(id));
  storage.setSetting("balance_sheet_hidden", JSON.stringify(cur));
  return { hidden: cur };
}

export function balanceSheet() {
  init();
  const accounts = storage.listAccounts().filter((a) => !a.archived);
  const line = (a: any) => ({ id: a.id, name: a.name, amount: a.currentBalance });
  const cash = accounts.filter((a) => ["checking", "savings", "cash"].includes(a.type)).map(line);
  const invest = accounts.filter((a) => a.type === "investment").map(line);
  const cards = accounts.filter((a) => a.type === "credit_card").map((a) => ({ id: a.id, name: a.name, amount: Math.max(0, -a.currentBalance) }));
  const loans = accounts.filter((a) => a.type === "loan").map((a) => ({ id: a.id, name: a.name, amount: Math.abs(a.currentBalance) }));

  // Business charges on your personal cards not yet paid back = money the businesses owe you
  const owed = sqlite.prepare(
    `SELECT b.id, b.name, SUM(ABS(t.amount)) AS amount, COUNT(*) AS n FROM transactions t JOIN businesses b ON b.id = t.business_id
     WHERE t.is_business_expense = 1 AND t.reimbursed_at IS NULL AND t.amount < 0 GROUP BY b.id ORDER BY amount DESC`
  ).all() as any[];
  const unassignedBiz = (sqlite.prepare("SELECT SUM(ABS(amount)) AS a, COUNT(*) AS n FROM transactions WHERE is_business_expense = 1 AND business_id IS NULL AND reimbursed_at IS NULL AND amount < 0").get() as any);

  const manual = getManualItems();
  let sfIgnored: any[] = [];
  try { sfIgnored = sqlite.prepare("SELECT id, name, balance FROM simplefin_accounts WHERE ignored = 1").all() as any[]; } catch {}
  const untracked = sfIgnored
    .filter((u) => u.balance != null && !manual.some((m) => m.name === u.name) && !getHiddenUntracked().includes(Number(u.id)))
    .map((u) => ({ id: u.id, name: u.name, balance: u.balance }));

  const sum = (ls: { amount: number }[]) => ls.reduce((s, l) => s + l.amount, 0);
  const groupsOf = (side: "asset" | "liability") => {
    const m = new Map<string, { name: string; amount: number; id: string }[]>();
    for (const i of manual.filter((x) => x.side === side)) {
      if (!m.has(i.group)) m.set(i.group, []);
      m.get(i.group)!.push({ id: i.id, name: i.name, amount: i.amount });
    }
    return Array.from(m.entries()).map(([name, items]) => ({ name, items, total: sum(items), manual: true }));
  };
  const owedLines = owed.map((o) => ({ id: o.id, name: o.name, amount: o.amount, count: o.n }));
  if (unassignedBiz?.a) owedLines.push({ id: 0, name: "Business, not assigned yet", amount: unassignedBiz.a, count: unassignedBiz.n });

  const assets = [
    { name: "Cash (checking & savings)", items: cash, total: sum(cash) },
    { name: "Investments & retirement", items: invest, total: sum(invest) },
    { name: "Owed to you by your businesses", items: owedLines, total: sum(owedLines) },
    ...groupsOf("asset"),
  ].filter((g) => g.items.length);
  const liabilities = [
    { name: "Credit cards", items: cards, total: sum(cards) },
    { name: "Loans & mortgage", items: loans, total: sum(loans) },
    ...groupsOf("liability"),
  ].filter((g) => g.items.length);
  const totalAssets = assets.reduce((s, g) => s + g.total, 0);
  const totalLiabilities = liabilities.reduce((s, g) => s + g.total, 0);
  return { asOf: todayNY(), assets, liabilities, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, manual, untracked };
}

// ---------- Money guide ----------
export function moneyGuide() {
  init();
  const plan = planner.buildPlan();
  const bills = planner.billsOverview();
  const review = reviewQueue();
  const bs = balanceSheet();
  const today = todayNY();
  const since90 = addDaysISO(today, -90);
  const feeRows = sqlite.prepare(
    `SELECT description, amount FROM transactions WHERE amount < 0 AND date >= ?`
  ).all(since90) as any[];
  const FEE = /interest charge|finance charge|late (payment )?fee|overdraft|maintenance service|monthly service fee|annual fee|cash advance fee|returned payment/i;
  const fees = feeRows.filter((r) => FEE.test(r.description));
  const feeTotal = fees.reduce((s, r) => s + Math.abs(r.amount), 0);
  const lateFees = fees.filter((r) => /late|returned/i.test(r.description)).reduce((s, r) => s + Math.abs(r.amount), 0);
  const interest = fees.filter((r) => /interest|finance charge/i.test(r.description)).reduce((s, r) => s + Math.abs(r.amount), 0);

  const accounts = storage.listAccounts().filter((a) => !a.archived);
  const cards = accounts.filter((a) => a.type === "credit_card" && a.currentBalance < 0)
    .map((a) => ({ id: a.id, name: a.name, owed: -a.currentBalance })).sort((a, b) => b.owed - a.owed);
  let sfConnected = false;
  try { sfConnected = (sqlite.prepare("SELECT COUNT(*) AS n FROM simplefin_connections").get() as any)?.n > 0; } catch {}
  const calLastFetch = storage.getSetting("calendar_last_fetch");
  const owedByBiz = bs.assets.find((g: any) => g.name === "Owed to you by your businesses")?.total || 0;
  const investments = bs.assets.find((g: any) => g.name === "Investments & retirement")?.total || 0;
  const hasHome = bs.manual.some((m) => /home|house/i.test(m.name));
  // Cushion goal: 3 months of basic costs (bills + everyday)
  const monthlyNeed = plan.need || 0;
  const cushionGoal = monthlyNeed * 3;
  const cushionMonths = monthlyNeed ? plan.cash / monthlyNeed : 0;

  return {
    today,
    snapshot: {
      cash: plan.cash, cardDebt: plan.cardDebt, billsNext30: plan.billsNext30, safeToSpend: plan.safeToSpend,
      netWorth: bs.netWorth, owedByBiz,
    },
    facts: {
      sfConnected, cashAccounts: plan.cashAccounts.length,
      billsCount: bills.items.length, overdueCount: bills.totals.overdueCount, overdueAmount: bills.totals.overdueAmount,
      next7Count: bills.totals.next7Count, next7Amount: bills.totals.next7Amount, cardGaps: plan.cardGaps,
      calendarOn: !!calLastFetch, calLastFetch,
      toSort: review.count, toSortAmount: review.total,
      income: plan.income, need: plan.need, leftover: plan.leftover,
      cushionGoal, cushionMonths: Math.round(cushionMonths * 10) / 10,
      cards: cards.slice(0, 5), cardCount: cards.length,
      feeTotal90: feeTotal, lateFees90: lateFees, interest90: interest,
      investments, hasHome, homeAdded: hasHome,
    },
  };
}
