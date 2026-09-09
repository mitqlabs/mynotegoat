"use client";

import { useMemo, useState } from "react";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import type { TreatmentPackage } from "@/lib/billing-macros";

const UNCATEGORIZED_KEY = "__uncategorized__";
const UNCATEGORIZED_LABEL = "Uncategorized";

function toCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function toPercent(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0%";
  }
  return `${value.toFixed(1)}%`;
}

/** Normalize a family string for grouping — treats blank / undefined
 *  as the same "Uncategorized" bucket. */
function familyKey(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : UNCATEGORIZED_KEY;
}

function familyLabel(key: string): string {
  return key === UNCATEGORIZED_KEY ? UNCATEGORIZED_LABEL : key;
}

interface FamilyGroup {
  key: string;            // family key (UNCATEGORIZED_KEY for empty)
  label: string;          // display label
  packages: TreatmentPackage[];
}

/** Bucket packages into family groups, preserving the order of the
 *  first occurrence of each family in the source array. Reordering a
 *  family means moving every package in it as a block. */
function groupPackagesByFamily(packages: TreatmentPackage[]): FamilyGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, TreatmentPackage[]>();
  for (const pkg of packages) {
    const key = familyKey(pkg.family);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(pkg);
  }
  return order.map((key) => ({
    key,
    label: familyLabel(key),
    packages: buckets.get(key) ?? [],
  }));
}

export function PackageBuilderSettingsPanel() {
  const {
    billingMacros,
    addPackage,
    updatePackage,
    removePackage,
    reorderPackages,
    renamePackageFamily,
    setPackageFamily,
    addPackageTreatment,
    updatePackageTreatmentVisits,
    removePackageTreatment,
  } = useBillingMacros();

  // Per-family draft for the inline "Add Tier" form. Keyed by family
  // key so each family has its own scratch.
  const [tierDrafts, setTierDrafts] = useState<
    Record<string, { name: string; totalVisits: number; discountedPrice: number }>
  >({});
  const [packageTreatmentDrafts, setPackageTreatmentDrafts] = useState<
    Record<string, { treatmentId: string; visits: number }>
  >({});
  // Top-level "Add Family" inline form.
  const [newFamilyDraft, setNewFamilyDraft] = useState({
    family: "",
    tierName: "",
    totalVisits: 12,
    discountedPrice: 0,
  });
  // Collapsed/expanded state per family — default-collapsed so a long
  // list of families isn't an overwhelming wall of forms.
  const [openFamilies, setOpenFamilies] = useState<Set<string>>(new Set());
  // Inline-rename state for family headers. Key → in-progress edit.
  const [editingFamily, setEditingFamily] = useState<{
    key: string;
    value: string;
  } | null>(null);
  const [error, setError] = useState("");

  // Drag state for tiers (rows within a family).
  const [tierDragId, setTierDragId] = useState<string | null>(null);
  const [tierDragOverId, setTierDragOverId] = useState<string | null>(null);
  // Drag state for whole families. The whole block of packages with
  // the same family value moves together.
  const [familyDragKey, setFamilyDragKey] = useState<string | null>(null);
  const [familyDragOverKey, setFamilyDragOverKey] = useState<string | null>(null);

  const activeTreatments = useMemo(
    () => billingMacros.treatments.filter((entry) => entry.active),
    [billingMacros.treatments],
  );
  const treatmentById = useMemo(
    () => new Map(billingMacros.treatments.map((entry) => [entry.id, entry] as const)),
    [billingMacros.treatments],
  );

  const groups = useMemo(
    () => groupPackagesByFamily(billingMacros.packages),
    [billingMacros.packages],
  );

  const isFamilyOpen = (key: string) => openFamilies.has(key);
  const toggleFamilyOpen = (key: string) => {
    setOpenFamilies((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getTierDraft = (familyKeyValue: string) =>
    tierDrafts[familyKeyValue] ?? {
      name: "",
      totalVisits: 12,
      discountedPrice: 0,
    };

  const setTierDraft = (
    familyKeyValue: string,
    patch: Partial<{ name: string; totalVisits: number; discountedPrice: number }>,
  ) => {
    setTierDrafts((current) => ({
      ...current,
      [familyKeyValue]: { ...getTierDraft(familyKeyValue), ...patch },
    }));
  };

  const handleAddTierToFamily = (familyKeyValue: string) => {
    const draft = getTierDraft(familyKeyValue);
    const family = familyKeyValue === UNCATEGORIZED_KEY ? "" : familyKeyValue;
    const ok = addPackage({
      name: draft.name,
      totalVisits: draft.totalVisits,
      discountedPrice: draft.discountedPrice,
      family,
    });
    if (!ok) {
      setError(`Could not add tier. A tier named "${draft.name}" already exists in this family.`);
      return;
    }
    setError("");
    setTierDraft(familyKeyValue, { name: "", totalVisits: 12, discountedPrice: 0 });
    // Auto-open the family so the user sees the new tier.
    setOpenFamilies((current) => new Set([...current, familyKeyValue]));
  };

  const handleAddFamily = () => {
    const familyName = newFamilyDraft.family.trim();
    if (!familyName) {
      setError("Family name is required.");
      return;
    }
    if (!newFamilyDraft.tierName.trim()) {
      setError("First tier name is required.");
      return;
    }
    const ok = addPackage({
      name: newFamilyDraft.tierName,
      totalVisits: newFamilyDraft.totalVisits,
      discountedPrice: newFamilyDraft.discountedPrice,
      family: familyName,
    });
    if (!ok) {
      setError(`A tier named "${newFamilyDraft.tierName}" already exists in family "${familyName}".`);
      return;
    }
    setError("");
    setNewFamilyDraft({ family: "", tierName: "", totalVisits: 12, discountedPrice: 0 });
    setOpenFamilies((current) => new Set([...current, familyName]));
  };

  // Tier drag: reorders within the source family OR moves to a target
  // family if dropped on a tier in a different family.
  const handleTierDrop = (targetTierId: string) => {
    if (!tierDragId || tierDragId === targetTierId) {
      setTierDragId(null);
      setTierDragOverId(null);
      return;
    }
    const sourcePkg = billingMacros.packages.find((p) => p.id === tierDragId);
    const targetPkg = billingMacros.packages.find((p) => p.id === targetTierId);
    if (!sourcePkg || !targetPkg) {
      setTierDragId(null);
      setTierDragOverId(null);
      return;
    }
    const sourceFam = familyKey(sourcePkg.family);
    const targetFam = familyKey(targetPkg.family);
    // Cross-family drag — first move the source into the target's
    // family, then reorder so it lands at the target's position.
    if (sourceFam !== targetFam) {
      setPackageFamily(
        sourcePkg.id,
        targetFam === UNCATEGORIZED_KEY ? "" : targetFam,
      );
    }
    // Build the reordered ids: take the current array, remove source,
    // insert it just before the target.
    const ids = billingMacros.packages.map((p) => p.id);
    const filtered = ids.filter((id) => id !== sourcePkg.id);
    const targetIdx = filtered.indexOf(targetPkg.id);
    if (targetIdx < 0) {
      filtered.push(sourcePkg.id);
    } else {
      filtered.splice(targetIdx, 0, sourcePkg.id);
    }
    reorderPackages(filtered);
    setTierDragId(null);
    setTierDragOverId(null);
  };

  // Family drag: move every package with the source family value to
  // sit before the first package of the target family.
  const handleFamilyDrop = (targetKey: string) => {
    if (!familyDragKey || familyDragKey === targetKey) {
      setFamilyDragKey(null);
      setFamilyDragOverKey(null);
      return;
    }
    const all = billingMacros.packages;
    const sourceIds = all
      .filter((p) => familyKey(p.family) === familyDragKey)
      .map((p) => p.id);
    if (sourceIds.length === 0) {
      setFamilyDragKey(null);
      setFamilyDragOverKey(null);
      return;
    }
    const without = all.filter((p) => !sourceIds.includes(p.id));
    const targetFirstIdx = without.findIndex((p) => familyKey(p.family) === targetKey);
    const insertAt = targetFirstIdx < 0 ? without.length : targetFirstIdx;
    const reordered = [...without];
    reordered.splice(insertAt, 0, ...all.filter((p) => sourceIds.includes(p.id)));
    reorderPackages(reordered.map((p) => p.id));
    setFamilyDragKey(null);
    setFamilyDragOverKey(null);
  };

  const commitFamilyRename = () => {
    if (!editingFamily) return;
    const oldKey = editingFamily.key;
    const next = editingFamily.value.trim();
    // Renaming the Uncategorized bucket = setting a real family on
    // every previously-empty package.
    const oldName = oldKey === UNCATEGORIZED_KEY ? "" : oldKey;
    if ((next || "") !== oldName) {
      renamePackageFamily(oldName, next);
      // Move open-state along with the rename.
      setOpenFamilies((current) => {
        const newSet = new Set(current);
        if (current.has(oldKey)) {
          newSet.delete(oldKey);
          newSet.add(next || UNCATEGORIZED_KEY);
        }
        return newSet;
      });
    }
    setEditingFamily(null);
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-sm font-semibold text-[#b43b34]">{error}</p>}

      <article className="rounded-xl border border-[var(--line-soft)] bg-white p-4">
        <h4 className="text-lg font-semibold">Package Library</h4>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Group tiers (Gold / Silver / Bronze) under a family (e.g. Spinal
          Decompression). Drag the family header to reorder families; drag a
          tier row to reorder within or across families.
        </p>

        <div className="mt-3 space-y-2">
          {groups.length === 0 && (
            <p className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-3 text-sm text-[var(--text-muted)]">
              No packages yet. Add a family below to get started.
            </p>
          )}

          {groups.map((group) => {
            const open = isFamilyOpen(group.key);
            const tierDraft = getTierDraft(group.key);
            const isFamilyDragging = familyDragKey === group.key;
            const isFamilyDragOver =
              familyDragOverKey === group.key && familyDragKey !== group.key;
            return (
              <div
                className={`rounded-xl border transition-colors ${
                  isFamilyDragging
                    ? "opacity-50"
                    : isFamilyDragOver
                      ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.06)]"
                      : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
                }`}
                key={group.key}
              >
                {/* Family header — drag handle, expand toggle, rename, count */}
                <div
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                  draggable={editingFamily?.key !== group.key}
                  onDragStart={() => setFamilyDragKey(group.key)}
                  onDragOver={(event) => {
                    if (familyDragKey && familyDragKey !== group.key) {
                      event.preventDefault();
                      setFamilyDragOverKey(group.key);
                    }
                  }}
                  onDragLeave={() => {
                    if (familyDragOverKey === group.key) setFamilyDragOverKey(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleFamilyDrop(group.key);
                  }}
                  onDragEnd={() => {
                    setFamilyDragKey(null);
                    setFamilyDragOverKey(null);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="cursor-grab text-[var(--text-muted)] select-none"
                    title="Drag to reorder family"
                  >
                    ⋮⋮
                  </span>
                  <button
                    aria-label={open ? "Collapse family" : "Expand family"}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--line-soft)] bg-white text-sm font-bold"
                    onClick={() => toggleFamilyOpen(group.key)}
                    type="button"
                  >
                    {open ? "−" : "+"}
                  </button>
                  {editingFamily?.key === group.key ? (
                    <input
                      autoFocus
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                      onBlur={commitFamilyRename}
                      onChange={(event) =>
                        setEditingFamily((current) =>
                          current ? { ...current, value: event.target.value } : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitFamilyRename();
                        } else if (event.key === "Escape") {
                          setEditingFamily(null);
                        }
                      }}
                      placeholder={UNCATEGORIZED_LABEL}
                      value={editingFamily.value}
                    />
                  ) : (
                    <button
                      className="rounded-md px-1 text-base font-semibold hover:bg-white"
                      onClick={() =>
                        setEditingFamily({
                          key: group.key,
                          value: group.key === UNCATEGORIZED_KEY ? "" : group.key,
                        })
                      }
                      title="Click to rename family"
                      type="button"
                    >
                      {group.label}
                    </button>
                  )}
                  <span className="text-xs text-[var(--text-muted)]">
                    ({group.packages.length} tier
                    {group.packages.length === 1 ? "" : "s"})
                  </span>
                </div>

                {open && (
                  <div className="space-y-3 border-t border-[var(--line-soft)] bg-white p-3">
                    {group.packages.map((entry) => {
                      const assignedVisits = entry.items.reduce(
                        (sum, item) => sum + item.visits,
                        0,
                      );
                      const retailTotal = entry.items.reduce((sum, item) => {
                        const treatment = treatmentById.get(item.treatmentId);
                        if (!treatment) return sum;
                        return (
                          sum +
                          treatment.unitPrice * treatment.defaultUnits * item.visits
                        );
                      }, 0);
                      const discountAmount = Math.max(
                        0,
                        retailTotal - entry.discountedPrice,
                      );
                      const discountPercent =
                        retailTotal > 0 ? (discountAmount / retailTotal) * 100 : 0;
                      const draft =
                        packageTreatmentDrafts[entry.id] ?? {
                          treatmentId: "",
                          visits: entry.totalVisits,
                        };
                      const isTierDragging = tierDragId === entry.id;
                      const isTierDragOver =
                        tierDragOverId === entry.id && tierDragId !== entry.id;
                      return (
                        <div
                          className={`rounded-xl border p-3 transition-colors ${
                            isTierDragging
                              ? "opacity-50"
                              : isTierDragOver
                                ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.06)]"
                                : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
                          }`}
                          draggable
                          key={entry.id}
                          onDragStart={() => setTierDragId(entry.id)}
                          onDragOver={(event) => {
                            if (tierDragId && tierDragId !== entry.id) {
                              event.preventDefault();
                              setTierDragOverId(entry.id);
                            }
                          }}
                          onDragLeave={() => {
                            if (tierDragOverId === entry.id) setTierDragOverId(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleTierDrop(entry.id);
                          }}
                          onDragEnd={() => {
                            setTierDragId(null);
                            setTierDragOverId(null);
                          }}
                        >
                          <div className="grid grid-cols-12 gap-3">
                            <div className="col-span-12 flex items-end gap-2 lg:col-span-5">
                              <span
                                aria-hidden="true"
                                className="cursor-grab pb-2 text-[var(--text-muted)] select-none"
                                title="Drag to reorder"
                              >
                                ⋮⋮
                              </span>
                              <label className="grid min-w-0 flex-1 gap-1">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                                  Tier Name
                                </span>
                                <input
                                  className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                                  onChange={(event) =>
                                    updatePackage(entry.id, { name: event.target.value })
                                  }
                                  value={entry.name}
                                />
                              </label>
                            </div>
                            <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                                Total Visits
                              </span>
                              <input
                                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                                min={1}
                                onChange={(event) =>
                                  updatePackage(entry.id, {
                                    totalVisits: Math.max(
                                      1,
                                      Number(event.target.value) || 1,
                                    ),
                                  })
                                }
                                type="number"
                                value={entry.totalVisits}
                              />
                            </label>
                            <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                                Discounted Price ($)
                              </span>
                              <input
                                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                                min={0}
                                onChange={(event) =>
                                  updatePackage(entry.id, {
                                    discountedPrice: Math.max(
                                      0,
                                      Number(event.target.value) || 0,
                                    ),
                                  })
                                }
                                step="0.01"
                                type="number"
                                value={entry.discountedPrice}
                              />
                            </label>
                            <div className="col-span-6 flex items-end lg:col-span-1">
                              <label className="inline-flex h-[34px] w-full items-center justify-center gap-2 rounded-lg border border-[var(--line-soft)] bg-white px-3 text-sm font-semibold">
                                <input
                                  checked={entry.active}
                                  onChange={(event) =>
                                    updatePackage(entry.id, {
                                      active: event.target.checked,
                                    })
                                  }
                                  type="checkbox"
                                />
                                Active
                              </label>
                            </div>
                            <div className="col-span-6 flex items-end lg:col-span-2">
                              <button
                                className="h-[34px] w-full rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1 text-sm font-semibold"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Remove tier "${entry.name}" from family "${group.label}"?`,
                                    )
                                  )
                                    removePackage(entry.id);
                                }}
                                type="button"
                              >
                                Remove Tier
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-12 gap-2 rounded-lg border border-[var(--line-soft)] bg-white p-2">
                            <label className="col-span-12 grid min-w-0 gap-1 lg:col-span-8">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                                Treatment Macro
                              </span>
                              <select
                                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                                onChange={(event) =>
                                  setPackageTreatmentDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      treatmentId: event.target.value,
                                      visits: current[entry.id]?.visits ?? entry.totalVisits,
                                    },
                                  }))
                                }
                                value={draft.treatmentId}
                              >
                                <option value="">Select treatment macro</option>
                                {activeTreatments.map((treatment) => (
                                  <option
                                    key={`${entry.id}-draft-treatment-${treatment.id}`}
                                    value={treatment.id}
                                  >
                                    {treatment.name} ({treatment.procedureCode})
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                                Visits
                              </span>
                              <input
                                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                                min={1}
                                onChange={(event) =>
                                  setPackageTreatmentDrafts((current) => ({
                                    ...current,
                                    [entry.id]: {
                                      treatmentId: current[entry.id]?.treatmentId ?? "",
                                      visits: Math.max(1, Number(event.target.value) || 1),
                                    },
                                  }))
                                }
                                type="number"
                                value={draft.visits}
                              />
                            </label>

                            <div className="col-span-6 flex items-end lg:col-span-2">
                              <button
                                className="h-[34px] w-full rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-white"
                                onClick={() => {
                                  if (!draft.treatmentId) {
                                    setError("Select a treatment before adding it to package.");
                                    return;
                                  }
                                  addPackageTreatment(
                                    entry.id,
                                    draft.treatmentId,
                                    draft.visits,
                                  );
                                  setError("");
                                }}
                                type="button"
                              >
                                Add / Update Line
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 overflow-x-auto">
                            <div className="min-w-[640px] space-y-1">
                              <div className="grid grid-cols-[1.5fr_110px_130px_90px] gap-2 border-b border-[var(--line-soft)] pb-1 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                                <span>Treatment</span>
                                <span>Visits</span>
                                <span>Line Total</span>
                                <span />
                              </div>
                              {entry.items.length === 0 && (
                                <p className="py-2 text-sm text-[var(--text-muted)]">
                                  No treatment lines yet.
                                </p>
                              )}
                              {entry.items.map((item) => {
                                const treatment = treatmentById.get(item.treatmentId);
                                if (!treatment) return null;
                                return (
                                  <div
                                    className="grid grid-cols-[1.5fr_110px_130px_90px] items-center gap-2"
                                    key={`${entry.id}-${item.treatmentId}`}
                                  >
                                    <p className="text-sm font-semibold">
                                      {treatment.name} ({treatment.procedureCode})
                                    </p>
                                    <input
                                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                                      min={1}
                                      onChange={(event) =>
                                        updatePackageTreatmentVisits(
                                          entry.id,
                                          item.treatmentId,
                                          Math.max(1, Number(event.target.value) || 1),
                                        )
                                      }
                                      type="number"
                                      value={item.visits}
                                    />
                                    <p className="text-sm font-semibold">
                                      {toCurrency(
                                        treatment.unitPrice *
                                          treatment.defaultUnits *
                                          item.visits,
                                      )}
                                    </p>
                                    <button
                                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm font-semibold"
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            "Remove this treatment from the package?",
                                          )
                                        )
                                          removePackageTreatment(entry.id, item.treatmentId);
                                      }}
                                      type="button"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 rounded-lg border border-[var(--line-soft)] bg-white p-2 text-sm md:grid-cols-3">
                            <p>
                              <span className="font-semibold">Assigned Visits:</span>{" "}
                              {assignedVisits}/{entry.totalVisits}
                            </p>
                            <p>
                              <span className="font-semibold">Retail Total:</span>{" "}
                              {toCurrency(retailTotal)}
                            </p>
                            <p>
                              <span className="font-semibold">Discount:</span>{" "}
                              {toPercent(discountPercent)}
                            </p>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add-tier inline form, scoped to this family */}
                    <div className="rounded-xl border border-dashed border-[var(--line-soft)] bg-white p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                        Add Tier to {group.label}
                      </p>
                      <div className="mt-2 grid grid-cols-12 gap-2">
                        <label className="col-span-12 grid min-w-0 gap-1 lg:col-span-5">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                            Tier Name
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                            onChange={(event) =>
                              setTierDraft(group.key, { name: event.target.value })
                            }
                            placeholder="e.g. Gold"
                            value={tierDraft.name}
                          />
                        </label>
                        <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                            Total Visits
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                            min={1}
                            onChange={(event) =>
                              setTierDraft(group.key, {
                                totalVisits: Math.max(1, Number(event.target.value) || 1),
                              })
                            }
                            type="number"
                            value={tierDraft.totalVisits}
                          />
                        </label>
                        <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                            Discounted Price ($)
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1"
                            min={0}
                            onChange={(event) =>
                              setTierDraft(group.key, {
                                discountedPrice: Math.max(
                                  0,
                                  Number(event.target.value) || 0,
                                ),
                              })
                            }
                            step="0.01"
                            type="number"
                            value={tierDraft.discountedPrice}
                          />
                        </label>
                        <div className="col-span-12 flex items-end lg:col-span-2">
                          <button
                            className="h-[34px] w-full rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-sm font-semibold text-white"
                            onClick={() => handleAddTierToFamily(group.key)}
                            type="button"
                          >
                            Add Tier
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </article>

      {/* Add Family form — bottom of the panel. Family exists the
          moment the first tier in it is created. */}
      <article className="rounded-xl border border-dashed border-[var(--line-soft)] bg-white p-4">
        <h4 className="text-base font-semibold">Add New Family</h4>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Create a new family by adding its first tier. You can add more tiers
          inside the family afterward.
        </p>
        <div className="mt-3 grid grid-cols-12 gap-3">
          <label className="col-span-12 grid min-w-0 gap-1 lg:col-span-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Family Name
            </span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setNewFamilyDraft((current) => ({
                  ...current,
                  family: event.target.value,
                }))
              }
              placeholder="e.g. Spinal Decompression"
              value={newFamilyDraft.family}
            />
          </label>
          <label className="col-span-12 grid min-w-0 gap-1 lg:col-span-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              First Tier Name
            </span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(event) =>
                setNewFamilyDraft((current) => ({
                  ...current,
                  tierName: event.target.value,
                }))
              }
              placeholder="e.g. Gold"
              value={newFamilyDraft.tierName}
            />
          </label>
          <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Visits
            </span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              min={1}
              onChange={(event) =>
                setNewFamilyDraft((current) => ({
                  ...current,
                  totalVisits: Math.max(1, Number(event.target.value) || 1),
                }))
              }
              type="number"
              value={newFamilyDraft.totalVisits}
            />
          </label>
          <label className="col-span-6 grid min-w-0 gap-1 lg:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
              Price ($)
            </span>
            <input
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-2"
              min={0}
              onChange={(event) =>
                setNewFamilyDraft((current) => ({
                  ...current,
                  discountedPrice: Math.max(0, Number(event.target.value) || 0),
                }))
              }
              step="0.01"
              type="number"
              value={newFamilyDraft.discountedPrice}
            />
          </label>
          <div className="col-span-12 flex items-end lg:col-span-2">
            <button
              className="h-[42px] w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={handleAddFamily}
              type="button"
            >
              Add Family
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
