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
    const updated = storage.updateTransaction(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
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
    const { content } = req.body || {};
    if (typeof content !== "string") return res.status(400).json({ message: "content required" });
    const parsed = parseCsv(content);
    res.json({ headers: parsed.headers, rows: parsed.rows.slice(0, 100), rowCount: parsed.rows.length, suggested: parsed.suggested });
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
      const categoryId = storage.applyRules(r.description, null);
      return { ...r, externalId, isDuplicate, categoryId };
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
        merchant: null,
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
  app.get("/api/dashboard", (_req, res) => {
    const accounts = storage.listAccounts().filter((a) => !a.archived);
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const startLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
    const endLastMonth = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

    const monthTxs = storage.listTransactions({ startDate: startMonth, excludeBusiness: true });
    const lastMonthTxs = storage.listTransactions({ startDate: startLastMonth, endDate: endLastMonth, excludeBusiness: true });

    const totalSpentMonth = monthTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalSpentLastMonth = lastMonthTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    // Spending by category (excluding business)
    const cats = storage.listCategories();
    const catMap = new Map(cats.map((c) => [c.id, c]));
    const catTotals = new Map<number | null, number>();
    monthTxs.forEach((t) => {
      if (t.amount >= 0) return;
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

    // Business expenses owed (this month + all-time)
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
      totalSpentMonth,
      totalSpentLastMonth,
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

  return httpServer;
}
