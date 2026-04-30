// Money: stored as integer cents, displayed as dollars.

export function formatCents(cents: number, opts: { showSign?: boolean; abs?: boolean } = {}): string {
  const value = (opts.abs ? Math.abs(cents) : cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  if (opts.abs) return formatted;
  if (value < 0) return `-${formatted}`;
  if (opts.showSign && value > 0) return `+${formatted}`;
  return formatted;
}

export function dollarsToCents(dollars: string | number): number {
  const n = typeof dollars === "number" ? dollars : parseFloat(String(dollars).replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateShort(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a.length === 10 ? a + "T00:00:00" : a);
  const db = new Date(b.length === 10 ? b + "T00:00:00" : b);
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}
