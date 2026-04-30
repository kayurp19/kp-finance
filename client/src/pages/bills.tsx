import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/Money";
import { dollarsToCents, formatDate, daysBetween, todayISO } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Bill, Account, Category } from "@shared/schema";
import { Plus, Pencil, Trash2, Calendar, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function BillsPage() {
  const { data: bills, isLoading } = useQuery<Bill[]>({ queryKey: ["/api/bills"] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Bills</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Track recurring bills and never miss a due date</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-bill"><Plus className="h-4 w-4 mr-1" />Add bill</Button>
          </DialogTrigger>
          {open && (
            <BillFormDialog bill={editing} accounts={accounts} categories={categories} onClose={() => { setOpen(false); setEditing(null); }} />
          )}
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : !bills?.length ? (
        <Card className="py-16 px-6 text-center">
          <Calendar className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
          <h3 className="font-medium mb-1">No bills yet</h3>
          <p className="text-[13px] text-muted-foreground mb-5">Add recurring bills like rent, utilities, or subscriptions.</p>
          <Button onClick={() => setOpen(true)} data-testid="button-add-first-bill"><Plus className="h-4 w-4 mr-1" />Add your first bill</Button>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {bills.map((b) => (
            <BillRow
              key={b.id}
              bill={b}
              accounts={accounts}
              categories={categories}
              onEdit={() => { setEditing(b); setOpen(true); }}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

function BillRow({ bill, accounts, categories, onEdit }: { bill: Bill; accounts: Account[]; categories: Category[]; onEdit: () => void }) {
  const days = daysBetween(todayISO(), bill.nextDueDate);
  const overdue = days < 0;
  const soon = days >= 0 && days <= bill.reminderDaysBefore;

  const pay = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/bills/${bill.id}/pay`, { paidDate: todayISO() }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });
  const del = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/bills/${bill.id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });

  return (
    <div className="flex items-center justify-between px-5 py-4" data-testid={`bill-${bill.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[14px]">{bill.name}</span>
          {bill.autopay && <span className="text-[10px] uppercase tracking-wide bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">Autopay</span>}
        </div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          {bill.payee && <span>{bill.payee} · </span>}
          {bill.frequency} ·
          <span className={overdue ? "text-destructive ml-1" : soon ? "text-warning ml-1" : "ml-1"}>
            {overdue ? `Overdue · ` : ""}due {formatDate(bill.nextDueDate)}{!overdue && days >= 0 ? ` (in ${days} day${days === 1 ? "" : "s"})` : ""}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Money cents={bill.amount} abs size="md" className="font-medium" />
        <Button variant="outline" size="sm" onClick={() => pay.mutate()} data-testid={`button-pay-${bill.id}`}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Mark paid</Button>
        <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-bill-${bill.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Delete ${bill.name}?`)) del.mutate(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function BillFormDialog({ bill, accounts, categories, onClose }: { bill: Bill | null; accounts: Account[]; categories: Category[]; onClose: () => void }) {
  const isEdit = !!bill;
  const [form, setForm] = useState({
    name: bill?.name || "",
    payee: bill?.payee || "",
    amount: bill ? (bill.amount / 100).toFixed(2) : "0.00",
    frequency: bill?.frequency || "monthly",
    nextDueDate: bill?.nextDueDate || todayISO(),
    accountId: bill?.accountId ? String(bill.accountId) : "",
    categoryId: bill?.categoryId ? String(bill.categoryId) : "",
    autopay: bill?.autopay || false,
    reminderDaysBefore: bill?.reminderDaysBefore || 3,
  });
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        payee: form.payee || null,
        amount: dollarsToCents(form.amount),
        frequency: form.frequency,
        nextDueDate: form.nextDueDate,
        dueDay: new Date(form.nextDueDate + "T00:00:00").getDate(),
        accountId: form.accountId ? Number(form.accountId) : null,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        autopay: form.autopay,
        reminderDaysBefore: Number(form.reminderDaysBefore),
        notes: null, archived: false,
      };
      if (isEdit) await apiRequest("PATCH", `/api/bills/${bill!.id}`, payload);
      else await apiRequest("POST", "/api/bills", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: isEdit ? "Bill updated" : "Bill added" });
      onClose();
    },
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isEdit ? "Edit bill" : "Add bill"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mortgage" data-testid="input-bill-name" /></div>
        <div><Label>Payee</Label><Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="e.g. Wells Fargo" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Amount ($)</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="input-bill-amount" /></div>
          <div>
            <Label>Frequency</Label>
            <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="one_time">One-time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Next due date</Label><Input type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} data-testid="input-bill-date" /></div>
          <div><Label>Reminder (days before)</Label><Input type="number" value={form.reminderDaysBefore} onChange={(e) => setForm({ ...form, reminderDaysBefore: Number(e.target.value) })} /></div>
        </div>
        <div>
          <Label>Pay from account (optional)</Label>
          <Select value={form.accountId || "none"} onValueChange={(v) => setForm({ ...form, accountId: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" id="autopay" checked={form.autopay} onChange={(e) => setForm({ ...form, autopay: e.target.checked })} />
          <label htmlFor="autopay">Set up on autopay</label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending} data-testid="button-save-bill">{save.isPending ? "Saving…" : isEdit ? "Save" : "Add bill"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
