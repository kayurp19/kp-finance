// SimpleFIN Bridge integration.
// Protocol: https://www.simplefin.org/protocol.html
// - Setup token = base64(claim URL). POST to claim URL once -> Access URL (https://user:pass@host/path).
// - GET {accessUrl}/accounts?start-date=<unix>&end-date=<unix> -> { errors|errlist, accounts: [...] }
// The access URL is stored server-side only and is never returned to the browser.
import { sqlite, storage } from "./storage";
import { isTransferDescription } from "./money";

export interface SfConnectionRow {
  id: number;
  label: string;
  access_url: string;
  created_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_errors: string | null;
}

export interface SfAccountRow {
  id: number;
  connection_id: number;
  sf_id: string;
  name: string;
  org_name: string | null;
  currency: string | null;
  balance: number | null;
  balance_date: string | null;
  mapped_account_id: number | null;
  suggested_account_id: number | null;
  ignored: number;
  last_seen_at: string | null;
}

const toCents = (v: any): number => {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// Unix seconds -> yyyy-mm-dd in America/New_York
function unixToIsoDate(sec: number): string {
  const d = new Date(sec * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return parts; // en-CA formats as yyyy-mm-dd
}

function isoDayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

// Cards and loans are stored as negative (owed) in KP regardless of the bank's sign convention.
function setBankBalance(accountId: number, balance: number, balDate: string | null) {
  const acct = storage.getAccount(accountId);
  if (!acct) return;
  const v = acct.type === "credit_card" || acct.type === "loan" ? -Math.abs(balance) : balance;
  sqlite.prepare("UPDATE accounts SET bank_balance = ?, bank_balance_at = ? WHERE id = ?").run(v, balDate, accountId);
}

// ===== Connections =====
export function listConnections(): SfConnectionRow[] {
  return sqlite.prepare("SELECT * FROM simplefin_connections ORDER BY id").all() as SfConnectionRow[];
}

export function deleteConnection(id: number) {
  sqlite.prepare("UPDATE accounts SET bank_balance = NULL, bank_balance_at = NULL WHERE id IN (SELECT mapped_account_id FROM simplefin_accounts WHERE connection_id = ? AND mapped_account_id IS NOT NULL)").run(id);
  const mapped = sqlite.prepare("SELECT mapped_account_id FROM simplefin_accounts WHERE connection_id = ? AND mapped_account_id IS NOT NULL").all(id) as { mapped_account_id: number }[];
  sqlite.prepare("DELETE FROM simplefin_accounts WHERE connection_id = ?").run(id);
  sqlite.prepare("DELETE FROM simplefin_connections WHERE id = ?").run(id);
  for (const m of mapped) storage.recomputeAccountBalance(m.mapped_account_id);
}

export async function claimSetupToken(rawToken: string, label: string): Promise<SfConnectionRow> {
  const token = rawToken.trim().replace(/\s+/g, "");
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(token, "base64").toString("utf8").trim();
  } catch {
    throw new Error("That doesn't look like a SimpleFIN setup token.");
  }
  if (!/^https:\/\//i.test(claimUrl)) throw new Error("That doesn't look like a SimpleFIN setup token.");
  const resp = await fetch(claimUrl, { method: "POST", headers: { "Content-Length": "0" } });
  const body = (await resp.text()).trim();
  if (!resp.ok) {
    if (resp.status === 403) throw new Error("This setup token was already used or expired. Create a new app connection in SimpleFIN and paste the new token.");
    throw new Error(`SimpleFIN rejected the token (HTTP ${resp.status}).`);
  }
  if (!/^https:\/\/[^:]+:[^@]+@/i.test(body)) throw new Error("SimpleFIN returned an unexpected response.");
  const info = sqlite.prepare(
    "INSERT INTO simplefin_connections (label, access_url, created_at) VALUES (?, ?, ?)"
  ).run(label || "SimpleFIN", body, new Date().toISOString());
  return sqlite.prepare("SELECT * FROM simplefin_connections WHERE id = ?").get(info.lastInsertRowid) as SfConnectionRow;
}

async function fetchAccounts(accessUrl: string, startSec: number, endSec?: number) {
  const u = new URL(accessUrl.replace(/\/$/, "") + "/accounts");
  const auth = "Basic " + Buffer.from(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password)).toString("base64");
  u.username = ""; u.password = "";
  u.searchParams.set("start-date", String(startSec));
  if (endSec) u.searchParams.set("end-date", String(endSec));
  const resp = await fetch(u.toString(), { headers: { Authorization: auth, Accept: "application/json" } });
  if (resp.status === 403) throw new Error("SimpleFIN access was revoked. Reconnect in Settings.");
  if (resp.status === 402) throw new Error("SimpleFIN subscription payment required.");
  if (!resp.ok) throw new Error(`SimpleFIN HTTP ${resp.status}`);
  return (await resp.json()) as any;
}

// Suggest a KP account for a SimpleFIN account using last-4 digits and institution name.
function suggestMapping(name: string, orgName: string | null): number | null {
  const kp = storage.listAccounts().filter((a) => !a.archived);
  const digits = (name.match(/\d{4}(?!.*\d{4})/) || [])[0];
  const alreadyMapped = new Set(
    (sqlite.prepare("SELECT COALESCE(mapped_account_id, suggested_account_id) AS m FROM simplefin_accounts WHERE COALESCE(mapped_account_id, suggested_account_id) IS NOT NULL").all() as any[]).map((r) => r.m)
  );
  const free = kp.filter((a) => !alreadyMapped.has(a.id));
  if (digits) {
    const hits = free.filter((a) => a.last4 && a.last4 === digits);
    if (hits.length === 1) return hits[0].id;
  }
  // Fallback: same bank AND same kind of account (card/checking/savings/loan/investment).
  const n = name.toLowerCase();
  const kind = /card|credit|visa|mastercard|amex|discover/.test(n) ? "credit_card"
    : /checking/.test(n) ? "checking" : /saving/.test(n) ? "savings"
    : /mortgage|loan/.test(n) ? "loan" : /ira|roth|brokerage|401k|invest/.test(n) ? "investment" : null;
  const org = (orgName || "").toLowerCase();
  if (org && kind) {
    const firstWord = org.split(/\s+/)[0];
    const hits = free.filter((a) => a.type === kind && (a.institution || a.name).toLowerCase().includes(firstWord));
    if (hits.length === 1) return hits[0].id;
  }
  return null;
}

export interface SyncResult {
  connectionId: number;
  accountsSeen: number;
  imported: number;
  matchedExisting: number;
  errors: string[];
}

export async function syncConnection(conn: SfConnectionRow, opts: { days?: number } = {}): Promise<SyncResult> {
  const result: SyncResult = { connectionId: conn.id, accountsSeen: 0, imported: 0, matchedExisting: 0, errors: [] };
  const now = Math.floor(Date.now() / 1000);
  // First sync pulls up to 90 days; routine syncs pull the last 21 days to catch late-posting items.
  const days = Math.min(89, opts.days ?? (conn.last_sync_at ? 21 : 89));
  const start = now - days * 86400;
  try {
    const data = await fetchAccounts(conn.access_url, start);
    const errs: string[] = [];
    if (Array.isArray(data.errors)) errs.push(...data.errors.map(String));
    if (Array.isArray(data.errlist)) errs.push(...data.errlist.map((e: any) => e?.msg || e?.message || JSON.stringify(e)));
    // Informational notices aren't problems the user needs to act on.
    const real = errs.filter((e) => !/requested date range|was capped|may be capped/i.test(e));
    errs.length = 0; errs.push(...real);
    result.errors.push(...errs);

    const touched = new Set<number>();
    for (const a of data.accounts || []) {
      result.accountsSeen++;
      const orgName = a.org?.name || a.org?.domain || null;
      const balance = toCents(a.balance);
      const balDate = a["balance-date"] ? new Date(Number(a["balance-date"]) * 1000).toISOString() : null;
      let row = sqlite.prepare("SELECT * FROM simplefin_accounts WHERE connection_id = ? AND sf_id = ?").get(conn.id, String(a.id)) as SfAccountRow | undefined;
      if (!row) {
        const suggested = suggestMapping(String(a.name || ""), orgName);
        sqlite.prepare(
          "INSERT INTO simplefin_accounts (connection_id, sf_id, name, org_name, currency, balance, balance_date, suggested_account_id, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)"
        ).run(conn.id, String(a.id), String(a.name || "Account"), orgName, a.currency || "USD", balance, balDate, suggested, new Date().toISOString());
        row = sqlite.prepare("SELECT * FROM simplefin_accounts WHERE connection_id = ? AND sf_id = ?").get(conn.id, String(a.id)) as SfAccountRow;
      } else {
        sqlite.prepare("UPDATE simplefin_accounts SET name = ?, org_name = ?, balance = ?, balance_date = ?, last_seen_at = ? WHERE id = ?")
          .run(String(a.name || row.name), orgName, balance, balDate, new Date().toISOString(), row.id);
      }
      if (!row.mapped_account_id || row.ignored) continue;
      const accountId = row.mapped_account_id;
      touched.add(accountId);

      setBankBalance(accountId, balance, balDate);
      const r = importTransactions(accountId, a.transactions || []);
      result.imported += r.imported;
      result.matchedExisting += r.matched;
    }
    for (const id of touched) storage.recomputeAccountBalance(id);

    sqlite.prepare("UPDATE simplefin_connections SET last_sync_at = ?, last_sync_status = ?, last_errors = ? WHERE id = ?")
      .run(new Date().toISOString(), "ok", errs.length ? JSON.stringify(errs) : null, conn.id);
  } catch (e: any) {
    const msg = e?.message || String(e);
    result.errors.push(msg);
    sqlite.prepare("UPDATE simplefin_connections SET last_sync_at = ?, last_sync_status = ?, last_errors = ? WHERE id = ?")
      .run(new Date().toISOString(), "error", JSON.stringify([msg]), conn.id);
  }
  return result;
}

function transfersCategoryId(): number | null {
  const c = storage.listCategories().find((x) => x.name === "Transfers");
  return c ? c.id : null;
}

// One-time + ongoing cleanup: synced rows that are really transfers/card payments get the Transfers category.
export function retagSyncedTransfers(): number {
  const tid = transfersCategoryId();
  if (!tid) return 0;
  const rows = sqlite.prepare("SELECT id, description, category_id FROM transactions WHERE external_id LIKE 'sf:%' AND (category_id IS NULL OR category_id != ?)").all(tid) as any[];
  let n = 0;
  const upd = sqlite.prepare("UPDATE transactions SET category_id = ? WHERE id = ?");
  for (const r of rows) if (isTransferDescription(r.description)) { upd.run(tid, r.id); n++; }
  return n;
}

// Imports SimpleFIN transactions into a KP account.
// Dedupe: (1) exact SimpleFIN id already stored; (2) a statement-uploaded row in the same account with the
// same amount within 3 days that hasn't been claimed yet -> link it instead of creating a duplicate.
function importTransactions(accountId: number, txns: any[]): { imported: number; matched: number } {
  let imported = 0, matched = 0;
  const existsStmt = sqlite.prepare("SELECT id FROM transactions WHERE account_id = ? AND simplefin_id = ? LIMIT 1");
  const candStmt = sqlite.prepare(
    "SELECT id, date FROM transactions WHERE account_id = ? AND simplefin_id IS NULL AND amount = ? AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days') ORDER BY id"
  );
  const claimStmt = sqlite.prepare("UPDATE transactions SET simplefin_id = ? WHERE id = ?");
  // Safety net in case a bank re-issues transaction ids: same date + amount + description already synced.
  const sameStmt = sqlite.prepare("SELECT id FROM transactions WHERE account_id = ? AND external_id LIKE 'sf:%' AND date = ? AND amount = ? AND description = ? LIMIT 1");

  for (const t of txns) {
    if (t.pending) continue; // only posted transactions
    const sfId = String(t.id ?? "");
    const posted = Number(t.posted || t.transacted_at || 0);
    if (!sfId || !posted) continue;
    if (existsStmt.get(accountId, sfId)) continue;
    const date = unixToIsoDate(posted);
    const amount = toCents(t.amount);
    if (amount === 0) continue;
    const cands = candStmt.all(accountId, amount, date, date) as { id: number; date: string }[];
    if (cands.length) {
      cands.sort((x, y) => isoDayDiff(x.date, date) - isoDayDiff(y.date, date));
      claimStmt.run(sfId, cands[0].id);
      matched++;
      continue;
    }
    const description = String(t.description || t.payee || t.memo || "Transaction").trim();
    if (sameStmt.get(accountId, date, amount, description)) continue;
    const ruled = storage.applyRules(description, t.payee || null);
    const cleanMerchant = ruled.cleanMerchant;
    // Card payments / transfers between your own accounts go to Transfers before any merchant rule
    // (e.g. "MOBILE PAYMENT" must not match a Mobil gas rule).
    const categoryId = isTransferDescription(description) ? transfersCategoryId() ?? ruled.categoryId : ruled.categoryId;
    storage.createTransaction({
      accountId,
      date,
      amount,
      description,
      merchant: cleanMerchant || null,
      categoryId: categoryId ?? null,
      entity: "Personal",
      isBusinessExpense: false,
      businessId: null,
      reimbursedAt: null,
      reconciled: false,
      reconciledAt: null,
      notes: null,
      importBatchId: null,
      externalId: "sf:" + sfId,
      pending: false,
      simplefinId: sfId,
    } as any);
    imported++;
  }
  return { imported, matched };
}

export async function syncAll(opts: { days?: number } = {}): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const c of listConnections()) out.push(await syncConnection(c, opts));
  storage.setSetting("simplefin_last_sync_all", new Date().toISOString());
  retagSyncedTransfers();
  try { (await import("./planner")).autoMatchBills(); } catch (e) { console.warn("[bills] auto-match failed", e); }
  return out;
}

// Daily background sync inside the server process. Checks hourly; runs when >20h since the last full sync.
let syncing = false;
export function startSimplefinScheduler() {
  const tick = async () => {
    if (syncing) return;
    if (!listConnections().length) return;
    const last = storage.getSetting("simplefin_last_sync_all");
    if (last && Date.now() - Date.parse(last) < 20 * 3600 * 1000) return;
    syncing = true;
    try {
      const r = await syncAll();
      console.log("[simplefin] daily sync", JSON.stringify(r.map((x) => ({ c: x.connectionId, imp: x.imported, m: x.matchedExisting, e: x.errors.length }))));
    } catch (e) {
      console.warn("[simplefin] daily sync failed", e);
    } finally {
      syncing = false;
    }
  };
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
}

export async function runManualSync(days?: number) {
  if (syncing) throw new Error("A sync is already running. Try again in a minute.");
  syncing = true;
  try { return await syncAll({ days }); } finally { syncing = false; }
}

// Status for the UI (never includes access URLs).
export function getStatus() {
  const conns = listConnections();
  const kp = new Map(storage.listAccounts().map((a) => [a.id, a]));
  const staleMs = 48 * 3600 * 1000;
  return {
    lastSyncAll: storage.getSetting("simplefin_last_sync_all") || null,
    connections: conns.map((c) => {
      const accts = sqlite.prepare("SELECT * FROM simplefin_accounts WHERE connection_id = ? ORDER BY org_name, name").all(c.id) as SfAccountRow[];
      return {
        id: c.id,
        label: c.label,
        createdAt: c.created_at,
        lastSyncAt: c.last_sync_at,
        lastSyncStatus: c.last_sync_status,
        errors: c.last_errors ? (JSON.parse(c.last_errors) as string[]) : [],
        accounts: accts.map((a) => ({
          id: a.id,
          name: a.name,
          orgName: a.org_name,
          balance: a.balance,
          balanceDate: a.balance_date,
          mappedAccountId: a.mapped_account_id,
          mappedAccountName: a.mapped_account_id ? kp.get(a.mapped_account_id)?.name || null : null,
          suggestedAccountId: a.suggested_account_id,
          ignored: !!a.ignored,
          stale: !!a.balance_date && Date.now() - Date.parse(a.balance_date) > staleMs,
        })),
      };
    }),
  };
}

export function updateSfAccount(id: number, data: { mappedAccountId?: number | null; ignored?: boolean }) {
  const row = sqlite.prepare("SELECT * FROM simplefin_accounts WHERE id = ?").get(id) as SfAccountRow | undefined;
  if (!row) throw new Error("Not found");
  if (data.mappedAccountId !== undefined) {
    const prev = row.mapped_account_id;
    if (data.mappedAccountId) {
      // One SimpleFIN account per KP account.
      sqlite.prepare("UPDATE simplefin_accounts SET mapped_account_id = NULL WHERE mapped_account_id = ? AND id != ?").run(data.mappedAccountId, id);
    }
    sqlite.prepare("UPDATE simplefin_accounts SET mapped_account_id = ? WHERE id = ?").run(data.mappedAccountId || null, id);
    if (prev && prev !== data.mappedAccountId) {
      sqlite.prepare("UPDATE accounts SET bank_balance = NULL, bank_balance_at = NULL WHERE id = ?").run(prev);
      storage.recomputeAccountBalance(prev);
    }
    if (data.mappedAccountId && row.balance !== null) {
      setBankBalance(data.mappedAccountId, row.balance, row.balance_date);
      storage.recomputeAccountBalance(data.mappedAccountId);
    }
  }
  if (data.ignored !== undefined) sqlite.prepare("UPDATE simplefin_accounts SET ignored = ? WHERE id = ?").run(data.ignored ? 1 : 0, id);
}
