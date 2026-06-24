"use client";

/**
 * Patient packages UI section.
 *
 * Renders on the patient page underneath Cash Payments (gated on
 * `isCashPatient` by the parent). Lets the user:
 *   - Assign a new package from the active templates configured in
 *     Settings → Billing Macros → Package Builder
 *   - See each assigned package's name, price, visits used / total
 *     with a progress bar, purchase date, status badge
 *   - +/- visits per row (manual)
 *   - Edit a free-text note per row
 *   - Mark a package refunded (explicit status override) — auto
 *     completion happens automatically when visits hit total
 *   - Remove a package entirely
 *
 * All writes go through usePatientPackages → savePatientPackages
 * → dualWriteKv to the "billing" KV namespace. Cross-device sync
 * is automatic via the GlobalKvRealtime listener mounted in the
 * portal layout.
 */

import { useMemo, useState } from "react";
import { usePatientPackages } from "@/hooks/use-patient-packages";
import { useBillingMacros } from "@/hooks/use-billing-macros";
import type { TreatmentPackage } from "@/lib/billing-macros";
import type { PatientPackage } from "@/lib/patient-packages";

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusLabel(status: PatientPackage["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "refunded") return "Refunded";
  return "Active";
}

function statusClass(status: PatientPackage["status"]): string {
  if (status === "completed") return "bg-gray-100 text-gray-600 border border-gray-300";
  if (status === "refunded") return "bg-red-50 text-red-700 border border-red-200";
  return "bg-emerald-50 text-emerald-700 border border-emerald-200";
}

function formatFamilyLabel(template: TreatmentPackage): string {
  if (template.family && template.family.trim()) {
    return `${template.family.trim()} — ${template.name}`;
  }
  return template.name;
}

export function PatientPackagesSection({ patientId }: { patientId: string }) {
  const {
    getPackagesForPatient,
    assignPackage,
    removePackage,
    incrementVisits,
    decrementVisits,
    updatePackage,
    setStatus,
  } = usePatientPackages();
  const { billingMacros } = useBillingMacros();

  const assigned = getPackagesForPatient(patientId);

  // Only ACTIVE templates show in the picker. Inactive templates
  // stay visible on rows that were assigned BEFORE they were
  // deactivated — that's the snapshot doing its job. The picker
  // just stops offering them for new assignments.
  const activeTemplates = useMemo(
    () => billingMacros.packages.filter((entry) => entry.active),
    [billingMacros.packages],
  );

  // Group templates by family for the picker so users with several
  // tiers (Bronze / Silver / Gold) see them clustered. Empty
  // family rolls into "Uncategorized".
  const templatesByFamily = useMemo(() => {
    const groups = new Map<string, TreatmentPackage[]>();
    for (const template of activeTemplates) {
      const family = (template.family ?? "").trim() || "Uncategorized";
      const list = groups.get(family) ?? [];
      list.push(template);
      groups.set(family, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [activeTemplates]);

  const [pickerTemplateId, setPickerTemplateId] = useState<string>("");
  const [noteDraftsByPackageId, setNoteDraftsByPackageId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>("");

  const handleAssign = () => {
    setError("");
    const template = activeTemplates.find((entry) => entry.id === pickerTemplateId);
    if (!template) {
      setError("Pick a package from the dropdown first.");
      return;
    }
    assignPackage({ patientId, template });
    setPickerTemplateId("");
  };

  return (
    <section className="rounded-2xl border border-[var(--line-soft)] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-semibold">
          Treatment Packages
          {assigned.length > 0 && (
            <span className="ml-2 rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs font-normal text-[var(--text-muted)]">
              {assigned.length}
            </span>
          )}
        </h4>
      </div>

      {activeTemplates.length === 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No active packages defined yet. Configure them in{" "}
          <span className="font-semibold">Settings → Templates → Billing Macros → Package Builder</span>{" "}
          first, then come back to assign one here.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--line-soft)] bg-[var(--bg-soft)] p-2">
          <select
            className="min-w-[220px] flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
            onChange={(event) => setPickerTemplateId(event.target.value)}
            value={pickerTemplateId}
          >
            <option value="">Pick a package…</option>
            {templatesByFamily.map(([family, templates]) => (
              <optgroup key={family} label={family}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {formatFamilyLabel(template)} — {template.totalVisits} visits /{" "}
                    {formatMoney(template.discountedPrice)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            className="rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-xs font-semibold text-white"
            onClick={handleAssign}
            type="button"
          >
            + Assign Package
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">{error}</p>
      )}

      {assigned.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">No packages assigned to this patient yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {assigned.map((pkg) => {
            const total = pkg.snapshot.totalVisits;
            const used = pkg.visitsUsed;
            const remaining = Math.max(0, total - used);
            const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
            const noteDraft =
              noteDraftsByPackageId[pkg.id] !== undefined
                ? noteDraftsByPackageId[pkg.id]
                : pkg.note ?? "";
            return (
              <li
                key={pkg.id}
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{pkg.snapshot.name}</span>
                      {pkg.snapshot.family && (
                        <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                          {pkg.snapshot.family}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(
                          pkg.status,
                        )}`}
                      >
                        {statusLabel(pkg.status)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      Purchased {pkg.purchaseDate} · {formatMoney(pkg.snapshot.discountedPrice)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {pkg.status !== "refunded" ? (
                      <button
                        className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                        onClick={() => setStatus(patientId, pkg.id, "refunded")}
                        type="button"
                        title="Mark this package as refunded"
                      >
                        Refund
                      </button>
                    ) : (
                      <button
                        className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-[11px] font-semibold"
                        onClick={() => setStatus(patientId, pkg.id, "active")}
                        type="button"
                        title="Undo refund status"
                      >
                        Unrefund
                      </button>
                    )}
                    <button
                      className="rounded-md p-1.5 text-[#b43b34] hover:bg-red-50"
                      onClick={() => {
                        const ok = window.confirm(
                          `Remove "${pkg.snapshot.name}" from this patient?\n\nThis does not refund anything automatically — it just deletes the package assignment from the patient's record.`,
                        );
                        if (!ok) return;
                        removePackage(patientId, pkg.id);
                      }}
                      type="button"
                      title="Delete this package assignment"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m19 7-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-muted)]">
                        Visits: <span className="font-semibold text-[var(--text-main)]">{used}</span> / {total}
                        {remaining > 0 && pkg.status === "active" && (
                          <span className="ml-1 text-[var(--text-muted)]">
                            ({remaining} remaining)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-soft)]">
                      <div
                        className={`h-full transition-all ${
                          pkg.status === "refunded"
                            ? "bg-red-400"
                            : pkg.status === "completed"
                              ? "bg-gray-400"
                              : "bg-[var(--brand-primary)]"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1">
                    <button
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={used === 0}
                      onClick={() => decrementVisits(patientId, pkg.id)}
                      title="Undo last visit"
                      type="button"
                    >
                      −
                    </button>
                    <button
                      className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                      onClick={() => incrementVisits(patientId, pkg.id)}
                      title="Record a visit against this package"
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="mt-2">
                  <input
                    className="w-full rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs"
                    onBlur={() => {
                      const finalNote = noteDraft.trim();
                      if (finalNote === (pkg.note ?? "")) return;
                      updatePackage(patientId, pkg.id, { note: finalNote || undefined });
                    }}
                    onChange={(event) =>
                      setNoteDraftsByPackageId((current) => ({
                        ...current,
                        [pkg.id]: event.target.value,
                      }))
                    }
                    placeholder="Note (optional)"
                    value={noteDraft}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
