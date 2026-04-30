import Papa from "papaparse";
import crypto from "node:crypto";

export interface ParsedRow {
  date: string;        // ISO yyyy-mm-dd
  description: string;
  amount: number;      // cents (negative=outflow, positive=inflow)
  rawDate: string;
  rawAmount: string;
}

export interface ColumnMap {
  dateCol: string;
  descCol: string;
  amountCol?: string;        // single signed amount
  debitCol?: string;
  creditCol?: string;
  invertSign?: boolean;       // some banks export expenses as positive
}

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  suggested: ColumnMap;
}

export function parseCsv(content: string): ParsedFile {
  const result = Papa.parse<Record<string, string>>(content.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = result.data || [];
  const headers = result.meta.fields || [];
  return { headers, rows, suggested: suggestColumnMap(headers) };
}

export function suggestColumnMap(headers: string[]): ColumnMap {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...candidates: string[]) => {
    for (const c of candidates) {
      const idx = lower.findIndex((h) => h === c || h.includes(c));
      if (idx !== -1) return headers[idx];
    }
    return undefined;
  };
  return {
    dateCol: find("date", "posted", "transaction date", "post date") || headers[0] || "",
    descCol: find("description", "memo", "details", "merchant", "name", "payee") || headers[1] || "",
    amountCol: find("amount"),
    debitCol: find("debit", "withdrawal", "withdrawals"),
    creditCol: find("credit", "deposit", "deposits"),
  };
}

export function normalizeDate(input: string): string {
  if (!input) return "";
  const s = input.trim();
  // Try ISO first
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // mm/dd/yyyy or m/d/yy
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (us) {
    let yy = us[3];
    if (yy.length === 2) yy = (parseInt(yy) > 50 ? "19" : "20") + yy;
    return `${yy}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  // dd-MMM-yyyy
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

/**
 * Parse a currency-like string into integer cents.
 *
 * Handles:
 *   "208.75"      → 20875
 *   "1,234.56"    → 123456
 *   "-208.75"     → -20875
 *   "(208.75)"    → -20875   (accountant-style negatives)
 *   "$1,234.56"   → 123456
 *   "$ 1,234.56 " → 123456
 *   ""            → 0
 *   "abc"         → 0
 */
export function parseAmount(input: string): number {
  if (input == null) return 0;
  let s = String(input).trim();
  if (!s) return 0;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Strip currency symbols, thousands separators, spaces; keep digits, dot, minus.
  s = s.replace(/[$,\s]/g, "").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return Math.round((negative ? -n : n) * 100);
}

export function applyColumnMap(rows: Record<string, string>[], map: ColumnMap): ParsedRow[] {
  return rows.map((row) => {
    const rawDate = row[map.dateCol] || "";
    const desc = (row[map.descCol] || "").trim();
    let cents = 0;
    let rawAmount = "";
    if (map.amountCol) {
      rawAmount = row[map.amountCol] || "";
      cents = parseAmount(rawAmount);
      if (map.invertSign) cents = -cents;
    } else {
      const debit = parseAmount(row[map.debitCol || ""] || "");
      const credit = parseAmount(row[map.creditCol || ""] || "");
      // Debit (money out) -> negative, Credit (money in) -> positive
      cents = credit > 0 ? credit : -Math.abs(debit);
      rawAmount = `D:${row[map.debitCol || ""] || ""} C:${row[map.creditCol || ""] || ""}`;
    }
    return {
      date: normalizeDate(rawDate),
      description: desc,
      amount: cents,
      rawDate, rawAmount,
    };
  }).filter((r) => r.date && r.description);
}

export function makeExternalId(accountId: number, row: ParsedRow): string {
  const h = crypto.createHash("sha1");
  h.update(`${accountId}|${row.date}|${row.amount}|${row.description.toLowerCase()}`);
  return h.digest("hex").slice(0, 24);
}
