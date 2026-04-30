import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// All money values are integer cents to avoid float precision issues.

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(), // checking | savings | credit_card | loan | investment | cash
  institution: text("institution"),
  last4: text("last4"),
  currentBalance: integer("current_balance").notNull().default(0),
  creditLimit: integer("credit_limit"),
  notes: text("notes"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  lastReconciledAt: text("last_reconciled_at"),
  lastReconciledBalance: integer("last_reconciled_balance"),
  createdAt: text("created_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  color: text("color").notNull().default("#64748b"),
  icon: text("icon").notNull().default("Tag"),
  isIncome: integer("is_income", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  date: text("date").notNull(), // ISO yyyy-mm-dd
  amount: integer("amount").notNull(), // cents (negative=outflow, positive=inflow)
  description: text("description").notNull(),
  merchant: text("merchant"),
  categoryId: integer("category_id"),
  // Schema-only fields kept for forward-compat; not exposed in UI per user.
  entity: text("entity").notNull().default("Personal"),
  isBusinessExpense: integer("is_business_expense", { mode: "boolean" }).notNull().default(false),
  businessId: integer("business_id"),
  reimbursedAt: text("reimbursed_at"),
  // Reconciliation
  reconciled: integer("reconciled", { mode: "boolean" }).notNull().default(false),
  reconciledAt: text("reconciled_at"),
  notes: text("notes"),
  importBatchId: integer("import_batch_id"),
  externalId: text("external_id"),
  pending: integer("pending", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const categoryRules = sqliteTable("category_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchType: text("match_type").notNull(), // contains | equals
  matchValue: text("match_value").notNull(),
  categoryId: integer("category_id").notNull(),
  priority: integer("priority").notNull().default(0),
});

export const bills = sqliteTable("bills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  payee: text("payee"),
  amount: integer("amount").notNull(),
  dueDay: integer("due_day"),
  frequency: text("frequency").notNull(), // monthly | quarterly | annual | one_time
  nextDueDate: text("next_due_date").notNull(),
  accountId: integer("account_id"),
  categoryId: integer("category_id"),
  autopay: integer("autopay", { mode: "boolean" }).notNull().default(false),
  reminderDaysBefore: integer("reminder_days_before").notNull().default(3),
  notes: text("notes"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const billPayments = sqliteTable("bill_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  billId: integer("bill_id").notNull(),
  paidDate: text("paid_date").notNull(),
  amount: integer("amount").notNull(),
  transactionId: integer("transaction_id"),
});

export const importBatches = sqliteTable("import_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const businesses = sqliteTable("businesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const reimbursementClearings = sqliteTable("reimbursement_clearings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  clearedAt: text("cleared_at").notNull(),
  amount: integer("amount").notNull(),
  notes: text("notes"),
});

export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertCategoryRuleSchema = createInsertSchema(categoryRules).omit({ id: true });
export const insertBillSchema = createInsertSchema(bills).omit({ id: true });
export const insertBillPaymentSchema = createInsertSchema(billPayments).omit({ id: true });
export const insertImportBatchSchema = createInsertSchema(importBatches).omit({ id: true, importedAt: true });
export const insertBusinessSchema = createInsertSchema(businesses).omit({ id: true });
export const insertReimbursementClearingSchema = createInsertSchema(reimbursementClearings).omit({ id: true });

export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type CategoryRule = typeof categoryRules.$inferSelect;
export type InsertCategoryRule = z.infer<typeof insertCategoryRuleSchema>;
export type Bill = typeof bills.$inferSelect;
export type InsertBill = z.infer<typeof insertBillSchema>;
export type BillPayment = typeof billPayments.$inferSelect;
export type InsertBillPayment = z.infer<typeof insertBillPaymentSchema>;
export type ImportBatch = typeof importBatches.$inferSelect;
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type ReimbursementClearing = typeof reimbursementClearings.$inferSelect;
export type InsertReimbursementClearing = z.infer<typeof insertReimbursementClearingSchema>;
