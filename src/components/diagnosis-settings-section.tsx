"use client";

import { useMemo, useState } from "react";
import { Icd10Search } from "@/components/icd10-search";
import type { useBillingMacros } from "@/hooks/use-billing-macros";
import { GENERAL_DIAGNOSIS_FOLDER_ID } from "@/lib/billing-macros";
import { dottedCode, sameCode, type Icd10Code } from "@/lib/icd10";

type Macros = ReturnType<typeof useBillingMacros>;
type Diagnosis = Macros["billingMacros"]["diagnoses"][number];

const card = "rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3";
const input = "rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm";
const smallBtn =
  "rounded-md border border-[var(--line-soft)] bg-white px-2 py-0.5 text-xs font-semibold disabled:opacity-40";
const primaryBtn =
  "rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] active:brightness-90";
const sectionLabel = "text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]";

function matches(entry: Diagnosis, filter: string): boolean {
  if (!filter) return true;
  const hay = `${entry.code} ${entry.code.replace(/\./g, "")} ${entry.description}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/**
 * Diagnosis codes + bundles settings. Same data and actions as before
 * (useBillingMacros); only the layout changed, plus built-in ICD-10 search.
 */
export function DiagnosisSettingsSection({ macros }: { macros: Macros }) {
  const {
    billingMacros,
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
  } = macros;
  const folders = billingMacros.diagnosisFolders;
  const firstFolderId = folders[0]?.id ?? "";

  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const ok = (text: string) => setMessage({ kind: "ok", text });
  const fail = (text: string) => setMessage({ kind: "error", text });

  const [filter, setFilter] = useState("");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [openBundles, setOpenBundles] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // "Add a code" form.
  const [targetFolderId, setTargetFolderId] = useState("");
  const [targetBundleIds, setTargetBundleIds] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState({ code: "", description: "" });
  const [folderDraft, setFolderDraft] = useState("");
  const [manageFolders, setManageFolders] = useState(false);

  // New bundle form.
  const [bundleName, setBundleName] = useState("");
  const [bundleDraft, setBundleDraft] = useState<string[]>([]);
  const [bundleDraftFilter, setBundleDraftFilter] = useState("");
  const [bundleFilterFolderId, setBundleFilterFolderId] = useState<Record<string, string>>({});
  const [dragChip, setDragChip] = useState<{ bundleId: string; index: number } | null>(null);

  const diagnosisById = useMemo(
    () => new Map(billingMacros.diagnoses.map((entry) => [entry.id, entry] as const)),
    [billingMacros.diagnoses],
  );
  const folderNameById = useMemo(() => new Map(folders.map((f) => [f.id, f.name] as const)), [folders]);
  const byFolder = useMemo(() => {
    const grouped = new Map<string, Diagnosis[]>();
    folders.forEach((folder) => grouped.set(folder.id, []));
    billingMacros.diagnoses.forEach((entry) => {
      const target = grouped.has(entry.folderId) ? entry.folderId : firstFolderId;
      grouped.get(target)?.push(entry);
    });
    grouped.forEach((list) => list.sort((a, b) => a.code.localeCompare(b.code)));
    return grouped;
  }, [billingMacros.diagnoses, folders, firstFolderId]);

  const libraryCodes = useMemo(() => billingMacros.diagnoses.map((d) => d.code), [billingMacros.diagnoses]);
  const findInLibrary = (code: string) => billingMacros.diagnoses.find((d) => sameCode(d.code, code));

  /** Library id for a code — existing entry, or a new one in `folderId`. */
  const ensureInLibrary = (code: string, description: string, folderId: string): { id: string | null; added: boolean } => {
    const existing = findInLibrary(code);
    if (existing) return { id: existing.id, added: false };
    return addDiagnosis({ code, description, folderId: folderId || firstFolderId });
  };

  const addToLibrary = (code: string, description: string): boolean => {
    const shown = code.trim().toUpperCase();
    if (!shown || !description.trim()) {
      fail("Could not add diagnosis code. Code or description is missing.");
      return false;
    }
    const { id, added } = ensureInLibrary(shown, description, targetFolderId || firstFolderId);
    if (!id) {
      fail("Could not add diagnosis code. Code or description is missing.");
      return false;
    }
    if (!added) {
      fail(`${shown} is already in the library.`);
      return false;
    }
    for (const bundleId of targetBundleIds) {
      const bundle = billingMacros.bundles.find((b) => b.id === bundleId);
      if (bundle && !bundle.diagnosisIds.includes(id)) updateBundle(bundleId, { diagnosisIds: [...bundle.diagnosisIds, id] });
    }
    const folderName = folderNameById.get(targetFolderId || firstFolderId) ?? "General";
    ok(`${shown} added to ${folderName}.`);
    setTargetBundleIds(new Set());
    return true;
  };

  const addFromIcd = (entry: Icd10Code) => addToLibrary(dottedCode(entry.code), entry.description);

  const addManual = () => {
    if (addToLibrary(manual.code, manual.description)) setManual({ code: "", description: "" });
  };

  const addFolder = () => {
    if (!addDiagnosisFolder(folderDraft)) {
      fail("Could not add diagnosis folder. Name may be missing or duplicated.");
      return;
    }
    setMessage(null);
    setFolderDraft("");
  };

  const createBundle = () => {
    if (!addBundle(bundleName, bundleDraft)) {
      fail("Could not add bundle. Give it a name and include at least one diagnosis code.");
      return;
    }
    ok(`Bundle "${bundleName.trim()}" created.`);
    setBundleName("");
    setBundleDraft([]);
    setBundleDraftFilter("");
  };

  /** ICD-10 pick inside a bundle: put the code in the library (if needed), then in the bundle. */
  const addIcdToBundle = (bundleId: string, entry: Icd10Code): boolean => {
    const bundle = billingMacros.bundles.find((b) => b.id === bundleId);
    if (!bundle) return false;
    const { id, added } = ensureInLibrary(dottedCode(entry.code), entry.description, firstFolderId);
    if (!id) return false;
    if (bundle.diagnosisIds.includes(id)) {
      fail(`${dottedCode(entry.code)} is already in "${bundle.name}".`);
      return false;
    }
    updateBundle(bundleId, { diagnosisIds: [...bundle.diagnosisIds, id] });
    ok(
      `${dottedCode(entry.code)} added to "${bundle.name}"${added ? ` (and to your ${folderNameById.get(firstFolderId) ?? "General"} codes)` : ""}.`,
    );
    return true;
  };

  const addIcdToBundleDraft = (entry: Icd10Code): boolean => {
    const { id, added } = ensureInLibrary(dottedCode(entry.code), entry.description, firstFolderId);
    if (!id) return false;
    setBundleDraft((current) => (current.includes(id) ? current : [...current, id]));
    ok(`${dottedCode(entry.code)} added to the new bundle${added ? ` (and to your ${folderNameById.get(firstFolderId) ?? "General"} codes)` : ""}.`);
    return true;
  };

  const filtering = filter.trim().length > 0;
  const totalShown = filtering
    ? billingMacros.diagnoses.filter((d) => matches(d, filter.trim())).length
    : billingMacros.diagnoses.length;
  const allOpen = folders.length > 0 && folders.every((f) => openFolders.has(f.id));

  return (
    <div className="space-y-4">
      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            message.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-[#b43b34]"
          }`}
          role="status"
        >
          {message.text}
        </p>
      )}

      {/* ── Add a code ─────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-base font-semibold">Add a code</h5>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className={sectionLabel}>Folder</span>
              <select
                aria-label="Folder for new codes"
                className={input}
                onChange={(e) => setTargetFolderId(e.target.value)}
                value={targetFolderId || firstFolderId}
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {billingMacros.bundles.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={sectionLabel}>Also add to bundles</span>
            {billingMacros.bundles.map((bundle) => {
              const on = targetBundleIds.has(bundle.id);
              return (
                <button
                  aria-pressed={on}
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    on
                      ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                      : "border-[var(--line-soft)] bg-white text-[var(--text-muted)]"
                  }`}
                  key={bundle.id}
                  onClick={() => setTargetBundleIds((s) => toggle(s, bundle.id))}
                  type="button"
                >
                  {on ? "✓ " : ""}
                  {bundle.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-3">
          <Icd10Search
            actionLabel="Add"
            addedLabel="In your list"
            existingCodes={libraryCodes}
            label={null}
            maxResults={20}
            ariaLabel="Search ICD-10 to add to your codes"
            onPick={addFromIcd}
          />
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--text-muted)]">
            Or type a code yourself
          </summary>
          <div className="mt-2 grid gap-2 md:grid-cols-[140px_1fr_auto]">
            <input
              aria-label="ICD-10 code"
              className={`${input} py-2`}
              onChange={(e) => setManual((m) => ({ ...m, code: e.target.value }))}
              placeholder="ICD-10 code"
              value={manual.code}
            />
            <input
              aria-label="Diagnosis description"
              className={`${input} py-2`}
              onChange={(e) => setManual((m) => ({ ...m, description: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              placeholder="Diagnosis description"
              value={manual.description}
            />
            <button className={primaryBtn} onClick={addManual} type="button">
              Add Diagnosis
            </button>
          </div>
        </details>
      </section>

      {/* ── Your codes ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h5 className="mr-auto text-base font-semibold">
            Your codes{" "}
            <span className="text-sm font-normal text-[var(--text-muted)]">
              {filtering ? `${totalShown} of ${billingMacros.diagnoses.length}` : billingMacros.diagnoses.length} codes ·{" "}
              {folders.length} folders
            </span>
          </h5>
          <input
            aria-label="Filter your codes"
            className={`${input} w-full py-1.5 sm:w-64`}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter your codes…"
            type="search"
            value={filter}
          />
          <button
            className={smallBtn}
            onClick={() => setOpenFolders(allOpen ? new Set() : new Set(folders.map((f) => f.id)))}
            type="button"
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
          <button
            aria-pressed={manageFolders}
            className={smallBtn}
            onClick={() => setManageFolders((v) => !v)}
            type="button"
          >
            {manageFolders ? "Done" : "Manage folders"}
          </button>
        </div>

        {manageFolders && (
          <div className={`${card} space-y-2`}>
            <p className="text-xs text-[var(--text-muted)]">
              Rename, reorder or remove folders. Folders keep the picker on the patient page tidy.
            </p>
            <div className="flex gap-2">
              <input
                aria-label="New folder name"
                className={`${input} flex-1 py-1.5`}
                onChange={(e) => setFolderDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFolder();
                  }
                }}
                placeholder="New folder name (e.g. Cervical)"
                value={folderDraft}
              />
              <button className={primaryBtn} onClick={addFolder} type="button">
                Add Folder
              </button>
            </div>
            <ul className="divide-y divide-[var(--line-soft)] rounded-lg border border-[var(--line-soft)] bg-white">
              {folders.map((folder, index) => {
                const locked = folder.id === GENERAL_DIAGNOSIS_FOLDER_ID;
                return (
                  <li className="flex items-center gap-2 px-2 py-1.5" key={folder.id}>
                    <input
                      aria-label={`Folder name ${folder.name}`}
                      className={`${input} flex-1`}
                      onChange={(e) => updateDiagnosisFolder(folder.id, e.target.value)}
                      value={folder.name}
                    />
                    <span className="w-16 text-right text-xs text-[var(--text-muted)]">
                      {byFolder.get(folder.id)?.length ?? 0} codes
                    </span>
                    <button
                      aria-label={`Move ${folder.name} up`}
                      className={smallBtn}
                      disabled={index === 0}
                      onClick={() => moveDiagnosisFolder(folder.id, "up")}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move ${folder.name} down`}
                      className={smallBtn}
                      disabled={index === folders.length - 1}
                      onClick={() => moveDiagnosisFolder(folder.id, "down")}
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      className={smallBtn}
                      disabled={locked || folders.length <= 1}
                      onClick={() => {
                        if (window.confirm(`Remove folder "${folder.name}" and all its diagnoses?`)) removeDiagnosisFolder(folder.id);
                      }}
                      title={locked ? "The General folder can't be removed" : "Remove folder"}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-[var(--line-soft)] bg-white">
          {folders.map((folder, folderIndex) => {
            const all = byFolder.get(folder.id) ?? [];
            const entries = filtering ? all.filter((d) => matches(d, filter.trim())) : all;
            if (filtering && entries.length === 0) return null;
            const open = filtering || openFolders.has(folder.id);
            const inactive = all.filter((d) => !d.active).length;
            return (
              <div className={folderIndex > 0 ? "border-t border-[var(--line-soft)]" : ""} key={folder.id}>
                <button
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 bg-[var(--bg-soft)] px-3 py-2 text-left hover:brightness-[0.98]"
                  onClick={() => setOpenFolders((s) => toggle(s, folder.id))}
                  type="button"
                >
                  <span className="w-3 text-xs text-[var(--text-muted)]">{open ? "▾" : "▸"}</span>
                  <span className="text-sm font-semibold">{folder.name}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                    {filtering ? `${entries.length} of ${all.length}` : all.length}
                  </span>
                  {inactive > 0 && <span className="text-[11px] text-[var(--text-muted)]">{inactive} inactive</span>}
                  {!open && all.length > 0 && (
                    <span className="ml-2 hidden truncate text-xs text-[var(--text-muted)] md:inline">
                      {all
                        .slice(0, 6)
                        .map((d) => d.code)
                        .join(" · ")}
                      {all.length > 6 ? " …" : ""}
                    </span>
                  )}
                </button>
                {open && (
                  <div className="divide-y divide-[var(--line-soft)]">
                    {entries.length === 0 && (
                      <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No diagnosis codes in this folder yet.</p>
                    )}
                    {entries.map((entry) => (
                      <div
                        className={`grid items-center gap-2 px-3 py-1.5 md:grid-cols-[110px_1fr_130px_auto_auto] ${
                          entry.active ? "" : "opacity-55"
                        }`}
                        key={entry.id}
                      >
                        <input
                          aria-label={`Code for ${entry.description}`}
                          className={`${input} font-mono font-semibold`}
                          onChange={(e) => updateDiagnosis(entry.id, { code: e.target.value })}
                          value={entry.code}
                        />
                        <input
                          aria-label={`Description for ${entry.code}`}
                          className={`${input} border-transparent hover:border-[var(--line-soft)] focus:border-[var(--line-soft)]`}
                          onChange={(e) => updateDiagnosis(entry.id, { description: e.target.value })}
                          value={entry.description}
                        />
                        <select
                          aria-label={`Folder for ${entry.code}`}
                          className={`${input} text-xs`}
                          onChange={(e) => updateDiagnosis(entry.id, { folderId: e.target.value })}
                          value={entry.folderId}
                        >
                          {folders.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                        <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                          <input
                            checked={entry.active}
                            onChange={(e) => updateDiagnosis(entry.id, { active: e.target.checked })}
                            type="checkbox"
                          />
                          Active
                        </label>
                        <button
                          aria-label={`Remove ${entry.code}`}
                          className="rounded-md px-2 py-0.5 text-sm text-[var(--text-muted)] hover:bg-red-50 hover:text-[#b43b34]"
                          onClick={() => {
                            if (window.confirm(`Remove diagnosis "${entry.code}"?`)) removeDiagnosis(entry.id);
                          }}
                          title="Remove"
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtering && totalShown === 0 && (
            <p className="px-3 py-3 text-sm text-[var(--text-muted)]">
              None of your codes match “{filter.trim()}”. Use the ICD-10 search above to add it.
            </p>
          )}
        </div>
      </section>

      {/* ── Bundles (diagnosis macros) ─────────────────────────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h5 className="text-base font-semibold">Diagnosis Bundles</h5>
          <span className="text-sm text-[var(--text-muted)]">
            One click adds every code in a bundle to a patient. {billingMacros.bundles.length} bundles.
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--line-soft)] bg-white">
          {billingMacros.bundles.length === 0 && <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No bundles yet.</p>}
          {billingMacros.bundles.map((bundle, bundleIndex) => {
            const open = openBundles.has(bundle.id);
            const folderFilter = bundleFilterFolderId[bundle.id] ?? "";
            const visible = folderFilter
              ? billingMacros.diagnoses.filter((d) => d.folderId === folderFilter)
              : billingMacros.diagnoses;
            const bundleCodes = bundle.diagnosisIds.map((id) => diagnosisById.get(id)?.code).filter(Boolean) as string[];
            return (
              <div className={bundleIndex > 0 ? "border-t border-[var(--line-soft)]" : ""} key={bundle.id}>
                <div className={`flex items-center gap-2 px-3 py-2 ${open ? "bg-[var(--bg-soft)]" : ""}`}>
                  <button
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} ${bundle.name}`}
                    className="w-4 text-xs text-[var(--text-muted)]"
                    onClick={() => setOpenBundles((s) => toggle(s, bundle.id))}
                    type="button"
                  >
                    {open ? "▾" : "▸"}
                  </button>
                  <input
                    aria-label="Bundle name"
                    className={`${input} w-56 font-semibold ${bundle.active ? "" : "opacity-55"}`}
                    onChange={(e) => updateBundle(bundle.id, { name: e.target.value })}
                    value={bundle.name}
                  />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-xs text-[var(--text-muted)]"
                    onClick={() => setOpenBundles((s) => toggle(s, bundle.id))}
                    type="button"
                  >
                    <span className="font-semibold">{bundleCodes.length} codes</span>
                    {bundleCodes.length > 0 && <span className="font-mono"> · {bundleCodes.join(", ")}</span>}
                  </button>
                  <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    <input
                      checked={bundle.active}
                      onChange={(e) => updateBundle(bundle.id, { active: e.target.checked })}
                      type="checkbox"
                    />
                    Active
                  </label>
                  <button
                    aria-label={`Remove bundle ${bundle.name}`}
                    className="rounded-md px-2 py-0.5 text-sm text-[var(--text-muted)] hover:bg-red-50 hover:text-[#b43b34]"
                    onClick={() => {
                      if (window.confirm(`Remove bundle "${bundle.name}"?`)) removeBundle(bundle.id);
                    }}
                    title="Remove bundle"
                    type="button"
                  >
                    ✕
                  </button>
                </div>

                {open && (
                  <div className="grid gap-3 border-t border-[var(--line-soft)] px-3 py-3 lg:grid-cols-2">
                    <div className="space-y-2">
                      <p className={sectionLabel}>Codes in this bundle (drag to reorder)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {bundle.diagnosisIds.length === 0 && (
                          <p className="text-xs text-[var(--text-muted)]">No diagnosis codes selected.</p>
                        )}
                        {bundle.diagnosisIds.map((diagnosisId, chipIndex) => {
                          const diagnosis = diagnosisById.get(diagnosisId);
                          if (!diagnosis) return null;
                          const dragging = dragChip?.bundleId === bundle.id && dragChip?.index === chipIndex;
                          return (
                            <span
                              className={`inline-flex cursor-grab items-center gap-1 rounded-full border border-[var(--line-soft)] bg-[var(--bg-soft)] py-0.5 pl-2 pr-1 text-xs font-semibold ${
                                dragging ? "opacity-50" : ""
                              }`}
                              draggable
                              key={`${bundle.id}-${diagnosisId}`}
                              onDragEnd={() => setDragChip(null)}
                              onDragOver={(e) => {
                                if (!dragChip || dragChip.bundleId !== bundle.id || dragChip.index === chipIndex) return;
                                e.preventDefault();
                              }}
                              onDragStart={() => setDragChip({ bundleId: bundle.id, index: chipIndex })}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (!dragChip || dragChip.bundleId !== bundle.id || dragChip.index === chipIndex) return;
                                const next = [...bundle.diagnosisIds];
                                const [moved] = next.splice(dragChip.index, 1);
                                next.splice(chipIndex, 0, moved);
                                updateBundle(bundle.id, { diagnosisIds: next });
                                setDragChip(null);
                              }}
                              title={`${diagnosis.description} — drag to reorder`}
                            >
                              <span className="font-mono">{diagnosis.code}</span>
                              <button
                                aria-label={`Take ${diagnosis.code} out of ${bundle.name}`}
                                className="rounded-full px-1 text-[var(--text-muted)] hover:text-[#b43b34]"
                                onClick={() =>
                                  updateBundle(bundle.id, { diagnosisIds: bundle.diagnosisIds.filter((id) => id !== diagnosisId) })
                                }
                                type="button"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <Icd10Search
                        addedLabel="In bundle"
                        ariaLabel={`Search ICD-10 to add to ${bundle.name}`}
                        existingCodes={bundleCodes}
                        label="Add from ICD-10"
                        maxResults={12}
                        onPick={(entry) => addIcdToBundle(bundle.id, entry)}
                        placeholder="Search ICD-10 to add to this bundle…"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className={`${sectionLabel} mr-auto`}>Or pick from your codes</p>
                        <select
                          aria-label="Folder filter"
                          className={`${input} text-xs`}
                          onChange={(e) => setBundleFilterFolderId((c) => ({ ...c, [bundle.id]: e.target.value }))}
                          value={folderFilter}
                        >
                          <option value="">All folders</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="max-h-48 space-y-0.5 overflow-auto rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
                        {visible.length === 0 && (
                          <p className="text-xs text-[var(--text-muted)]">No diagnosis codes in this folder yet.</p>
                        )}
                        {visible.map((diagnosis) => (
                          <label className="flex items-start gap-2 text-xs" key={`${bundle.id}-dx-${diagnosis.id}`}>
                            <input
                              checked={bundle.diagnosisIds.includes(diagnosis.id)}
                              onChange={(e) => {
                                const nextIds = e.target.checked
                                  ? Array.from(new Set([...bundle.diagnosisIds, diagnosis.id]))
                                  : bundle.diagnosisIds.filter((id) => id !== diagnosis.id);
                                updateBundle(bundle.id, { diagnosisIds: nextIds });
                              }}
                              type="checkbox"
                            />
                            <span>
                              <span className="font-mono font-semibold">{diagnosis.code}</span> {diagnosis.description}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <details className={card}>
          <summary className="cursor-pointer text-sm font-semibold">+ New bundle</summary>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  aria-label="New bundle name"
                  className={`${input} flex-1 py-1.5`}
                  onChange={(e) => setBundleName(e.target.value)}
                  placeholder="Bundle name (e.g. Cervical + Lumbar PI)"
                  value={bundleName}
                />
                <button className={primaryBtn} onClick={createBundle} type="button">
                  Add Bundle
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bundleDraft.length === 0 && <p className="text-xs text-[var(--text-muted)]">No codes picked yet.</p>}
                {bundleDraft.map((id) => {
                  const d = diagnosisById.get(id);
                  if (!d) return null;
                  return (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--line-soft)] bg-white py-0.5 pl-2 pr-1 text-xs font-semibold"
                      key={`draft-${id}`}
                      title={d.description}
                    >
                      <span className="font-mono">{d.code}</span>
                      <button
                        aria-label={`Remove ${d.code} from new bundle`}
                        className="px-1 text-[var(--text-muted)]"
                        onClick={() => setBundleDraft((c) => c.filter((x) => x !== id))}
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
              <Icd10Search
                addedLabel="Picked"
                ariaLabel="Search ICD-10 to add to the new bundle"
                existingCodes={bundleDraft.map((id) => diagnosisById.get(id)?.code ?? "")}
                label="Add from ICD-10"
                maxResults={12}
                onPick={addIcdToBundleDraft}
                placeholder="Search ICD-10 to add to the new bundle…"
              />
            </div>
            <div className="space-y-2">
              <input
                aria-label="Filter codes for new bundle"
                className={`${input} w-full py-1.5`}
                onChange={(e) => setBundleDraftFilter(e.target.value)}
                placeholder="Or pick from your codes — filter…"
                type="search"
                value={bundleDraftFilter}
              />
              <div className="max-h-48 space-y-0.5 overflow-auto rounded-lg border border-[var(--line-soft)] bg-white p-2">
                {billingMacros.diagnoses.length === 0 && (
                  <p className="text-sm text-[var(--text-muted)]">Add diagnosis macros first.</p>
                )}
                {billingMacros.diagnoses
                  .filter((d) => matches(d, bundleDraftFilter.trim()))
                  .map((entry) => (
                    <label className="flex items-start gap-2 text-xs" key={`bundle-draft-${entry.id}`}>
                      <input
                        checked={bundleDraft.includes(entry.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setBundleDraft((current) =>
                            checked ? Array.from(new Set([...current, entry.id])) : current.filter((id) => id !== entry.id),
                          );
                        }}
                        type="checkbox"
                      />
                      <span>
                        <span className="font-mono font-semibold">{entry.code}</span> {entry.description}
                        <span className="ml-1 text-[var(--text-muted)]">({folderNameById.get(entry.folderId) ?? "General"})</span>
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
