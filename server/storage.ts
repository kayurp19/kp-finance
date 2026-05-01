import {
  accounts, categories, transactions, categoryRules,
  bills, billPayments, importBatches, settings,
  businesses, reimbursementClearings, pfsVersions,
  type Account, type InsertAccount,
  type Category, type InsertCategory,
  type Transaction, type InsertTransaction,
  type CategoryRule, type InsertCategoryRule,
  type Bill, type InsertBill,
  type BillPayment, type InsertBillPayment,
  type ImportBatch, type InsertImportBatch,
  type Business, type InsertBusiness,
  type ReimbursementClearing, type InsertReimbursementClearing,
  type PfsVersion, type InsertPfsVersion,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, asc, gte, lte, sql, inArray, isNull } from "drizzle-orm";

// Resolve DB path: prefer explicit DATABASE_PATH, then DATABASE_URL=file:..., else local file.
function resolveDbPath(): string {
  const p = process.env.DATABASE_PATH;
  if (p) return p;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("file:")) return url.slice("file:".length);
  return "data.db";
}
const dbPath = resolveDbPath();
// Ensure the parent directory exists (e.g. /data on Railway volume).
try {
  const fs = require("fs");
  const path = require("path");
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
} catch {}
console.log(`[db] using SQLite at ${dbPath}`);
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Auto-create tables (avoids needing drizzle-kit push at runtime)
function initSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      institution TEXT,
      last4 TEXT,
      current_balance INTEGER NOT NULL DEFAULT 0,
      credit_limit INTEGER,
      notes TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      last_reconciled_at TEXT,
      last_reconciled_balance INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      color TEXT NOT NULL DEFAULT '#64748b',
      icon TEXT NOT NULL DEFAULT 'Tag',
      is_income INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      merchant TEXT,
      category_id INTEGER,
      entity TEXT NOT NULL DEFAULT 'Personal',
      is_business_expense INTEGER NOT NULL DEFAULT 0,
      business_id INTEGER,
      reimbursed_at TEXT,
      reconciled INTEGER NOT NULL DEFAULT 0,
      reconciled_at TEXT,
      notes TEXT,
      import_batch_id INTEGER,
      external_id TEXT,
      pending INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_type TEXT NOT NULL,
      match_value TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      payee TEXT,
      amount INTEGER NOT NULL,
      due_day INTEGER,
      frequency TEXT NOT NULL,
      next_due_date TEXT NOT NULL,
      account_id INTEGER,
      category_id INTEGER,
      autopay INTEGER NOT NULL DEFAULT 0,
      reminder_days_before INTEGER NOT NULL DEFAULT 3,
      notes TEXT,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bill_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      paid_date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      transaction_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reimbursement_clearings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      cleared_at TEXT NOT NULL,
      amount INTEGER NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS pfs_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      as_of_date TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_external ON transactions(external_id);
  `);
}
initSchema();

const DEFAULT_CATEGORIES: Array<Omit<InsertCategory, "archived">> = [
  // Income
  { name: "Salary", color: "#16a34a", icon: "Banknote", isIncome: true, parentId: null },
  { name: "Interest", color: "#16a34a", icon: "TrendingUp", isIncome: true, parentId: null },
  { name: "Refunds", color: "#16a34a", icon: "Undo2", isIncome: true, parentId: null },
  { name: "Other Income", color: "#16a34a", icon: "PiggyBank", isIncome: true, parentId: null },
  // Expenses
  { name: "Groceries", color: "#10b981", icon: "ShoppingCart", isIncome: false, parentId: null },
  { name: "Dining Out", color: "#f97316", icon: "UtensilsCrossed", isIncome: false, parentId: null },
  { name: "Coffee", color: "#a16207", icon: "Coffee", isIncome: false, parentId: null },
  { name: "Gas", color: "#dc2626", icon: "Fuel", isIncome: false, parentId: null },
  { name: "Auto/Transport", color: "#ef4444", icon: "Car", isIncome: false, parentId: null },
  { name: "Utilities", color: "#0891b2", icon: "Zap", isIncome: false, parentId: null },
  { name: "Mortgage/Rent", color: "#6366f1", icon: "Home", isIncome: false, parentId: null },
  { name: "Home Maintenance", color: "#8b5cf6", icon: "Wrench", isIncome: false, parentId: null },
  { name: "Insurance", color: "#0284c7", icon: "Shield", isIncome: false, parentId: null },
  { name: "Healthcare", color: "#e11d48", icon: "Heart", isIncome: false, parentId: null },
  { name: "Subscriptions", color: "#7c3aed", icon: "Repeat", isIncome: false, parentId: null },
  { name: "Shopping", color: "#db2777", icon: "ShoppingBag", isIncome: false, parentId: null },
  { name: "Clothing", color: "#ec4899", icon: "Shirt", isIncome: false, parentId: null },
  { name: "Travel", color: "#0ea5e9", icon: "Plane", isIncome: false, parentId: null },
  { name: "Entertainment", color: "#a855f7", icon: "Tv", isIncome: false, parentId: null },
  { name: "Hobbies", color: "#eab308", icon: "Palette", isIncome: false, parentId: null },
  { name: "Gifts", color: "#f43f5e", icon: "Gift", isIncome: false, parentId: null },
  { name: "Personal Care", color: "#d946ef", icon: "Sparkles", isIncome: false, parentId: null },
  { name: "Education", color: "#2563eb", icon: "GraduationCap", isIncome: false, parentId: null },
  { name: "Bank Fees", color: "#64748b", icon: "Landmark", isIncome: false, parentId: null },
  { name: "Taxes", color: "#475569", icon: "FileText", isIncome: false, parentId: null },
  { name: "Transfers", color: "#6b7280", icon: "ArrowLeftRight", isIncome: false, parentId: null },
  { name: "Other", color: "#94a3b8", icon: "Tag", isIncome: false, parentId: null },
];

const DEFAULT_BUSINESSES = ["Cicero Grand", "Syracuse Grand", "Super 8", "PuroClean"];

export function seedDefaults() {
  const existing = db.select().from(categories).all();
  if (existing.length === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      db.insert(categories).values({ ...cat, archived: false }).run();
    }
  }
  const existingBiz = db.select().from(businesses).all();
  if (existingBiz.length === 0) {
    for (const name of DEFAULT_BUSINESSES) {
      db.insert(businesses).values({ name, archived: false }).run();
    }
  }
}

export const storage = {
  // ===== Settings =====
  getSetting(key: string): string | undefined {
    const row = db.select().from(settings).where(eq(settings.key, key)).get();
    return row?.value;
  },
  setSetting(key: string, value: string) {
    const existing = this.getSetting(key);
    if (existing === undefined) {
      db.insert(settings).values({ key, value }).run();
    } else {
      db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    }
  },

  // ===== Accounts =====
  listAccounts(): Account[] {
    return db.select().from(accounts).orderBy(asc(accounts.name)).all();
  },
  getAccount(id: number): Account | undefined {
    return db.select().from(accounts).where(eq(accounts.id, id)).get();
  },
  createAccount(data: InsertAccount): Account {
    return db.insert(accounts).values({ ...data, createdAt: new Date().toISOString() } as any).returning().get();
  },
  updateAccount(id: number, data: Partial<InsertAccount>): Account | undefined {
    db.update(accounts).set(data as any).where(eq(accounts.id, id)).run();
    return this.getAccount(id);
  },
  deleteAccount(id: number) {
    db.delete(transactions).where(eq(transactions.accountId, id)).run();
    db.delete(accounts).where(eq(accounts.id, id)).run();
  },
  setReconciled(accountId: number, statementDate: string, statementBalance: number) {
    db.update(accounts).set({
      lastReconciledAt: statementDate,
      lastReconciledBalance: statementBalance,
    }).where(eq(accounts.id, accountId)).run();
  },

  // ===== Categories =====
  listCategories(): Category[] {
    return db.select().from(categories).orderBy(asc(categories.isIncome), asc(categories.name)).all();
  },
  getCategory(id: number): Category | undefined {
    return db.select().from(categories).where(eq(categories.id, id)).get();
  },
  createCategory(data: InsertCategory): Category {
    return db.insert(categories).values(data as any).returning().get();
  },
  updateCategory(id: number, data: Partial<InsertCategory>): Category | undefined {
    db.update(categories).set(data as any).where(eq(categories.id, id)).run();
    return this.getCategory(id);
  },
  deleteCategory(id: number) {
    db.update(transactions).set({ categoryId: null }).where(eq(transactions.categoryId, id)).run();
    db.delete(categories).where(eq(categories.id, id)).run();
  },

  // ===== Transactions =====
  listTransactions(filters: {
    accountId?: number;
    categoryId?: number | "uncategorized";
    startDate?: string;
    endDate?: string;
    isBusinessExpense?: boolean;
    excludeBusiness?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Transaction[] {
    const conds: any[] = [];
    if (filters.accountId) conds.push(eq(transactions.accountId, filters.accountId));
    if (filters.categoryId === "uncategorized") conds.push(isNull(transactions.categoryId));
    else if (typeof filters.categoryId === "number") conds.push(eq(transactions.categoryId, filters.categoryId));
    if (filters.startDate) conds.push(gte(transactions.date, filters.startDate));
    if (filters.endDate) conds.push(lte(transactions.date, filters.endDate));
    if (filters.isBusinessExpense === true) conds.push(eq(transactions.isBusinessExpense, true));
    else if (filters.excludeBusiness) conds.push(eq(transactions.isBusinessExpense, false));
    if (filters.search) {
      const s = `%${filters.search.toLowerCase()}%`;
      conds.push(sql`(LOWER(${transactions.description}) LIKE ${s} OR LOWER(COALESCE(${transactions.merchant}, '')) LIKE ${s})`);
    }
    let q = db.select().from(transactions).$dynamic();
    if (conds.length) q = q.where(and(...conds));
    q = q.orderBy(desc(transactions.date), desc(transactions.id));
    if (filters.limit) q = q.limit(filters.limit);
    if (filters.offset) q = q.offset(filters.offset);
    return q.all();
  },
  getTransaction(id: number): Transaction | undefined {
    return db.select().from(transactions).where(eq(transactions.id, id)).get();
  },
  createTransaction(data: InsertTransaction): Transaction {
    const tx = db.insert(transactions).values({ ...data, createdAt: new Date().toISOString() } as any).returning().get();
    this.recomputeAccountBalance(tx.accountId);
    return tx;
  },
  updateTransaction(id: number, data: Partial<InsertTransaction>): Transaction | undefined {
    const old = this.getTransaction(id);
    db.update(transactions).set(data as any).where(eq(transactions.id, id)).run();
    const updated = this.getTransaction(id);
    if (old) this.recomputeAccountBalance(old.accountId);
    if (updated && old && updated.accountId !== old.accountId) this.recomputeAccountBalance(updated.accountId);
    return updated;
  },
  deleteTransaction(id: number) {
    const old = this.getTransaction(id);
    db.delete(transactions).where(eq(transactions.id, id)).run();
    if (old) this.recomputeAccountBalance(old.accountId);
  },
  bulkUpdateTransactions(ids: number[], data: Partial<InsertTransaction>) {
    if (!ids.length) return;
    const txs = db.select().from(transactions).where(inArray(transactions.id, ids)).all();
    db.update(transactions).set(data as any).where(inArray(transactions.id, ids)).run();
    const accountIds = Array.from(new Set(txs.map(t => t.accountId)));
    accountIds.forEach(a => this.recomputeAccountBalance(a));
  },
  recomputeAccountBalance(accountId: number) {
    const acct = this.getAccount(accountId);
    if (!acct) return;
    const sum = sqlite.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE account_id = ?").get(accountId) as { s: number };
    db.update(accounts).set({ currentBalance: sum.s }).where(eq(accounts.id, accountId)).run();
  },

  // ===== Category rules =====
  listRules(): CategoryRule[] {
    return db.select().from(categoryRules).orderBy(desc(categoryRules.priority)).all();
  },
  createRule(data: InsertCategoryRule): CategoryRule {
    return db.insert(categoryRules).values(data as any).returning().get();
  },
  deleteRule(id: number) {
    db.delete(categoryRules).where(eq(categoryRules.id, id)).run();
  },
  // Extract a stable merchant token from a description (first 1-2 alphabetic words).
  // Used for auto-learning: when the user assigns a category, we create a rule on this token.
  extractMerchantToken(description: string): string | null {
    if (!description) return null;
    const cleaned = description
      .toLowerCase()
      .replace(/[^a-z0-9\s&]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = cleaned.split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
    if (words.length === 0) return null;
    // Use first 1 or 2 meaningful words
    return words.slice(0, Math.min(2, words.length)).join(" ");
  },

  // Apply user-defined rules first, then fall back to the built-in merchant dictionary.
  // Returns { categoryId, cleanMerchant }.
  applyRules(description: string, merchant: string | null): { categoryId: number | null; cleanMerchant: string | null } {
    const text = `${description} ${merchant || ""}`.toLowerCase();
    // 1. User-defined rules take priority
    const rules = this.listRules();
    for (const r of rules) {
      const v = r.matchValue.toLowerCase();
      if ((r.matchType === "contains" && text.includes(v)) ||
          (r.matchType === "equals" && text.trim() === v)) {
        return { categoryId: r.categoryId, cleanMerchant: null };
      }
    }
    // 2. Built-in merchant dictionary
    const { suggestMerchant } = require("./merchant-rules");
    const sugg = suggestMerchant(description, merchant);
    if (sugg.category) {
      const cat = db.select().from(categories).where(eq(categories.name, sugg.category)).get();
      if (cat) return { categoryId: cat.id, cleanMerchant: sugg.cleanName };
    }
    return { categoryId: null, cleanMerchant: sugg.cleanName };
  },

  // ===== Bills =====
  listBills(): Bill[] {
    return db.select().from(bills).where(eq(bills.archived, false)).orderBy(asc(bills.nextDueDate)).all();
  },
  getBill(id: number): Bill | undefined {
    return db.select().from(bills).where(eq(bills.id, id)).get();
  },
  createBill(data: InsertBill): Bill {
    return db.insert(bills).values(data as any).returning().get();
  },
  updateBill(id: number, data: Partial<InsertBill>): Bill | undefined {
    db.update(bills).set(data as any).where(eq(bills.id, id)).run();
    return this.getBill(id);
  },
  deleteBill(id: number) {
    db.delete(bills).where(eq(bills.id, id)).run();
  },
  payBill(billId: number, paidDate: string): BillPayment | null {
    const bill = this.getBill(billId);
    if (!bill) return null;
    const payment = db.insert(billPayments).values({
      billId, paidDate, amount: bill.amount, transactionId: null,
    } as any).returning().get();
    // Advance next due date
    const next = advanceDueDate(bill.nextDueDate, bill.frequency);
    db.update(bills).set({ nextDueDate: next }).where(eq(bills.id, billId)).run();
    return payment;
  },
  listBillPayments(billId?: number): BillPayment[] {
    let q = db.select().from(billPayments).$dynamic();
    if (billId) q = q.where(eq(billPayments.billId, billId));
    return q.orderBy(desc(billPayments.paidDate)).all();
  },

  // ===== Import =====
  createImportBatch(data: InsertImportBatch): ImportBatch {
    return db.insert(importBatches).values({ ...data, importedAt: new Date().toISOString() } as any).returning().get();
  },
  listImportBatches(): ImportBatch[] {
    return db.select().from(importBatches).orderBy(desc(importBatches.importedAt)).all();
  },
  deleteImportBatch(id: number) {
    const txs = db.select().from(transactions).where(eq(transactions.importBatchId, id)).all();
    const accountIds = Array.from(new Set(txs.map(t => t.accountId)));
    db.delete(transactions).where(eq(transactions.importBatchId, id)).run();
    db.delete(importBatches).where(eq(importBatches.id, id)).run();
    accountIds.forEach(a => this.recomputeAccountBalance(a));
  },
  // ===== Businesses =====
  listBusinesses(): Business[] {
    return db.select().from(businesses).orderBy(asc(businesses.archived), asc(businesses.name)).all();
  },
  createBusiness(data: InsertBusiness): Business {
    return db.insert(businesses).values(data as any).returning().get();
  },
  updateBusiness(id: number, data: Partial<InsertBusiness>): Business | undefined {
    db.update(businesses).set(data as any).where(eq(businesses.id, id)).run();
    return db.select().from(businesses).where(eq(businesses.id, id)).get();
  },
  deleteBusiness(id: number) {
    db.update(transactions).set({ businessId: null }).where(eq(transactions.businessId, id)).run();
    db.delete(businesses).where(eq(businesses.id, id)).run();
  },

  // ===== Reimbursements =====
  listClearings(businessId?: number): ReimbursementClearing[] {
    let q = db.select().from(reimbursementClearings).$dynamic();
    if (businessId) q = q.where(eq(reimbursementClearings.businessId, businessId));
    return q.orderBy(desc(reimbursementClearings.clearedAt)).all();
  },
  clearReimbursements(businessId: number, clearedAt: string, amount: number, notes: string | null): ReimbursementClearing {
    // Mark all currently-owed (reimbursedAt IS NULL, isBusinessExpense=true, businessId matches) transactions as reimbursed
    const now = new Date().toISOString();
    db.update(transactions)
      .set({ reimbursedAt: now })
      .where(and(
        eq(transactions.isBusinessExpense, true),
        eq(transactions.businessId, businessId),
        isNull(transactions.reimbursedAt),
      ))
      .run();
    return db.insert(reimbursementClearings).values({
      businessId, clearedAt, amount, notes,
    } as any).returning().get();
  },

  // ===== PFS versions =====
  listPfsVersions(): PfsVersion[] {
    return db.select().from(pfsVersions).orderBy(desc(pfsVersions.updatedAt)).all();
  },
  getPfsVersion(id: number): PfsVersion | undefined {
    return db.select().from(pfsVersions).where(eq(pfsVersions.id, id)).get();
  },
  createPfsVersion(data: InsertPfsVersion): PfsVersion {
    const now = new Date().toISOString();
    return db.insert(pfsVersions).values({ ...data, createdAt: now, updatedAt: now } as any).returning().get();
  },
  updatePfsVersion(id: number, data: Partial<InsertPfsVersion>): PfsVersion | undefined {
    const now = new Date().toISOString();
    db.update(pfsVersions).set({ ...data, updatedAt: now } as any).where(eq(pfsVersions.id, id)).run();
    return this.getPfsVersion(id);
  },
  deletePfsVersion(id: number) {
    db.delete(pfsVersions).where(eq(pfsVersions.id, id)).run();
  },

  findExistingExternalIds(accountId: number, externalIds: string[]): Set<string> {
    if (!externalIds.length) return new Set();
    const rows = db.select({ externalId: transactions.externalId }).from(transactions)
      .where(and(eq(transactions.accountId, accountId), inArray(transactions.externalId, externalIds)))
      .all();
    return new Set(rows.map(r => r.externalId).filter(Boolean) as string[]);
  },
};

function advanceDueDate(currentISO: string, frequency: string): string {
  const d = new Date(currentISO + "T00:00:00");
  if (frequency === "monthly") d.setMonth(d.getMonth() + 1);
  else if (frequency === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (frequency === "annual") d.setFullYear(d.getFullYear() + 1);
  // one_time: leave as-is
  return d.toISOString().slice(0, 10);
}
