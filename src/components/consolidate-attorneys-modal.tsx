"use client";

/**
 * Consolidate Attorneys — one-off migration helper.
 *
 * Bandaid tool (per product direction) that helps users clean up the
 * attorney field after a legacy-system migration where the same firm was
 * typed several different ways across different patient records (e.g.
 * "Joe & Dave Associates" vs "Joe & Dave Law Firm" vs "Joe & Dave Lawyer").
 *
 * Flow:
 *   1. Scan every active patient, collect unique attorney names
 *   2. Group names by last-significant-word + fuzzy similarity
 *   3. User reviews each group, picks a canonical name, and check-marks
 *      which patients should adopt that name
 *   4. Apply → rewrites patient.attorney in bulk, optionally creates a
 *      contact for the canonical name
 *
 * This component is intentionally self-contained and opens as a modal so
 * it's easy to remove later if the product decision flips.
 */

import { useMemo, useState } from "react";
import { patients as patientRecords, updatePatientRecordById, type ContactRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { ScrollLock } from "@/components/scroll-lock";

// ---------- Fuzzy matching helpers ---------------------------------------

function normalizeAttorneyString(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\b(llp|llc|pllc|pc|p\.c\.|inc|ltd|esq|esquire)\b/gi, "")
    .replace(/\b(law|firm|lawyer|lawyers|attorney|attorneys|associates|office|offices|legal|group)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attorneyTokens(value: string): string[] {
  const n = normalizeAttorneyString(value);
  return n.split(/\s+/).filter((t) => t.length >= 2);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Two attorney strings count as similar if their normalized forms share
 *  ≥2 tokens OR are within ~30% edit distance. Tighter than the patient
 *  finder on purpose — firm names are long and accidental collisions hurt
 *  more. */
function attorneysSimilar(a: string, b: string): boolean {
  const na = normalizeAttorneyString(a);
  const nb = normalizeAttorneyString(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Shared-token heuristic: if the non-boilerplate words overlap by ≥2,
  // they're almost certainly the same firm ("Joe Dave" vs "Joe Dave").
  const ta = new Set(attorneyTokens(a));
  const tb = new Set(attorneyTokens(b));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared >= 2) return true;
  if (shared === 1 && (ta.size === 1 || tb.size === 1)) return true;
  // Edit-distance fallback for short names / simple typos
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen < 6) return false;
  const dist = levenshtein(na, nb);
  return dist / maxLen < 0.3;
}

// ---------- Data types ----------------------------------------------------

export type AttorneyVariant = {
  /** Original attorney string as stored on the patient record */
  rawName: string;
  /** Patients using exactly this attorney string */
  patientIds: string[];
};

export type AttorneyGroup = {
  /** Stable key (derived from the biggest variant's normalized form) */
  key: string;
  /** The variants that were merged into this group */
  variants: AttorneyVariant[];
};

// ---------- Core grouping logic -----------------------------------------

function buildAttorneyGroups(): AttorneyGroup[] {
  // Bucket by exact raw attorney name, counting patients per variant.
  const byRaw = new Map<string, { rawName: string; patientIds: string[] }>();
  for (const p of patientRecords) {
    if (p.deleted) continue;
    const raw = (p.attorney ?? "").trim();
    if (!raw) continue;
    // Skip the "Self" sentinel — never a firm
    if (raw.toLowerCase() === "self") continue;
    const key = raw.toLowerCase();
    const bucket = byRaw.get(key) ?? { rawName: raw, patientIds: [] };
    bucket.patientIds.push(p.id);
    byRaw.set(key, bucket);
  }

  const variants = Array.from(byRaw.values()).sort(
    (a, b) => b.patientIds.length - a.patientIds.length,
  );

  // Union-find: merge variants that are similar to each other.
  const parent = new Map<string, string>();
  const nameByKey = new Map<string, string>();
  for (const v of variants) {
    const key = v.rawName.toLowerCase();
    parent.set(key, key);
    nameByKey.set(key, v.rawName);
  }
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      if (attorneysSimilar(variants[i].rawName, variants[j].rawName)) {
        union(
          variants[i].rawName.toLowerCase(),
          variants[j].rawName.toLowerCase(),
        );
      }
    }
  }

  // Collect cluster members
  const clusters = new Map<string, AttorneyVariant[]>();
  for (const v of variants) {
    const root = find(v.rawName.toLowerCase());
    const list = clusters.get(root) ?? [];
    list.push(v);
    clusters.set(root, list);
  }

  const groups: AttorneyGroup[] = [];
  clusters.forEach((list, key) => {
    // Only surface groups with more than one variant OR more than one patient
    // — a single variant covering a single patient isn't a consolidation
    // target, it's just a contact to create.
    const totalPatients = list.reduce((sum, v) => sum + v.patientIds.length, 0);
    if (list.length <= 1 && totalPatients <= 1) return;
    list.sort((a, b) => b.patientIds.length - a.patientIds.length);
    groups.push({ key, variants: list });
  });

  // Largest clusters first
  groups.sort((a, b) => {
    const as = a.variants.reduce((sum, v) => sum + v.patientIds.length, 0);
    const bs = b.variants.reduce((sum, v) => sum + v.patientIds.length, 0);
    return bs - as;
  });
  return groups;
}

// ---------- Component ----------------------------------------------------

interface GroupSelection {
  targetName: string;
  /** Checked patient IDs inside this group */
  selectedPatientIds: Set<string>;
  /** Create a Contact row from the target name after apply? */
  createContact: boolean;
  /** Contact-creation form fields (only read when createContact=true).
   *  Name starts synced to targetName but the user can override it if they
   *  want the contact label to differ from what we write into patient
   *  records (rare, but occasionally useful). */
  contactName: string;
  contactPhone: string;
  contactFax: string;
  contactEmail: string;
  contactAddress: string;
}

interface ConsolidateAttorneysModalProps {
  onClose: () => void;
  /** Bound to the PARENT Contacts page's useContactDirectory() instance so
   *  newly-created attorney contacts appear immediately in the background
   *  list when the modal closes. If we called useContactDirectory() inside
   *  the modal instead, its state would be isolated from the parent's
   *  state — localStorage would still persist correctly but the Contacts
   *  page would appear unchanged until the next reload. */
  addContact: (draft: {
    name: string;
    category: ContactRecord["category"];
    phone: string;
    subCategory?: string;
    fax?: string;
    email?: string;
    address?: string;
  }) => { added: true; contact: ContactRecord } | { added: false; reason: string; contact?: ContactRecord };
}

export function ConsolidateAttorneysModal({
  onClose,
  addContact,
}: ConsolidateAttorneysModalProps) {
  const groups = useMemo(() => buildAttorneyGroups(), []);

  const [selections, setSelections] = useState<Map<string, GroupSelection>>(() => {
    const initial = new Map<string, GroupSelection>();
    for (const g of groups) {
      const biggest = g.variants[0];
      const defaultName = biggest?.rawName ?? "";
      initial.set(g.key, {
        targetName: defaultName,
        selectedPatientIds: new Set<string>(),
        createContact: false,
        contactName: defaultName,
        contactPhone: "",
        contactFax: "",
        contactEmail: "",
        contactAddress: "",
      });
    }
    return initial;
  });

  const [applying, setApplying] = useState(false);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [resultError, setResultError] = useState<string>("");

  const patientNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const p of patientRecords) lookup.set(p.id, p.fullName);
    return lookup;
  }, []);

  const updateSelection = (
    groupKey: string,
    updater: (current: GroupSelection) => GroupSelection,
  ) => {
    setSelections((current) => {
      const next = new Map(current);
      const existing = next.get(groupKey);
      if (!existing) return current;
      next.set(groupKey, updater(existing));
      return next;
    });
  };

  const togglePatient = (groupKey: string, patientId: string) => {
    updateSelection(groupKey, (sel) => {
      const ids = new Set(sel.selectedPatientIds);
      if (ids.has(patientId)) ids.delete(patientId);
      else ids.add(patientId);
      return { ...sel, selectedPatientIds: ids };
    });
  };

  const toggleVariant = (groupKey: string, variant: AttorneyVariant) => {
    updateSelection(groupKey, (sel) => {
      const ids = new Set(sel.selectedPatientIds);
      const allChecked = variant.patientIds.every((id) => ids.has(id));
      if (allChecked) {
        for (const id of variant.patientIds) ids.delete(id);
      } else {
        for (const id of variant.patientIds) ids.add(id);
      }
      return { ...sel, selectedPatientIds: ids };
    });
  };

  const selectAllInGroup = (group: AttorneyGroup) => {
    updateSelection(group.key, (sel) => {
      const ids = new Set<string>();
      for (const v of group.variants) for (const id of v.patientIds) ids.add(id);
      return { ...sel, selectedPatientIds: ids };
    });
  };

  const handleApply = async () => {
    setApplying(true);
    setResultMessage("");
    setResultError("");

    let patientsTouched = 0;
    let contactsCreated = 0;
    let contactsAlreadyExisted = 0;
    const contactFailures: string[] = [];

    for (const group of groups) {
      const sel = selections.get(group.key);
      if (!sel) continue;
      const target = sel.targetName.trim();
      if (!target || sel.selectedPatientIds.size === 0) continue;

      // Rewrite every selected patient's attorney field to the canonical
      // name. updatePatientRecordById triggers persistPatients which fires
      // the Supabase dual-write, so one call per patient keeps the cloud
      // in sync without a manual push.
      for (const patientId of sel.selectedPatientIds) {
        const updated = updatePatientRecordById(patientId, {
          attorney: target,
          lastUpdate: new Date().toISOString().slice(0, 10),
        });
        if (updated) patientsTouched++;
      }

      // Optionally create a contact for the firm. Uses the Name / Phone /
      // Fax / Email / Address that the user entered in the expanded contact
      // form — falls back to the canonical attorney name + a placeholder
      // phone when those fields are blank. We don't skip on a pre-check:
      // addContact's own dup detection and validation decide, and we
      // surface its exact reason string if it refuses.
      if (sel.createContact) {
        const name = sel.contactName.trim() || target;
        const phone = sel.contactPhone.trim() || "(000) 000-0000";
        const res = addContact({
          name,
          category: "Attorney",
          phone,
          fax: sel.contactFax.trim() || undefined,
          email: sel.contactEmail.trim() || undefined,
          address: sel.contactAddress.trim() || undefined,
        });
        if (res.added) {
          contactsCreated++;
        } else if (res.reason === "Contact already exists.") {
          contactsAlreadyExisted++;
        } else {
          contactFailures.push(`${name}: ${res.reason}`);
        }
      }
    }

    setApplying(false);
    if (patientsTouched === 0 && contactsCreated === 0) {
      setResultError(
        contactFailures.length
          ? `No patients updated. Contact creation errors: ${contactFailures.join("; ")}`
          : "Nothing to apply — check at least one patient in a group and confirm the canonical name.",
      );
      return;
    }

    const parts: string[] = [];
    if (patientsTouched > 0) {
      parts.push(
        `updated ${patientsTouched} patient${patientsTouched === 1 ? "" : "s"}`,
      );
    }
    if (contactsCreated > 0) {
      parts.push(
        `created ${contactsCreated} attorney contact${
          contactsCreated === 1 ? "" : "s"
        }`,
      );
    }
    if (contactsAlreadyExisted > 0) {
      parts.push(
        `${contactsAlreadyExisted} contact${
          contactsAlreadyExisted === 1 ? " was" : "s were"
        } already in your directory`,
      );
    }
    setResultMessage(`✓ ${parts.join(", ")}.`);
    if (contactFailures.length) {
      setResultError(
        `Could not create ${contactFailures.length} contact${
          contactFailures.length === 1 ? "" : "s"
        }: ${contactFailures.join("; ")}`,
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.5)] px-4 py-8">
      <ScrollLock />
      <section className="w-full max-w-4xl rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Consolidate Attorneys</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Find patients who list the same firm under slightly different
              names and merge them onto one canonical attorney.
            </p>
          </div>
          <button
            className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-6 text-center">
            <p className="text-sm font-semibold text-emerald-600">
              ✓ No attorney duplicates found.
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Every patient&apos;s attorney name is either unique or already
              consolidated.
            </p>
          </div>
        ) : (
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <p className="text-xs text-[var(--text-muted)]">
              Found {groups.length} group{groups.length === 1 ? "" : "s"} of
              similar attorney names. For each group: type the canonical name,
              check the patients to merge, then hit Apply.
            </p>
            {groups.map((group) => {
              const sel = selections.get(group.key);
              if (!sel) return null;
              const totalSelected = sel.selectedPatientIds.size;
              const totalPatients = group.variants.reduce(
                (sum, v) => sum + v.patientIds.length,
                0,
              );

              return (
                <div
                  key={group.key}
                  className="rounded-xl border border-[var(--line-soft)] bg-white p-3"
                >
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                    <label className="grid grow gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        Canonical attorney name for this group
                      </span>
                      <input
                        className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                        list={`canonical-${group.key}`}
                        onChange={(e) =>
                          updateSelection(group.key, (s) => {
                            const nextTarget = e.target.value;
                            // If the user hasn't explicitly edited the contact
                            // name yet, keep it synced to the canonical name
                            // so they don't have to retype when they tick the
                            // "Also create a contact" box.
                            const contactNameWasSynced =
                              s.contactName.trim() === s.targetName.trim();
                            return {
                              ...s,
                              targetName: nextTarget,
                              contactName: contactNameWasSynced
                                ? nextTarget
                                : s.contactName,
                            };
                          })
                        }
                        value={sel.targetName}
                      />
                      <datalist id={`canonical-${group.key}`}>
                        {group.variants.map((v) => (
                          <option key={v.rawName} value={v.rawName} />
                        ))}
                      </datalist>
                    </label>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1.5 text-xs font-semibold"
                      onClick={() => selectAllInGroup(group)}
                      type="button"
                    >
                      Select all {totalPatients}
                    </button>
                  </div>

                  <ul className="space-y-2">
                    {group.variants.map((variant) => {
                      const allChecked = variant.patientIds.every((id) =>
                        sel.selectedPatientIds.has(id),
                      );
                      const someChecked =
                        !allChecked &&
                        variant.patientIds.some((id) =>
                          sel.selectedPatientIds.has(id),
                        );
                      return (
                        <li
                          key={variant.rawName}
                          className="rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2"
                        >
                          <label className="flex items-center gap-2">
                            <input
                              checked={allChecked}
                              onChange={() => toggleVariant(group.key, variant)}
                              ref={(el) => {
                                if (el) el.indeterminate = someChecked;
                              }}
                              type="checkbox"
                            />
                            <span className="text-sm font-semibold">
                              {variant.rawName}
                            </span>
                            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                              {variant.patientIds.length} patient
                              {variant.patientIds.length === 1 ? "" : "s"}
                            </span>
                          </label>
                          <ul className="mt-1 grid gap-0.5 pl-6 sm:grid-cols-2">
                            {variant.patientIds.map((id) => (
                              <li
                                key={id}
                                className="flex items-center gap-1.5 text-xs"
                              >
                                <input
                                  checked={sel.selectedPatientIds.has(id)}
                                  onChange={() => togglePatient(group.key, id)}
                                  type="checkbox"
                                />
                                <span className="truncate text-[var(--text-muted)]">
                                  {patientNameLookup.get(id) ?? id}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          checked={sel.createContact}
                          onChange={(e) =>
                            updateSelection(group.key, (s) => ({
                              ...s,
                              createContact: e.target.checked,
                              // Re-sync contact name from target when opening
                              // the form so the user starts with the canonical
                              // name pre-filled.
                              contactName:
                                e.target.checked && !s.contactName.trim()
                                  ? s.targetName
                                  : s.contactName,
                            }))
                          }
                          type="checkbox"
                        />
                        <span className="font-semibold">
                          Also create a contact for &ldquo;{sel.targetName}&rdquo;
                        </span>
                      </label>
                      <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
                        {totalSelected} of {totalPatients} checked
                      </span>
                    </div>

                    {sel.createContact ? (
                      <div className="mt-2 grid gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] p-2 sm:grid-cols-2">
                        <label className="grid gap-0.5 sm:col-span-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Name *
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                            onChange={(e) =>
                              updateSelection(group.key, (s) => ({
                                ...s,
                                contactName: e.target.value,
                              }))
                            }
                            placeholder="Firm / attorney name"
                            value={sel.contactName}
                          />
                        </label>
                        <label className="grid gap-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Phone
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                            inputMode="numeric"
                            maxLength={14}
                            onChange={(e) =>
                              updateSelection(group.key, (s) => ({
                                ...s,
                                contactPhone: formatUsPhoneInput(e.target.value),
                              }))
                            }
                            placeholder="(555) 555-5555"
                            value={sel.contactPhone}
                          />
                        </label>
                        <label className="grid gap-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Fax
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                            inputMode="numeric"
                            maxLength={14}
                            onChange={(e) =>
                              updateSelection(group.key, (s) => ({
                                ...s,
                                contactFax: formatUsPhoneInput(e.target.value),
                              }))
                            }
                            placeholder="Optional"
                            value={sel.contactFax}
                          />
                        </label>
                        <label className="grid gap-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Email
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                            onChange={(e) =>
                              updateSelection(group.key, (s) => ({
                                ...s,
                                contactEmail: e.target.value,
                              }))
                            }
                            placeholder="Optional"
                            type="email"
                            value={sel.contactEmail}
                          />
                        </label>
                        <label className="grid gap-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                            Address
                          </span>
                          <input
                            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-sm"
                            onChange={(e) =>
                              updateSelection(group.key, (s) => ({
                                ...s,
                                contactAddress: e.target.value,
                              }))
                            }
                            placeholder="Optional"
                            value={sel.contactAddress}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {resultError ? (
          <p className="mt-3 text-sm font-semibold text-[#b43b34]">{resultError}</p>
        ) : null}
        {resultMessage ? (
          <p className="mt-3 text-sm font-semibold text-emerald-600">
            {resultMessage}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
          {groups.length > 0 ? (
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90 disabled:opacity-50"
              disabled={applying}
              onClick={() => void handleApply()}
              type="button"
            >
              {applying ? "Applying…" : "Apply Consolidation"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
