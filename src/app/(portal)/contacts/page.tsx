"use client";

import { useMemo, useState } from "react";
import { useContactCategories } from "@/hooks/use-contact-categories";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import type { ContactRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { ConsolidateAttorneysModal } from "@/components/consolidate-attorneys-modal";
import { AddressFieldGroup } from "@/components/address-field-group";
import { ScrollLock } from "@/components/scroll-lock";

type ContactFormState = {
  name: string;
  category: ContactRecord["category"];
  subCategory: string;
  phone: string;
  fax: string;
  email: string;
  address: string;
};

function createBlankContactForm(
  defaultCategory: ContactRecord["category"] = "Attorney",
): ContactFormState {
  return {
    name: "",
    category: defaultCategory,
    subCategory: "",
    phone: "",
    fax: "",
    email: "",
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
    email: contact.email ?? "",
    address: contact.address ?? "",
  };
}

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export default function ContactsPage() {
  const { categories, subCategories } = useContactCategories();
  const { contacts, addContact, updateContact, removeContact } = useContactDirectory();
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [contactSearch, setContactSearch] = useState("");
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

  const filteredContacts = useMemo(() => {
    const list =
      resolvedSelectedCategory === "ALL"
        ? contacts
        : contacts.filter(
            (contact) => normalizeLookupValue(contact.category) === normalizeLookupValue(resolvedSelectedCategory),
          );
    const query = normalizeLookupValue(contactSearch);
    const searched = query
      ? list.filter((contact) => {
          const haystack = [
            contact.name,
            contact.category,
            contact.phone,
            contact.fax ?? "",
            contact.email ?? "",
            contact.address ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : list;
    return [...searched].sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, resolvedSelectedCategory, contactSearch]);

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

  const handleDeleteContact = (contact: ContactRecord) => {
    const confirmed = window.confirm(
      `Delete contact "${contact.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
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
                placeholder="Search name, phone, email..."
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
                onChange={(event) => setSelectedCategory(event.target.value)}
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

      <section className="grid gap-3 md:grid-cols-2">
        {filteredContacts.length === 0 && (
          <article className="panel-card p-4 md:col-span-2">
            <p className="text-sm text-[var(--text-muted)]">
              No contacts found for this category yet.
            </p>
          </article>
        )}

        {filteredContacts.map((contact) => {
          const isEditing = editingContactId === contact.id;

          return (
            <article key={contact.id} className="panel-card p-4 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-lg font-semibold">{contact.name}</h4>
                {!isEditing && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                      onClick={() => startEditing(contact)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-lg border border-[#b43b34] px-3 py-1 text-sm font-semibold text-[#b43b34] hover:bg-[#b43b34] hover:text-white"
                      onClick={() => handleDeleteContact(contact)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {!isEditing ? (
                <>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">Category:</span> {contact.category}
                    {contact.subCategory ? (
                      <span className="ml-2 inline-block rounded-full border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-0.5 text-xs font-semibold">
                        {contact.subCategory}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">Phone:</span> {contact.phone}
                  </p>
                  {contact.fax && (
                    <p className="text-sm">
                      <span className="font-semibold">Fax:</span> {contact.fax}
                    </p>
                  )}
                  <p className="text-sm">
                    <span className="font-semibold">Email:</span> {contact.email || "-"}
                  </p>
                  {contact.address && (
                    <p className="text-sm">
                      <span className="font-semibold">Address:</span> {contact.address}
                    </p>
                  )}
                </>
              ) : (
                <form className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2" onSubmit={(e) => { e.preventDefault(); saveEditedContact(); }}>
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
                  <input
                    className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                    onChange={(event) =>
                      setEditContactForm((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="Email Address"
                    value={editContactForm.email}
                  />
                  <AddressFieldGroup
                    onChange={(nextAddress) =>
                      setEditContactForm((current) => ({ ...current, address: nextAddress }))
                    }
                    value={editContactForm.address}
                  />

                  {editContactError && (
                    <p className="text-sm font-semibold text-[#b43b34]">{editContactError}</p>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-lg border border-[var(--line-soft)] px-3 py-1 text-sm font-semibold"
                      onClick={cancelEditing}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-lg bg-[var(--brand-primary)] px-3 py-1 text-sm font-semibold text-white"
                      type="submit"
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })}
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
                  Sub-Category (optional)
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

              <label className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Email Address</span>
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) =>
                    setAddContactForm((current) => ({ ...current, email: event.target.value }))
                  }
                  value={addContactForm.email}
                />
              </label>

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
