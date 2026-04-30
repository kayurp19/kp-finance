import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MoneyProps {
  cents: number;
  className?: string;
  /** Color positive=green, negative=red */
  colored?: boolean;
  /** Display absolute value only */
  abs?: boolean;
  /** Treat as expense — negative numbers shown as red, positive as plain. */
  expense?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
}

const SIZE_CLASS: Record<NonNullable<MoneyProps["size"]>, string> = {
  xs: "text-[11px]",
  sm: "text-[13px]",
  md: "text-sm",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
};

export function Money({ cents, className, colored, abs, expense, size = "sm" }: MoneyProps) {
  let color = "";
  if (colored) {
    if (cents > 0) color = "text-success";
    else if (cents < 0) color = "text-destructive";
  } else if (expense && cents < 0) {
    color = "text-destructive";
  }
  return (
    <span className={cn("font-mono tabular-nums", SIZE_CLASS[size], color, className)}>
      {formatCents(cents, { abs })}
    </span>
  );
}
