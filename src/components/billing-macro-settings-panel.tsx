"use client";

import { useCallback, useMemo, useState } from "react";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import { GENERAL_DIAGNOSIS_FOLDER_ID } from "@/lib/billing-macros";

type TreatmentSortKey = "name" | "procedureCode" | "unitPrice";
type SortDir = "asc" | "desc";

export function BillingMacroSettingsPanel() {
  const {
    billingMacros,
    addTreatment,
    updateTreatment,
    removeTreatment,
    addDiagnosis,
    updateDiagnosis,
    removeDiagnosis,
    addDiagnosisFolder,
    updateDiagnosisFolder,
    moveDiagnosisFolder,
    removeDiagnosisFolder,
    addBundle,
    updateBundle,
    removeBundle,
    resetToDefaults,
  } = useBillingMacros();

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
  const [diagnosisDraft, setDiagnosisDraft] = useState({
    code: "",
    description: "",
    folderId: "",
  });
  // Bundle ids the user wants to attach the new diagnosis to. Same
  // multi-select pattern the patient page uses so the two flows match.
  const [diagnosisDraftBundleIds, setDiagnosisDraftBundleIds] = useState<Set<string>>(
    new Set(),
  );
  const [diagnosisFolderDraft, setDiagnosisFolderDraft] = useState("");
  const [bundleNameDraft, setBundleNameDraft] = useState("");
  const [bundleDiagnosisDraft, setBundleDiagnosisDraft] = useState<string[]>([]);
  // Per-bundle folder filter for the dx picker checkbox list. Without
  // this, building a Cervical bundle forced you to scroll through
  // every code in every folder. "" = show all.
  const [bundleFilterFolderId, setBundleFilterFolderId] = useState<Record<string, string>>({});
  // Drag state for reordering selected diagnosis chips inside a bundle.
  // Keyed by bundle id + chip index so two bundles can't cross-drag.
  const [dragBundleChip, setDragBundleChip] = useState<{ bundleId: string; index: number } | null>(null);
  const [error, setError] = useState("");
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);

  const diagnosisById = useMemo(
    () => new Map(billingMacros.diagnoses.map((entry) => [entry.id, entry] as const)),
    [billingMacros.diagnoses],
  );
  const diagnosisFolderById = useMemo(
    () => new Map(billingMacros.diagnosisFolders.map((entry) => [entry.id, entry] as const)),
    [billingMacros.diagnosisFolders],
  );
  const diagnosesByFolder = useMemo(() => {
    const grouped = new Map<string, typeof billingMacros.diagnoses>();
    billingMacros.diagnosisFolders.forEach((folder) => {
      grouped.set(folder.id, []);
    });
    const fallbackFolderId = billingMacros.diagnosisFolders[0]?.id ?? "";
    billingMacros.diagnoses.forEach((entry) => {
      const targetFolderId = grouped.has(entry.folderId) ? entry.folderId : fallbackFolderId;
      if (!targetFolderId) {
        return;
      }
      const bucket = grouped.get(targetFolderId);
      if (bucket) {
        bucket.push(entry);
      }
    });
    return grouped;
  }, [billingMacros.diagnoses, billingMacros.diagnosisFolders]);

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

  const handleAddDiagnosis = () => {
    const { id, added } = addDiagnosis({
      code: diagnosisDraft.code,
      description: diagnosisDraft.description,
      folderId: diagnosisDraft.folderId || billingMacros.diagnosisFolders[0]?.id,
    });
    if (!id) {
      setError("Could not add diagnosis code. Code or description is missing.");
      return;
    }
    if (!added) {
      setError("Diagnosis code already exists in the library.");
      return;
    }
    // Attach the new dx to every bundle the user ticked. updateBundle
    // re-validates against the library so a stale id is dropped.
    for (const bundleId of diagnosisDraftBundleIds) {
      const bundle = billingMacros.bundles.find((b) => b.id === bundleId);
      if (!bundle) continue;
      if (bundle.diagnosisIds.includes(id)) continue;
      updateBundle(bundleId, { diagnosisIds: [...bundle.diagnosisIds, id] });
    }
    setError("");
    setDiagnosisDraft({
      code: "",
      description: "",
      folderId: diagnosisDraft.folderId || billingMacros.diagnosisFolders[0]?.id || "",
    });
    // Reset bundle selection too so the next dx starts fresh.
    setDiagnosisDraftBundleIds(new Set());
  };

  const toggleDiagnosisDraftBundle = (bundleId: string) => {
    setDiagnosisDraftBundleIds((current) => {
      const next = new Set(current);
      if (next.has(bundleId)) next.delete(bundleId);
      else next.add(bundleId);
      return next;
    });
  };

  const handleAddDiagnosisFolder = () => {
    const added = addDiagnosisFolder(diagnosisFolderDraft);
    if (!added) {
      setError("Could not add diagnosis folder. Name may be missing or duplicated.");
      return;
    }
    setError("");
    setDiagnosisFolderDraft("");
  };

  const handleAddBundle = () => {
    const added = addBundle(bundleNameDraft, bundleDiagnosisDraft);
    if (!added) {
      setError("Could not add bundle. Give it a name and include at least one diagnosis code.");
      return;
    }
    setError("");
    setBundleNameDraft("");
    setBundleDiagnosisDraft([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
          onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetToDefaults(); }}
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
            <input
              aria-label="Price ($)"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              min={0}
              onChange={(event) =>
                setTreatmentDraft((current) => ({ ...current, unitPrice: Number(event.target.value) || 0 }))
              }
              placeholder="$"
              step="0.01"
              type="number"
              value={treatmentDraft.unitPrice}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Units
            </span>
            <input
              aria-label="Default Units"
              className="rounded-lg border border-[var(--line-soft)] bg-white px-1 py-2 text-center"
              min={1}
              max={9}
              onChange={(event) =>
                setTreatmentDraft((current) => ({ ...current, defaultUnits: Number(event.target.value) || 1 }))
              }
              placeholder="1"
              type="number"
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
                <input
                  aria-label="Price ($)"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                  min={0}
                  onChange={(event) => updateTreatment(entry.id, { unitPrice: Number(event.target.value) || 0 })}
                  step="0.01"
                  type="number"
                  value={entry.unitPrice}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] md:hidden">
                  Units
                </span>
                <input
                  aria-label="Default Units"
                  className="rounded-lg border border-[var(--line-soft)] bg-white px-1 py-1 text-center"
                  min={1}
                  max={9}
                  onChange={(event) => updateTreatment(entry.id, { defaultUnits: Number(event.target.value) || 1 })}
                  type="number"
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
                  onClick={() => { if (window.confirm(`Remove treatment "${entry.name}"?`)) removeTreatment(entry.id); }}
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
              Organize your ICD-10 library with folders, then group common sets into one-click bundles.
            </p>
          </div>
          <span className="ml-3 shrink-0 text-xl">{diagnosisOpen ? "▾" : "▸"}</span>
        </button>
        {diagnosisOpen && <div className="border-t border-[var(--line-soft)] p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <article className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <h5 className="text-base font-semibold">Diagnosis Folders</h5>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Create folders like Cervical, Thoracic, Lumbar, etc. and assign codes to keep the picker clean.
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setDiagnosisFolderDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddDiagnosisFolder();
                  }
                }}
                placeholder="New folder name (e.g. Cervical)"
                value={diagnosisFolderDraft}
              />
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                onClick={handleAddDiagnosisFolder}
                type="button"
              >
                Add Folder
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {billingMacros.diagnosisFolders.map((folder, index) => {
                const folderCount = diagnosesByFolder.get(folder.id)?.length ?? 0;
                const isLocked = folder.id === GENERAL_DIAGNOSIS_FOLDER_ID;
                return (
                  <div
                    key={folder.id}
                    className="grid gap-2 rounded-xl border border-[var(--line-soft)] bg-white p-2 md:grid-cols-[1fr_auto]"
                  >
                    <div className="grid gap-1">
                      <input
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                        onChange={(event) => updateDiagnosisFolder(folder.id, event.target.value)}
                        value={folder.name}
                      />
                      <p className="text-xs text-[var(--text-muted)]">{folderCount} code(s)</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                        disabled={index === 0}
                        onClick={() => moveDiagnosisFolder(folder.id, "up")}
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                        disabled={index === billingMacros.diagnosisFolders.length - 1}
                        onClick={() => moveDiagnosisFolder(folder.id, "down")}
                        type="button"
                      >
                        ↓
                      </button>
                      <button
                        className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-sm"
                        disabled={isLocked || billingMacros.diagnosisFolders.length <= 1}
                        onClick={() => { if (window.confirm(`Remove folder "${folder.name}" and all its diagnoses?`)) removeDiagnosisFolder(folder.id); }}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <h5 className="text-base font-semibold">Add Diagnosis Code</h5>
            <div className="mt-2 grid gap-2 md:grid-cols-[170px_1fr]">
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setDiagnosisDraft((current) => ({ ...current, code: event.target.value }))}
                placeholder="ICD-10 code"
                value={diagnosisDraft.code}
              />
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) =>
                  setDiagnosisDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Diagnosis description"
                value={diagnosisDraft.description}
              />
              <select
                className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 md:col-span-2"
                onChange={(event) =>
                  setDiagnosisDraft((current) => ({ ...current, folderId: event.target.value }))
                }
                value={diagnosisDraft.folderId || billingMacros.diagnosisFolders[0]?.id || ""}
              >
                {billingMacros.diagnosisFolders.map((folder) => (
                  <option key={`dx-folder-select-${folder.id}`} value={folder.id}>
                    Folder: {folder.name}
                  </option>
                ))}
              </select>
            </div>
            {/* Bundle picker — match the patient page custom-dx flow.
                Optional; multiple bundles can be ticked at once. */}
            <fieldset className="mt-2 rounded-lg border border-[var(--line-soft)] bg-white p-2">
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                Bundles (optional)
              </legend>
              {billingMacros.bundles.length === 0 ? (
                <p className="px-1 text-xs text-[var(--text-muted)]">
                  No bundles in the library yet. Add a bundle below first
                  if you want this code to belong to one.
                </p>
              ) : (
                <div className="grid max-h-32 gap-1 overflow-y-auto px-1">
                  {billingMacros.bundles.map((bundle) => (
                    <label
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--bg-soft)]"
                      key={`dx-bundle-pick-${bundle.id}`}
                    >
                      <input
                        checked={diagnosisDraftBundleIds.has(bundle.id)}
                        className="accent-[var(--brand-primary)]"
                        onChange={() => toggleDiagnosisDraftBundle(bundle.id)}
                        type="checkbox"
                      />
                      <span className="text-sm">{bundle.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <button
              className="mt-2 w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={handleAddDiagnosis}
              type="button"
            >
              Add Diagnosis
            </button>
          </article>
        </div>

        <div className="mt-4 space-y-3">
          {billingMacros.diagnosisFolders.map((folder) => {
            const entries = [...(diagnosesByFolder.get(folder.id) ?? [])].sort((left, right) =>
              left.code.localeCompare(right.code),
            );
            return (
              <details
                className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3"
                key={`diagnosis-folder-group-${folder.id}`}
                open={entries.length > 0}
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  {folder.name} ({entries.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {entries.length === 0 && (
                    <p className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
                      No diagnosis codes in this folder yet.
                    </p>
                  )}
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid gap-2 rounded-xl border border-[var(--line-soft)] bg-white p-2 md:grid-cols-[180px_1fr_170px_80px_90px]"
                    >
                      <input
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                        onChange={(event) => updateDiagnosis(entry.id, { code: event.target.value })}
                        value={entry.code}
                      />
                      <input
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                        onChange={(event) => updateDiagnosis(entry.id, { description: event.target.value })}
                        value={entry.description}
                      />
                      <select
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                        onChange={(event) => updateDiagnosis(entry.id, { folderId: event.target.value })}
                        value={entry.folderId}
                      >
                        {billingMacros.diagnosisFolders.map((folderOption) => (
                          <option key={`${entry.id}-folder-${folderOption.id}`} value={folderOption.id}>
                            {folderOption.name}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          checked={entry.active}
                          onChange={(event) => updateDiagnosis(entry.id, { active: event.target.checked })}
                          type="checkbox"
                        />
                        Active
                      </label>
                      <button
                        className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                        onClick={() => { if (window.confirm(`Remove diagnosis "${entry.code}"?`)) removeDiagnosis(entry.id); }}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
          <h5 className="text-base font-semibold">Diagnosis Bundles</h5>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) => setBundleNameDraft(event.target.value)}
              placeholder="Bundle name (e.g. Cervical + Lumbar PI)"
              value={bundleNameDraft}
            />
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={handleAddBundle}
              type="button"
            >
              Add Bundle
            </button>
          </div>
          <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded-lg border border-[var(--line-soft)] bg-white p-2">
            {billingMacros.diagnoses.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">Add diagnosis macros first.</p>
            )}
            {billingMacros.diagnoses.map((entry) => (
              <label key={`bundle-draft-${entry.id}`} className="flex items-start gap-2 text-sm">
                <input
                  checked={bundleDiagnosisDraft.includes(entry.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setBundleDiagnosisDraft((current) =>
                      checked
                        ? Array.from(new Set([...current, entry.id]))
                        : current.filter((id) => id !== entry.id),
                    );
                  }}
                  type="checkbox"
                />
                <span>
                  <span className="font-semibold">{entry.code}</span> {entry.description}
                  <span className="ml-1 text-xs text-[var(--text-muted)]">
                    ({diagnosisFolderById.get(entry.folderId)?.name ?? "General"})
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            {billingMacros.bundles.map((bundle) => (
              <div key={bundle.id} className="rounded-xl border border-[var(--line-soft)] bg-white p-2">
                <div className="grid gap-2 md:grid-cols-[1fr_90px_90px]">
                  <input
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                    onChange={(event) => updateBundle(bundle.id, { name: event.target.value })}
                    value={bundle.name}
                  />
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      checked={bundle.active}
                      onChange={(event) => updateBundle(bundle.id, { active: event.target.checked })}
                      type="checkbox"
                    />
                    Active
                  </label>
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                    onClick={() => { if (window.confirm(`Remove bundle "${bundle.name}"?`)) removeBundle(bundle.id); }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>

                {/* Selected dx chips. Drag a chip onto a sibling to
                    reorder; the order is the saved diagnosisIds order,
                    which downstream code (patient page bundle apply,
                    document templates) reads in sequence. */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {bundle.diagnosisIds.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)]">No diagnosis codes selected.</p>
                  )}
                  {bundle.diagnosisIds.map((diagnosisId, chipIndex) => {
                    const diagnosis = diagnosisById.get(diagnosisId);
                    if (!diagnosis) {
                      return null;
                    }
                    const isDragging =
                      dragBundleChip?.bundleId === bundle.id &&
                      dragBundleChip?.index === chipIndex;
                    return (
                      <span
                        key={`${bundle.id}-${diagnosisId}`}
                        className={`cursor-grab rounded-full border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-1 text-xs font-semibold transition-opacity ${
                          isDragging ? "opacity-50" : ""
                        }`}
                        draggable
                        onDragEnd={() => setDragBundleChip(null)}
                        onDragOver={(e) => {
                          if (!dragBundleChip || dragBundleChip.bundleId !== bundle.id) return;
                          if (dragBundleChip.index === chipIndex) return;
                          e.preventDefault();
                        }}
                        onDragStart={() => setDragBundleChip({ bundleId: bundle.id, index: chipIndex })}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!dragBundleChip || dragBundleChip.bundleId !== bundle.id) return;
                          if (dragBundleChip.index === chipIndex) return;
                          const next = [...bundle.diagnosisIds];
                          const [moved] = next.splice(dragBundleChip.index, 1);
                          next.splice(chipIndex, 0, moved);
                          updateBundle(bundle.id, { diagnosisIds: next });
                          setDragBundleChip(null);
                        }}
                        title="Drag to reorder"
                      >
                        {diagnosis.code}
                      </span>
                    );
                  })}
                </div>

                {/* Folder filter — narrows the dx checkbox list so building
                    a regional bundle isn't a 100-row scroll. Default ""
                    (all folders) preserves the legacy behavior. */}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[var(--text-muted)]">Folder:</span>
                  <select
                    className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1"
                    onChange={(event) =>
                      setBundleFilterFolderId((current) => ({
                        ...current,
                        [bundle.id]: event.target.value,
                      }))
                    }
                    value={bundleFilterFolderId[bundle.id] ?? ""}
                  >
                    <option value="">All folders</option>
                    {billingMacros.diagnosisFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 max-h-36 space-y-1 overflow-auto rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
                  {(() => {
                    const selectedFolderId = bundleFilterFolderId[bundle.id] ?? "";
                    const visible = selectedFolderId
                      ? billingMacros.diagnoses.filter((d) => d.folderId === selectedFolderId)
                      : billingMacros.diagnoses;
                    if (visible.length === 0) {
                      return (
                        <p className="text-xs text-[var(--text-muted)]">
                          No diagnosis codes in this folder yet.
                        </p>
                      );
                    }
                    return visible.map((diagnosis) => (
                      <label key={`${bundle.id}-dx-${diagnosis.id}`} className="inline-flex items-center gap-2 text-xs">
                        <input
                          checked={bundle.diagnosisIds.includes(diagnosis.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            const nextIds = checked
                              ? Array.from(new Set([...bundle.diagnosisIds, diagnosis.id]))
                              : bundle.diagnosisIds.filter((id) => id !== diagnosis.id);
                            updateBundle(bundle.id, { diagnosisIds: nextIds });
                          }}
                          type="checkbox"
                        />
                        {diagnosis.code} - {diagnosis.description}
                      </label>
                    ));
                  })()}
                </div>
              </div>
            ))}
            {billingMacros.bundles.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">No bundles yet.</p>
            )}
          </div>
        </div>
      </div>}
      </article>
    </div>
  );
}
