import { contacts as defaultContacts, type ContactRecord } from "@/lib/mock-data";
import { migrateLegacyCategory } from "@/lib/contact-categories";
import { formatUsPhoneInput } from "@/lib/phone-format";

const STORAGE_KEY = "casemate.contact-directory.v1";

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function normalizeContact(value: unknown): ContactRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Partial<ContactRecord>;
  const id = normalizeText(row.id);
  const name = normalizeText(row.name);
  const phone = formatUsPhoneInput(normalizeText(row.phone));
  const email = normalizeText(row.email);
  const fax = formatUsPhoneInput(normalizeText(row.fax));
  const address = normalizeText(row.address);

  // Resolve top-level category + sub-category from whatever the saved row
  // has. Legacy rows have a single free-form `category` string like
  // "Pain Management" — those get mapped to
  // { category: "Specialist", subCategory: "Pain Management" }.
  const rawCategory = normalizeText(row.category);
  const migrated = migrateLegacyCategory(rawCategory);
  const savedSub = normalizeText(row.subCategory);
  const subCategory = savedSub || migrated.subCategory || undefined;

  if (!id || !name || !phone) {
    return null;
  }

  return {
    id,
    name,
    category: migrated.category,
    ...(subCategory ? { subCategory } : {}),
    phone,
    email,
    fax,
    address,
  };
}

export function getDefaultContactDirectory() {
  return defaultContacts.map((contact) => ({ ...contact }));
}

export function normalizeContactDirectory(value: unknown) {
  if (!Array.isArray(value)) {
    return getDefaultContactDirectory();
  }

  return value
    .map((entry) => normalizeContact(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export function loadContactDirectory() {
  if (typeof window === "undefined") {
    return getDefaultContactDirectory();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultContactDirectory();
    }
    return normalizeContactDirectory(JSON.parse(raw));
  } catch {
    return getDefaultContactDirectory();
  }
}

export function saveContactDirectory(contacts: ContactRecord[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "contacts", contacts));
}

export function createContactId() {
  return `CT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
