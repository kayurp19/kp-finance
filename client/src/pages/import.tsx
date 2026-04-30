import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Account, Category, ImportBatch } from "@shared/schema";
import { Upload, FileText, ArrowRight, ArrowLeft, CheckCircle2, Trash2, AlertTriangle } from "lucide-react";
import { Money } from "@/components/Money";
import { formatDate, formatDateShort } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

type Step = "account" | "upload" | "map" | "preview" | "done";

interface PreviewRow {
  date: string;
  description: string;
  amount: number;
  rawAmount?: string;
  externalId: string;
  isDuplicate: boolean;
  categoryId: number | null;
  isBusinessExpense?: boolean;
  businessId?: number | null;
  skip?: boolean;
}

// Sanity-check thresholds for the preview screen (values in cents).
const HUGE_AMOUNT_CENTS = 10_000_000;   // $100,000 — trigger banner
const LARGE_AMOUNT_CENTS = 1_000_000;   // $10,000  — show raw value subscript

export default function ImportPage() {
  const [step, setStep] = useState<Step>("account");
  const [accountId, setAccountId] = useState<string>("");
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<any>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [stats, setStats] = useState({ newCount: 0, duplicateCount: 0 });
  const [importedCount, setImportedCount] = useState(0);

  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: batches = [] } = useQuery<ImportBatch[]>({ queryKey: ["/api/import/batches"] });
  const { toast } = useToast();

  const reset = () => {
    setStep("account");
    setAccountId("");
    setFilename("");
    setContent("");
    setHeaders([]);
    setColumnMap(null);
    setPreviewRows([]);
    setStats({ newCount: 0, duplicateCount: 0 });
    setImportedCount(0);
  };

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Import statement</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">Upload a CSV from your bank to add transactions in bulk.</p>
      </div>

      <StepIndicator step={step} />

      {step === "account" && (
        <StepAccount accounts={accounts} accountId={accountId} setAccountId={setAccountId} onNext={() => setStep("upload")} />
      )}
      {step === "upload" && (
        <StepUpload
          accountId={Number(accountId)}
          onBack={() => setStep("account")}
          onParsed={(p) => {
            setFilename(p.filename); setContent(p.content); setHeaders(p.headers); setColumnMap(p.suggested);
            setStep("map");
          }}
        />
      )}
      {step === "map" && (
        <StepMap
          headers={headers}
          columnMap={columnMap}
          setColumnMap={setColumnMap}
          onBack={() => setStep("upload")}
          onPreview={async () => {
            const res = await apiRequest("POST", "/api/import/preview", { accountId: Number(accountId), content, columnMap });
            const data = await res.json();
            setPreviewRows(data.rows);
            setStats({ newCount: data.newCount, duplicateCount: data.duplicateCount });
            setStep("preview");
          }}
        />
      )}
      {step === "preview" && (
        <StepPreview
          rows={previewRows}
          setRows={setPreviewRows}
          categories={categories}
          stats={stats}
          onBack={() => setStep("map")}
          onCommit={async () => {
            const res = await apiRequest("POST", "/api/import/commit", { accountId: Number(accountId), filename, rows: previewRows });
            const data = await res.json();
            setImportedCount(data.imported);
            queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
            queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
            setStep("done");
            toast({ title: "Import complete", description: `${data.imported} transactions added.` });
          }}
        />
      )}
      {step === "done" && (
        <Card className="p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
          <div className="text-lg font-semibold">Imported {importedCount} transactions</div>
          <p className="text-[13px] text-muted-foreground mt-1">{stats.duplicateCount} duplicates skipped</p>
          <div className="mt-6 flex gap-2 justify-center">
            <Button variant="outline" onClick={reset} data-testid="button-import-another">Import another file</Button>
            <Button onClick={() => { window.location.hash = "#/transactions"; }} data-testid="button-view-transactions">View transactions</Button>
          </div>
        </Card>
      )}

      {/* Import history */}
      <Card>
        <div className="px-5 py-4 border-b border-card-border">
          <h2 className="text-[15px] font-semibold">Recent imports</h2>
          <p className="text-[12px] text-muted-foreground">Delete an import to remove all its transactions.</p>
        </div>
        {batches.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted-foreground">No imports yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {batches.map((b) => {
              const acct = accounts.find((a) => a.id === b.accountId);
              return (
                <BatchRow key={b.id} batch={b} accountName={acct?.name || "Unknown"} />
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function BatchRow({ batch, accountName }: { batch: ImportBatch; accountName: string }) {
  const del = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/import/batches/${batch.id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
  });
  return (
    <div className="flex items-center justify-between px-5 py-3 text-[13px]" data-testid={`batch-${batch.id}`}>
      <div>
        <div className="font-medium">{batch.filename}</div>
        <div className="text-[11px] text-muted-foreground">{accountName} · {batch.rowCount} transactions · {formatDate(batch.importedAt)}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete this import and all ${batch.rowCount} transactions?`)) del.mutate(); }}>
        <Trash2 className="h-3.5 w-3.5 mr-1" />Undo
      </Button>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "account", label: "Account" },
    { key: "upload", label: "Upload" },
    { key: "map", label: "Map columns" },
    { key: "preview", label: "Preview" },
    { key: "done", label: "Done" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1.5">
          <div className={`px-2 py-0.5 rounded font-medium ${i <= idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {i + 1}. {s.label}
          </div>
          {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

function StepAccount({ accounts, accountId, setAccountId, onNext }: any) {
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <Label>Which account is this from?</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="mt-1.5" data-testid="select-import-account"><SelectValue placeholder="Select an account" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {accounts.length === 0 && <p className="text-[12px] text-muted-foreground mt-2">No accounts yet. <a href="#/accounts" className="text-primary hover:underline">Add one first</a>.</p>}
        </div>
        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!accountId} data-testid="button-import-next">Next<ArrowRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </div>
    </Card>
  );
}

function StepUpload({ accountId, onBack, onParsed }: { accountId: number; onBack: () => void; onParsed: (p: { filename: string; content: string; headers: string[]; suggested: any }) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setParsing(true);
    try {
      const text = await file.text();
      const res = await apiRequest("POST", "/api/import/parse", { content: text, accountId });
      const data = await res.json();
      onParsed({ filename: file.name, content: text, headers: data.headers, suggested: data.suggested });
    } catch (e: any) {
      toast({ title: "Couldn't parse file", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  return (
    <Card className="p-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        className={`border-2 border-dashed rounded-xl px-6 py-10 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <FileText className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
        <div className="font-medium text-[14px]">Drop your CSV here</div>
        <div className="text-[12px] text-muted-foreground mt-1">or</div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => fileRef.current?.click()} disabled={parsing} data-testid="button-pick-file">
          {parsing ? "Parsing…" : "Choose file"}
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <p className="text-[11px] text-muted-foreground mt-4">CSV files from any bank. We'll auto-detect columns.</p>
      </div>
      <div className="flex justify-between mt-4">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
      </div>
    </Card>
  );
}

function StepMap({ headers, columnMap, setColumnMap, onBack, onPreview }: any) {
  const [mode, setMode] = useState<"single" | "split">(columnMap?.amountCol ? "single" : "split");
  return (
    <Card className="p-6">
      <p className="text-[13px] text-muted-foreground mb-4">Confirm which columns map to date, description, and amount.</p>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <Label>Date column</Label>
          <Select value={columnMap.dateCol || ""} onValueChange={(v) => setColumnMap({ ...columnMap, dateCol: v })}>
            <SelectTrigger className="mt-1.5" data-testid="select-date-column"><SelectValue /></SelectTrigger>
            <SelectContent>{headers.map((h: string) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Description column</Label>
          <Select value={columnMap.descCol || ""} onValueChange={(v) => setColumnMap({ ...columnMap, descCol: v })}>
            <SelectTrigger className="mt-1.5" data-testid="select-desc-column"><SelectValue /></SelectTrigger>
            <SelectContent>{headers.map((h: string) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="mb-4">
        <Label>Amount format</Label>
        <div className="flex gap-2 mt-1.5">
          <Button variant={mode === "single" ? "default" : "outline"} size="sm" onClick={() => { setMode("single"); setColumnMap({ ...columnMap, debitCol: undefined, creditCol: undefined }); }}>Single signed column</Button>
          <Button variant={mode === "split" ? "default" : "outline"} size="sm" onClick={() => { setMode("split"); setColumnMap({ ...columnMap, amountCol: undefined }); }}>Separate Debit / Credit</Button>
        </div>
      </div>
      {mode === "single" ? (
        <div>
          <Label>Amount column</Label>
          <Select value={columnMap.amountCol || ""} onValueChange={(v) => setColumnMap({ ...columnMap, amountCol: v })}>
            <SelectTrigger className="mt-1.5" data-testid="select-amount-column"><SelectValue /></SelectTrigger>
            <SelectContent>{headers.map((h: string) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
          </Select>
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            <input type="checkbox" id="invert" checked={!!columnMap.invertSign} onChange={(e) => setColumnMap({ ...columnMap, invertSign: e.target.checked })} />
            <label htmlFor="invert" className="text-muted-foreground">Invert sign (some banks export expenses as positive)</label>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Debit (money out)</Label>
            <Select value={columnMap.debitCol || ""} onValueChange={(v) => setColumnMap({ ...columnMap, debitCol: v })}>
              <SelectTrigger className="mt-1.5" data-testid="select-debit-column"><SelectValue /></SelectTrigger>
              <SelectContent>{headers.map((h: string) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Credit (money in)</Label>
            <Select value={columnMap.creditCol || ""} onValueChange={(v) => setColumnMap({ ...columnMap, creditCol: v })}>
              <SelectTrigger className="mt-1.5" data-testid="select-credit-column"><SelectValue /></SelectTrigger>
              <SelectContent>{headers.map((h: string) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}
      <div className="flex justify-between mt-6">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button onClick={onPreview} data-testid="button-import-preview">Preview<ArrowRight className="h-4 w-4 ml-1" /></Button>
      </div>
    </Card>
  );
}

function StepPreview({ rows, setRows, categories, stats, onBack, onCommit }: any) {
  const hasHuge = rows.some((r: PreviewRow) => Math.abs(r.amount) > HUGE_AMOUNT_CENTS);
  return (
    <Card>
      <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Preview & confirm</h2>
          <p className="text-[12px] text-muted-foreground">{stats.newCount} new · {stats.duplicateCount} duplicates skipped</p>
        </div>
      </div>
      {hasHuge && (
        <div className="px-5 py-3 border-b border-card-border bg-yellow-500/10 text-yellow-900 dark:text-yellow-200 flex items-start gap-2 text-[12px]" data-testid="warning-huge-amount">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>Some amounts look unusually large — double-check the column mapping is correct. Go back to the previous step if the wrong column was picked as the amount.</div>
        </div>
      )}
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 sticky top-0">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 w-20">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 w-44">Category</th>
              <th className="px-3 py-2 w-24 text-right">Amount</th>
              <th className="px-3 py-2 w-16">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: PreviewRow, i: number) => (
              <tr key={i} className={`border-t border-border ${r.isDuplicate ? "opacity-50" : ""}`} data-testid={`preview-row-${i}`}>
                <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{formatDateShort(r.date)}</td>
                <td className="px-3 py-1.5 truncate max-w-[280px]">{r.description}</td>
                <td className="px-3 py-1.5">
                  <select
                    className="bg-background border border-border rounded px-1.5 py-1 text-[12px] w-full"
                    value={r.categoryId ?? ""}
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...next[i], categoryId: e.target.value ? Number(e.target.value) : null };
                      setRows(next);
                    }}
                    disabled={r.isDuplicate}
                  >
                    <option value="">— Uncategorized —</option>
                    {categories.filter((c: any) => !c.archived).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Money cents={r.amount} colored size="sm" />
                  {Math.abs(r.amount) > LARGE_AMOUNT_CENTS && r.rawAmount && (
                    <div className="text-[10px] text-muted-foreground font-mono" data-testid={`raw-amount-${i}`}>
                      from: {r.rawAmount}
                    </div>
                  )}
                </td>
                <td className="px-3 py-1.5 text-[11px]">{r.isDuplicate ? <span className="text-muted-foreground">Dup</span> : <span className="text-success">New</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-card-border flex justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button onClick={onCommit} disabled={!stats.newCount} data-testid="button-import-commit">Import {stats.newCount} transaction{stats.newCount === 1 ? "" : "s"}</Button>
      </div>
    </Card>
  );
}
