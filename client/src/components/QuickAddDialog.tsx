import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { dollarsToCents, todayISO } from "@/lib/format";
import type { Account, Category, Business } from "@shared/schema";

export function QuickAddButton() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const accountsQ = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
    enabled: open,
  });
  const categoriesQ = useQuery<Category[]>({
    queryKey: ["/api/categories"],
    enabled: open,
  });
  const businessesQ = useQuery<Business[]>({
    queryKey: ["/api/businesses"],
    enabled: open,
  });

  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [isBusiness, setIsBusiness] = useState(false);
  const [businessId, setBusinessId] = useState<string>("");

  const reset = () => {
    setDate(todayISO());
    setAccountId("");
    setAmount("");
    setType("expense");
    setDescription("");
    setMerchant("");
    setCategoryId("");
    setNotes("");
    setIsBusiness(false);
    setBusinessId("");
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const cents = dollarsToCents(amount);
      const signed = type === "expense" ? -Math.abs(cents) : Math.abs(cents);
      return apiRequest("POST", "/api/transactions", {
        accountId: Number(accountId),
        date,
        amount: signed,
        description: description || merchant || "Manual entry",
        merchant: merchant || null,
        categoryId: categoryId ? Number(categoryId) : null,
        notes: notes || null,
        entity: "Personal",
        isBusinessExpense: isBusiness,
        businessId: isBusiness && businessId ? Number(businessId) : null,
        reconciled: false,
        pending: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reimbursements/summary"] });
      toast({ title: "Transaction added" });
      reset();
      setOpen(false);
    },
    onError: (e: any) => {
      toast({
        title: "Failed to add",
        description: e?.message ?? "Check inputs",
        variant: "destructive",
      });
    },
  });

  const canSubmit = accountId && amount && description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-40"
          aria-label="Quick add transaction"
          data-testid="button-quick-add"
        >
          <Plus className="h-6 w-6" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-quick-add">
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>
            Quickly log a manual transaction. For bulk entries, use Import.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="qa-date">Date</Label>
            <Input
              id="qa-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="input-qa-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-account">Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="qa-account" data-testid="select-qa-account">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {(accountsQ.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger id="qa-type" data-testid="select-qa-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-amount">Amount</Label>
            <Input
              id="qa-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-qa-amount"
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="qa-desc">Description</Label>
            <Input
              id="qa-desc"
              placeholder="What's this for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-qa-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-merchant">Merchant</Label>
            <Input
              id="qa-merchant"
              placeholder="Optional"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              data-testid="input-qa-merchant"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="qa-category" data-testid="select-qa-category">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {(categoriesQ.data ?? [])
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isBusiness}
                onCheckedChange={(v) => setIsBusiness(!!v)}
                data-testid="checkbox-qa-business"
              />
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Business expense (track for reimbursement)</span>
            </label>
            {isBusiness && (
              <Select value={businessId} onValueChange={setBusinessId}>
                <SelectTrigger data-testid="select-qa-business">
                  <SelectValue placeholder="Which business?" />
                </SelectTrigger>
                <SelectContent>
                  {(businessesQ.data ?? [])
                    .filter((b) => !b.archived)
                    .map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="qa-notes">Notes</Label>
            <Textarea
              id="qa-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-qa-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            data-testid="button-qa-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!canSubmit || createMut.isPending}
            data-testid="button-qa-save"
          >
            {createMut.isPending ? "Saving…" : "Add transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default QuickAddButton;
