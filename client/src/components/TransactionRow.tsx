import type { Transaction, Category, Account, Business } from "@shared/schema";
import { Money } from "@/components/Money";
import { formatDateShort } from "@/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Briefcase, CheckCircle2, MoreHorizontal, Tag } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function TransactionRow({
  tx,
  categories,
  accounts,
  hideAccount,
}: {
  tx: Transaction;
  categories: Category[];
  accounts?: Account[];
  hideAccount?: boolean;
}) {
  const cat = categories.find((c) => c.id === tx.categoryId);
  const acct = accounts?.find((a) => a.id === tx.accountId);
  const { data: businesses = [] } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });
  const business = businesses.find((b) => b.id === tx.businessId);
  const [editOpen, setEditOpen] = useState(false);

  const update = useMutation({
    mutationFn: async (data: Partial<Transaction>) => {
      await apiRequest("PATCH", `/api/transactions/${tx.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reimbursements/summary"] });
    },
  });

  const del = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/transactions/${tx.id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
  });

  return (
    <div className="grid grid-cols-12 items-center gap-3 px-5 py-2.5 text-[13px] hover:bg-muted/30" data-testid={`tx-row-${tx.id}`}>
      <div className="col-span-2 md:col-span-1 font-mono text-[11px] text-muted-foreground">{formatDateShort(tx.date)}</div>
      <div className="col-span-6 md:col-span-5 min-w-0">
        <div className="font-medium truncate">{tx.description}</div>
        {!hideAccount && acct && <div className="text-[11px] text-muted-foreground">{acct.name}</div>}
        {tx.merchant && <div className="text-[11px] text-muted-foreground">{tx.merchant}</div>}
      </div>
      <div className="col-span-2 hidden md:block">
        <CategoryBadge tx={tx} categories={categories} onChange={(id) => update.mutate({ categoryId: id, autoLearn: true } as any)} />
      </div>
      <div className="col-span-2 hidden md:block">
        <BusinessTag tx={tx} businesses={businesses} onToggle={(b) => update.mutate({ isBusinessExpense: b })} onAssign={(id) => update.mutate({ businessId: id, isBusinessExpense: true })} />
      </div>
      <div className="col-span-3 md:col-span-1 text-right flex items-center justify-end gap-1">
        <Money cents={tx.amount} expense colored={tx.amount > 0} size="sm" className="font-medium" />
        {tx.reconciled && <CheckCircle2 className="h-3 w-3 text-success" />}
      </div>
      <div className="col-span-1 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`tx-menu-${tx.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit details</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => update.mutate({ reconciled: !tx.reconciled, reconciledAt: tx.reconciled ? null : new Date().toISOString() } as any)}>
              {tx.reconciled ? "Mark unreconciled" : "Mark reconciled"}
            </DropdownMenuItem>
            {tx.isBusinessExpense && (
              <DropdownMenuItem onClick={() => update.mutate({ reimbursedAt: tx.reimbursedAt ? null : new Date().toISOString() } as any)}>
                {tx.reimbursedAt ? "Mark as still owed" : "Mark as reimbursed"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm("Delete this transaction?")) del.mutate(); }}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        {editOpen && <EditTxDialog tx={tx} categories={categories} businesses={businesses} accounts={accounts || []} onClose={() => setEditOpen(false)} />}
      </Dialog>
    </div>
  );
}

function CategoryBadge({ tx, categories, onChange }: { tx: Transaction; categories: Category[]; onChange: (id: number | null) => void }) {
  const cat = categories.find((c) => c.id === tx.categoryId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-[12px] hover-elevate px-2 py-1 rounded-md max-w-full" data-testid={`tx-category-${tx.id}`}>
          {cat ? (
            <>
              <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: cat.color }} />
              <span className="truncate">{cat.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground italic flex items-center gap-1"><Tag className="h-3 w-3" />Uncategorized</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1 max-h-72 overflow-auto">
        <button onClick={() => onChange(null)} className="w-full text-left px-2 py-1.5 text-[12px] rounded hover-elevate text-muted-foreground italic">Uncategorized</button>
        {categories.filter((c) => !c.archived).map((c) => (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            data-testid={`category-option-${c.id}`}
            className="w-full text-left px-2 py-1.5 text-[12px] rounded hover-elevate flex items-center gap-2"
          >
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c.color }} />
            {c.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function BusinessTag({
  tx, businesses, onToggle, onAssign,
}: { tx: Transaction; businesses: Business[]; onToggle: (b: boolean) => void; onAssign: (id: number | null) => void }) {
  const business = businesses.find((b) => b.id === tx.businessId);
  if (!tx.isBusinessExpense) {
    return (
      <button
        onClick={() => onToggle(true)}
        className="text-[11px] text-muted-foreground/70 hover:text-warning px-2 py-1 rounded hover-elevate inline-flex items-center gap-1"
        data-testid={`tx-tag-business-${tx.id}`}
      >
        <Briefcase className="h-3 w-3" />Mark business
      </button>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-warning/10 text-warning hover-elevate" data-testid={`tx-business-${tx.id}`}>
          <Briefcase className="h-3 w-3" />
          <span className="truncate max-w-[100px]">{business?.name || "Unassigned"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pt-1.5 pb-1">Attribute to</div>
        <button onClick={() => onAssign(null)} className="w-full text-left px-2 py-1.5 text-[12px] rounded hover-elevate italic text-muted-foreground">Unassigned</button>
        {businesses.filter((b) => !b.archived).map((b) => (
          <button key={b.id} onClick={() => onAssign(b.id)} className="w-full text-left px-2 py-1.5 text-[12px] rounded hover-elevate" data-testid={`business-option-${b.id}`}>{b.name}</button>
        ))}
        <div className="border-t border-border my-1" />
        <button onClick={() => onToggle(false)} className="w-full text-left px-2 py-1.5 text-[12px] rounded hover-elevate text-muted-foreground">Remove business tag</button>
      </PopoverContent>
    </Popover>
  );
}

function EditTxDialog({
  tx, categories, businesses, accounts, onClose,
}: { tx: Transaction; categories: Category[]; businesses: Business[]; accounts: Account[]; onClose: () => void }) {
  const [form, setForm] = useState({
    date: tx.date,
    description: tx.description,
    merchant: tx.merchant || "",
    notes: tx.notes || "",
    amount: (tx.amount / 100).toFixed(2),
  });
  const update = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/transactions/${tx.id}`, {
        date: form.date,
        description: form.description,
        merchant: form.merchant || null,
        notes: form.notes || null,
        amount: Math.round(parseFloat(form.amount) * 100),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      onClose();
    },
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Edit transaction</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><Label>Amount ($)</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        </div>
        <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><Label>Merchant</Label><Input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} /></div>
        <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => update.mutate()} disabled={update.isPending}>Save</Button>
      </DialogFooter>
    </DialogContent>
  );
}
