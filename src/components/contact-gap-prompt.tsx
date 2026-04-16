"use client";

import { useEffect, useState } from "react";
import { useContactCategories } from "@/hooks/use-contact-categories";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { resolveCategoryHint } from "@/lib/contact-categories";
import { CONTACT_CATEGORIES, type ContactCategory } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";

export type ContactGap = {
  name: string;
  /** Free-form category hint — e.g. "Attorney", "Specialist", "Imaging
   *  Center", or a legacy sub-category like "Pain Management". The prompt
   *  auto-resolves this to one of the fixed top-level categories and
   *  pre-fills the sub-category field if the hint was actually a sub. */
  categoryHint?: string;
  /** Optional sub-category pre-fill (e.g. "Orthopedic"). Shown as the
   *  starting value when the popup opens. */
  subCategoryHint?: string;
  phone?: string;
  email?: string;
  address?: string;
  message?: string; // Custom headline, defaults based on categoryHint
};

interface ContactGapPromptProps {
  gap: ContactGap | null;
  onClose: () => void;
  onSaved?: (contactId: string) => void;
}

export function ContactGapPrompt({ gap, onClose, onSaved }: ContactGapPromptProps) {
  const { subCategories } = useContactCategories();
  const { addContact } = useContactDirectory();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ContactCategory>("Attorney");
  const [subCategory, setSubCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  // Sync local form state when a new `gap` arrives (popup opens or target
  // patient/entry changes). React's lint rule flags this as a cascading
  // re-render but that is the intended behavior here — we're syncing an
  // external prop into local editable form state.
  useEffect(() => {
    if (!gap) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(gap.name);
    setPhone(formatUsPhoneInput(gap.phone ?? ""));
    setEmail(gap.email ?? "");
    setAddress(gap.address ?? "");
    setError("");
    const resolved = resolveCategoryHint(gap.categoryHint);
    setCategory(resolved.category);
    setSubCategory(gap.subCategoryHint ?? resolved.subCategory ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [gap]);

  if (!gap) return null;

  const headline = gap.message ?? `"${gap.name}" is not in your Contacts — add them now?`;
  const availableSubs = subCategories[category] ?? [];

  const handleSave = () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!phone.trim()) {
      setError("Phone is required.");
      return;
    }
    const result = addContact({
      name,
      category,
      subCategory: subCategory.trim() || undefined,
      phone,
      email,
      address,
    });
    if (!result.added) {
      setError(result.reason ?? "Could not save contact.");
      return;
    }
    onSaved?.(result.contact.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[rgba(15,46,70,0.5)] px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-[var(--line-soft)] bg-white p-5 shadow-[0_18px_46px_rgba(14,41,62,0.25)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold">Add to Contacts</h4>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{headline}</p>
          </div>
          <button
            className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
            onClick={onClose}
            type="button"
          >
            Skip
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Name *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(e) => setName(e.target.value)}
              value={name}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Category</span>
            <select
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(e) => {
                const next = e.target.value as ContactCategory;
                setCategory(next);
                // Clear sub-category when switching top-level to avoid
                // mismatched labels (e.g. Orthopedic under Imaging Center).
                setSubCategory("");
              }}
              value={category}
            >
              {CONTACT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">
              Sub-Category (optional)
            </span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              list={`contact-subcategory-options-${category.replace(/\s+/g, "-")}`}
              onChange={(e) => setSubCategory(e.target.value)}
              placeholder={
                category === "Specialist"
                  ? "e.g. Pain Management, Orthopedic, Neurologist…"
                  : "Optional — type or pick"
              }
              value={subCategory}
            />
            <datalist
              id={`contact-subcategory-options-${category.replace(/\s+/g, "-")}`}
            >
              {availableSubs.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Phone *</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              inputMode="numeric"
              maxLength={12}
              onChange={(e) => setPhone(formatUsPhoneInput(e.target.value))}
              placeholder="(555) 555-5555"
              value={phone}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Email</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(e) => setEmail(e.target.value)}
              value={email}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Address</span>
            <input
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
              onChange={(e) => setAddress(e.target.value)}
              value={address}
            />
          </label>
          {error && <p className="text-sm font-semibold text-[#b43b34]">{error}</p>}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
            onClick={onClose}
            type="button"
          >
            Skip
          </button>
          <button
            className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
            onClick={handleSave}
            type="button"
          >
            Save Contact
          </button>
        </div>
      </section>
    </div>
  );
}

// Utility: given a name, search a contact list for a match in a given category.
export function findContactByName(
  contacts: { id: string; name: string; category: string }[],
  name: string,
  categoryHint?: string,
) {
  const normalized = name.trim().toLowerCase();
  if (!normalized || normalized === "self") return null;
  const hint = categoryHint?.trim().toLowerCase();
  return (
    contacts.find((c) => c.name.trim().toLowerCase() === normalized && (!hint || c.category.toLowerCase() === hint)) ??
    contacts.find((c) => c.name.trim().toLowerCase() === normalized) ??
    null
  );
}
