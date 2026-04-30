import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { dollarsToCents, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Account } from "@shared/schema";
import { Plus, Wallet } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit card" },
  { value: "loan", label: "Loan" },
  { value: "investment", label: "Investment" },
  { value: "cash", label: "Cash" },
];

export default function AccountsPage() {
  const { data: accounts, isLoading } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const [open, setOpen] = useState(false);

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">All your bank accounts and credit cards</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-account"><Plus className="h-4 w-4 mr-1" />Add account</Button>
          </DialogTrigger>
          <AccountFormDialog onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : !accounts?.length ? (
        <EmptyState onAdd={() => setOpen(true)} />
      ) : (
        <Card className="divide-y divide-border">
          {accounts.map((a) => (
            <Link key={a.id} href={`/accounts/${a.id}`}>
              <a className="flex items-center justify-between px-5 py-4 hover-elevate" data-testid={`account-row-${a.id}`}>
                <div>
                  <div className="font-medium text-[14px]">{a.name}</div>
                  <div className="text-[12px] text-muted-foreground capitalize">
                    {a.type.replace("_", " ")}
                    {a.institution ? ` · ${a.institution}` : ""}
                    {a.last4 ? ` · •••${a.last4}` : ""}
                    {a.lastReconciledAt ? ` · reconciled ${formatDate(a.lastReconciledAt)}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  {a.type === "credit_card" ? (
                    <>
                      <Money cents={Math.abs(Math.min(0, a.currentBalance))} abs size="md" className="text-destructive font-medium" />
                      <div className="text-[10px] text-muted-foreground">owed{a.creditLimit ? ` of ${(Math.abs(Math.min(0, a.currentBalance)) / a.creditLimit * 100).toFixed(0)}% used` : ""}</div>
                    </>
                  ) : (
                    <Money cents={a.currentBalance} colored={a.currentBalance < 0} size="md" className="font-medium" />
                  )}
                </div>
              </a>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="py-16 px-6 text-center">
      <Wallet className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
      <h3 className="font-medium mb-1">No accounts yet</h3>
      <p className="text-[13px] text-muted-foreground mb-5 max-w-sm mx-auto">Add your checking, savings, and credit card accounts so you can start tracking transactions.</p>
      <Button onClick={onAdd} data-testid="button-add-first-account"><Plus className="h-4 w-4 mr-1" />Add your first account</Button>
    </Card>
  );
}

export function AccountFormDialog({ account, onClose }: { account?: Account; onClose: () => void }) {
  const isEdit = !!account;
  const [form, setForm] = useState({
    name: account?.name ?? "",
    type: account?.type ?? "checking",
    institution: account?.institution ?? "",
    last4: account?.last4 ?? "",
    currentBalance: account ? (account.currentBalance / 100).toString() : "0",
    creditLimit: account?.creditLimit ? (account.creditLimit / 100).toString() : "",
    notes: account?.notes ?? "",
  });
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        type: form.type,
        institution: form.institution || null,
        last4: form.last4 || null,
        currentBalance: dollarsToCents(form.currentBalance),
        creditLimit: form.creditLimit ? dollarsToCents(form.creditLimit) : null,
        notes: form.notes || null,
        archived: false,
      };
      if (isEdit) await apiRequest("PATCH", `/api/accounts/${account!.id}`, payload);
      else await apiRequest("POST", "/api/accounts", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: isEdit ? "Account updated" : "Account added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isEdit ? "Edit account" : "New account"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Account name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chase Checking" data-testid="input-account-name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger data-testid="select-account-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Last 4</Label>
            <Input value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value })} placeholder="1234" maxLength={4} data-testid="input-account-last4" />
          </div>
        </div>
        <div>
          <Label>Institution</Label>
          <Input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} placeholder="e.g. Chase" data-testid="input-account-institution" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Current balance ($)</Label>
            <Input type="number" step="0.01" value={form.currentBalance} onChange={(e) => setForm({ ...form, currentBalance: e.target.value })} data-testid="input-account-balance" />
            <p className="text-[10px] text-muted-foreground mt-1">For credit cards, enter as negative (e.g. -1234.56)</p>
          </div>
          {form.type === "credit_card" && (
            <div>
              <Label>Credit limit ($)</Label>
              <Input type="number" step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} data-testid="input-account-limit" />
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending} data-testid="button-save-account">
          {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add account"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
