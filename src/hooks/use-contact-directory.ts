"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createContactId,
  getDefaultContactDirectory,
  loadContactDirectory,
  saveContactDirectory,
  STORAGE_KEY_CONTACT_DIRECTORY,
} from "@/lib/contact-directory";
import { sanitizeContactCategory } from "@/lib/contact-categories";
import type { ContactRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { onLocalChange } from "@/lib/local-sync";

type ContactDraft = {
  name: string;
  category: ContactRecord["category"];
  subCategory?: string;
  phone: string;
  fax?: string;
  email?: string;
  address?: string;
};

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
      const email = (draft.email ?? "").trim();
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

  const updateContact = useCallback(
    (id: string, draft: ContactDraft): UpdateContactResult => {
      const name = draft.name.trim();
      const category = normalizeCategory(draft.category);
      const subCategory = (draft.subCategory ?? "").trim() || undefined;
      const phone = formatUsPhoneInput(draft.phone);
      const fax = formatUsPhoneInput(draft.fax ?? "");
      const email = (draft.email ?? "").trim();
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
    resetToDefaults,
  };
}
