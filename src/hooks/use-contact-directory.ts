"use client";

import { useCallback, useState } from "react";
import {
  createContactId,
  getDefaultContactDirectory,
  loadContactDirectory,
  saveContactDirectory,
} from "@/lib/contact-directory";
import { sanitizeContactCategory } from "@/lib/contact-categories";
import type { ContactRecord } from "@/lib/mock-data";
import { formatUsPhoneInput } from "@/lib/phone-format";

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

function normalizeCategory(category: string) {
  return sanitizeContactCategory(category);
}

export function useContactDirectory() {
  const [contacts, setContacts] = useState<ContactRecord[]>(() => loadContactDirectory());

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
      saveContactDirectory(updated);
      setContacts(updated);

      return {
        added: true,
        contact: next,
      };
    },
    [],
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
      saveContactDirectory(updated);
      setContacts(updated);

      return {
        updated: true,
        contact: updatedContact,
      };
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaultContactDirectory();
    setContacts(defaults);
    saveContactDirectory(defaults);
  }, []);

  return {
    contacts,
    addContact,
    updateContact,
    resetToDefaults,
  };
}
