"use client";

import { toUsDateCanonical } from "@/lib/follow-up-queue";

type ImagingSummaryEntry = Record<string, unknown>;

function readStringField(entry: ImagingSummaryEntry, ...keys: string[]): string {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Region labels (set in patient-case-file). These mirror the
// `lateralityEnabledRegions` set used on the patient page so this
// function and the patient-page summary stay in sync without a
// shared module dependency.
const LATERALIZABLE_REGIONS = new Set([
  "shoulder", "elbow", "wrist", "hand",
  "hip", "knee", "ankle", "foot",
]);
const FLEX_EXT_REGIONS = new Set(["cervical", "thoracic", "lumbar"]);

function readRegionsList(entry: ImagingSummaryEntry): string {
  const regions = entry.regions;
  if (!Array.isArray(regions) || regions.length === 0) return "";
  // Pull the laterality + flex/ext maps off the entry so labels like
  // "Knee" become "Knee (L)" / "Knee (R)" / "Knee (BL)" — the user
  // needs to know WHICH knee was imaged when reading the encounter
  // sidebar, not just that some knee was.
  const lateralityByRegion = (entry.lateralityByRegion ?? {}) as Record<string, string>;
  const flexExtRaw = entry.flexExtRegions;
  const flexExtSet = new Set(
    Array.isArray(flexExtRaw) ? flexExtRaw.filter((r): r is string => typeof r === "string") : [],
  );
  return regions
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((region) => {
      const key = region.trim().toLowerCase();
      const lat = LATERALIZABLE_REGIONS.has(key) ? lateralityByRegion[region] : undefined;
      const flexExt = FLEX_EXT_REGIONS.has(key) && flexExtSet.has(region);
      let label = region;
      if (lat) label += ` (${lat})`;
      if (flexExt) label += " (Flex/Ext)";
      return label;
    })
    .join(", ");
}

/**
 * Quick Glance — the case at a glance, shared by the patient page and the
 * Encounters side-rail so the two never drift apart: DOI, IE and billed total, then
 * each X-Ray / MRI / Specialist referral with only its Sent and Completed
 * dates. A missing Completed date means it isn't done. Refused referrals are
 * marked. Everything else (received, reviewed, findings) lives in the
 * patient file.
 */
export function QuickGlance({
  doi,
  ie,
  billed,
  xrayReferrals,
  mriReferrals,
  specialistReferrals,
}: {
  doi: string;
  ie: string;
  billed: number;
  xrayReferrals?: unknown[];
  mriReferrals?: unknown[];
  specialistReferrals?: unknown[];
}) {
  const doiLabel = toUsDateCanonical(doi ?? "");
  const ieLabel = toUsDateCanonical(ie ?? "");
  type Row = { key: string; what: string; sent: string; completed: string; refused: boolean };
  const imagingRows = (entries: unknown[] | undefined, markCt: boolean): Row[] =>
    ((entries ?? []) as ImagingSummaryEntry[]).map((entry, index) => ({
      key: readStringField(entry, "id") || String(index),
      what: [
        markCt && readStringField(entry, "modalityLabel") === "CT" ? "CT" : "",
        readStringField(entry, "center"),
        readRegionsList(entry),
      ]
        .filter(Boolean)
        .join(" · "),
      sent: toUsDateCanonical(readStringField(entry, "sentDate", "sent")),
      completed: toUsDateCanonical(readStringField(entry, "doneDate", "completedDate")),
      refused: entry.patientRefused === true,
    }));
  const groups: Array<[string, Row[]]> = [
    ["XR", imagingRows(xrayReferrals, false)],
    ["MR", imagingRows(mriReferrals, true)],
    [
      "PM",
      ((specialistReferrals ?? []) as ImagingSummaryEntry[]).map((entry, index) => ({
        key: readStringField(entry, "id") || String(index),
        what: readStringField(entry, "specialist", "name"),
        sent: toUsDateCanonical(readStringField(entry, "sentDate", "sent")),
        completed: toUsDateCanonical(readStringField(entry, "completedDate")),
        refused: entry.patientRefused === true,
      })),
    ],
  ];

  const dash = <span className="text-[var(--text-muted)]">—</span>;

  return (
    <article className="panel-card p-3">
      <h3 className="text-sm font-semibold">Quick Glance</h3>
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-[var(--bg-soft)] px-2 py-1.5 text-xs">
        <div>
          <div className="font-semibold text-[var(--text-muted)]">DOI</div>
          <div className="font-semibold tabular-nums">{doiLabel || dash}</div>
        </div>
        <div>
          <div className="font-semibold text-[var(--text-muted)]">IE</div>
          <div className="font-semibold tabular-nums">{ieLabel || dash}</div>
        </div>
        <div>
          <div className="font-semibold text-[var(--text-muted)]">Billed</div>
          <div className="font-semibold tabular-nums">
            {billed > 0 ? billed.toLocaleString("en-US", { style: "currency", currency: "USD" }) : dash}
          </div>
        </div>
      </div>
      <div className="mt-2 grid gap-2 text-xs">
        {groups.map(([label, rows]) => (
          <div key={label} className="grid grid-cols-[1.75rem_1fr] gap-2">
            <span className="pt-0.5 font-semibold text-[var(--text-muted)]">{label}</span>
            <div className="grid gap-1.5">
              {rows.length === 0 ? (
                dash
              ) : (
                rows.map((row) => (
                  <div key={row.key}>
                    <div className="font-semibold">{row.what || <span className="text-[var(--text-muted)]">Referral</span>}</div>
                    <div className="flex flex-wrap gap-x-3 tabular-nums">
                      <span className="whitespace-nowrap">
                        <span className="text-[var(--text-muted)]">Sent </span>
                        {row.sent || dash}
                      </span>
                      <span className="whitespace-nowrap">
                        <span className="text-[var(--text-muted)]">Completed </span>
                        {row.refused ? (
                          <span className="font-semibold text-[#b43b34]">Refused</span>
                        ) : row.completed ? (
                          <span className="font-semibold text-[#047857]">✓ {row.completed}</span>
                        ) : (
                          dash
                        )}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
