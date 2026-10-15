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
