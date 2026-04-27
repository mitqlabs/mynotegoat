/**
 * Helpers for building a vCard 3.0 (`.vcf`) blob from a patient record
 * and triggering the browser to download it. macOS opens `.vcf` files
 * in Contacts.app by default, which prompts the user to add the
 * contact — pre-filled with first name, last name, phone, birthday,
 * and (optionally) email + address. iOS does the same via Files /
 * Safari → Contacts.
 *
 * vCard is the universal exchange format — works on macOS, iOS,
 * Android, Outlook, Google Contacts. No proprietary URL scheme
 * required, no native code, no permissions.
 */

export interface VCardInput {
  firstName: string;
  lastName: string;
  /** US phone string in any format — digits will be extracted. */
  phone?: string;
  email?: string;
  /** ISO YYYY-MM-DD or US MM/DD/YYYY; emitted as YYYY-MM-DD on the
   *  vCard since that's the spec format. */
  dob?: string;
  /** Single-string address. Emitted on the ADR line in a single
   *  street component since we don't break it apart for storage. */
  address?: string;
  /** Free-form note appended to the vCard — useful for case number
   *  or DOI when the contact is going to a phone for follow-up. */
  note?: string;
  /** ORG line — e.g. office name. Lets the contact appear under a
   *  company in iCloud Contacts. */
  organization?: string;
}

/** Escape characters that have special meaning in vCard text values. */
function escape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Convert MM/DD/YYYY → YYYY-MM-DD; pass-through if already ISO. */
function normalizeBirthday(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const usMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) {
    const [, mm, dd, yyyy] = usMatch;
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return "";
}

export function buildVCard(input: VCardInput): string {
  const firstName = (input.firstName ?? "").trim();
  const lastName = (input.lastName ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  const lines: string[] = [];
  lines.push("BEGIN:VCARD");
  lines.push("VERSION:3.0");
  // N (structured name): Last;First;Middle;Prefix;Suffix
  lines.push(`N:${escape(lastName)};${escape(firstName)};;;`);
  // FN (display name)
  lines.push(`FN:${escape(fullName || lastName || firstName)}`);
  if (input.organization?.trim()) {
    lines.push(`ORG:${escape(input.organization.trim())}`);
  }
  if (input.phone?.trim()) {
    const digits = input.phone.replace(/\D/g, "");
    if (digits) {
      // TYPE=CELL labels it as the patient's mobile in Contacts.app.
      // VOICE keeps it dialable on platforms that don't recognize CELL.
      lines.push(`TEL;TYPE=CELL,VOICE:${digits.length === 10 ? `+1${digits}` : `+${digits}`}`);
    }
  }
  if (input.email?.trim()) {
    lines.push(`EMAIL;TYPE=INTERNET:${escape(input.email.trim())}`);
  }
  const bday = input.dob ? normalizeBirthday(input.dob) : "";
  if (bday) {
    lines.push(`BDAY:${bday}`);
  }
  if (input.address?.trim()) {
    // ADR: PO Box;Extended;Street;City;Region;Postal;Country
    // We store address as one string, so dump it into Street.
    lines.push(`ADR;TYPE=HOME:;;${escape(input.address.trim())};;;;`);
  }
  if (input.note?.trim()) {
    lines.push(`NOTE:${escape(input.note.trim())}`);
  }
  lines.push("END:VCARD");
  // vCard spec mandates CRLF line endings.
  return lines.join("\r\n");
}

/**
 * Trigger a `.vcf` download in the browser. macOS opens it in
 * Contacts.app; iOS Safari prompts to add to Contacts; other
 * platforms open in their default contact app or save the file.
 *
 * Filename safe-cases the contact name and falls back to "contact".
 */
export function downloadVCard(input: VCardInput, filename?: string): void {
  if (typeof window === "undefined") return;
  const text = buildVCard(input);
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const derived =
    [input.firstName, input.lastName]
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9_-]+/g, "")
      .toLowerCase() || "contact";
  const safeName = filename ?? derived;
  anchor.href = url;
  anchor.download = `${safeName}.vcf`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revocation slightly so Safari has time to start the
  // download before the URL becomes invalid.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
