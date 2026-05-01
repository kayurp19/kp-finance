import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Printer, Save, FileText, Copy } from "lucide-react";
import { formatCents, dollarsToCents, todayISO } from "@/lib/format";

// ============================================================
// PFS data model (lives entirely in the version's `data` JSON)
// ============================================================

interface PfsLine {
  id: string;             // client-side stable id for editing
  label: string;
  amount: number;         // cents
  detail?: string;        // optional sub-line (e.g. "30-yr fixed @ 5.25%")
  monthlyPayment?: number; // for liabilities (cents)
}

interface PfsData {
  // Profile / borrower info (what banks ask for)
  profile: {
    name: string;
    address: string;
    cityStateZip: string;
    phone: string;
    email: string;
    dob: string;             // YYYY-MM-DD
    ssn: string;             // optional
    employer: string;
    position: string;
    yearsEmployed: string;
    spouseName?: string;
    spouseEmployer?: string;
  };
  // Sections — each is an editable list of lines
  cash: PfsLine[];
  investments: PfsLine[];
  realEstate: PfsLine[];
  vehicles: PfsLine[];
  personalProperty: PfsLine[];
  businessInterests: PfsLine[];
  notesReceivable: PfsLine[];
  otherAssets: PfsLine[];
  mortgages: PfsLine[];          // tied to real estate
  creditCards: PfsLine[];
  autoLoans: PfsLine[];
  otherLiabilities: PfsLine[];
  // Income / expense — annualized
  income: PfsLine[];
  expenses: PfsLine[];
  // Contingent liabilities (SBA Form 413 \u00a74)
  contingent: {
    asEndorser: number;
    legalClaims: number;
    pastDueTaxes: number;
    otherSpecial: number;
  };
}

const SECTION_LABELS: Record<string, string> = {
  cash: "Cash on Hand & in Banks",
  investments: "Stocks, Bonds & Other Securities",
  realEstate: "Real Estate Owned",
  vehicles: "Automobiles",
  personalProperty: "Other Personal Property",
  businessInterests: "Business / Partnership Interests",
  notesReceivable: "Accounts & Notes Receivable",
  otherAssets: "Other Assets",
  mortgages: "Mortgages on Real Estate",
  creditCards: "Credit Card Balances",
  autoLoans: "Auto Loans",
  otherLiabilities: "Other Liabilities",
  income: "Annual Income",
  expenses: "Annual Expenses",
};

const ASSET_SECTIONS: Array<keyof PfsData> = [
  "cash", "investments", "realEstate", "vehicles",
  "personalProperty", "businessInterests", "notesReceivable", "otherAssets",
];
const LIABILITY_SECTIONS: Array<keyof PfsData> = [
  "mortgages", "creditCards", "autoLoans", "otherLiabilities",
];

// Stable client id helper
const cid = () => Math.random().toString(36).slice(2, 10);

// ============================================================
// Build a fresh PfsData from the /api/pfs auto-derived snapshot
// ============================================================

function buildDefaultPfs(derived: any): PfsData {
  const cashLines: PfsLine[] = (derived?.cash || []).map((a: any) => ({
    id: cid(), label: a.name, detail: a.institution || undefined, amount: a.balance,
  }));
  const investmentLines: PfsLine[] = (derived?.investments || []).map((a: any) => ({
    id: cid(), label: a.name, detail: a.institution || undefined, amount: a.balance,
  }));
  const ccLines: PfsLine[] = (derived?.creditCards || []).map((a: any) => ({
    id: cid(), label: a.name, detail: a.institution || undefined, amount: a.balance,
  }));
  const loanLines: PfsLine[] = (derived?.loans || []).map((a: any) => ({
    id: cid(), label: a.name, detail: a.institution || undefined, amount: a.balance,
  }));

  // For Income/Expense, seed a single line with the annual rollup
  const incomeLines: PfsLine[] = derived?.annualIncome
    ? [{ id: cid(), label: "Salary / Personal Income (12-mo rollup)", amount: derived.annualIncome }]
    : [{ id: cid(), label: "Salary", amount: 0 }];
  const expenseLines: PfsLine[] = derived?.annualExpenses
    ? [{ id: cid(), label: "Living Expenses (12-mo rollup)", amount: derived.annualExpenses }]
    : [{ id: cid(), label: "Living Expenses", amount: 0 }];

  return {
    profile: {
      name: "", address: "", cityStateZip: "", phone: "", email: "",
      dob: "", ssn: "", employer: "", position: "", yearsEmployed: "",
    },
    cash: cashLines.length ? cashLines : [{ id: cid(), label: "Checking", amount: 0 }],
    investments: investmentLines,
    realEstate: [],
    vehicles: [],
    personalProperty: [],
    businessInterests: [],
    notesReceivable: [],
    otherAssets: [],
    mortgages: [],
    creditCards: ccLines,
    autoLoans: loanLines,
    otherLiabilities: [],
    income: incomeLines,
    expenses: expenseLines,
    contingent: { asEndorser: 0, legalClaims: 0, pastDueTaxes: 0, otherSpecial: 0 },
  };
}

// ============================================================
// Helpers
// ============================================================

function sumLines(lines: PfsLine[] = []): number {
  return lines.reduce((s, l) => s + (l.amount || 0), 0);
}

// ============================================================
// Editable money input (raw dollars, syncs cents)
// ============================================================

function MoneyInput({
  cents, onChange, className = "", placeholder, "data-testid": testId,
}: {
  cents: number;
  onChange: (cents: number) => void;
  className?: string;
  placeholder?: string;
  "data-testid"?: string;
}) {
  const [text, setText] = useState(cents ? (cents / 100).toFixed(2) : "");
  // Sync external changes
  useEffect(() => {
    const expected = cents ? (cents / 100).toFixed(2) : "";
    if (parseFloat(text) !== cents / 100) setText(expected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(dollarsToCents(text))}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`bg-background border border-border rounded px-2 py-1 text-right text-[13px] tabular-nums w-32 ${className}`}
      placeholder={placeholder || "0.00"}
      data-testid={testId}
    />
  );
}

// ============================================================
// Editable text input (small, inline)
// ============================================================

function TextInline({
  value, onChange, placeholder, className = "", "data-testid": testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`bg-transparent border-0 border-b border-transparent hover:border-border focus:border-primary focus:outline-none text-[13px] w-full ${className}`}
      placeholder={placeholder}
      data-testid={testId}
    />
  );
}

// ============================================================
// Main page
// ============================================================

export default function PfsPage() {
  // Versions list
  const { data: versions = [] } = useQuery<any[]>({ queryKey: ["/api/pfs/versions"] });
  // Auto-derived snapshot from accounts/transactions
  const { data: derived } = useQuery<any>({ queryKey: ["/api/pfs"] });

  const [versionId, setVersionId] = useState<number | null>(null);
  const [name, setName] = useState("Personal Financial Statement");
  const [asOfDate, setAsOfDate] = useState(todayISO());
  const [data, setData] = useState<PfsData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // When derived loads and we have no data yet, build defaults
  useEffect(() => {
    if (derived && !data) {
      setData(buildDefaultPfs(derived.derived));
    }
  }, [derived, data]);

  function patchData(patch: Partial<PfsData>) {
    setData((prev) => prev ? { ...prev, ...patch } : prev);
    setDirty(true);
  }
  function patchSection(key: keyof PfsData, lines: PfsLine[]) {
    patchData({ [key]: lines } as any);
  }
  function addLine(key: keyof PfsData) {
    if (!data) return;
    const next = [...(data[key] as PfsLine[]), { id: cid(), label: "", amount: 0 }];
    patchSection(key, next);
  }
  function removeLine(key: keyof PfsData, id: string) {
    if (!data) return;
    patchSection(key, (data[key] as PfsLine[]).filter((l) => l.id !== id));
  }
  function updateLine(key: keyof PfsData, id: string, patch: Partial<PfsLine>) {
    if (!data) return;
    patchSection(key, (data[key] as PfsLine[]).map((l) => l.id === id ? { ...l, ...patch } : l));
  }

  // Totals
  const totalAssets = useMemo(() => {
    if (!data) return 0;
    return ASSET_SECTIONS.reduce((s, k) => s + sumLines(data[k] as PfsLine[]), 0);
  }, [data]);
  const totalLiabilities = useMemo(() => {
    if (!data) return 0;
    return LIABILITY_SECTIONS.reduce((s, k) => s + sumLines(data[k] as PfsLine[]), 0);
  }, [data]);
  const netWorth = totalAssets - totalLiabilities;
  const totalIncome = useMemo(() => data ? sumLines(data.income) : 0, [data]);
  const totalExpenses = useMemo(() => data ? sumLines(data.expenses) : 0, [data]);

  async function loadVersion(id: number) {
    const v = await apiRequest("GET", `/api/pfs/versions/${id}`).then((r) => r.json());
    setVersionId(v.id);
    setName(v.name);
    setAsOfDate(v.asOfDate);
    setData(v.data);
    setDirty(false);
  }

  async function saveCurrent() {
    if (!data) return;
    setSaving(true);
    try {
      if (versionId) {
        await apiRequest("PATCH", `/api/pfs/versions/${versionId}`, { name, asOfDate, data });
      } else {
        const created = await apiRequest("POST", `/api/pfs/versions`, { name, asOfDate, data })
          .then((r) => r.json());
        setVersionId(created.id);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/pfs/versions"] });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveAsNew() {
    if (!data) return;
    setSaving(true);
    try {
      const newName = window.prompt("Name for this saved version:", `${name} (Copy)`);
      if (!newName) return;
      const created = await apiRequest("POST", `/api/pfs/versions`, { name: newName, asOfDate, data })
        .then((r) => r.json());
      setVersionId(created.id);
      setName(newName);
      queryClient.invalidateQueries({ queryKey: ["/api/pfs/versions"] });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function deleteVersion() {
    if (!versionId) return;
    if (!window.confirm("Delete this saved version?")) return;
    await apiRequest("DELETE", `/api/pfs/versions/${versionId}`);
    setVersionId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/pfs/versions"] });
  }

  function startNew() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setVersionId(null);
    setName("Personal Financial Statement");
    setAsOfDate(todayISO());
    if (derived) setData(buildDefaultPfs(derived.derived));
    setDirty(false);
  }

  function reseedFromAccounts() {
    if (!derived) return;
    if (!window.confirm("Replace cash, investments, credit-card and loan rows with current account balances? (Other rows like real estate stay.)")) return;
    if (!data) return;
    const fresh = buildDefaultPfs(derived.derived);
    patchData({
      cash: fresh.cash,
      investments: fresh.investments,
      creditCards: fresh.creditCards,
      autoLoans: fresh.autoLoans,
    });
  }

  if (!data) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="pfs-root">
      {/* ========================== Toolbar (hidden in print) ========================== */}
      <div className="no-print sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex flex-wrap items-center gap-2">
        <FileText className="h-5 w-5 text-primary" />
        <h1 className="text-[15px] font-semibold mr-3">Personal Financial Statement</h1>

        <Select value={versionId ? String(versionId) : "new"} onValueChange={(v) => v === "new" ? startNew() : loadVersion(Number(v))}>
          <SelectTrigger className="w-56" data-testid="select-pfs-version">
            <SelectValue placeholder="— New —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">— New blank statement —</SelectItem>
            {versions.map((v: any) => (
              <SelectItem key={v.id} value={String(v.id)}>
                {v.name} · {v.asOfDate}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" onClick={reseedFromAccounts} data-testid="button-pfs-refresh">
          Refresh from Accounts
        </Button>

        <div className="flex-1" />

        <Button size="sm" variant="outline" onClick={saveAsNew} disabled={saving} data-testid="button-pfs-save-as">
          <Copy className="h-4 w-4 mr-1.5" />Save as new
        </Button>
        <Button size="sm" onClick={saveCurrent} disabled={saving || !dirty} data-testid="button-pfs-save">
          <Save className="h-4 w-4 mr-1.5" />{saving ? "Saving..." : (versionId ? "Save" : "Save version")}
        </Button>
        <Button size="sm" variant="default" onClick={() => window.print()} data-testid="button-pfs-print">
          <Printer className="h-4 w-4 mr-1.5" />Print / Save PDF
        </Button>
        {versionId && (
          <Button size="sm" variant="ghost" onClick={deleteVersion} data-testid="button-pfs-delete">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>

      <div className="no-print px-6 pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-[11px]">Version Name</Label>
          <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} data-testid="input-pfs-name" />
        </div>
        <div>
          <Label className="text-[11px]">As-of Date</Label>
          <Input type="date" value={asOfDate} onChange={(e) => { setAsOfDate(e.target.value); setDirty(true); }} data-testid="input-pfs-date" />
        </div>
        <div className="flex items-end">
          {dirty && <span className="text-[12px] text-yellow-700 dark:text-yellow-400">Unsaved changes</span>}
        </div>
      </div>

      {/* ========================== Printable area ========================== */}
      <div className="pfs-print-area px-6 py-6 max-w-[8.5in] mx-auto print:max-w-full print:px-0">
        <div className="text-center mb-6 print:mb-4">
          <h1 className="text-2xl font-bold print:text-[20pt]">Personal Financial Statement</h1>
          <p className="text-[12px] text-muted-foreground">As of {asOfDate}</p>
        </div>

        {/* ---------------- Profile ---------------- */}
        <Section title="Borrower Information">
          <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <ProfileField label="Full Name" value={data.profile.name} onChange={(v) => patchData({ profile: { ...data.profile, name: v } })} testId="pfs-profile-name" />
            <ProfileField label="Date of Birth" value={data.profile.dob} onChange={(v) => patchData({ profile: { ...data.profile, dob: v } })} placeholder="YYYY-MM-DD" testId="pfs-profile-dob" />
            <ProfileField label="Address" value={data.profile.address} onChange={(v) => patchData({ profile: { ...data.profile, address: v } })} testId="pfs-profile-address" />
            <ProfileField label="City, State, ZIP" value={data.profile.cityStateZip} onChange={(v) => patchData({ profile: { ...data.profile, cityStateZip: v } })} testId="pfs-profile-citystatezip" />
            <ProfileField label="Phone" value={data.profile.phone} onChange={(v) => patchData({ profile: { ...data.profile, phone: v } })} testId="pfs-profile-phone" />
            <ProfileField label="Email" value={data.profile.email} onChange={(v) => patchData({ profile: { ...data.profile, email: v } })} testId="pfs-profile-email" />
            <ProfileField label="Employer" value={data.profile.employer} onChange={(v) => patchData({ profile: { ...data.profile, employer: v } })} testId="pfs-profile-employer" />
            <ProfileField label="Position" value={data.profile.position} onChange={(v) => patchData({ profile: { ...data.profile, position: v } })} testId="pfs-profile-position" />
            <ProfileField label="Years Employed" value={data.profile.yearsEmployed} onChange={(v) => patchData({ profile: { ...data.profile, yearsEmployed: v } })} testId="pfs-profile-years" />
            <ProfileField label="SSN (optional)" value={data.profile.ssn} onChange={(v) => patchData({ profile: { ...data.profile, ssn: v } })} testId="pfs-profile-ssn" />
          </div>
        </Section>

        {/* ---------------- Two-column Assets / Liabilities ---------------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6 mt-6 print:gap-4">
          {/* ASSETS */}
          <div>
            <h2 className="text-[14pt] font-bold border-b-2 border-foreground pb-1 mb-3">Assets</h2>
            {ASSET_SECTIONS.map((k) => (
              <SectionList
                key={k}
                title={SECTION_LABELS[k as string]}
                lines={data[k] as PfsLine[]}
                onChange={(lines) => patchSection(k, lines)}
                onAdd={() => addLine(k)}
                onRemove={(id) => removeLine(k, id)}
                onUpdate={(id, p) => updateLine(k, id, p)}
                testIdPrefix={`pfs-asset-${k}`}
              />
            ))}
            <TotalRow label="TOTAL ASSETS" amount={totalAssets} highlight />
          </div>

          {/* LIABILITIES */}
          <div>
            <h2 className="text-[14pt] font-bold border-b-2 border-foreground pb-1 mb-3">Liabilities</h2>
            {LIABILITY_SECTIONS.map((k) => (
              <SectionList
                key={k}
                title={SECTION_LABELS[k as string]}
                lines={data[k] as PfsLine[]}
                onChange={(lines) => patchSection(k, lines)}
                onAdd={() => addLine(k)}
                onRemove={(id) => removeLine(k, id)}
                onUpdate={(id, p) => updateLine(k, id, p)}
                showMonthlyPayment
                testIdPrefix={`pfs-liab-${k}`}
              />
            ))}
            <TotalRow label="TOTAL LIABILITIES" amount={totalLiabilities} highlight />
            <div className="mt-2 pt-2 border-t-2 border-foreground">
              <TotalRow label="NET WORTH" amount={netWorth} highlight />
            </div>
          </div>
        </div>

        {/* ---------------- Income & Expenses ---------------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6 mt-8 print:gap-4 print:mt-6">
          <div>
            <h2 className="text-[14pt] font-bold border-b-2 border-foreground pb-1 mb-3">Annual Income</h2>
            <SectionList
              title=""
              lines={data.income}
              onChange={(l) => patchSection("income", l)}
              onAdd={() => addLine("income")}
              onRemove={(id) => removeLine("income", id)}
              onUpdate={(id, p) => updateLine("income", id, p)}
              testIdPrefix="pfs-income"
            />
            <TotalRow label="TOTAL ANNUAL INCOME" amount={totalIncome} highlight />
          </div>
          <div>
            <h2 className="text-[14pt] font-bold border-b-2 border-foreground pb-1 mb-3">Annual Expenses</h2>
            <SectionList
              title=""
              lines={data.expenses}
              onChange={(l) => patchSection("expenses", l)}
              onAdd={() => addLine("expenses")}
              onRemove={(id) => removeLine("expenses", id)}
              onUpdate={(id, p) => updateLine("expenses", id, p)}
              testIdPrefix="pfs-expense"
            />
            <TotalRow label="TOTAL ANNUAL EXPENSES" amount={totalExpenses} highlight />
          </div>
        </div>

        {/* ---------------- Contingent Liabilities ---------------- */}
        <Section title="Contingent Liabilities">
          <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <ContingentField label="As Endorser or Co-Maker" cents={data.contingent.asEndorser} onChange={(c) => patchData({ contingent: { ...data.contingent, asEndorser: c } })} />
            <ContingentField label="Legal Claims & Judgments" cents={data.contingent.legalClaims} onChange={(c) => patchData({ contingent: { ...data.contingent, legalClaims: c } })} />
            <ContingentField label="Past-Due Taxes" cents={data.contingent.pastDueTaxes} onChange={(c) => patchData({ contingent: { ...data.contingent, pastDueTaxes: c } })} />
            <ContingentField label="Other Special Debt" cents={data.contingent.otherSpecial} onChange={(c) => patchData({ contingent: { ...data.contingent, otherSpecial: c } })} />
          </div>
        </Section>

        {/* ---------------- Signature ---------------- */}
        <div className="mt-10 print:mt-8 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6 text-[12px]">
          <div>
            <div className="border-t border-foreground pt-1">Signature</div>
          </div>
          <div>
            <div className="border-t border-foreground pt-1">Date</div>
          </div>
        </div>
        <p className="mt-6 text-[10px] text-muted-foreground print:text-black print:text-[8pt]">
          The undersigned certifies that the information provided in this Personal Financial Statement is true and complete to the best of their knowledge as of the date above. This statement is provided for the purpose of obtaining credit.
        </p>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .pfs-print-area { padding: 0.5in !important; max-width: 100% !important; }
          .pfs-print-area, .pfs-print-area * { color: black !important; }
          input { border: none !important; background: transparent !important; }
          @page { size: letter; margin: 0.5in; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 print:mt-4">
      <h2 className="text-[14pt] font-bold border-b-2 border-foreground pb-1 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function ProfileField({
  label, value, onChange, placeholder, testId,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-border pb-0.5">
      <span className="text-[11px] text-muted-foreground w-32 shrink-0">{label}</span>
      <TextInline value={value} onChange={onChange} placeholder={placeholder} data-testid={testId} />
    </div>
  );
}

function ContingentField({
  label, cents, onChange,
}: { label: string; cents: number; onChange: (c: number) => void }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-border pb-0.5">
      <span className="text-[12px] flex-1">{label}</span>
      <MoneyInput cents={cents} onChange={onChange} className="w-28" />
    </div>
  );
}

function SectionList({
  title, lines, onAdd, onRemove, onUpdate, showMonthlyPayment, testIdPrefix,
}: {
  title: string;
  lines: PfsLine[];
  onChange: (lines: PfsLine[]) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, p: Partial<PfsLine>) => void;
  showMonthlyPayment?: boolean;
  testIdPrefix: string;
}) {
  const subtotal = sumLines(lines);
  return (
    <div className="mb-3 print:mb-2">
      {title && (
        <div className="flex items-center justify-between mt-3 mb-1 print:mt-2">
          <h3 className="text-[11pt] font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onAdd}
            className="no-print text-[11px] text-primary hover:underline flex items-center gap-1"
            data-testid={`${testIdPrefix}-add`}
          >
            <Plus className="h-3 w-3" />Add
          </button>
        </div>
      )}
      {lines.length === 0 && (
        <button
          type="button"
          onClick={onAdd}
          className="no-print text-[11px] text-muted-foreground hover:text-primary italic"
          data-testid={`${testIdPrefix}-empty-add`}
        >
          + Add line
        </button>
      )}
      {lines.map((l) => (
        <div key={l.id} className="flex items-center gap-2 py-0.5 group" data-testid={`${testIdPrefix}-row-${l.id}`}>
          <div className="flex-1 min-w-0">
            <TextInline
              value={l.label}
              onChange={(v) => onUpdate(l.id, { label: v })}
              placeholder="Description"
              data-testid={`${testIdPrefix}-label-${l.id}`}
            />
            {(l.detail || showMonthlyPayment) && (
              <div className="text-[10px] text-muted-foreground flex gap-2">
                {l.detail !== undefined && (
                  <TextInline
                    value={l.detail || ""}
                    onChange={(v) => onUpdate(l.id, { detail: v })}
                    placeholder="(optional details)"
                    className="text-[10px]"
                  />
                )}
                {showMonthlyPayment && (
                  <span className="flex items-center gap-1">
                    <span className="whitespace-nowrap">Monthly:</span>
                    <MoneyInput
                      cents={l.monthlyPayment || 0}
                      onChange={(c) => onUpdate(l.id, { monthlyPayment: c })}
                      className="w-20 text-[10px] py-0"
                    />
                  </span>
                )}
              </div>
            )}
          </div>
          <MoneyInput
            cents={l.amount}
            onChange={(c) => onUpdate(l.id, { amount: c })}
            data-testid={`${testIdPrefix}-amount-${l.id}`}
          />
          <button
            type="button"
            onClick={() => onRemove(l.id)}
            className="no-print opacity-0 group-hover:opacity-100 text-destructive"
            data-testid={`${testIdPrefix}-remove-${l.id}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {title && (
        <div className="flex justify-between border-t border-border pt-1 mt-1">
          <span className="text-[11px] text-muted-foreground italic">Subtotal</span>
          <span className="text-[11px] font-medium tabular-nums">{formatCents(subtotal, { abs: true })}</span>
        </div>
      )}
    </div>
  );
}

function TotalRow({ label, amount, highlight }: { label: string; amount: number; highlight?: boolean }) {
  return (
    <div className={`flex justify-between mt-3 print:mt-2 py-1 ${highlight ? "border-t-2 border-foreground font-bold text-[13pt]" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatCents(amount)}</span>
    </div>
  );
}
