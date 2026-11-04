/**
 * Patients by Location: groups patients by the city (city + state) or ZIP
 * code in their home address. Pure functions, no storage. Used by the
 * Dashboard (Statistics) card and by G.O.A.T. ("how many patients from
 * Glendale", "top zip codes").
 */
import { parseAddressString } from "@/lib/address-parts";

export type LocationMode = "city" | "zip";

export interface LocationPatient {
  id: string;
  fullName: string;
  caseStatus: string;
  address?: string;
  deleted?: boolean;
}

export interface LocationRow {
  /** Stable group key ("glendale|CA", "91205", or NO_ADDRESS_KEY). */
  key: string;
  /** Display label ("Glendale, CA", "91205 · Glendale", "No address"). */
  label: string;
  city: string;
  state: string;
  zip: string;
  count: number;
  /** Whole-number percent of the total. */
  percent: number;
  patientIds: string[];
}

export interface LocationSummary {
  mode: LocationMode;
  total: number;
  /** Every city / ZIP, count desc, then label A–Z. */
  rows: LocationRow[];
  /** Patients with no city (city mode) or no ZIP (ZIP mode); null when none. */
  noAddress: LocationRow | null;
}

export const NO_ADDRESS_KEY = "__no_address__";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** "  north   HOLLYWOOD " → "North Hollywood". */
export function titleCaseCity(s: string): string {
  return squash(s)
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

export interface PatientPlace {
  city: string;
  state: string;
  zip: string;
}

/** City / state / 5-digit ZIP from a patient's stored address string. */
export function patientPlace(address: string | undefined): PatientPlace {
  const parts = parseAddressString(address ?? "");
  let city = squash(parts.city);
  // A street-only address ("1234 Fake St") parses into the city slot.
  if (/^\d/.test(city) || (!parts.state && !parts.zip && !parts.address1)) city = "";
  const zip = (parts.zip.match(/^\d{5}/) ?? [""])[0];
  return { city: city ? titleCaseCity(city) : "", state: parts.state.toUpperCase(), zip };
}

export function summarizeLocations(
  patients: LocationPatient[],
  mode: LocationMode,
  status: string = "ALL",
): LocationSummary {
  const list = patients.filter((p) => !p.deleted && (status === "ALL" || p.caseStatus === status));
  const groups = new Map<string, LocationRow>();
  const missing: string[] = [];
  // ZIP mode: most common city per ZIP for the "ZIP · City" label.
  const zipCities = new Map<string, Map<string, number>>();
  for (const p of list) {
    const place = patientPlace(p.address);
    const key = mode === "city" ? (place.city ? `${place.city.toLowerCase()}|${place.state}` : "") : place.zip;
    if (!key) {
      missing.push(p.id);
      continue;
    }
    let row = groups.get(key);
    if (!row) {
      row = { key, label: "", city: place.city, state: place.state, zip: mode === "zip" ? place.zip : "", count: 0, percent: 0, patientIds: [] };
      groups.set(key, row);
    }
    row.count += 1;
    row.patientIds.push(p.id);
    if (mode === "zip" && place.city) {
      const m = zipCities.get(key) ?? new Map<string, number>();
      m.set(place.city, (m.get(place.city) ?? 0) + 1);
      zipCities.set(key, m);
    }
  }
  const total = list.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const rows = [...groups.values()].map((r) => {
    if (mode === "zip") {
      const best = [...(zipCities.get(r.key) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      r.city = best?.[0] ?? "";
      r.label = r.city ? `${r.zip} · ${r.city}` : r.zip;
    } else {
      r.label = r.state ? `${r.city}, ${r.state}` : r.city;
    }
    r.percent = pct(r.count);
    return r;
  });
  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const noAddress = missing.length
    ? { key: NO_ADDRESS_KEY, label: "No address", city: "", state: "", zip: "", count: missing.length, percent: pct(missing.length), patientIds: missing }
    : null;
  return { mode, total, rows, noAddress };
}

// ---------------------------------------------------------------- G.O.A.T.

export type LocationQuestion =
  | { kind: "top"; mode: LocationMode }
  | { kind: "place"; query: string; mode: LocationMode };

const TOP = /\b(top|most|biggest|main|which|what|breakdown|by)\b.*\b(zip\s*codes?|zips?|cit(?:y|ies)|towns?|areas?|locations?)\b|\b(zip\s*codes?|zips?|cit(?:y|ies)|locations?)\b.*\b(most|top|breakdown)\b|\bpatients?\s+by\s+(city|zip|location)\b/i;
const PLACE = /\b(?:how\s+many|number\s+of|count|list|which|who|show)\b.*?\b(?:patients?|pts?|people|cases?)\b.*?\b(?:from|in|live\s+in|living\s+in|located\s+in)\s+([a-z][a-z .'-]*?|\d{5})\s*\??$/i;

export function parseLocationQuestion(question: string): LocationQuestion | null {
  const q = squash(question);
  const place = PLACE.exec(q);
  if (place) {
    const query = place[1].replace(/\b(the|city|of|zip|code)\b/gi, "").trim();
    if (query && !/^(total|all|this|that|today|tomorrow|week|month|year|it)$/i.test(query) && !/\b(this|last|next)\s+(week|month|year)\b/i.test(query)) {
      return { kind: "place", query, mode: /^\d{5}$/.test(query) ? "zip" : "city" };
    }
  }
  if (TOP.test(q) && /\b(patients?|pts?|zip|cit(?:y|ies)|live|from)\b/i.test(q) && !/\b(appointments?|appts?|attorneys?|lawyers?|referr)/i.test(q)) {
    return { kind: "top", mode: /\bzip/i.test(q) ? "zip" : "city" };
  }
  return null;
}

export interface LocationAnswer {
  text: string;
  links?: { label: string; href: string }[];
}

export function answerLocationQuestion(lq: LocationQuestion, patients: LocationPatient[]): LocationAnswer {
  const link = [{ label: "Patients by Location", href: "/dashboard#patients-by-location" }];
  const sum = summarizeLocations(patients, lq.mode);
  if (lq.kind === "top") {
    if (!sum.rows.length) return { text: "No patients have a city or ZIP code on file yet.", links: link };
    const top = sum.rows.slice(0, 10).map((r, i) => `${i + 1}. ${r.label}: ${r.count} (${r.percent}%)`);
    const tail = sum.noAddress ? `\nNo address: ${sum.noAddress.count}.` : "";
    return { text: `Top ${lq.mode === "zip" ? "ZIP codes" : "cities"} (${sum.total} patients):\n${top.join("\n")}${tail}`, links: link };
  }
  const needle = lq.query.toLowerCase();
  const hits = sum.rows.filter((r) => (lq.mode === "zip" ? r.zip === needle : r.city.toLowerCase() === needle));
  const count = hits.reduce((n, r) => n + r.count, 0);
  const name = lq.mode === "zip" ? `ZIP ${lq.query}` : titleCaseCity(lq.query);
  const byId = new Map(patients.map((p) => [p.id, p]));
  const active = hits.flatMap((r) => r.patientIds).filter((id) => byId.get(id)?.caseStatus === "Active").length;
  if (!count) return { text: `No patients have an address in ${name}.`, links: link };
  return {
    text: `${count} patient${count === 1 ? "" : "s"} ${count === 1 ? "lives" : "live"} in ${name} (${active} active).`,
    links: link,
  };
}
