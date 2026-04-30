import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Category, CategoryRule } from "@shared/schema";
import { Plus, Trash2 } from "lucide-react";

export default function CategoriesPage() {
  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Categories & rules</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Customize categories and auto-apply them on import</p>
      </div>
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-4"><CategoriesTab /></TabsContent>
        <TabsContent value="rules" className="mt-4"><RulesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function CategoriesTab() {
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const [form, setForm] = useState({ name: "", color: "#64748b", isIncome: false });
  const create = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/categories", { name: form.name, color: form.color, isIncome: form.isIncome, icon: "Tag", parentId: null, archived: false });
    },
    onSuccess: () => {
      setForm({ name: "", color: "#64748b", isIncome: false });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
  });
  const archiveToggle = useMutation({
    mutationFn: async ({ id, archived }: { id: number; archived: boolean }) => {
      await apiRequest("PATCH", `/api/categories/${id}`, { archived });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/categories"] }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/categories/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/categories"] }),
  });

  const income = categories.filter((c) => c.isIncome);
  const expense = categories.filter((c) => !c.isIncome);

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="text-[13px] font-medium mb-3">Add new category</div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pet Care" />
          </div>
          <div>
            <Label>Color</Label>
            <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-16 h-9 p-1" />
          </div>
          <div className="flex items-center gap-2 mb-2 text-[13px]">
            <input id="isInc" type="checkbox" checked={form.isIncome} onChange={(e) => setForm({ ...form, isIncome: e.target.checked })} />
            <label htmlFor="isInc">Income</label>
          </div>
          <Button onClick={() => create.mutate()} disabled={!form.name}>Add</Button>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-3 border-b border-card-border text-[13px] font-medium">Expenses ({expense.length})</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
          {expense.map((c) => <CategoryCell key={c.id} cat={c} onArchive={() => archiveToggle.mutate({ id: c.id, archived: !c.archived })} onDelete={() => { if (confirm(`Delete ${c.name}? Existing transactions will become uncategorized.`)) del.mutate(c.id); }} />)}
        </div>
        <div className="px-5 py-3 border-y border-card-border text-[13px] font-medium">Income ({income.length})</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
          {income.map((c) => <CategoryCell key={c.id} cat={c} onArchive={() => archiveToggle.mutate({ id: c.id, archived: !c.archived })} onDelete={() => del.mutate(c.id)} />)}
        </div>
      </Card>
    </div>
  );
}

function CategoryCell({ cat, onArchive, onDelete }: { cat: Category; onArchive: () => void; onDelete: () => void }) {
  return (
    <div className={`flex items-center justify-between rounded-md border border-border px-3 py-2 ${cat.archived ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: cat.color }} />
        <span className="text-[13px] truncate">{cat.name}</span>
      </div>
      <div className="flex gap-0.5">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onArchive}>{cat.archived ? "↺" : "—"}</Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

function RulesTab() {
  const { data: rules = [] } = useQuery<CategoryRule[]>({ queryKey: ["/api/rules"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const [form, setForm] = useState({ matchType: "contains", matchValue: "", categoryId: "" });
  const create = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/rules", { matchType: form.matchType, matchValue: form.matchValue, categoryId: Number(form.categoryId), priority: 0 });
    },
    onSuccess: () => { setForm({ matchType: "contains", matchValue: "", categoryId: "" }); queryClient.invalidateQueries({ queryKey: ["/api/rules"] }); },
  });
  const del = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/rules/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rules"] }),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-[13px] font-medium mb-2">Add a rule</div>
        <p className="text-[12px] text-muted-foreground mb-3">When a transaction's description matches, automatically apply this category on import.</p>
        <div className="flex gap-2 flex-wrap">
          <Select value={form.matchType} onValueChange={(v) => setForm({ ...form, matchType: v })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">Contains</SelectItem>
              <SelectItem value="equals">Equals</SelectItem>
            </SelectContent>
          </Select>
          <Input value={form.matchValue} onChange={(e) => setForm({ ...form, matchValue: e.target.value })} placeholder="STARBUCKS" className="flex-1 min-w-[180px]" data-testid="input-rule-value" />
          <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {categories.filter((c) => !c.archived).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => create.mutate()} disabled={!form.matchValue || !form.categoryId} data-testid="button-add-rule">Add rule</Button>
        </div>
      </Card>

      <Card className="divide-y divide-border">
        {rules.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted-foreground">No rules yet. Add one above to auto-categorize on import.</div>
        ) : rules.map((r) => {
          const cat = categories.find((c) => c.id === r.categoryId);
          return (
            <div key={r.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
              <div>
                <span className="text-muted-foreground">If description {r.matchType}</span>{" "}
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[12px]">{r.matchValue}</span>
                <span className="text-muted-foreground"> → </span>
                {cat ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </span>
                ) : <span className="italic text-muted-foreground">deleted category</span>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => del.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
