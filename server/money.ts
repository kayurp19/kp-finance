// Shared money classification rules (used by dashboard, planner, bank sync).

// Descriptions that are money moving between your own accounts (card payments, transfers, loan payments).
// These are excluded from income and spending so nothing is counted twice.
export const TRANSFER_RE = new RegExp(
  [
    "payment\\s*-?\\s*thank\\s*you",
    "payment\\s*received",
    "mobile\\s*payment",
    "autopay",
    "auto\\s*pay",
    "crdtcardautopay",
    "internet\\s*trf\\s*to\\s*(cca|dda)",
    "internet\\s*trf\\s*fr",
    "online\\s*payment",
    "online\\s*(realtime\\s*)?transfer",
    "internet\\s*payment",
    "ach\\s*pmt",
    "bank\\s*payment",
    "card\\s*payment",
    "epayment",
    "web\\s*xfer",
    "\\bxfer\\b",
    "transfer\\s*(to|from)",
    "payment\\s*to\\s*chase\\s*card",
    "applecard\\s*gsbank\\s*payment",
    "citi\\s*autopay",
    "discover\\s*e-?payment",
    "amex\\s*epayment",
    "odp\\s*transfer",
    "overdraft\\s*(cash\\s*advance|transfer|protection)",
  ].join("|"),
  "i",
);

export function isTransferDescription(desc: string | null | undefined): boolean {
  return TRANSFER_RE.test(desc || "");
}

export function todayNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
