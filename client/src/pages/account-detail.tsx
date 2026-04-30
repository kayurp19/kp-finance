import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { dollarsToCents, formatDate, formatDateShort, todayISO } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Account, Transaction, Category } from "@shared/schema";
import { TransactionRow } from "@/components/TransactionRow";
import { ChevronLeft, Pencil, ScrollText, Trash2, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AccountFormDialog } from "@/pages/accounts";
import { useToast } from "@/hooks/use-toast";

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const accountId = Number(params.id);
  const { data: account, isLoading } = useQuery<Account>({ queryKey: [`/api/accounts/${accountId}`] });
  const { data: txs } = useQuery<Transaction[]>({ queryKey: ["/api/transactions", { accountId }] });
  const { data: categories } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const [editOpen, setEditOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const { toast } = useToast();

  const del = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/accounts/${accountId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      window.location.hash = "#/accounts";
    },
  });

  if (isLoading || !account) return <div className="p-8"><Skeleton className="h-8 w-48 mb-4" /><Skeleton className="h-32" /></div>;

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl space-y-5">
      <div>
        <Link href="/accounts"><a className="inline-flex items-center text-[12px] text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" />Back to accounts</a></Link>
      </div>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{account.name}</h1>
          <div className="text-[12px] text-muted-foreground mt-1 capitalize">
            {account.type.replace("_", " ")}
            {account.institution ? ` · ${account.institution}` : ""}
            {account.last4 ? ` · •••${account.last4}` : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-reconcile"><ScrollText className="h-4 w-4 mr-1" />Reconcile</Button>
            </DialogTrigger>
            {reconcileOpen && (
              <ReconcileDialog
                account={account}
                transactions={txs || []}
                onClose={() => setReconcileOpen(false)}
              />
            )}
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-edit-account"><Pencil className="h-4 w-4 mr-1" />Edit</Button>
            </DialogTrigger>
            <AccountFormDialog account={account} onClose={() => setEditOpen(false)} />
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            data-testid="button-delete-account"
            onClick={() => {
              if (confirm(`Delete ${account.name} and all its transactions?`)) del.mutate();
            }}
          ><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current balance</div>
          {account.type === "credit_card" ? (
            <Money cents={Math.abs(Math.min(0, account.currentBalance))} abs size="xl" className="text-destructive font-semibold mt-1" />
          ) : (
            <Money cents={account.currentBalance} colored={account.currentBalance < 0} size="xl" className="font-semibold mt-1" />
          )}
        </Card>
        {account.creditLimit && (
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Credit limit</div>
            <Money cents={account.creditLimit} size="xl" className="font-semibold mt-1" />
            <div className="text-[11px] text-muted-foreground mt-1">
              {(Math.abs(Math.min(0, account.currentBalance)) / account.creditLimit * 100).toFixed(0)}% utilized
            </div>
          </Card>
        )}
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Transactions</div>
          <div className="text-xl font-semibold mt-1 font-mono">{txs?.length ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last reconciled</div>
          <div className="text-[14px] font-medium mt-1.5">
            {account.lastReconciledAt ? formatDate(account.lastReconciledAt) : <span className="text-muted-foreground italic">Never</span>}
          </div>
          {account.lastReconciledBalance !== null && account.lastReconciledBalance !== undefined && (
            <div className="text-[11px] text-muted-foreground">
              statement: <Money cents={account.lastReconciledBalance} size="xs" />
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Transactions</h2>
          <Link href={`/transactions?accountId=${account.id}`}><a className="text-[12px] text-primary hover:underline">Filter on transactions page</a></Link>
        </div>
        {!txs?.length ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No transactions for this account yet. <Link href="/import"><a className="text-primary hover:underline">Import a CSV</a></Link> to get started.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {txs.slice(0, 50).map((t) => (
              <TransactionRow key={t.id} tx={t} categories={categories || []} hideAccount />
            ))}
            {txs.length > 50 && (
              <div className="px-5 py-3 text-center text-[12px] text-muted-foreground">
                Showing 50 of {txs.length}. <Link href={`/transactions?accountId=${account.id}`}><a className="text-primary hover:underline">View all</a></Link>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function ReconcileDialog({ account, transactions, onClose }: { account: Account; transactions: Transaction[]; onClose: () => void }) {
  const [statementDate, setStatementDate] = useState(todayISO());
  const [statementBalance, setStatementBalance] = useState(account.currentBalance / 100 + "");
  // Pre-check transactions already reconciled
  const [checked, setChecked] = useState<Set<number>>(() => {
    const s = new Set<number>();
    transactions.forEach((t) => { if (t.reconciled) s.add(t.id); });
    return s;
  });
  const { toast } = useToast();

  const eligible = useMemo(() => transactions.filter((t) => t.date <= statementDate), [transactions, statementDate]);
  const clearedCents = useMemo(() => eligible.filter((t) => checked.has(t.id)).reduce((s, t) => s + t.amount, 0), [eligible, checked]);
  const targetCents = dollarsToCents(statementBalance);
  const diff = targetCents - clearedCents;
  const matches = diff === 0;

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/accounts/${account.id}/reconcile`, {
        statementDate,
        statementBalance: targetCents,
        reconciledIds: Array.from(checked),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/accounts/${account.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Reconciled", description: `${checked.size} transactions marked as reconciled.` });
      onClose();
    },
  });

  const toggle = (id: number) => {
    const s = new Set(checked);
    if (s.has(id)) s.delete(id); else s.add(id);
    setChecked(s);
  };

  return (
    <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Reconcile {account.name}</DialogTitle>
        <p className="text-[12px] text-muted-foreground">Check off each transaction that appears on your statement. When the cleared total matches your statement balance, you're reconciled.</p>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Statement date</Label>
          <Input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} data-testid="input-reconcile-date" />
        </div>
        <div>
          <Label>Statement ending balance ($)</Label>
          <Input type="number" step="0.01" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} data-testid="input-reconcile-balance" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-[13px]">
        <Card className="p-3"><div className="text-[11px] text-muted-foreground">Cleared total</div><Money cents={clearedCents} size="md" className="font-semibold mt-1" /></Card>
        <Card className="p-3"><div className="text-[11px] text-muted-foreground">Statement target</div><Money cents={targetCents} size="md" className="font-semibold mt-1" /></Card>
        <Card className={`p-3 ${matches ? "border-success" : ""}`}>
          <div className="text-[11px] text-muted-foreground">Difference</div>
          <div className="flex items-center gap-1.5 mt-1">
            <Money cents={diff} size="md" className={`font-semibold ${matches ? "text-success" : "text-warning"}`} />
            {matches && <CheckCircle2 className="h-4 w-4 text-success" />}
          </div>
        </Card>
      </div>
      <div className="flex-1 overflow-auto border border-border rounded-md">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 sticky top-0">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 w-10"></th>
              <th className="px-3 py-2 w-24">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 w-28 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {eligible.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-6 text-muted-foreground italic">No transactions on or before {statementDate}.</td></tr>
            ) : eligible.map((t) => (
              <tr key={t.id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggle(t.id)} data-testid={`check-recon-${t.id}`} />
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{formatDateShort(t.date)}</td>
                <td className="px-3 py-1.5 truncate max-w-[280px]">{t.description}</td>
                <td className="px-3 py-1.5 text-right"><Money cents={t.amount} colored size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-reconcile">
          {save.isPending ? "Saving…" : matches ? "Mark reconciled" : "Save progress"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
