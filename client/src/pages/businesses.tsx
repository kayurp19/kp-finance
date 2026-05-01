import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { dollarsToCents, formatDate, todayISO } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Business, ReimbursementClearing } from "@shared/schema";
import { Briefcase, Building2, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface SummaryRow {
  businessId: number;
  businessName: string;
  owedAmount: number;
  owedCount: number;
  monthAmount: number;
  allTimeAmount: number;
  lastClearedAt: string | null;
}

interface Summary {
  summary: SummaryRow[];
  unassignedAmount: number;
  unassignedCount: number;
}

export default function BusinessesPage() {
  const { data, isLoading } = useQuery<Summary>({ queryKey: ["/api/reimbursements/summary"] });
  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });
  const [clearOpen, setClearOpen] = useState<SummaryRow | null>(null);

  const totalOwed = data?.summary.reduce((s, b) => s + b.owedAmount, 0) || 0;

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reimbursements</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Track what each business owes you for personal-card spending</p>
        </div>
      </div>

      <Card className="p-6">
        <div className="text-[12px] uppercase tracking-wide text-muted-foreground font-medium">Total owed by businesses</div>
        <Money cents={totalOwed} size="3xl" className="font-semibold mt-2 text-warning" />
        {data && data.unassignedCount > 0 && (
          <Link href="/transactions?business=true&unassigned=1">
            <a className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-warning hover:underline" data-testid="link-unassigned-businesses">
              {data.unassignedCount} unassigned · <Money cents={data.unassignedAmount} abs size="xs" /> — assign to a business
            </a>
          </Link>
        )}
      </Card>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <Card>
          <div className="grid grid-cols-12 gap-3 px-5 py-3 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-card-border">
            <div className="col-span-4">Business</div>
            <div className="col-span-2 text-right">Currently owed</div>
            <div className="col-span-2 text-right">This month</div>
            <div className="col-span-2 text-right">All-time</div>
            <div className="col-span-2"></div>
          </div>
          <div className="divide-y divide-border">
            {data?.summary.map((b) => (
              <div key={b.businessId} className="grid grid-cols-12 gap-3 px-5 py-3 items-center text-[13px]" data-testid={`biz-row-${b.businessId}`}>
                <div className="col-span-4 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <Link href={`/transactions?businessId=${b.businessId}`}>
                    <a className="font-medium hover:underline">{b.businessName}</a>
                  </Link>
                  <span className="text-[11px] text-muted-foreground">{b.owedCount} item{b.owedCount === 1 ? "" : "s"}</span>
                </div>
                <div className="col-span-2 text-right">
                  {b.owedAmount === 0 ? <span className="text-muted-foreground italic text-[12px]">—</span> : <Money cents={b.owedAmount} abs size="sm" className="font-medium text-warning" />}
                </div>
                <div className="col-span-2 text-right"><Money cents={b.monthAmount} abs size="sm" className="text-muted-foreground" /></div>
                <div className="col-span-2 text-right">
                  <Money cents={b.allTimeAmount} abs size="sm" className="text-muted-foreground" />
                  {b.lastClearedAt && <div className="text-[10px] text-muted-foreground">last cleared {formatDate(b.lastClearedAt)}</div>}
                </div>
                <div className="col-span-2 text-right">
                  {b.owedAmount > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setClearOpen(b)} data-testid={`button-clear-${b.businessId}`}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Mark cleared
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold mb-3">Manage businesses</h2>
        <ManageBusinesses businesses={businesses} />
      </Card>

      {clearOpen && (
        <Dialog open onOpenChange={() => setClearOpen(null)}>
          <ClearDialog row={clearOpen} onClose={() => setClearOpen(null)} />
        </Dialog>
      )}
    </div>
  );
}

interface PaymentCandidate {
  id: number;
  date: string;
  description: string;
  amount: number;
  accountId: number;
  accountName: string;
  accountType: string;
}

function ClearDialog({ row, onClose }: { row: SummaryRow; onClose: () => void }) {
  const [clearedAt, setClearedAt] = useState(todayISO());
  const [amount, setAmount] = useState((row.owedAmount / 100).toFixed(2));
  const [notes, setNotes] = useState("");
  // null = not selected / manual record. number = id of payment txn on personal card.
  const [paymentMode, setPaymentMode] = useState<"manual" | "match">("match");
  const [paymentTransactionId, setPaymentTransactionId] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: candidatesData } = useQuery<{ candidates: PaymentCandidate[] }>({
    queryKey: ["/api/reimbursements/candidate-payments", { businessId: row.businessId }],
  });
  const candidates = candidatesData?.candidates || [];

  // When user picks a candidate, auto-fill date + amount.
  function pickCandidate(c: PaymentCandidate | null) {
    if (!c) {
      setPaymentTransactionId(null);
      return;
    }
    setPaymentTransactionId(c.id);
    setClearedAt(c.date);
    setAmount((c.amount / 100).toFixed(2));
  }

  const clear = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reimbursements/clear", {
        businessId: row.businessId,
        clearedAt,
        amount: dollarsToCents(amount),
        notes: notes || null,
        paymentTransactionId: paymentMode === "match" ? paymentTransactionId : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reimbursements/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({
        title: "Cleared",
        description: paymentMode === "match" && paymentTransactionId
          ? `${row.businessName} reimbursement matched to payment.`
          : `${row.businessName} reimbursement recorded.`,
      });
      onClose();
    },
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Clear reimbursement from {row.businessName}</DialogTitle>
        <p className="text-[12px] text-muted-foreground">All currently-owed transactions for this business will be marked reimbursed.</p>
      </DialogHeader>

      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="inline-flex rounded-md bg-muted p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => setPaymentMode("match")}
            className={`px-3 py-1.5 rounded transition-colors ${paymentMode === "match" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
            data-testid="button-mode-match"
          >Business paid the card</button>
          <button
            type="button"
            onClick={() => setPaymentMode("manual")}
            className={`px-3 py-1.5 rounded transition-colors ${paymentMode === "manual" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
            data-testid="button-mode-manual"
          >Just record it</button>
        </div>

        {paymentMode === "match" && (
          <div>
            <Label className="text-[12px]">Pick the payment that came from {row.businessName}'s account</Label>
            <p className="text-[11px] text-muted-foreground mb-2 mt-1">Select the payment/credit transaction on your personal card paid by the business. We'll mark it as a business reimbursement so it doesn't double-count.</p>
            {candidates.length === 0 ? (
              <div className="text-[12px] text-muted-foreground italic p-3 border border-dashed rounded">
                No matching payments found on cards with owed expenses. Either import the relevant statement or use “Just record it”.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto border border-card-border rounded divide-y divide-border" data-testid="candidate-list">
                {candidates.map((c) => {
                  const selected = paymentTransactionId === c.id;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => pickCandidate(c)}
                      className={`w-full text-left px-3 py-2 grid grid-cols-12 gap-2 items-center text-[12px] hover-elevate ${selected ? "bg-primary/10" : ""}`}
                      data-testid={`candidate-${c.id}`}
                    >
                      <div className="col-span-2 text-muted-foreground tabular-nums">{c.date.slice(5)}</div>
                      <div className="col-span-6 truncate">{c.description}</div>
                      <div className="col-span-2 text-muted-foreground truncate">{c.accountName}</div>
                      <div className="col-span-2 text-right font-mono">${(c.amount / 100).toFixed(2)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-[12px]">Date received</Label><Input type="date" value={clearedAt} onChange={(e) => setClearedAt(e.target.value)} data-testid="input-cleared-at" /></div>
          <div><Label className="text-[12px]">Amount ($)</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-cleared-amount" /></div>
        </div>
        <div><Label className="text-[12px]">Notes (optional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Check #, transfer ref, etc." data-testid="input-cleared-notes" /></div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => clear.mutate()}
          disabled={clear.isPending || (paymentMode === "match" && candidates.length > 0 && !paymentTransactionId)}
          data-testid="button-confirm-clear"
        >
          {clear.isPending ? "Saving…" : (paymentMode === "match" && paymentTransactionId ? "Match & mark cleared" : "Mark cleared")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ManageBusinesses({ businesses }: { businesses: Business[] }) {
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/businesses", { name, archived: false }); },
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reimbursements/summary"] });
    },
  });
  const archiveToggle = useMutation({
    mutationFn: async ({ id, archived }: { id: number; archived: boolean }) => {
      await apiRequest("PATCH", `/api/businesses/${id}`, { archived });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/businesses"] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New business name" className="max-w-xs" data-testid="input-new-business" />
        <Button size="sm" onClick={() => create.mutate()} disabled={!name}>Add</Button>
      </div>
      <div className="space-y-1 mt-2">
        {businesses.map((b) => (
          <div key={b.id} className="flex items-center justify-between text-[13px] py-1.5 border-b border-border/50 last:border-0">
            <span className={b.archived ? "text-muted-foreground line-through" : ""}>{b.name}</span>
            <Button variant="ghost" size="sm" onClick={() => archiveToggle.mutate({ id: b.id, archived: !b.archived })}>
              {b.archived ? "Restore" : "Archive"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
