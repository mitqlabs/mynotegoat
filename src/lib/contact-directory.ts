import { contacts as defaultContacts, type ContactEmail, type ContactRecord } from "@/lib/mock-data";
import { migrateLegacyCategory } from "@/lib/contact-categories";
import { formatUsPhoneInput } from "@/lib/phone-format";
import { notifyChange } from "@/lib/local-sync";

const STORAGE_KEY = "casemate.contact-directory.v1";
export const STORAGE_KEY_CONTACT_DIRECTORY = STORAGE_KEY;

function normalizeText(value: unknown, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function normalizeEmails(value: unknown, legacyEmail: string): ContactEmail[] {
  const out: ContactEmail[] = [];
  const seen = new Set<string>();
  const push = (label: string, email: string) => {
    const em = email.trim();
    if (!em) return;
    const key = em.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: label.trim(), email: em });
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") push("", entry);
      else if (entry && typeof entry === "object") {
        push(
          normalizeText((entry as { label?: unknown }).label),
          normalizeText((entry as { email?: unknown }).email),
        );
      }
    }
  }
  // Migrate the legacy single email if the array didn't already include it.
  if (legacyEmail) push("", legacyEmail);
  return out;
}

function normalizeContact(value: unknown): ContactRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Partial<ContactRecord>;
  const id = normalizeText(row.id);
  const name = normalizeText(row.name);
  const phone = formatUsPhoneInput(normalizeText(row.phone));
  const legacyEmail = normalizeText(row.email);
  const emails = normalizeEmails(row.emails, legacyEmail);
  const email = emails[0]?.email ?? legacyEmail;
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
    ...(emails.length ? { emails } : {}),
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
  // Notify other hook instances (e.g. the Marketing page) so a contact
  // add/edit/remove is reflected everywhere without a reload.
  notifyChange(STORAGE_KEY);
}

export function createContactId() {
  return `CT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
