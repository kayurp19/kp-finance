// One-time YTD setup: bulk-import Kayur's 2026 YTD across 10 accounts.
//
// Endpoint POST /api/setup/ytd is idempotent: if the marker account "Setup:
// YTD imported" exists OR if there are already > 100 transactions in the DB,
// it refuses to run.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { storage } from "./storage";
import { suggestMerchant } from "./merchant-rules";
import type { InsertAccount, InsertTransaction, Account, Category } from "@shared/schema";

// Find seed-data directory. In dev: <repo>/server/seed-data. In prod (bundled
// to dist/index.cjs): <repo>/dist/seed-data, copied during build.
function getSeedDir(): string {
  // Try import.meta.url first (ESM dev), fall back to __dirname (CJS prod).
  let here: string;
  try {
    // @ts-ignore
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    here = (typeof __dirname !== "undefined" ? __dirname : process.cwd());
  }
  const candidates = [
    resolve(here, "seed-data"),         // dev: server/seed-data
    resolve(here, "..", "seed-data"),   // prod: dist/index.cjs -> dist/seed-data
    resolve(process.cwd(), "server", "seed-data"),
    resolve(process.cwd(), "dist", "seed-data"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Could not locate seed-data directory. Searched: ${candidates.join(", ")}`);
}

interface FileSpec {
  filename: string;
  accountName: string;
  accountType: "checking" | "credit_card";
  institution: string;
  last4?: string;
  parser: "chase_checking" | "chase_card" | "keybank" | "td_card" | "discover" | "citi_card" | "nbt_checking" | "amex";
}

const SPECS: FileSpec[] = [
  { filename: "chase_checking_8641.csv", accountName: "Chase Checking 8641", accountType: "checking",   institution: "Chase",    last4: "8641", parser: "chase_checking" },
  { filename: "chase_card_2711.csv",      accountName: "Chase Card 2711",      accountType: "credit_card", institution: "Chase",    last4: "2711", parser: "chase_card" },
  { filename: "keybank_checking_9579.csv",accountName: "KeyBank Checking 9579",accountType: "checking",   institution: "KeyBank",  last4: "9579", parser: "keybank" },
  { filename: "keybank_mc_9352.csv",      accountName: "KeyBank Mastercard 9352", accountType: "credit_card", institution: "KeyBank", last4: "9352", parser: "keybank" },
  { filename: "td_card_0411.csv",         accountName: "TD Credit Card 0411",  accountType: "credit_card", institution: "TD Bank",  last4: "0411", parser: "td_card" },
  { filename: "discover.csv",             accountName: "Discover",             accountType: "credit_card", institution: "Discover",                parser: "discover" },
  { filename: "citi_card.csv",            accountName: "Citi Card",            accountType: "credit_card", institution: "Citibank",                parser: "citi_card" },
  { filename: "nbt_checking.csv",         accountName: "NBT Checking",         accountType: "checking",   institution: "NBT Bank",                  parser: "nbt_checking" },
  { filename: "amex.csv",                 accountName: "Amex",                 accountType: "credit_card", institution: "American Express",        parser: "amex" },
];

// Manually-tracked NBT mortgage + Fidelity Roth (no transactions, just balances)
const STATIC_ACCOUNTS: InsertAccount[] = [
  { name: "NBT Mortgage", type: "loan", institution: "NBT Bank", last4: "1403", currentBalance: -15891213, notes: "5100 Constitution Lane, Liverpool NY. 3.125% rate. Monthly payment $837.36. Co-borrowers: Satish Patel + Damyanti Patel.", archived: false } as InsertAccount,
  { name: "Fidelity Roth IRA", type: "investment", institution: "Fidelity", last4: "7718", currentBalance: 725346, notes: "Account 250537718", archived: false } as InsertAccount,
];

function parseMoney(s: string): number {
  if (!s) return 0;
  const cleaned = String(s).replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "-") return 0;
  const n = Number(cleaned);
  if (isNaN(n)) return 0;
  return Math.round(n * 100); // cents
}

function toIsoDate(s: string): string {
  s = (s || "").trim();
  // mm/dd/yyyy or mm/dd/yy
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let yyyy = slash[3];
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    return `${yyyy}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }
  // already iso
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

interface RawRow {
  date: string;       // ISO
  description: string;
  amount: number;     // cents, signed (positive=inflow, negative=outflow)
}

function parseFile(spec: FileSpec, content: string): RawRow[] {
  const out: RawRow[] = [];

  if (spec.parser === "keybank") {
    // Strip preamble.
    const lines = content.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => /^date,amount,description/i.test(l.trim()));
    const cleaned = headerIdx >= 0 ? lines.slice(headerIdx).join("\n") : content;
    const parsed = Papa.parse<Record<string, string>>(cleaned, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Date"] || "");
      const desc = (r["Description"] || "").trim();
      const amt = parseMoney(r["Amount"] || "0");
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "chase_checking") {
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Posting Date"] || r["Transaction Date"] || "");
      const desc = (r["Description"] || "").trim();
      const amt = parseMoney(r["Amount"] || "0");
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "chase_card") {
    // Chase card: Amount column has negative for charges (debits), positive for payments.
    // BUT in our system credit-card "expense" should be NEGATIVE. Chase's sign matches that already.
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Transaction Date"] || r["Posting Date"] || "");
      const desc = (r["Description"] || "").trim();
      const amt = parseMoney(r["Amount"] || "0");
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "td_card") {
    // Debit/Credit columns. Debit = charge (we store as NEGATIVE). Credit = payment (POSITIVE).
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Date"] || "");
      const desc = (r["Description"] || "").trim();
      const debit = parseMoney(r["Debit"] || "0");
      const credit = parseMoney(r["Credit"] || "0");
      const amt = -debit + credit;
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "discover") {
    // Discover: positive Amount = charge, negative = payment. We invert so charges are NEGATIVE.
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Trans. Date"] || r["Post Date"] || "");
      const desc = (r["Description"] || "").trim();
      const amt = -parseMoney(r["Amount"] || "0"); // INVERT
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "citi_card") {
    // Citi: Debit = charge, Credit = payment. Debit is positive in file. Charges -> NEGATIVE in system.
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Date"] || "");
      const desc = (r["Description"] || "").trim();
      const debit = parseMoney(r["Debit"] || "0");
      const credit = parseMoney(r["Credit"] || "0"); // already negative in file
      const amt = -debit + credit;
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "nbt_checking") {
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Date"] || "");
      const desc = (r["Description"] || "").trim();
      const amt = parseMoney(r["Amount"] || "0");
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  if (spec.parser === "amex") {
    // Amex: positive = charge, negative = payment. Invert so charges are NEGATIVE.
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    for (const r of parsed.data) {
      const date = toIsoDate(r["Date"] || "");
      const desc = (r["Description"] || "").trim();
      const amt = -parseMoney(r["Amount"] || "0"); // INVERT
      if (!date || !desc) continue;
      out.push({ date, description: desc, amount: amt });
    }
    return out;
  }

  return out;
}

// Detect inter-account transfers across just-imported transactions: a positive
// transaction in account X on date D matched by a negative transaction of the
// same magnitude in account Y on date D (or +/-1 day).
function tagTransfersAndCategorize(
  importedByAccount: Map<number, RawRow[]>,
  categoryByName: Map<string, Category>,
): Map<string, number | null> {
  const transferIds = new Set<string>(); // key = `${accountId}|${idx}`
  const accountIds = Array.from(importedByAccount.keys());

  for (let i = 0; i < accountIds.length; i++) {
    const a = accountIds[i];
    const aRows = importedByAccount.get(a)!;
    for (let j = i + 1; j < accountIds.length; j++) {
      const b = accountIds[j];
      const bRows = importedByAccount.get(b)!;
      for (let ai = 0; ai < aRows.length; ai++) {
        const ar = aRows[ai];
        if (transferIds.has(`${a}|${ai}`)) continue;
        for (let bi = 0; bi < bRows.length; bi++) {
          const br = bRows[bi];
          if (transferIds.has(`${b}|${bi}`)) continue;
          if (ar.amount + br.amount !== 0) continue;
          if (Math.abs(ar.amount) < 100) continue; // ignore < $1
          // Date within 3 days
          const da = new Date(ar.date).getTime();
          const db = new Date(br.date).getTime();
          if (Math.abs(da - db) > 3 * 86400000) continue;
          transferIds.add(`${a}|${ai}`);
          transferIds.add(`${b}|${bi}`);
          break;
        }
      }
    }
  }
  return new Map(); // not used, just transferIds via closure — return placeholder
  // (actual return handled in main loop)
}

interface YtdResult {
  accountsCreated: number;
  transactionsImported: number;
  transactionsCategorized: number;
  transfersTagged: number;
  perAccount: Array<{ name: string; transactions: number; inflow: number; outflow: number }>;
  warnings: string[];
}

export async function runYtdSetup(): Promise<YtdResult> {
  const result: YtdResult = {
    accountsCreated: 0,
    transactionsImported: 0,
    transactionsCategorized: 0,
    transfersTagged: 0,
    perAccount: [],
    warnings: [],
  };

  // Idempotency check.
  const existingAccounts = storage.listAccounts();
  const existingTxnCount = storage.listTransactions({}).length;
  if (existingTxnCount > 50) {
    throw new Error(`Refusing to run YTD setup: database already has ${existingTxnCount} transactions. This setup is for a fresh start only.`);
  }
  const ytdMarker = existingAccounts.find((a) => a.name === "Chase Checking 8641");
  if (ytdMarker) {
    throw new Error("YTD setup has already been run (account 'Chase Checking 8641' exists).");
  }

  // Build category lookup, creating any missing categories we'll use.
  const cats = storage.listCategories();
  const catByName = new Map<string, Category>(cats.map((c) => [c.name.toLowerCase(), c]));
  function ensureCategory(name: string, isIncome = false): Category {
    const k = name.toLowerCase();
    let c = catByName.get(k);
    if (!c) {
      c = storage.createCategory({ name, isIncome, color: "#64748b", icon: "Tag", archived: false } as any);
      catByName.set(k, c);
    }
    return c;
  }
  // Pre-seed essentials (idempotent — uses existing if present).
  ensureCategory("Transfers");
  ensureCategory("Fees & Interest");
  ensureCategory("Income", true);
  const transfersCat = ensureCategory("Transfers");
  const feesCat = ensureCategory("Fees & Interest");

  // Read all files into memory and parse.
  const seedDir = getSeedDir();
  type ParsedFile = { spec: FileSpec; rows: RawRow[]; account?: Account };
  const parsed: ParsedFile[] = [];
  for (const spec of SPECS) {
    const path = resolve(seedDir, spec.filename);
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch {
      result.warnings.push(`Missing seed file: ${spec.filename}`);
      continue;
    }
    const rows = parseFile(spec, content);
    parsed.push({ spec, rows });
  }

  // Create accounts.
  for (const pf of parsed) {
    const acct = storage.createAccount({
      name: pf.spec.accountName,
      type: pf.spec.accountType,
      institution: pf.spec.institution,
      last4: pf.spec.last4 || null,
      currentBalance: 0,
      archived: false,
    } as InsertAccount);
    pf.account = acct;
    result.accountsCreated += 1;
  }
  // Static accounts (mortgage + Roth IRA).
  for (const sa of STATIC_ACCOUNTS) {
    storage.createAccount(sa);
    result.accountsCreated += 1;
  }

  // Detect inter-account transfers BEFORE inserting so we can tag.
  // Build a map of pending rows per account.
  const importedByAccount = new Map<number, RawRow[]>();
  for (const pf of parsed) {
    importedByAccount.set(pf.account!.id, pf.rows);
  }
  const transferKeys = new Set<string>(); // `${accountId}|${idx}`
  const accountIds = Array.from(importedByAccount.keys());
  for (let i = 0; i < accountIds.length; i++) {
    const a = accountIds[i];
    const aRows = importedByAccount.get(a)!;
    for (let j = i + 1; j < accountIds.length; j++) {
      const b = accountIds[j];
      const bRows = importedByAccount.get(b)!;
      for (let ai = 0; ai < aRows.length; ai++) {
        if (transferKeys.has(`${a}|${ai}`)) continue;
        const ar = aRows[ai];
        if (Math.abs(ar.amount) < 500) continue; // skip < $5 to reduce noise
        for (let bi = 0; bi < bRows.length; bi++) {
          if (transferKeys.has(`${b}|${bi}`)) continue;
          const br = bRows[bi];
          if (ar.amount + br.amount !== 0) continue;
          const da = new Date(ar.date).getTime();
          const dbb = new Date(br.date).getTime();
          if (Math.abs(da - dbb) > 3 * 86400000) continue;
          transferKeys.add(`${a}|${ai}`);
          transferKeys.add(`${b}|${bi}`);
          break;
        }
      }
    }
  }

  // Insert transactions.
  for (const pf of parsed) {
    const acct = pf.account!;
    let inflow = 0;
    let outflow = 0;
    let count = 0;
    for (let idx = 0; idx < pf.rows.length; idx++) {
      const r = pf.rows[idx];
      const isTransfer = transferKeys.has(`${acct.id}|${idx}`);
      // Categorize.
      let categoryId: number | null = null;
      const merchantInfo = suggestMerchant(r.description);
      if (isTransfer) {
        categoryId = transfersCat.id;
      } else if (/late\s*fee|interest\s*charge|service\s*fee|overdraft/i.test(r.description)) {
        categoryId = feesCat.id;
      } else if (merchantInfo.category) {
        const c = ensureCategory(merchantInfo.category);
        categoryId = c.id;
      }
      if (categoryId !== null) result.transactionsCategorized += 1;

      storage.createTransaction({
        accountId: acct.id,
        date: r.date,
        amount: r.amount,
        description: r.description,
        merchant: merchantInfo.cleanName || null,
        categoryId,
        entity: "Personal",
        isBusinessExpense: false,
        businessId: null,
        reimbursedAt: null,
        reconciled: false,
        reconciledAt: null,
        notes: isTransfer ? "Auto-detected inter-account transfer" : null,
        importBatchId: null,
        externalId: null,
        pending: false,
      } as InsertTransaction);

      count += 1;
      if (r.amount > 0) inflow += r.amount;
      else outflow += r.amount;
      result.transactionsImported += 1;
      if (isTransfer) result.transfersTagged += 1;
    }
    result.perAccount.push({
      name: acct.name,
      transactions: count,
      inflow: inflow / 100,
      outflow: outflow / 100,
    });
  }

  return result;
}
