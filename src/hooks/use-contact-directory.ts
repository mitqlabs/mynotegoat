"use client";

import { withMainFirst } from "@/lib/contact-email";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createContactId,
  getDefaultContactDirectory,
  loadContactDirectory,
  saveContactDirectory,
  STORAGE_KEY_CONTACT_DIRECTORY,
} from "@/lib/contact-directory";
import { sanitizeContactCategory } from "@/lib/contact-categories";
import type { ContactEmail, ContactRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { onLocalChange } from "@/lib/local-sync";

type ContactDraft = {
  name: string;
  category: ContactRecord["category"];
  subCategory?: string;
  phone: string;
  fax?: string;
  /** Legacy single email (still accepted from older call sites). */
  email?: string;
  /** Labeled emails; takes precedence over `email` when present. */
  emails?: ContactEmail[];
  address?: string;
};

/** Clean a draft's emails (trim, drop blanks, dedupe), falling back to the
 *  legacy single-email field. Returns the list plus the primary address. */
function resolveDraftEmails(draft: ContactDraft): { emails: ContactEmail[]; primary: string } {
  const source =
    draft.emails && draft.emails.length
      ? draft.emails
      : draft.email
        ? [{ name: "", label: "", email: draft.email }]
        : [];
  const emails: ContactEmail[] = [];
  const seen = new Set<string>();
  for (const entry of source) {
    const email = (entry.email ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push({ name: (entry.name ?? "").trim(), label: (entry.label ?? "").trim(), email, ...(entry.main ? { main: true } : {}) });
  }
  const ordered = withMainFirst(emails);
  return { emails: ordered, primary: ordered[0]?.email ?? "" };
}

type AddContactResult =
  | { added: true; contact: ContactRecord }
  | { added: false; reason: string; contact?: ContactRecord };

type UpdateContactResult =
  | { updated: true; contact: ContactRecord }
  | { updated: false; reason: string; contact?: ContactRecord };

type RemoveContactResult =
  | { removed: true; contact: ContactRecord }
  | { removed: false; reason: string };

function normalizeCategory(category: string) {
  return sanitizeContactCategory(category);
}

export function useContactDirectory() {
  const [contacts, setContacts] = useState<ContactRecord[]>(() => loadContactDirectory());
  const selfWriteCountRef = useRef(0);

  // Stay in sync with edits from other hook instances (Contacts page,
  // Marketing page, cross-device realtime). Our own writes bump the
  // counter so we don't redundantly reload right after saving.
  useEffect(() => {
    return onLocalChange(STORAGE_KEY_CONTACT_DIRECTORY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setContacts(loadContactDirectory());
    });
  }, []);

  // Persist + optimistically update local state. saveContactDirectory
  // fires notifyChange; we pre-increment so our own listener skips it.
  const persist = useCallback((updated: ContactRecord[]) => {
    selfWriteCountRef.current++;
    saveContactDirectory(updated);
    setContacts(updated);
  }, []);

  const addContact = useCallback(
    (draft: ContactDraft): AddContactResult => {
      const name = draft.name.trim();
      const category = normalizeCategory(draft.category);
      const subCategory = (draft.subCategory ?? "").trim() || undefined;
      const phone = formatUsPhoneInput(draft.phone);
      const fax = formatUsPhoneInput(draft.fax ?? "");
      const { emails, primary: email } = resolveDraftEmails(draft);
      const address = (draft.address ?? "").trim();

      if (!name || !phone) {
        return {
          added: false,
          reason: "Name and phone are required.",
        };
      }

      // Read current state synchronously
      const current = loadContactDirectory();

      const existing = current.find(
        (entry) =>
          entry.category.toLowerCase() === category.toLowerCase() &&
          entry.name.toLowerCase() === name.toLowerCase(),
      );

      if (existing) {
        return {
          added: false,
          reason: "Contact already exists.",
          contact: existing,
        };
      }

      const next: ContactRecord = {
        id: createContactId(),
        name,
        category,
        ...(subCategory ? { subCategory } : {}),
        phone,
        fax,
        email,
        ...(emails.length ? { emails } : {}),
        address,
      };

      const updated = [...current, next];
      persist(updated);

      return {
        added: true,
        contact: next,
      };
    },
    [persist],
  );

  /**
   * Add many contacts in ONE save (one cloud write, one version-history row).
   * Merge-safe: first pulls the latest cloud list and unions it with this
   * device's list by id, so a contact added elsewhere a moment ago survives.
   * Skips names that already exist in the same category.
   */
  const addContactsBulk = useCallback(
    async (drafts: ContactDraft[]): Promise<{ added: ContactRecord[]; skipped: Array<{ name: string; reason: string }> }> => {
      let current = loadContactDirectory();
      try {
        const { fetchKvValue } = await import("@/lib/kv-cloud");
        const cloud = await fetchKvValue<unknown>(STORAGE_KEY_CONTACT_DIRECTORY);
        if (Array.isArray(cloud)) {
          const { normalizeContactDirectory } = await import("@/lib/contact-directory");
          const remote = normalizeContactDirectory(cloud);
          const ids = new Set(current.map((c) => c.id));
          current = [...current, ...remote.filter((c) => !ids.has(c.id))];
        }
      } catch {
        // Offline: fall back to this device's list (still dual-written below).
      }
      const added: ContactRecord[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];
      const taken = new Set(current.map((c) => `${c.category.toLowerCase()}|${c.name.toLowerCase()}`));
      for (const draft of drafts) {
        const name = draft.name.trim();
        const category = normalizeCategory(draft.category);
        const phone = formatUsPhoneInput(draft.phone);
        if (!name || !phone) {
          skipped.push({ name: name || "(no name)", reason: "Name and phone are required." });
          continue;
        }
        const key = `${category.toLowerCase()}|${name.toLowerCase()}`;
        if (taken.has(key)) {
          skipped.push({ name, reason: "Contact already exists." });
          continue;
        }
        taken.add(key);
        const { emails, primary: email } = resolveDraftEmails(draft);
        const subCategory = (draft.subCategory ?? "").trim() || undefined;
        added.push({
          id: `${createContactId()}-${added.length}`,
          name,
          category,
          ...(subCategory ? { subCategory } : {}),
          phone,
          fax: formatUsPhoneInput(draft.fax ?? ""),
          email,
          ...(emails.length ? { emails } : {}),
          address: (draft.address ?? "").trim(),
        });
      }
      if (added.length) persist([...current, ...added]);
      return { added, skipped };
    },
    [persist],
  );

  /** Remove exactly these ids in one save (undo of a bulk add). */
  const removeContactsByIds = useCallback(
    (ids: string[]): number => {
      const drop = new Set(ids);
      const current = loadContactDirectory();
      const next = current.filter((c) => !drop.has(c.id));
      if (next.length !== current.length) persist(next);
      return current.length - next.length;
    },
    [persist],
  );

  const updateContact = useCallback(
    (id: string, draft: ContactDraft): UpdateContactResult => {
      const name = draft.name.trim();
      const category = normalizeCategory(draft.category);
      const subCategory = (draft.subCategory ?? "").trim() || undefined;
      const phone = formatUsPhoneInput(draft.phone);
      const fax = formatUsPhoneInput(draft.fax ?? "");
      const { emails, primary: email } = resolveDraftEmails(draft);
      const address = (draft.address ?? "").trim();

      if (!name || !phone) {
        return {
          updated: false,
          reason: "Name and phone are required.",
        };
      }

      const current = loadContactDirectory();

      const target = current.find((entry) => entry.id === id);
      if (!target) {
        return {
          updated: false,
          reason: "Contact not found.",
        };
      }

      const duplicate = current.find(
        (entry) =>
          entry.id !== id &&
          entry.category.toLowerCase() === category.toLowerCase() &&
          entry.name.toLowerCase() === name.toLowerCase(),
      );

      if (duplicate) {
        return {
          updated: false,
          reason: "Contact already exists.",
          contact: duplicate,
        };
      }

      const updatedContact: ContactRecord = {
        ...target,
        name,
        category,
        subCategory,
        phone,
        fax,
        email,
        emails: emails.length ? emails : undefined,
        address,
      };

      const updated = current.map((entry) =>
        entry.id === id ? updatedContact : entry,
      );
      persist(updated);

      return {
        updated: true,
        contact: updatedContact,
      };
    },
    [persist],
  );

  const removeContact = useCallback((id: string): RemoveContactResult => {
    const current = loadContactDirectory();
    const target = current.find((entry) => entry.id === id);
    if (!target) {
      return { removed: false, reason: "Contact not found." };
    }
    const updated = current.filter((entry) => entry.id !== id);
    persist(updated);
    return { removed: true, contact: target };
  }, [persist]);

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultContactDirectory();
    persist(defaults);
  }, [persist]);

  return {
    contacts,
    addContact,
    updateContact,
    removeContact,
    addContactsBulk,
    removeContactsByIds,
    resetToDefaults,
  };
}
