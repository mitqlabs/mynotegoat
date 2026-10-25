"use client";

import { NumberInput } from "@/components/number-input";
import { useCallback, useMemo, useState } from "react";
import { DiagnosisSettingsSection } from "@/components/diagnosis-settings-section";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { appConfirm } from "@/components/app-dialog";

type TreatmentSortKey = "name" | "procedureCode" | "unitPrice";
type SortDir = "asc" | "desc";

export function BillingMacroSettingsPanel() {
  const macros = useBillingMacros();
  const {
    billingMacros,
    addTreatment,
    updateTreatment,
    removeTreatment,
    resetToDefaults,
  } = macros;

  const [treatmentDraft, setTreatmentDraft] = useState({
    name: "",
    procedureCode: "",
    modifier: "",
    unitPrice: 0,
    defaultUnits: 1,
  });
  const [treatmentSortKey, setTreatmentSortKey] = useState<TreatmentSortKey | null>(null);
  const [treatmentSortDir, setTreatmentSortDir] = useState<SortDir>("asc");

  const toggleTreatmentSort = useCallback((key: TreatmentSortKey) => {
    setTreatmentSortKey((prev) => {
      if (prev === key) {
        setTreatmentSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setTreatmentSortDir("asc");
      return key;
    });
  }, []);

  const sortedTreatments = useMemo(() => {
    if (!treatmentSortKey) return billingMacros.treatments;
    return [...billingMacros.treatments].sort((a, b) => {
      let cmp = 0;
      if (treatmentSortKey === "unitPrice") {
        cmp = a.unitPrice - b.unitPrice;
      } else {
        cmp = a[treatmentSortKey].localeCompare(b[treatmentSortKey]);
      }
      return treatmentSortDir === "desc" ? -cmp : cmp;
    });
  }, [billingMacros.treatments, treatmentSortKey, treatmentSortDir]);
  const [error, setError] = useState("");
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);

  const handleAddTreatment = () => {
    const added = addTreatment(treatmentDraft);
    if (!added) {
      setError("Could not add treatment macro. Name/code may be missing or duplicated.");
      return;
    }
    setError("");
    setTreatmentDraft({
      name: "",
      procedureCode: "",
      modifier: "",
      unitPrice: 0,
      defaultUnits: 1,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
          onClick={async () => { if ((await appConfirm("Are you sure you want to reset to defaults? This will overwrite your current settings."))) resetToDefaults(); }}
          type="button"
        >
          Reset Billing Macro Defaults
        </button>
      </div>

      {error && <p className="text-sm font-semibold text-[#b43b34]">{error}</p>}

      <article className="rounded-xl border border-[var(--line-soft)] bg-white">
        <button
          className="flex w-full items-center justify-between p-4 text-left"
          onClick={() => setTreatmentOpen((prev) => !prev)}
          type="button"
        >
          <div>
            <h4 className="text-lg font-semibold">Treatment Macros</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              These define CPT/procedure code, price per unit, and default units used when adding ledger charges.
            </p>
          </div>
          <span className="ml-3 shrink-0 text-xl">{treatmentOpen ? "▾" : "▸"}</span>
        </button>
        {treatmentOpen && <div className="border-t border-[var(--line-soft)] p-4">
        <p className="text-xs text-[var(--text-muted)]">
          Default Units are auto-filled when you add this treatment to Billing. Most services are set to 1.
        </p>

        <div className="mt-3 grid gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 md:grid-cols-[1fr_90px_46px_80px_40px_auto]">
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)] md:col-span-6">
            Add New Treatment Macro
          </p>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Treatment Name
            </span>
            <input
              aria-label="Treatment Name"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setTreatmentDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Treatment name"
              value={treatmentDraft.name}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              CPT / Code
            </span>
            <input
              aria-label="CPT / Code"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setTreatmentDraft((current) => ({ ...current, procedureCode: event.target.value }))
              }
              placeholder="CPT"
              value={treatmentDraft.procedureCode}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Mod
            </span>
            <input
              aria-label="Modifier"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2 text-center"
              maxLength={2}
              onChange={(event) =>
                setTreatmentDraft((current) => ({ ...current, modifier: event.target.value }))
              }
              placeholder="--"
              value={treatmentDraft.modifier}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Price ($)
            </span>
            <NumberInput
              aria-label="Price ($)"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              min={0}
              onChange={(n) =>
                setTreatmentDraft((current) => ({ ...current, unitPrice: n }))
              }
              placeholder="$"
              step="0.01"
              fallback={0}
              value={treatmentDraft.unitPrice}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Units
            </span>
            <NumberInput
              aria-label="Default Units"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-1 py-2 text-center"
              min={1}
              max={9}
              onChange={(n) =>
                setTreatmentDraft((current) => ({ ...current, defaultUnits: n }))
              }
              placeholder="1"
              fallback={1}
              value={treatmentDraft.defaultUnits}
            />
          </label>
          <div className="flex items-end">
            <button
              className="w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={handleAddTreatment}
              type="button"
            >
              Add Treatment
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="hidden rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:grid md:grid-cols-[1fr_90px_46px_80px_40px_60px_70px]">
            <button type="button" className="text-left hover:text-[var(--brand-primary)]" onClick={() => toggleTreatmentSort("name")}>
              Treatment Name {treatmentSortKey === "name" ? (treatmentSortDir === "asc" ? "▲" : "▼") : ""}
            </button>
            <button type="button" className="text-left hover:text-[var(--brand-primary)]" onClick={() => toggleTreatmentSort("procedureCode")}>
              CPT Code {treatmentSortKey === "procedureCode" ? (treatmentSortDir === "asc" ? "▲" : "▼") : ""}
            </button>
            <span>Mod</span>
            <button type="button" className="text-left hover:text-[var(--brand-primary)]" onClick={() => toggleTreatmentSort("unitPrice")}>
              Price ($) {treatmentSortKey === "unitPrice" ? (treatmentSortDir === "asc" ? "▲" : "▼") : ""}
            </button>
            <span>Units</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {sortedTreatments.map((entry) => (
            <div
              key={entry.id}
              className="grid gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2 md:grid-cols-[1fr_90px_46px_80px_40px_60px_70px]"
            >
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Treatment Name
                </span>
                <input
                  aria-label="Treatment Name"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                  onChange={(event) => updateTreatment(entry.id, { name: event.target.value })}
                  value={entry.name}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  CPT / Code
                </span>
                <input
                  aria-label="CPT / Code"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                  onChange={(event) => updateTreatment(entry.id, { procedureCode: event.target.value })}
                  value={entry.procedureCode}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Modifier
                </span>
                <input
                  aria-label="Modifier"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-1 py-1 text-center"
                  maxLength={2}
                  onChange={(event) => updateTreatment(entry.id, { modifier: event.target.value })}
                  value={entry.modifier ?? ""}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Price ($)
                </span>
                <NumberInput
                  aria-label="Price ($)"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                  min={0}
                  onChange={(n) => updateTreatment(entry.id, { unitPrice: n })}
                  step="0.01"
                  fallback={0}
                  value={entry.unitPrice}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Units
                </span>
                <NumberInput
                  aria-label="Default Units"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-1 py-1 text-center"
                  min={1}
                  max={9}
                  onChange={(n) => updateTreatment(entry.id, { defaultUnits: n })}
                  fallback={1}
                  value={entry.defaultUnits}
                />
              </label>
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Status
                </span>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    checked={entry.active}
                    onChange={(event) => updateTreatment(entry.id, { active: event.target.checked })}
                    type="checkbox"
                  />
                  Active
                </label>
              </div>
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Action
                </span>
                <button
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                  onClick={async () => { if ((await appConfirm(`Remove treatment "${entry.name}"?`))) removeTreatment(entry.id); }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>}
      </article>

      <article className="rounded-xl border border-[var(--line-soft)] bg-white">
        <button
          className="flex w-full items-center justify-between p-4 text-left"
          onClick={() => setDiagnosisOpen((prev) => !prev)}
          type="button"
        >
          <div>
            <h4 className="text-lg font-semibold">Diagnosis Macro Settings</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Your ICD-10 codes in folders, the built-in ICD-10 search, and one-click diagnosis bundles.
            </p>
          </div>
          <span className="ml-3 shrink-0 text-xl">{diagnosisOpen ? "▾" : "▸"}</span>
        </button>
        {diagnosisOpen && <div className="border-t border-[var(--line-soft)] p-4">
          <DiagnosisSettingsSection macros={macros} />
      </div>}
      </article>
    </div>
  );
}
