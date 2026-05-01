import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Business } from "@shared/schema";
import { ArrowLeft, Briefcase, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface UnassignedItem {
  id: number;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  accountId: number;
  accountName: string;
  categoryId: number | null;
}

interface UnassignedResponse {
  items: UnassignedItem[];
  count: number;
  total: number;
}

export default function BusinessAssignPage() {
  const { data, isLoading } = useQuery<UnassignedResponse>({
    queryKey: ["/api/businesses/unassigned-transactions"],
  });
  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && selected.size === items.length;
  const selectedTotal = useMemo(
    () => items.filter((i) => selected.has(i.id)).reduce((s, i) => s + Math.abs(i.amount), 0),
    [items, selected],
  );

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const assign = useMutation({
    mutationFn: async (businessId: number) => {
      const ids = Array.from(selected);
      if (!ids.length) throw new Error("Select at least one transaction");
      const r = await apiRequest("POST", "/api/businesses/bulk-assign", { ids, businessId });
      return r.json();
    },
    onSuccess: (_d: any, businessId: number) => {
      const biz = businesses.find((b) => b.id === businessId);
      queryClient.invalidateQueries();
      toast({
        title: `Assigned ${selected.size} ${selected.size === 1 ? "txn" : "txns"}`,
        description: `Tagged to ${biz?.name || "business"}.`,
      });
      setSelected(new Set());
    },
    onError: (e: any) => toast({ title: "Assign failed", description: e.message, variant: "destructive" }),
  });

  const markNotBusiness = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      if (!ids.length) throw new Error("Select at least one transaction");
      // PATCH each via bulk endpoint — there isn't a dedicated "untag" route, but PATCH /api/transactions
      // accepts batch updates via /api/transactions/bulk. Fallback: hit individual rows.
      await Promise.all(ids.map((id) =>
        apiRequest("PATCH", `/api/transactions/${id}`, { isBusinessExpense: false, businessId: null }),
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: `Marked ${selected.size} as personal` });
      setSelected(new Set());
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/">
            <a className="text-[12px] text-muted-foreground hover:underline inline-flex items-center gap-1 mb-2" data-testid="link-back-dashboard">
              <ArrowLeft className="h-3 w-3" /> Dashboard
            </a>
          </Link>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Briefcase className="h-5 w-5" /> Assign business transactions
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Tag each transaction to the business that should reimburse you. Personal-card spending you'll bill back to a hotel or PuroClean.
          </p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !items.length ? (
        <Card className="py-16 px-6 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto text-success mb-3" />
          <h3 className="font-medium mb-1">All caught up</h3>
          <p className="text-[13px] text-muted-foreground">No business transactions need a home right now.</p>
        </Card>
      ) : (
        <>
          {/* Sticky action bar */}
          <Card className="p-4 sticky top-2 z-10 backdrop-blur bg-card/95">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[13px]">
                <span className="font-medium">{selected.size}</span>
                <span className="text-muted-foreground"> of {items.length} selected · </span>
                <Money cents={selectedTotal} abs size="sm" className="font-medium" />
                <span className="text-muted-foreground"> · {(data!.total / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} total flagged</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {businesses.filter((b) => !b.archived).map((b) => (
                  <Button
                    key={b.id}
                    size="sm"
                    onClick={() => assign.mutate(b.id)}
                    disabled={!selected.size || assign.isPending}
                    data-testid={`button-assign-${b.id}`}
                  >
                    {b.name}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => markNotBusiness.mutate()}
                  disabled={!selected.size || markNotBusiness.isPending}
                  data-testid="button-mark-personal"
                >
                  Mark as personal
                </Button>
              </div>
            </div>
          </Card>

          {/* Transaction list */}
          <Card className="divide-y divide-border">
            <div className="px-4 py-2.5 flex items-center gap-3 bg-muted/30 text-[12px] uppercase tracking-wide text-muted-foreground font-medium">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all" />
              <div className="w-20">Date</div>
              <div className="flex-1">Description</div>
              <div className="w-32 text-right">Account</div>
              <div className="w-24 text-right">Amount</div>
            </div>
            {items.map((it) => (
              <label
                key={it.id}
                className="px-4 py-3 flex items-center gap-3 hover-elevate cursor-pointer text-[13px]"
                data-testid={`row-unassigned-${it.id}`}
              >
                <Checkbox
                  checked={selected.has(it.id)}
                  onCheckedChange={() => toggleOne(it.id)}
                  data-testid={`checkbox-tx-${it.id}`}
                />
                <div className="w-20 text-muted-foreground">{formatDate(it.date)}</div>
                <div className="flex-1 truncate">
                  <div className="font-medium">{it.merchant || it.description}</div>
                  {it.merchant && it.merchant !== it.description && (
                    <div className="text-[11px] text-muted-foreground truncate">{it.description}</div>
                  )}
                </div>
                <div className="w-32 text-right text-[12px] text-muted-foreground truncate">{it.accountName}</div>
                <div className="w-24 text-right">
                  <Money cents={it.amount} abs size="sm" className="font-medium" />
                </div>
              </label>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
