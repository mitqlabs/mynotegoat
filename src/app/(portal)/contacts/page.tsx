"use client";

import { ensureDeleteAllowed } from "@/lib/delete-guard";
import { logActivity } from "@/lib/activity-log";
import { useWorkspaceAccess } from "@/lib/workspace-access-context";
import { isAdminTier } from "@/lib/admin-access";
import { useMemo, useState } from "react";
import { useContactCategories } from "@/hooks/use-contact-categories";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import type { ContactEmail, ContactRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { ConsolidateAttorneysModal } from "@/components/consolidate-attorneys-modal";
import { AddressFieldGroup } from "@/components/address-field-group";
import { ScrollLock } from "@/components/scroll-lock";
import {
  CONTACT_SORT_STORAGE_KEY,
  initialsFor,
  nextContactSort,
  parseContactSort,
  pastelFor,
  sortContacts,
  type ContactSort,
  type ContactSortKey,
} from "@/lib/contact-sort";

const COLS =
  "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_10.5rem_minmax(0,1.9fr)]";

function PhoneIcon() {
  return (
    <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#9aa5b1]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#9aa5b1]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="m3 7 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SortHeader({ label, k, sort, onSort }: { label: string; k: ContactSortKey; sort: ContactSort; onSort: (k: ContactSortKey) => void }) {
  const active = sort.key === k;
  return (
    <button
      className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-[var(--brand-primary)] ${active ? "text-[var(--brand-primary)]" : ""}`}
      onClick={() => onSort(k)}
      title={`Sort by ${label.toLowerCase()}`}
      type="button"
    >
      {label}
      <span aria-hidden className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
        {active && sort.dir === "desc" ? "▼" : "▲"}
      </span>
    </button>
  );
}

type ContactFormState = {
  name: string;
  category: ContactRecord["category"];
  subCategory: string;
  phone: string;
  fax: string;
  emails: ContactEmail[];
  address: string;
};

/** Emails for a form: existing labeled list, else the legacy single email,
 *  else one blank row to type into. */
function toFormEmails(contact?: ContactRecord): ContactEmail[] {
  if (contact?.emails?.length) return contact.emails.map((e) => ({ ...e }));
  if (contact?.email) return [{ name: "", label: "", email: contact.email }];
  return [{ name: "", label: "", email: "" }];
}

function createBlankContactForm(
  defaultCategory: ContactRecord["category"] = "Attorney",
): ContactFormState {
  return {
    name: "",
    category: defaultCategory,
    subCategory: "",
    phone: "",
    fax: "",
    emails: toFormEmails(),
    address: "",
  };
}

function toContactForm(contact: ContactRecord): ContactFormState {
  return {
    name: contact.name,
    category: contact.category,
    subCategory: contact.subCategory ?? "",
    phone: contact.phone,
    fax: contact.fax ?? "",
    emails: toFormEmails(contact),
    address: contact.address ?? "",
  };
}

/** Display rows for a saved contact (labeled list, or legacy single email). */
function toDisplayEmails(contact: ContactRecord): ContactEmail[] {
  if (contact.emails?.length) return contact.emails;
  if (contact.email) return [{ name: "", label: "", email: contact.email }];
  return [];
}

/** Repeatable labeled-email editor used by both the add and edit forms. */
function EmailFieldList({
  emails,
  onChange,
}: {
  emails: ContactEmail[];
  onChange: (next: ContactEmail[]) => void;
}) {
  const blank: ContactEmail = { name: "", label: "", email: "" };
  const rows = emails.length ? emails : [blank];
  const update = (index: number, patch: Partial<ContactEmail>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length ? next : [blank]);
  };
  return (
    <div className="grid gap-2">
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,6rem)_minmax(0,6rem)_minmax(0,1fr)_auto] gap-2"
        >
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(event) => update(i, { name: event.target.value })}
            placeholder="Name"
            value={row.name}
          />
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(event) => update(i, { label: event.target.value })}
            placeholder="Label"
            value={row.label}
          />
          <input
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            inputMode="email"
            onChange={(event) => update(i, { email: event.target.value })}
            placeholder="Email Address"
            type="email"
            value={row.email}
          />
          <button
            aria-label="Remove email"
            className="rounded-lg border border-[var(--line-soft)] px-2.5 text-sm text-[var(--text-muted)] transition hover:border-red-200 hover:text-red-600"
            onClick={() => remove(i)}
            type="button"
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="justify-self-start rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold text-[var(--brand-primary)] transition-all active:scale-[0.97]"
        onClick={() => onChange([...rows, blank])}
        type="button"
      >
        + Add email
      </button>
    </div>
  );
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export default function ContactsPage() {
  const { categories, subCategories } = useContactCategories();
  const { contacts, addContact, updateContact, removeContact } = useContactDirectory();
  // Everyone can add a contact. Editing an existing one is for managers and
  // admins; deleting is set per role in Settings → Admin Access.
  const { roleTier, deleteRule } = useWorkspaceAccess();
  const canEditContacts = isAdminTier(roleTier) || roleTier === "manager";
  const canDeleteContacts = deleteRule("contacts") !== "never";
  // Clicking a name opens the contact (edit form, with Delete inside).
  const canOpenContact = canEditContacts || canDeleteContacts;
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedSubCategory, setSelectedSubCategory] = useState("ALL");
  const [contactSearch, setContactSearch] = useState("");
  // Remembered per browser. The portal only mounts on the client, so
  // reading localStorage here can't cause a hydration mismatch.
  const [sort, setSort] = useState<ContactSort>(() =>
    typeof window === "undefined" ? parseContactSort(null) : parseContactSort(window.localStorage.getItem(CONTACT_SORT_STORAGE_KEY)),
  );
  const changeSort = (key: ContactSortKey) => {
    const next = nextContactSort(sort, key);
    setSort(next);
    try {
      window.localStorage.setItem(CONTACT_SORT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  const defaultCategory = useMemo<ContactRecord["category"]>(() => "Attorney", []);

  const [showConsolidateModal, setShowConsolidateModal] = useState(false);
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [addContactError, setAddContactError] = useState("");
  const [addContactForm, setAddContactForm] = useState<ContactFormState>(() =>
    createBlankContactForm(defaultCategory),
  );

  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactError, setEditContactError] = useState("");
  const [editContactForm, setEditContactForm] = useState<ContactFormState>(() =>
    createBlankContactForm(defaultCategory),
  );

  const categoryOptions = useMemo(() => categories, [categories]);
  const resolvedSelectedCategory = useMemo(() => {
    if (selectedCategory === "ALL") {
      return "ALL";
    }
    return categoryOptions.some(
      (entry) => normalizeLookupValue(entry) === normalizeLookupValue(selectedCategory),
    )
      ? selectedCategory
      : "ALL";
  }, [categoryOptions, selectedCategory]);

  // Sub-categories offered for the chosen category: the ones set up in
  // Settings, plus anything already typed onto a contact, so a one-off
  // sub-category still shows up here.
  const subCategoryOptions = useMemo(() => {
    if (resolvedSelectedCategory === "ALL") return [];
    const inUse = contacts
      .filter(
        (contact) =>
          normalizeLookupValue(contact.category) === normalizeLookupValue(resolvedSelectedCategory),
      )
      .map((contact) => (contact.subCategory ?? "").trim())
      .filter(Boolean);
    const configured =
      subCategories[resolvedSelectedCategory as ContactRecord["category"]] ?? [];
    const seen = new Map<string, string>();
    for (const value of [...configured, ...inUse]) {
      const key = normalizeLookupValue(value);
      if (!seen.has(key)) seen.set(key, value);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [contacts, resolvedSelectedCategory, subCategories]);

  const resolvedSelectedSubCategory = useMemo(
    () =>
      subCategoryOptions.some(
        (entry) => normalizeLookupValue(entry) === normalizeLookupValue(selectedSubCategory),
      )
        ? selectedSubCategory
        : "ALL",
    [subCategoryOptions, selectedSubCategory],
  );

  const filteredContacts = useMemo(() => {
    const byCategory =
      resolvedSelectedCategory === "ALL"
        ? contacts
        : contacts.filter(
            (contact) => normalizeLookupValue(contact.category) === normalizeLookupValue(resolvedSelectedCategory),
          );
    const list =
      resolvedSelectedSubCategory === "ALL"
        ? byCategory
        : byCategory.filter(
            (contact) =>
              normalizeLookupValue(contact.subCategory ?? "") ===
              normalizeLookupValue(resolvedSelectedSubCategory),
          );
    const query = normalizeLookupValue(contactSearch);
    const searched = query
      ? list.filter((contact) => {
          const haystack = [
            contact.name,
            contact.category,
            // Sub-category is how a specialist is actually found ("pain
            // management", "orthopedic"), so it belongs in the search.
            contact.subCategory ?? "",
            contact.phone,
            contact.fax ?? "",
            toDisplayEmails(contact)
              .map((e) => `${e.name} ${e.label} ${e.email}`)
              .join(" "),
            contact.address ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : list;
    return sortContacts(searched, sort);
  }, [contacts, resolvedSelectedCategory, resolvedSelectedSubCategory, contactSearch, sort]);

  const startEditing = (contact: ContactRecord) => {
    setEditingContactId(contact.id);
    setEditContactForm(toContactForm(contact));
    setEditContactError("");
  };

  const cancelEditing = () => {
    setEditingContactId(null);
    setEditContactError("");
    setEditContactForm(createBlankContactForm(defaultCategory));
  };

  const saveEditedContact = () => {
    if (!editingContactId) {
      return;
    }

    const result = updateContact(editingContactId, editContactForm);
    if (!result.updated) {
      setEditContactError(result.reason ?? "Could not save contact.");
      return;
    }

    setEditingContactId(null);
    setEditContactError("");
    setEditContactForm(createBlankContactForm(defaultCategory));
  };

  const handleDeleteContact = async (contact: ContactRecord) => {
    const confirmed = window.confirm(
      `Delete contact "${contact.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    if (!(await ensureDeleteAllowed("contacts"))) return;
    const result = removeContact(contact.id);
    if (!result.removed) {
      window.alert(result.reason);
      return;
    }
    if (editingContactId === contact.id) {
      setEditingContactId(null);
      setEditContactError("");
      setEditContactForm(createBlankContactForm(defaultCategory));
    }
    logActivity({
      category: "patients",
      action: "contact.deleted",
      summary: `Deleted contact ${contact.name}`,
    });
  };

  const openAddModal = () => {
    setShowAddContactModal(true);
    setAddContactError("");
    setAddContactForm(createBlankContactForm(defaultCategory));
  };

  const closeAddModal = () => {
    setShowAddContactModal(false);
    setAddContactError("");
    setAddContactForm(createBlankContactForm(defaultCategory));
  };

  const saveNewContact = () => {
    const result = addContact(addContactForm);
    if (!result.added) {
      setAddContactError(result.reason ?? "Could not add contact.");
      return;
    }

    setSelectedCategory(result.contact.category);
    closeAddModal();
  };

  return (
    <div className="space-y-5">
      <section className="panel-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">Contact Directory</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Manage attorneys and referral contacts used across patient workflow.
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Manage category names in Settings → Contact Categories.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Search
              </span>
              <input
                className="w-64 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search name, specialist, category, phone, email…"
                type="text"
                value={contactSearch}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Category
              </span>
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                onChange={(event) => {
                  setSelectedCategory(event.target.value);
                  setSelectedSubCategory("ALL");
                }}
                value={resolvedSelectedCategory}
              >
                <option value="ALL">All Categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            {/* Only worth showing once a category is chosen and that
                category actually has sub-categories to pick between. */}
            {subCategoryOptions.length > 0 && (
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {resolvedSelectedCategory === "Specialist"
                    ? "Specialty"
                    : resolvedSelectedCategory === "Insurance Agent"
                      ? "Insurance Company"
                      : "Sub-category"}
                </span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setSelectedSubCategory(event.target.value)}
                  value={resolvedSelectedSubCategory}
                >
                  <option value="ALL">All</option>
                  {subCategoryOptions.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold text-[var(--text-muted)] transition-all hover:text-[var(--brand-primary)] active:scale-[0.97] active:shadow-inner"
              onClick={() => setShowConsolidateModal(true)}
              title="Find patients with similar attorney names and merge them onto one canonical name"
              type="button"
            >
              Consolidate Attorneys
            </button>

            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={openAddModal}
              type="button"
            >
              Add Contact
            </button>
          </div>
        </div>
      </section>

      {showConsolidateModal && (
        <ConsolidateAttorneysModal
          addContact={addContact}
          onClose={() => setShowConsolidateModal(false)}
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-[var(--line-soft)] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_16px_rgba(16,24,40,0.05)]">
        <div className={`hidden items-center gap-4 border-b border-[var(--line-soft)] px-5 py-2.5 text-[11px] font-semibold text-[#7b8794] md:grid ${COLS}`}>
          <span className="pl-11"><SortHeader k="name" label="Name" onSort={changeSort} sort={sort} /></span>
          <SortHeader k="category" label="Category" onSort={changeSort} sort={sort} />
          <span className="uppercase tracking-wide">Phone</span>
          <span className="uppercase tracking-wide">Email</span>
        </div>
        <div className="flex items-center gap-3 border-b border-[var(--line-soft)] px-5 py-2 text-[11px] font-semibold text-[#7b8794] md:hidden">
          <span className="uppercase tracking-wide">Sort</span>
          <SortHeader k="name" label="Name" onSort={changeSort} sort={sort} />
          <SortHeader k="category" label="Category" onSort={changeSort} sort={sort} />
        </div>

        {filteredContacts.length === 0 && (
          <p className="px-5 py-4 text-sm text-[var(--text-muted)]">
            No contacts found for this category yet.
          </p>
        )}

        <ul>
        {filteredContacts.map((contact, index) => {
          const isEditing = editingContactId === contact.id;
          const emailRows = toDisplayEmails(contact);
          const pill = pastelFor(contact.category);
          const avatar = pastelFor(contact.name);
          const showGroup =
            sort.key === "category" &&
            (index === 0 || filteredContacts[index - 1].category !== contact.category);
          const groupCount = showGroup
            ? filteredContacts.filter((c) => c.category === contact.category).length
            : 0;
          const groupHeader = showGroup ? (
            <li
              className="flex items-center gap-2 border-t border-[var(--line-soft)] bg-[#f8fafc] px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide first:border-t-0"
              data-contact-group
              key={`group-${contact.category}`}
              style={{ color: pill.fg }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: pill.fg }} />
              {contact.category}
              <span className="font-medium text-[#9aa5b1]">{groupCount}</span>
            </li>
          ) : null;

          if (isEditing) {
            return [
              groupHeader,
              <li key={contact.id} className="border-t border-[var(--line-soft)] bg-[#f8fafc] px-5 py-3 first:border-t-0">
                <p className="mb-2 text-sm font-semibold">{contact.name}</p>
                <form className="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-2 py-1" onSubmit={(e) => { e.preventDefault(); if (canEditContacts) saveEditedContact(); }}>
                  <fieldset className="contents" disabled={!canEditContacts}>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setEditContactForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Contact Name"
                    value={editContactForm.name}
                  />
                  <select
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setEditContactForm((current) => ({
                        ...current,
                        category: event.target.value as ContactRecord["category"],
                        // Reset sub-category when top-level switches so stale
                        // sub-labels from another category don't leak over.
                        subCategory: "",
                      }))
                    }
                    value={editContactForm.category}
                  >
                    {categoryOptions.map((category) => (
                      <option key={`edit-contact-category-${category}`} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    list={`edit-subcategory-options-${editContactForm.category.replace(/\s+/g, "-")}`}
                    onChange={(event) =>
                      setEditContactForm((current) => ({
                        ...current,
                        subCategory: event.target.value,
                      }))
                    }
                    placeholder={
                      editContactForm.category === "Specialist"
                        ? "Sub-category (Pain Management, Orthopedic, …)"
                        : editContactForm.category === "Acute Care"
                          ? "Sub-category (Hospital, Emergency Room, Urgent Care)"
                          : editContactForm.category === "Insurance Agent"
                            ? "Insurance company (State Farm, Allstate, Farmers…)"
                            : "Sub-category (optional)"
                    }
                    value={editContactForm.subCategory}
                  />
                  <datalist
                    id={`edit-subcategory-options-${editContactForm.category.replace(/\s+/g, "-")}`}
                  >
                    {(subCategories[editContactForm.category] ?? []).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(event) =>
                      setEditContactForm((current) => ({
                        ...current,
                        phone: formatUsPhoneInput(event.target.value),
                      }))
                    }
                    placeholder="Phone Number"
                    value={editContactForm.phone}
                  />
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    inputMode="numeric"
                    maxLength={12}
                    onChange={(event) =>
                      setEditContactForm((current) => ({
                        ...current,
                        fax: formatUsPhoneInput(event.target.value),
                      }))
                    }
                    placeholder="Fax Number"
                    value={editContactForm.fax}
                  />
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold text-[var(--text-muted)]">
                      Emails (Name · Label · Address)
                    </span>
                    <EmailFieldList
                      emails={editContactForm.emails}
                      onChange={(emails) =>
                        setEditContactForm((current) => ({ ...current, emails }))
                      }
                    />
                  </div>
                  <AddressFieldGroup
                    onChange={(nextAddress) =>
                      setEditContactForm((current) => ({ ...current, address: nextAddress }))
                    }
                    value={editContactForm.address}
                  />

                  {editContactError && (
                    <p className="text-sm font-semibold text-[#b43b34]">{editContactError}</p>
                  )}

                  </fieldset>
                  <div className="flex items-center gap-2 pt-1">
                    {canDeleteContacts && (
                      <button
                        className="rounded-lg px-3 py-1 text-sm font-semibold text-[#b43b34] hover:bg-[rgba(180,59,52,0.10)]"
                        onClick={() => void handleDeleteContact(contact)}
                        type="button"
                      >
                        Delete
                      </button>
                    )}
                    <span className="flex-1" />
                    <button
                      className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                      onClick={cancelEditing}
                      type="button"
                    >
                      {canEditContacts ? "Cancel" : "Close"}
                    </button>
                    {canEditContacts && (
                      <button
                        className="rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-sm font-semibold text-white"
                        type="submit"
                      >
                        Save
                      </button>
                    )}
                  </div>
                </form>
              </li>,
            ];
          }

          return [
            groupHeader,
            <li
              key={contact.id}
              className={`group grid grid-cols-[minmax(0,1fr)] items-start gap-x-4 gap-y-1 border-t border-[#eef1f4] px-5 py-2.5 text-[13px] text-[#334155] transition-colors first:border-t-0 hover:bg-[#f6f9fc] ${COLS}`}
              data-contact-row
            >
              <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ background: avatar.bg, color: avatar.fg }}
                >
                  {initialsFor(contact.name)}
                </span>
                <div className="min-w-0">
                  {canOpenContact ? (
                    <button
                      className="block max-w-full cursor-pointer truncate text-left text-[14px] font-semibold leading-5 text-[#1f2937] decoration-[var(--brand-primary)]/40 underline-offset-2 transition-colors hover:text-[var(--brand-primary)] hover:underline focus-visible:text-[var(--brand-primary)] focus-visible:underline focus-visible:outline-none"
                      data-contact-open
                      onClick={() => startEditing(contact)}
                      title={`Open ${contact.name}`}
                      type="button"
                    >
                      <span className="font-semibold">{contact.name}</span>
                    </button>
                  ) : (
                    <p className="truncate text-[14px] font-semibold leading-5 text-[#1f2937]" title={contact.name}>{contact.name}</p>
                  )}
                  {contact.address && (
                    <p className="truncate text-[11.5px] leading-4 text-[#8a96a3]" title={contact.address}>{contact.address}</p>
                  )}
                </div>
              </div>

              <div className="order-last col-span-1 flex min-w-0 flex-wrap items-center gap-1.5 pl-11 md:order-none md:col-span-1 md:min-h-8 md:pl-0">
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4"
                  style={{ background: pill.bg, color: pill.fg }}
                >
                  {contact.category}
                </span>
                {contact.subCategory ? (
                  <span className="truncate text-[12px] text-[#64748b]">{contact.subCategory}</span>
                ) : null}
              </div>

              <div className="order-last col-span-1 pl-11 tabular-nums md:order-none md:col-span-1 md:flex md:min-h-8 md:flex-col md:justify-center md:pl-0">
                <p className="flex items-center gap-1.5 leading-5">
                  <PhoneIcon />
                  {contact.phone || <span className="text-[#9aa5b1]">—</span>}
                </p>
                {contact.fax && <p className="pl-5 text-[11.5px] leading-4 text-[#8a96a3]">Fax {contact.fax}</p>}
              </div>

              <div className="order-last col-span-1 min-w-0 pl-11 md:order-none md:col-span-1 md:flex md:min-h-8 md:flex-col md:justify-center md:pl-0">
                {emailRows.length === 0 ? (
                  <p className="flex items-center gap-1.5 leading-5 text-[#9aa5b1]"><MailIcon />—</p>
                ) : (
                  emailRows.map((e, i) => (
                    <p key={i} className="flex min-w-0 items-center gap-1.5 leading-5">
                      <MailIcon />
                      <a className="truncate hover:text-[var(--brand-primary)] hover:underline" href={`mailto:${e.email}`} title={e.email}>{e.email}</a>
                      {(e.name || e.label) && (
                        <span className="shrink-0 rounded-full bg-[#f1f5f9] px-1.5 text-[10.5px] font-medium leading-4 text-[#64748b]">
                          {[e.name, e.label].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </p>
                  ))
                )}
              </div>

            </li>,
          ];
        })}
        </ul>
      </section>

      {showAddContactModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8">
          <ScrollLock />
          <form className="panel-card max-h-[85vh] w-full max-w-2xl overflow-auto p-4" onSubmit={(e) => { e.preventDefault(); saveNewContact(); }}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xl font-semibold">Add Contact</h3>
              <button
                className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm"
                onClick={closeAddModal}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Contact Name</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setAddContactForm((current) => ({ ...current, name: event.target.value }))
                  }
                  value={addContactForm.name}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Category</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setAddContactForm((current) => ({
                      ...current,
                      category: event.target.value as ContactRecord["category"],
                      subCategory: "",
                    }))
                  }
                  value={addContactForm.category}
                >
                  {categoryOptions.map((category) => (
                    <option key={`add-contact-category-${category}`} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">
                  {addContactForm.category === "Insurance Agent"
                    ? "Insurance Company"
                    : addContactForm.category === "Specialist"
                      ? "Specialty (optional)"
                      : "Sub-Category (optional)"}
                </span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  list={`add-subcategory-options-${addContactForm.category.replace(/\s+/g, "-")}`}
                  onChange={(event) =>
                    setAddContactForm((current) => ({
                      ...current,
                      subCategory: event.target.value,
                    }))
                  }
                  placeholder={
                    addContactForm.category === "Specialist"
                      ? "Pain Management, Orthopedic, Neurologist…"
                      : addContactForm.category === "Acute Care"
                        ? "Hospital, Emergency Room, Urgent Care"
                        : addContactForm.category === "Insurance Agent"
                          ? "State Farm, Allstate, Farmers…"
                          : "Optional"
                  }
                  value={addContactForm.subCategory}
                />
                <datalist
                  id={`add-subcategory-options-${addContactForm.category.replace(/\s+/g, "-")}`}
                >
                  {(subCategories[addContactForm.category] ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Phone Number</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) =>
                    setAddContactForm((current) => ({
                      ...current,
                      phone: formatUsPhoneInput(event.target.value),
                    }))
                  }
                  value={addContactForm.phone}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Fax Number</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  inputMode="numeric"
                  maxLength={12}
                  onChange={(event) =>
                    setAddContactForm((current) => ({
                      ...current,
                      fax: formatUsPhoneInput(event.target.value),
                    }))
                  }
                  value={addContactForm.fax}
                />
              </label>

              <div className="grid gap-1 md:col-span-2">
                <span className="text-sm font-semibold text-[var(--text-muted)]">
                  Emails (Name · Label · Address)
                </span>
                <EmailFieldList
                  emails={addContactForm.emails}
                  onChange={(emails) =>
                    setAddContactForm((current) => ({ ...current, emails }))
                  }
                />
              </div>

              <div className="md:col-span-2">
                <AddressFieldGroup
                  onChange={(nextAddress) =>
                    setAddContactForm((current) => ({ ...current, address: nextAddress }))
                  }
                  value={addContactForm.address}
                />
              </div>
            </div>

            {addContactError && (
              <p className="mt-3 text-sm font-semibold text-[#b43b34]">{addContactError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
                onClick={closeAddModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
                type="submit"
              >
                Save Contact
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
