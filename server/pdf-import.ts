// Convert a bank statement PDF (Chase, Amex, generic) into CSV text that the
// existing CSV import pipeline can consume.
//
// Strategy:
//  1) Extract raw text via pdf-parse.
//  2) Drop obvious noise lines (page markers, *start*/*end* tokens, headers).
//  3) Walk lines: a line that begins with MM/DD starts a transaction.
//     - Description continues until the next date-led line (concatenated).
//     - Trailing money tokens on each line are collected.
//  4) For each row, the trailing tokens are interpreted as either:
//       [amount, balance] (most withdrawals + checking lines)
//       [balance]         (deposits on Chase checking — actual amount derived
//                          from running balance delta)
//     Sign is determined by debit/credit relative to running balance.

import { PDFParse } from "pdf-parse";

async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

// Money token: optional leading "-", optional "$", digits with optional commas
// and 2-decimal cents, optionally a trailing "-" (some statements use that).
// Also accepts "( 12.60 )" style.
const MONEY_RE = /(?:^|\s)(-?\$?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?)(?=\s|$)/g;

const NOISE_RE = [
  /^\*?start\*/i,
  /^\*?end\*/i,
  /^-+\s*\d+\s+of\s+\d+\s*-+$/i,           // "-- 1 of 2 --"
  /^page\s+\d+\s+of\s+\d+/i,
  /^\d+\s+\d+\s+page\s+of$/i,                // "1 2 Page of"
  /^date\s+description\s+amount/i,
  /^checking\s+summary$/i,
  /^transaction\s+detail(\s+\(continued\))?$/i,
  /^customer\s+service\s+information$/i,
  /^account\s+number:?$/i,
  /^web\s+site:$/i,
  /^service\s+center:$/i,
  /^para\s+espanol:/i,
  /^international\s+calls:/i,
  /^we\s+accept\s+operator/i,
  /^\d{14,}/,                                 // long ref numbers
  /^\d{8}\s+dre\s+/i,
];

const HARD_STOP_RE = [
  /^in\s+case\s+of\s+errors/i,
  /^total\s+fees$/i,
  /^fees\s+charged$/i,
  /^interest\s+charged$/i,
  /^you\s+were\s+not\s+charged\s+a\s+monthly/i,
  /^how\s+to\s+avoid\s+monthly/i,
  /^member\s+fdic$/i,
  /^on\s+your\s+(chase|amex|american\s+express)/i,
  /^following\s+during\s+the\s+monthly/i,
  /^for\s+more\s+information\s+about\s+the/i,
  /^ending\s+balance/i,
];

interface OutRow {
  date: string;       // MM/DD/YYYY
  description: string;
  amount: string;     // signed dollars, no commas
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function normalizeMoney(token: string): number {
  let t = token.trim().replace(/[$,]/g, "");
  if (t.startsWith("(") && t.endsWith(")")) t = "-" + t.slice(1, -1);
  if (t.endsWith("-") && !t.startsWith("-")) t = "-" + t.slice(0, -1);
  return Number(t);
}

function inferYear(month: number, statementYearHint?: number): number {
  if (statementYearHint) return statementYearHint;
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  if (month > curMonth + 2) return now.getFullYear() - 1;
  return now.getFullYear();
}

function detectStatementYear(text: string): number | undefined {
  const m =
    text.match(/through\s+\w+\s+\d{1,2},?\s+(\d{4})/i) ||
    text.match(/statement\s+period[^0-9]+(\d{4})/i);
  if (m) {
    const y = Number(m[1]);
    if (y > 2000 && y < 2100) return y;
  }
  return undefined;
}

function detectBeginningBalance(text: string): number | undefined {
  const m = text.match(/Beginning\s+Balance\s*\$?(-?\d{1,3}(?:,\d{3})*\.\d{2})/i);
  if (m) return normalizeMoney(m[1]);
  return undefined;
}

export async function pdfToCsv(buffer: Buffer): Promise<string> {
  const text = await pdfText(buffer);
  const yearHint = detectStatementYear(text);
  const beginBal = detectBeginningBalance(text);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Group lines into transactions. Continuation lines (no leading date) get
  // merged into the most recent date-led line.
  // Hard-stop suppresses NEW transactions but only after we've seen at least
  // one — Chase prints "IN CASE OF ERRORS" at the top of page 2 BEFORE the
  // continuation transactions, so we don't want to bail on first sight.
  type Group = { dateMatch: RegExpMatchArray; raw: string };
  const groups: Group[] = [];
  let suppressing = false;

  for (const line of lines) {
    if (NOISE_RE.some((r) => r.test(line))) continue;

    const dm = line.match(DATE_RE);
    if (dm) {
      if (/^date\b/i.test(line)) continue;
      // A new date row resets suppression — we're back into a transaction list.
      suppressing = false;
      groups.push({ dateMatch: dm, raw: line });
    } else if (HARD_STOP_RE.some((r) => r.test(line))) {
      // Stop appending continuations to whatever came before; wait for next date.
      suppressing = true;
    } else if (groups.length > 0 && !suppressing) {
      groups[groups.length - 1].raw += " " + line;
    }
  }

  if (groups.length === 0) {
    throw new Error("Couldn't find any transactions in this PDF. Try uploading a CSV instead.");
  }

  // Now turn each group into a row.
  const rows: OutRow[] = [];
  let runningBal: number | undefined = beginBal;

  for (const g of groups) {
    const dm = g.dateMatch;
    const mm = Number(dm[1]);
    const dd = Number(dm[2]);
    const yyRaw = dm[3];
    const yyyy = yyRaw
      ? (yyRaw.length === 2 ? 2000 + Number(yyRaw) : Number(yyRaw))
      : inferYear(mm, yearHint);
    const dateStr = `${String(mm).padStart(2, "0")}/${String(dd).padStart(2, "0")}/${yyyy}`;

    // Strip leading date.
    let body = g.raw.replace(DATE_RE, "").trim();

    // Capture trailing money tokens (one or two).
    const tokens: string[] = [];
    for (const m of body.matchAll(MONEY_RE)) tokens.push(m[1]);

    if (tokens.length === 0) {
      // Description-only row with no amount — skip.
      continue;
    }

    // Some PDFs put a space between the minus sign and the amount: "- 4.00".
    // Glue any "<space>-<space>NUMBER" back into "-NUMBER" before tail matching.
    body = body.replace(/(^|\s)-\s+(\d)/g, "$1-$2");

    // Determine which tokens are the trailing amount/balance, by checking that
    // they actually appear at the end of `body`.
    // Match the last 1 or 2 tokens that form the tail.
    const tailMatch = body.match(/((?:-?\$?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?)(?:\s+(?:-?\$?\(?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?))?)\s*$/);
    if (!tailMatch) continue;
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/\s+/);
    const description = body.slice(0, body.length - tailMatch[1].length).replace(/\s+$/, "").replace(/\s+-\s*$/, "").trim();

    let amount: number | undefined;
    let balance: number | undefined;

    if (tailTokens.length === 2) {
      amount = normalizeMoney(tailTokens[0]);
      balance = normalizeMoney(tailTokens[1]);
    } else {
      // One trailing token: usually the running balance for a deposit row.
      // Derive amount from balance delta.
      balance = normalizeMoney(tailTokens[0]);
      if (runningBal !== undefined) {
        amount = +(balance - runningBal).toFixed(2);
      }
    }

    if (amount === undefined) continue;
    if (balance !== undefined) runningBal = balance;

    // Clean trailing dangling minus signs in description (e.g. "7208 -" left over).
    const cleanDesc = description.replace(/\s+-\s*$/, "").replace(/\s+/g, " ").trim();

    rows.push({
      date: dateStr,
      description: cleanDesc,
      amount: amount.toFixed(2),
    });
  }

  if (rows.length === 0) {
    throw new Error("Couldn't extract transactions from this PDF.");
  }

  const out = ["Date,Description,Amount"];
  for (const r of rows) {
    out.push([csvEscape(r.date), csvEscape(r.description), csvEscape(r.amount)].join(","));
  }
  return out.join("\n");
}
