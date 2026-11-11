/**
 * Quick Fill on the New Patient popup. Paste or drop an email / LOP / intake
 * and reuse the existing intake parser, then pick up DOB and address.
 * The form applies the result onto the same draft, so the duplicate check
 * (name + date of loss) runs on its own.
 */
import { parseIntakeText, stripReferralNoise, type ParsedIntake } from "@/lib/new-patient-intake";
import { to12hLabel } from "@/lib/time-12h";

export type QuickFillResult = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  dob?: string;
  addressStreet?: string;
  addressUnit?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  dateOfLoss?: string;
  attorney?: string;
  evalDate?: string;
  evalTime?: string;
  ask: string[];
};

const isoToMdy = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "";

function padDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${year}`;
}

export function quickFillFromText(
  raw: string,
  opts: { todayIso: string; attorneys?: string[] },
): QuickFillResult {
  const cleaned = stripReferralNoise(raw);
  const parsed: ParsedIntake = parseIntakeText(cleaned, opts);
  const d = parsed.draft;
  const out: QuickFillResult = { ask: [...parsed.ask] };
  if (d.firstName) out.firstName = d.firstName;
  if (d.lastName) out.lastName = d.lastName;
  if (d.phone) out.phone = d.phone;
  if (d.dateOfInjury) out.dateOfLoss = d.dateOfInjury;
  if (d.attorney) out.attorney = d.attorney;
  if (d.apptDate) out.evalDate = isoToMdy(d.apptDate);
  if (d.apptTime) out.evalTime = to12hLabel(d.apptTime);
  if (!out.evalDate) {
    const visit = /\b(?:first visit|initial(?:\s+(?:exam|eval|evaluation))?|new patient (?:eval|visit))\b[^0-9]{0,24}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?:[^0-9]{0,16}(\d{1,2}(?::\d{2})?\s*(?:am|pm)))?/i.exec(cleaned);
    if (visit) {
      out.evalDate = padDate(visit[1]);
      if (visit[2]) out.evalTime = visit[2].replace(/\s+/g, " ").trim().toUpperCase();
    }
  }

  const dob = /\b(?:dob|d\.o\.b\.|date of birth|born)\b[^0-9]{0,12}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i.exec(cleaned);
  if (dob) out.dob = padDate(dob[1]);

  const street = /\b(\d{1,6}\s+[A-Za-z0-9.'’\- ]{2,40}?\s(?:Blvd|Boulevard|St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court))\b/i.exec(cleaned);
  if (street) out.addressStreet = street[1].replace(/\s+/g, " ").trim();
  const unit = /\b(?:apt|apartment|unit|ste|suite|#)\s*([A-Za-z0-9\-]+)\b/i.exec(cleaned);
  if (unit) out.addressUnit = unit[1];
  const city = /\b([A-Za-z][A-Za-z .'-]{1,30}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/.exec(cleaned);
  if (city) {
    out.addressCity = city[1].trim();
    out.addressState = city[2];
    out.addressZip = city[3];
  }
  return out;
}

/** Readable text from a dropped .eml, .msg, or PDF. */
export async function textFromQuickFillFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return textFromPdf(await file.arrayBuffer());
  if (name.endsWith(".msg")) return textFromMsg(await file.arrayBuffer());
  return file.text();
}

async function textFromPdf(bytes: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/goat/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  const count = Math.min(doc.numPages, 8);
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(text);
    page.cleanup();
  }
  return pages.join("\n");
}

function textFromMsg(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  const utf16 = new TextDecoder("utf-16le", { fatal: false }).decode(u8);
  const latin = new TextDecoder("latin1").decode(u8);
  const chunks = `${utf16}\n${latin}`.match(/[A-Za-z0-9][A-Za-z0-9@.,'’:/() \-]{6,}/g) ?? [];
  return chunks.join("\n");
}
