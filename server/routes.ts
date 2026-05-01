import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import cookieParser from "cookie-parser";
import { storage, seedDefaults } from "./storage";
import {
  requireAuth, isAuthed, verifyPassword, setPassword,
  issueToken, setSessionCookie, clearSessionCookie, getPasswordHash,
} from "./auth";
import {
  insertAccountSchema, insertCategorySchema, insertTransactionSchema,
  insertCategoryRuleSchema, insertBillSchema, insertBusinessSchema,
  insertPfsVersionSchema,
} from "@shared/schema";
import type { Transaction } from "@shared/schema";
import { applyColumnMap, makeExternalId, parseCsv } from "./csv";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use(cookieParser());

  // Initialize defaults on first run
  seedDefaults();
  // Force password hash generation/persistence on startup
  getPasswordHash();

  // ===== Auth =====
  app.post("/api/login", (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string" || !verifyPassword(password)) {
      return res.status(401).json({ message: "Wrong password" });
    }
    const token = issueToken();
    setSessionCookie(res, token);
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    res.json({ authed: isAuthed(req) });
  });

  // Everything below requires auth
  app.use("/api", (req, res, next) => {
    if (req.path === "/login" || req.path === "/logout" || req.path === "/me") return next();
    return requireAuth(req, res, next);
  });

  app.post("/api/change-password", (req, res) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(current || "")) return res.status(401).json({ message: "Current password incorrect" });
    if (typeof next !== "string" || next.length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });
    setPassword(next);
    res.json({ ok: true });
  });

  // ===== Accounts =====
  app.get("/api/accounts", (_req, res) => res.json(storage.listAccounts()));
  app.get("/api/accounts/:id", (req, res) => {
    const acct = storage.getAccount(Number(req.params.id));
    if (!acct) return res.status(404).json({ message: "Not found" });
    res.json(acct);
  });
  app.post("/api/accounts", (req, res) => {
    const parsed = insertAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createAccount(parsed.data));
  });
  app.patch("/api/accounts/:id", (req, res) => {
    const updated = storage.updateAccount(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/api/accounts/:id", (req, res) => {
    storage.deleteAccount(Number(req.params.id));
    res.json({ ok: true });
  });

  // Reconcile: receives statementDate, statementBalance (cents), reconciledIds
  app.post("/api/accounts/:id/reconcile", (req, res) => {
    const id = Number(req.params.id);
    const { statementDate, statementBalance, reconciledIds } = req.body || {};
    if (typeof statementDate !== "string" || typeof statementBalance !== "number") {
      return res.status(400).json({ message: "Missing statementDate or statementBalance" });
    }
    const ids: number[] = Array.isArray(reconciledIds) ? reconciledIds.filter((x) => Number.isInteger(x)) : [];
    if (ids.length) {
      storage.bulkUpdateTransactions(ids, { reconciled: true, reconciledAt: new Date().toISOString() });
    }
    storage.setReconciled(id, statementDate, statementBalance);
    res.json({ ok: true, reconciledCount: ids.length });
  });

  // ===== Categories =====
  app.get("/api/categories", (_req, res) => res.json(storage.listCategories()));
  app.post("/api/categories", (req, res) => {
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createCategory(parsed.data));
  });
  app.patch("/api/categories/:id", (req, res) => {
    const updated = storage.updateCategory(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/api/categories/:id", (req, res) => {
    storage.deleteCategory(Number(req.params.id));
    res.json({ ok: true });
  });

  // ===== Transactions =====
  app.get("/api/transactions", (req, res) => {
    const q = req.query;
    const filters: any = {};
    if (q.accountId) filters.accountId = Number(q.accountId);
    if (q.categoryId === "uncategorized") filters.categoryId = "uncategorized";
    else if (q.categoryId) filters.categoryId = Number(q.categoryId);
    if (q.startDate) filters.startDate = String(q.startDate);
    if (q.endDate) filters.endDate = String(q.endDate);
    if (q.isBusinessExpense === "true") filters.isBusinessExpense = true;
    if (q.excludeBusiness === "true") filters.excludeBusiness = true;
    if (q.search) filters.search = String(q.search);
    if (q.limit) filters.limit = Number(q.limit);
    res.json(storage.listTransactions(filters));
  });
  app.post("/api/transactions", (req, res) => {
    const parsed = insertTransactionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createTransaction(parsed.data));
  });
  app.patch("/api/transactions/:id", (req, res) => {
    const { autoLearn, ...patch } = req.body || {};
    const updated = storage.updateTransaction(Number(req.params.id), patch);
    if (!updated) return res.status(404).json({ message: "Not found" });
    // Auto-learn: when the user picks a category, create a rule for similar future transactions.
    if (autoLearn && patch.categoryId && updated.description) {
      const token = storage.extractMerchantToken(updated.description);
      if (token) {
        const existing = storage.listRules().find(
          (r) => r.matchType === "contains" && r.matchValue.toLowerCase() === token,
        );
        if (!existing) {
          storage.createRule({
            matchType: "contains",
            matchValue: token,
            categoryId: patch.categoryId,
            priority: 10,
          } as any);
        }
      }
    }
    res.json(updated);
  });
  app.delete("/api/transactions/:id", (req, res) => {
    storage.deleteTransaction(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/transactions/bulk-update", (req, res) => {
    const { ids, data } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ message: "ids required" });
    storage.bulkUpdateTransactions(ids, data || {});
    res.json({ ok: true });
  });

  // ===== Category rules =====
  app.get("/api/rules", (_req, res) => res.json(storage.listRules()));
  app.post("/api/rules", (req, res) => {
    const parsed = insertCategoryRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createRule(parsed.data));
  });
  app.delete("/api/rules/:id", (req, res) => {
    storage.deleteRule(Number(req.params.id));
    res.json({ ok: true });
  });

  // ===== Bills =====
  app.get("/api/bills", (_req, res) => res.json(storage.listBills()));
  app.post("/api/bills", (req, res) => {
    const parsed = insertBillSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createBill(parsed.data));
  });
  app.patch("/api/bills/:id", (req, res) => {
    const updated = storage.updateBill(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/api/bills/:id", (req, res) => {
    storage.deleteBill(Number(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/bills/:id/pay", (req, res) => {
    const { paidDate } = req.body || {};
    const payment = storage.payBill(Number(req.params.id), paidDate || new Date().toISOString().slice(0, 10));
    if (!payment) return res.status(404).json({ message: "Bill not found" });
    res.json(payment);
  });

  // ===== Businesses =====
  app.get("/api/businesses", (_req, res) => res.json(storage.listBusinesses()));
  app.post("/api/businesses", (req, res) => {
    const parsed = insertBusinessSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.json(storage.createBusiness(parsed.data));
  });
  app.patch("/api/businesses/:id", (req, res) => {
    const updated = storage.updateBusiness(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });
  app.delete("/api/businesses/:id", (req, res) => {
    storage.deleteBusiness(Number(req.params.id));
    res.json({ ok: true });
  });

  // ===== Reimbursements =====
  app.get("/api/reimbursements/summary", (_req, res) => {
    const businesses = storage.listBusinesses();
    const txs = storage.listTransactions({ isBusinessExpense: true });
    const summary = businesses.map((b) => {
      const businessTxs = txs.filter((t) => t.businessId === b.id);
      const owed = businessTxs.filter((t) => !t.reimbursedAt);
      const owedAmount = owed.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const allTimeAmount = businessTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      // This month
      const startMonth = new Date(); startMonth.setDate(1);
      const monthIso = startMonth.toISOString().slice(0, 10);
      const monthAmount = owed.filter((t) => t.date >= monthIso).reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const lastClearing = storage.listClearings(b.id)[0];
      return {
        businessId: b.id,
        businessName: b.name,
        owedAmount,
        owedCount: owed.length,
        monthAmount,
        allTimeAmount,
        lastClearedAt: lastClearing?.clearedAt || null,
      };
    });
    // Unassigned (isBusinessExpense=true but no businessId)
    const unassigned = txs.filter((t) => t.isBusinessExpense && !t.businessId && !t.reimbursedAt);
    const unassignedAmount = unassigned.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    res.json({ summary, unassignedAmount, unassignedCount: unassigned.length });
  });
  app.get("/api/reimbursements/clearings", (req, res) => {
    const bid = req.query.businessId ? Number(req.query.businessId) : undefined;
    res.json(storage.listClearings(bid));
  });
  app.post("/api/reimbursements/clear", (req, res) => {
    const { businessId, clearedAt, amount, notes } = req.body || {};
    if (!businessId || !clearedAt) return res.status(400).json({ message: "businessId and clearedAt required" });
    res.json(storage.clearReimbursements(Number(businessId), clearedAt, Number(amount || 0), notes || null));
  });

  // ===== Import =====
  app.post("/api/import/parse", (req, res) => {
    const { content, accountId } = req.body || {};
    if (typeof content !== "string") return res.status(400).json({ message: "content required" });
    const parsed = parseCsv(content);
    // Credit-card statements (Amex, Chase, etc.) export charges as POSITIVE numbers
    // and payments/credits as NEGATIVE — the opposite of bank checking accounts.
    // Default invertSign=true for credit_card accounts so charges become outflows (negative cents).
    const suggested = { ...parsed.suggested };
    if (accountId) {
      const acct = storage.getAccount(Number(accountId));
      if (acct && acct.type === "credit_card" && suggested.amountCol) {
        suggested.invertSign = true;
      }
    }
    res.json({ headers: parsed.headers, rows: parsed.rows.slice(0, 100), rowCount: parsed.rows.length, suggested });
  });
  app.post("/api/import/preview", (req, res) => {
    const { accountId, content, columnMap } = req.body || {};
    if (!accountId || typeof content !== "string" || !columnMap) {
      return res.status(400).json({ message: "accountId, content, columnMap required" });
    }
    const { rows } = parseCsv(content);
    const parsed = applyColumnMap(rows, columnMap);
    const externalIds = parsed.map((r) => makeExternalId(accountId, r));
    const existing = storage.findExistingExternalIds(accountId, externalIds);
    const previewRows = parsed.map((r, i) => {
      const externalId = externalIds[i];
      const isDuplicate = existing.has(externalId);
      const { categoryId, cleanMerchant } = storage.applyRules(r.description, null);
      return { ...r, externalId, isDuplicate, categoryId, merchant: cleanMerchant };
    });
    res.json({
      rows: previewRows,
      newCount: previewRows.filter((r) => !r.isDuplicate).length,
      duplicateCount: previewRows.filter((r) => r.isDuplicate).length,
    });
  });
  app.post("/api/import/commit", (req, res) => {
    const { accountId, filename, rows } = req.body || {};
    if (!accountId || !Array.isArray(rows)) return res.status(400).json({ message: "accountId, rows required" });
    const newRows = rows.filter((r: any) => !r.isDuplicate && !r.skip);
    const batch = storage.createImportBatch({
      accountId: Number(accountId),
      filename: String(filename || "import.csv"),
      rowCount: newRows.length,
    });
    for (const r of newRows) {
      storage.createTransaction({
        accountId: Number(accountId),
        date: r.date,
        amount: Number(r.amount),
        description: r.description,
        merchant: r.merchant || null,
        categoryId: r.categoryId ?? null,
        entity: "Personal",
        isBusinessExpense: !!r.isBusinessExpense,
        businessId: r.businessId ?? null,
        reimbursedAt: null,
        reconciled: false,
        reconciledAt: null,
        notes: null,
        importBatchId: batch.id,
        externalId: r.externalId,
        pending: false,
      } as any);
    }
    res.json({ batch, imported: newRows.length });
  });
  app.get("/api/import/batches", (_req, res) => res.json(storage.listImportBatches()));
  app.delete("/api/import/batches/:id", (req, res) => {
    storage.deleteImportBatch(Number(req.params.id));
    res.json({ ok: true });
  });

  // ===== Settings =====
  app.get("/api/settings", (_req, res) => {
    res.json({
      dailyDigest: storage.getSetting("daily_digest") === "true",
      weeklyDigest: storage.getSetting("weekly_digest") === "true",
    });
  });
  app.post("/api/settings", (req, res) => {
    const { dailyDigest, weeklyDigest } = req.body || {};
    if (typeof dailyDigest === "boolean") storage.setSetting("daily_digest", String(dailyDigest));
    if (typeof weeklyDigest === "boolean") storage.setSetting("weekly_digest", String(weeklyDigest));
    res.json({ ok: true });
  });

  // ===== Dashboard =====
  app.get("/api/dashboard", (req, res) => {
    const accounts = storage.listAccounts().filter((a) => !a.archived);
    const today = new Date();
    const period = (String(req.query.period || "month")) as "week" | "month" | "year";

    // ISO week: Monday-Sunday
    const fmtISO = (d: Date) => d.toISOString().slice(0, 10);
    const startOfISOWeek = (d: Date) => {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const day = x.getDay(); // 0=Sun..6=Sat
      const diff = day === 0 ? -6 : 1 - day; // shift to Monday
      x.setDate(x.getDate() + diff);
      return x;
    };
    const endOfISOWeek = (d: Date) => {
      const s = startOfISOWeek(d);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      return e;
    };

    let startCur: string, endCur: string, startPrev: string, endPrev: string;
    let dayOfPeriod: number, daysInPeriod: number, periodLabel: string, prevLabel: string;

    if (period === "week") {
      const ws = startOfISOWeek(today);
      const we = endOfISOWeek(today);
      startCur = fmtISO(ws); endCur = fmtISO(we);
      const pwStart = new Date(ws); pwStart.setDate(pwStart.getDate() - 7);
      const pwEnd = new Date(ws); pwEnd.setDate(pwEnd.getDate() - 1);
      startPrev = fmtISO(pwStart); endPrev = fmtISO(pwEnd);
      daysInPeriod = 7;
      // dayOfPeriod = days elapsed including today (1..7)
      const elapsed = Math.floor((today.getTime() - ws.getTime()) / 86400000) + 1;
      dayOfPeriod = Math.max(1, Math.min(7, elapsed));
      periodLabel = "this week";
      prevLabel = "last week";
    } else if (period === "year") {
      startCur = fmtISO(new Date(today.getFullYear(), 0, 1));
      endCur = fmtISO(new Date(today.getFullYear(), 11, 31));
      startPrev = fmtISO(new Date(today.getFullYear() - 1, 0, 1));
      endPrev = fmtISO(new Date(today.getFullYear() - 1, 11, 31));
      const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      daysInPeriod = isLeap(today.getFullYear()) ? 366 : 365;
      const startMs = new Date(today.getFullYear(), 0, 1).getTime();
      dayOfPeriod = Math.floor((today.getTime() - startMs) / 86400000) + 1;
      periodLabel = `${today.getFullYear()} YTD`;
      prevLabel = `${today.getFullYear() - 1}`;
    } else {
      // month
      startCur = fmtISO(new Date(today.getFullYear(), today.getMonth(), 1));
      endCur = fmtISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));
      startPrev = fmtISO(new Date(today.getFullYear(), today.getMonth() - 1, 1));
      endPrev = fmtISO(new Date(today.getFullYear(), today.getMonth(), 0));
      daysInPeriod = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      dayOfPeriod = today.getDate();
      periodLabel = today.toLocaleString("en-US", { month: "long" });
      prevLabel = new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleString("en-US", { month: "long" });
    }

    const monthTxs = storage.listTransactions({ startDate: startCur, endDate: endCur, excludeBusiness: true });
    const lastMonthTxs = storage.listTransactions({ startDate: startPrev, endDate: endPrev, excludeBusiness: true });

    // Income/expense classification: isIncome flag wins, fall back to amount sign.
    const cats = storage.listCategories();
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const isIncomeTx = (t: { categoryId: number | null; amount: number }) => {
      if (t.categoryId != null) {
        const c = catMap.get(t.categoryId);
        if (c) return c.isIncome;
      }
      return t.amount > 0;
    };
    const sumIncome = (arr: typeof monthTxs) => arr.filter(isIncomeTx).reduce((s, t) => s + Math.abs(t.amount), 0);
    const sumExpense = (arr: typeof monthTxs) => arr.filter((t) => !isIncomeTx(t)).reduce((s, t) => s + Math.abs(t.amount), 0);

    const incomeMonth = sumIncome(monthTxs);
    const expensesMonth = sumExpense(monthTxs);
    const netMonth = incomeMonth - expensesMonth;

    const incomeLastMonth = sumIncome(lastMonthTxs);
    const expensesLastMonth = sumExpense(lastMonthTxs);
    const netLastMonth = incomeLastMonth - expensesLastMonth;

    // Back-compat fields used elsewhere
    const totalSpentMonth = expensesMonth;
    const totalSpentLastMonth = expensesLastMonth;

    // Pace projection: (current net / days elapsed) * days in period
    const projectedNet = dayOfPeriod > 0 ? Math.round((netMonth / dayOfPeriod) * daysInPeriod) : netMonth;

    // Spending by category (excluding business and income)
    const catTotals = new Map<number | null, number>();
    monthTxs.forEach((t) => {
      if (isIncomeTx(t)) return;
      const k = t.categoryId;
      catTotals.set(k, (catTotals.get(k) || 0) + Math.abs(t.amount));
    });
    const breakdown = Array.from(catTotals.entries())
      .map(([id, amount]) => ({
        categoryId: id,
        categoryName: id ? catMap.get(id)?.name || "Other" : "Uncategorized",
        color: id ? catMap.get(id)?.color || "#94a3b8" : "#94a3b8",
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Recent transactions (5)
    const recent = storage.listTransactions({ limit: 5 });

    // Upcoming bills (14 days)
    const in14 = new Date(); in14.setDate(in14.getDate() + 14);
    const allBills = storage.listBills();
    const upcomingBills = allBills.filter((b) => b.nextDueDate <= in14.toISOString().slice(0, 10));

    // Business expenses paid this period (informational)
    const businessTxsPeriod = storage.listTransactions({ startDate: startCur, endDate: endCur, isBusinessExpense: true });
    const businessPaidPeriod = businessTxsPeriod.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Business expenses owed (all-time, current outstanding)
    const businesses = storage.listBusinesses();
    const businessTxs = storage.listTransactions({ isBusinessExpense: true });
    const owedTxs = businessTxs.filter((t) => !t.reimbursedAt);
    const businessSummary = businesses.map((b) => {
      const owed = owedTxs.filter((t) => t.businessId === b.id);
      const owedAmount = owed.reduce((s, t) => s + Math.abs(t.amount), 0);
      return { businessId: b.id, businessName: b.name, owedAmount, owedCount: owed.length };
    });
    const unassignedOwed = owedTxs.filter((t) => !t.businessId);
    const businessOwedTotal = owedTxs.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Uncategorized count
    const uncategorizedCount = storage.listTransactions({ categoryId: "uncategorized" }).length;

    res.json({
      accounts,
      period,
      periodLabel,
      prevLabel,
      startCur,
      endCur,
      totalSpentMonth,
      totalSpentLastMonth,
      incomeMonth,
      expensesMonth,
      netMonth,
      incomeLastMonth,
      expensesLastMonth,
      netLastMonth,
      projectedNet,
      daysInMonth: daysInPeriod,
      dayOfMonth: dayOfPeriod,
      businessPaidPeriod,
      breakdown: breakdown.slice(0, 20),
      recent,
      upcomingBills,
      businessOwedTotal,
      businessSummary,
      unassignedOwed: {
        amount: unassignedOwed.reduce((s, t) => s + Math.abs(t.amount), 0),
        count: unassignedOwed.length,
      },
      uncategorizedCount,
    });
  });

  // ===== Personal Financial Statement (PFS / SBA Form 413) =====
  app.get("/api/pfs", (_req, res) => {
    // Auto-derive cash & liabilities from accounts; auto-derive income/expense from last 12 months tx.
    const accts = storage.listAccounts();
    const cash = accts.filter((a) => ["checking", "savings", "cash"].includes(a.type) && !a.archived);
    const investments = accts.filter((a) => a.type === "investment" && !a.archived);
    const creditCards = accts.filter((a) => a.type === "credit_card" && !a.archived);
    const loans = accts.filter((a) => a.type === "loan" && !a.archived);

    // 12-month income/expense rollup from transactions
    const today = new Date();
    const oneYearAgo = new Date(today); oneYearAgo.setFullYear(today.getFullYear() - 1);
    const startISO = oneYearAgo.toISOString().slice(0, 10);
    const endISO = today.toISOString().slice(0, 10);
    const tx = storage.listTransactions({ startDate: startISO, endDate: endISO });
    const cats = storage.listCategories();
    const catById = new Map(cats.map((c) => [c.id, c]));
    let totalIncome = 0;
    let totalExpenses = 0;
    const expenseByCat = new Map<string, number>();
    for (const t of tx) {
      if (t.amount > 0) totalIncome += t.amount;
      else {
        totalExpenses += Math.abs(t.amount);
        const name = t.categoryId ? (catById.get(t.categoryId)?.name || "Other") : "Uncategorized";
        expenseByCat.set(name, (expenseByCat.get(name) || 0) + Math.abs(t.amount));
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      periodStart: startISO,
      periodEnd: endISO,
      derived: {
        cash: cash.map((a) => ({ id: a.id, name: a.name, institution: a.institution, balance: a.currentBalance })),
        cashTotal: cash.reduce((s, a) => s + a.currentBalance, 0),
        investments: investments.map((a) => ({ id: a.id, name: a.name, institution: a.institution, balance: a.currentBalance })),
        investmentsTotal: investments.reduce((s, a) => s + a.currentBalance, 0),
        creditCards: creditCards.map((a) => ({ id: a.id, name: a.name, institution: a.institution, balance: Math.abs(a.currentBalance), creditLimit: a.creditLimit })),
        creditCardsTotal: creditCards.reduce((s, a) => s + Math.abs(a.currentBalance), 0),
        loans: loans.map((a) => ({ id: a.id, name: a.name, institution: a.institution, balance: Math.abs(a.currentBalance) })),
        loansTotal: loans.reduce((s, a) => s + Math.abs(a.currentBalance), 0),
        annualIncome: totalIncome,
        annualExpenses: totalExpenses,
        expenseByCategory: Array.from(expenseByCat.entries())
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => b.amount - a.amount),
      },
    });
  });

  // PFS Versions — named, editable snapshots
  app.get("/api/pfs/versions", (_req, res) => {
    // Return without the heavy `data` blob in the list view
    const list = storage.listPfsVersions().map((v) => ({
      id: v.id, name: v.name, asOfDate: v.asOfDate, createdAt: v.createdAt, updatedAt: v.updatedAt,
    }));
    res.json(list);
  });
  app.get("/api/pfs/versions/:id", (req, res) => {
    const v = storage.getPfsVersion(Number(req.params.id));
    if (!v) return res.status(404).json({ message: "Not found" });
    res.json({ ...v, data: JSON.parse(v.data) });
  });
  app.post("/api/pfs/versions", (req, res) => {
    const body = req.body || {};
    if (!body.name || !body.asOfDate || !body.data) {
      return res.status(400).json({ message: "name, asOfDate, data required" });
    }
    const created = storage.createPfsVersion({
      name: String(body.name),
      asOfDate: String(body.asOfDate),
      data: typeof body.data === "string" ? body.data : JSON.stringify(body.data),
    });
    res.json({ ...created, data: JSON.parse(created.data) });
  });
  app.patch("/api/pfs/versions/:id", (req, res) => {
    const body = req.body || {};
    const patch: any = {};
    if (body.name) patch.name = String(body.name);
    if (body.asOfDate) patch.asOfDate = String(body.asOfDate);
    if (body.data !== undefined) patch.data = typeof body.data === "string" ? body.data : JSON.stringify(body.data);
    const updated = storage.updatePfsVersion(Number(req.params.id), patch);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json({ ...updated, data: JSON.parse(updated.data) });
  });
  app.delete("/api/pfs/versions/:id", (req, res) => {
    storage.deletePfsVersion(Number(req.params.id));
    res.json({ ok: true });
  });

  return httpServer;
}
