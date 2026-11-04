import type { ContactEmail } from "@/lib/mock-data";

/**
 * Exactly one main email, stored first. The starred one wins (first starred if
 * several); with none starred the first email is main. Every place that uses a
 * single contact email reads `contact.email` / `emails[0]`, which is this one.
 */
export function withMainFirst(emails: ContactEmail[]): ContactEmail[] {
  if (!emails.length) return [];
  let idx = emails.findIndex((e) => e.main);
  if (idx < 0) idx = 0;
  const main = { ...emails[idx], main: true };
  const rest = emails.filter((_, i) => i !== idx).map(({ main: _m, ...e }) => e);
  return [main, ...rest];
}

/** The contact's main email address ("" if none). */
export function mainEmailOf(contact: { email?: string; emails?: ContactEmail[] }): string {
  return contact.emails?.length ? withMainFirst(contact.emails)[0].email : (contact.email ?? "");
}

/** Email choices for a contact, starred (main) first, deduped, blanks dropped. */
export function emailOptionsOf(contact: { email?: string; emails?: ContactEmail[] } | null | undefined): ContactEmail[] {
  if (!contact) return [];
  const list = contact.emails?.length
    ? withMainFirst(contact.emails)
    : contact.email
      ? [{ name: "", label: "", email: contact.email, main: true }]
      : [];
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = e.email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Dropdown text for one email: "jason@x.com (Jason · Paralegal)". */
export function emailOptionLabel(e: ContactEmail): string {
  const who = [e.name, e.label].map((s) => s?.trim()).filter(Boolean).join(" · ");
  return who ? `${e.email} (${who})` : e.email;
}

/** mailto: link that opens the default mail app (e.g. Outlook) to this address. */
export function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}`;
}
