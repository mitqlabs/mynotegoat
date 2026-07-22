"use client";

import { useMemo, useState } from "react";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useMarketing } from "@/hooks/use-marketing";
import { useMarketingSettings } from "@/hooks/use-marketing-settings";
import { useCaseStatuses } from "@/hooks/use-case-statuses";
import { resolveCaseBucket } from "@/lib/marketing-settings";
import {
  latestActivity,
  sortActivitiesDesc,
  type MarketingActivity,
} from "@/lib/marketing";
import { UsDateInput, usDateToIso } from "@/components/us-date-input";
import { patients } from "@/lib/mock-data";
import type { ContactRecord } from "@/lib/mock-data";

function getTodayUsDate(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const y = String(now.getFullYear());
  return `${m}/${d}/${y}`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Light emoji hints for the common default types; anything custom falls
// back to a neutral dot.
const TYPE_EMOJI: Record<string, string> = {
  Visit: "🚗",
  "Lunch Drop-off": "🍽️",
  Call: "📞",
  Email: "✉️",
  Gift: "🎁",
  Meeting: "🤝",
  Event: "🎉",
  Other: "•",
};

function emojiFor(type: string): string {
  return TYPE_EMOJI[type] ?? "•";
}

/** "🚗 Visit, ✉️ Email" for one or more contact types. */
function typesLabel(types: string[]): string {
  if (!types.length) return "Contact";
  return types.map((t) => `${emojiFor(t)} ${t}`).join(", ");
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sortable ISO key from a US date; empty/invalid sort last. */
function isoKey(usDate: string): string {
  return usDateToIso(usDate) || "0000-00-00";
}

/** "July 2026" from a US date, for timeline month dividers. */
function monthLabel(usDate: string): string {
  const m = isoKey(usDate).match(/^(\d{4})-(\d{2})/);
  if (!m || m[1] === "0000") return "Undated";
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

type SortKey = "az" | "za" | "cases_desc" | "cases_asc";

export default function MarketingPage() {
  const { contacts } = useContactDirectory();
  const { activitiesByContact, addActivity, updateActivity, removeActivity, totalActivities } =
    useMarketing();
  const { settings } = useMarketingSettings();
  const { caseStatuses } = useCaseStatuses();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("az");
  const [view, setView] = useState<"list" | "timeline">("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  // The activity currently being edited (from a firm's history).
  const [editing, setEditing] = useState<{ contactId: string; activity: MarketingActivity } | null>(
    null,
  );

  // Cases per firm, matched on the patient's attorney field, split into
  // Active vs Total using each case status's marketing bucket (set in
  // Settings → Admin → Marketing). active = live case (counts in both);
  // total = active + completed (e.g. Paid); none (e.g. Dropped) excluded.
  const casesByName = useMemo(() => {
    const counts = new Map<string, { active: number; total: number }>();
    for (const p of patients) {
      const a = normalizeName(p.attorney || "");
      if (!a || a === "self") continue;
      const bucket = resolveCaseBucket(p.caseStatus || "", settings, caseStatuses);
      if (bucket === "none") continue;
      const rec = counts.get(a) ?? { active: 0, total: 0 };
      if (bucket === "active") rec.active += 1;
      rec.total += 1;
      counts.set(a, rec);
    }
    return counts;
  }, [settings, caseStatuses]);

  const attorneys = useMemo(
    () => contacts.filter((c) => c.category === "Attorney"),
    [contacts],
  );

  type Row = {
    contact: ContactRecord;
    activities: MarketingActivity[];
    latest: MarketingActivity | null;
    activeCases: number;
    totalCases: number;
  };

  const rows = useMemo<Row[]>(() => {
    const q = normalizeName(search);
    return attorneys
      .map((contact) => {
        const counts = casesByName.get(normalizeName(contact.name)) ?? { active: 0, total: 0 };
        return {
          contact,
          activities: activitiesByContact[contact.id] ?? [],
          latest: latestActivity(activitiesByContact[contact.id] ?? []),
          activeCases: counts.active,
          totalCases: counts.total,
        };
      })
      .filter((r) => {
        if (!q) return true;
        if (normalizeName(r.contact.name).includes(q)) return true;
        // Also match who went and the notes on any logged activity.
        return r.activities.some(
          (a) =>
            normalizeName(a.repName ?? "").includes(q) ||
            normalizeName(a.notes ?? "").includes(q),
        );
      })
      .sort((a, b) => {
        const byName = a.contact.name.localeCompare(b.contact.name);
        switch (sortKey) {
          case "za":
            return -byName;
          case "cases_desc":
            return b.totalCases - a.totalCases || byName;
          case "cases_asc":
            return a.totalCases - b.totalCases || byName;
          case "az":
          default:
            return byName;
        }
      });
  }, [attorneys, activitiesByContact, casesByName, search, sortKey]);

  const totalActiveCases = useMemo(() => rows.reduce((s, r) => s + r.activeCases, 0), [rows]);
  const totalCases = useMemo(() => rows.reduce((s, r) => s + r.totalCases, 0), [rows]);

  const activitiesThisMonth = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let count = 0;
    for (const list of Object.values(activitiesByContact)) {
      for (const a of list) {
        if (usDateToIso(a.date).startsWith(ym)) count += 1;
      }
    }
    return count;
  }, [activitiesByContact]);

  // Business-wide timeline: every activity across every firm, newest
  // first, filtered by the same search box.
  const timelineItems = useMemo(() => {
    const nameById = new Map(contacts.map((c) => [c.id, c.name]));
    const items: { activity: MarketingActivity; firmName: string }[] = [];
    for (const [contactId, list] of Object.entries(activitiesByContact)) {
      const firmName = nameById.get(contactId) ?? "Unknown firm";
      for (const activity of list) items.push({ activity, firmName });
    }
    const q = normalizeName(search);
    const filtered = q
      ? items.filter(
          ({ activity, firmName }) =>
            normalizeName(firmName).includes(q) ||
            normalizeName(activity.repName ?? "").includes(q) ||
            normalizeName(activity.notes ?? "").includes(q) ||
            activity.types.some((t) => normalizeName(t).includes(q)),
        )
      : items;
    return filtered.sort((a, b) => isoKey(b.activity.date).localeCompare(isoKey(a.activity.date)));
  }, [activitiesByContact, contacts, search]);

  const visitTypes = settings.visitTypes;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Marketing</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Track your outreach to the attorneys you work with — visits, lunches, calls, and more.
          Firms auto-populate from your Attorney contacts.
        </p>
      </header>

      {/* Dashboard tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Attorneys" value={String(attorneys.length)} />
        <SummaryTile label="Active cases" value={String(totalActiveCases)} accent="emerald" />
        <SummaryTile label="Total cases" value={String(totalCases)} accent="blue" />
        <SummaryTile label="Activities this month" value={String(activitiesThisMonth)} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-xl border border-[var(--line-soft)]">
          {(["list", "timeline"] as const).map((v) => (
            <button
              key={v}
              className={`px-3 py-2 text-sm font-semibold transition ${
                view === v
                  ? "bg-[var(--brand-primary)] text-white"
                  : "bg-white text-[var(--text-main)] hover:bg-[var(--bg-soft)]"
              }`}
              onClick={() => setView(v)}
              type="button"
            >
              {v === "list" ? "List" : "Timeline"}
            </button>
          ))}
        </div>
        <input
          className="min-w-[200px] flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          value={search}
        />
        {view === "list" && (
          <select
            className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            value={sortKey}
          >
            <option value="az">Sort: A–Z</option>
            <option value="za">Sort: Z–A</option>
            <option value="cases_desc">Sort: Cases ↑ (most)</option>
            <option value="cases_asc">Sort: Cases ↓ (least)</option>
          </select>
        )}
      </div>

      {attorneys.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--line-soft)] bg-white p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No attorneys yet. Add contacts under the <strong>Attorney</strong> category in{" "}
            <a className="font-semibold text-[var(--brand-primary)] underline" href="/contacts">
              Contacts
            </a>{" "}
            and they&apos;ll show up here automatically.
          </p>
        </div>
      )}

      {view === "list" && (
      <div className="flex flex-col gap-3">
        {rows.map((row) => {
          const isExpanded = expandedId === row.contact.id;
          const isLogging = loggingId === row.contact.id;
          return (
            <section
              key={row.contact.id}
              className="rounded-2xl border border-[var(--line-soft)] bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{row.contact.name}</h3>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {row.activeCases} active
                    </span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      {row.totalCases} total
                    </span>
                  </div>
                  <div className="mt-1 flex flex-col gap-0.5 text-xs">
                    {row.contact.phone && (
                      <a
                        className="w-fit text-[var(--brand-primary)] hover:underline"
                        href={`tel:${row.contact.phone.replace(/[^0-9+]/g, "")}`}
                      >
                        {row.contact.phone}
                      </a>
                    )}
                    {row.contact.address && (
                      <a
                        className="w-fit text-[var(--brand-primary)] hover:underline"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          row.contact.address,
                        )}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {row.contact.address}
                      </a>
                    )}
                  </div>
                  <p className="mt-2 text-sm">
                    {row.latest ? (
                      <>
                        <span className="text-[var(--text-muted)]">Last activity: </span>
                        <span className="font-medium">
                          {typesLabel(row.latest.types)}
                        </span>{" "}
                        <span className="text-[var(--text-muted)]">on {row.latest.date}</span>
                      </>
                    ) : (
                      <span className="text-[var(--text-muted)]">No activity logged yet.</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.activities.length > 0 && (
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-soft)]"
                      onClick={() => setExpandedId(isExpanded ? null : row.contact.id)}
                      type="button"
                    >
                      {isExpanded ? "Hide" : `History (${row.activities.length})`}
                    </button>
                  )}
                  <button
                    className="rounded-lg bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-semibold text-white transition-all active:scale-[0.97]"
                    onClick={() => {
                      setEditing(null);
                      setLoggingId(isLogging ? null : row.contact.id);
                    }}
                    type="button"
                  >
                    {isLogging ? "Cancel" : "+ Activity"}
                  </button>
                </div>
              </div>

              {isLogging && (
                <LogActivityForm
                  visitTypes={visitTypes}
                  onCancel={() => setLoggingId(null)}
                  onSave={(input) => {
                    addActivity(row.contact.id, input);
                    setLoggingId(null);
                    setExpandedId(row.contact.id);
                  }}
                />
              )}

              {editing?.contactId === row.contact.id && (
                <LogActivityForm
                  visitTypes={visitTypes}
                  initial={editing.activity}
                  saveLabel="Save Changes"
                  onCancel={() => setEditing(null)}
                  onSave={(input) => {
                    updateActivity(row.contact.id, editing.activity.id, input);
                    setEditing(null);
                    setExpandedId(row.contact.id);
                  }}
                />
              )}

              {isExpanded && row.activities.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-[var(--line-soft)] pt-3">
                  {sortActivitiesDesc(row.activities).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start justify-between gap-3 rounded-lg bg-[var(--bg-soft)] px-3 py-2"
                    >
                      <div className="min-w-0 text-sm">
                        <span className="font-semibold">
                          {typesLabel(a.types)}
                        </span>
                        <span className="ml-2 text-xs text-[var(--text-muted)]">{a.date}</span>
                        {a.repName && (
                          <span className="ml-2 text-xs text-[var(--text-muted)]">
                            by {a.repName}
                          </span>
                        )}
                        {a.notes && <p className="mt-0.5 text-[var(--text-muted)]">{a.notes}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          className="rounded-md border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-soft)]"
                          onClick={() => {
                            setLoggingId(null);
                            setEditing({ contactId: row.contact.id, activity: a });
                            setExpandedId(row.contact.id);
                          }}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete this activity — ${a.types.join(", ")} on ${a.date}? This cannot be undone.`,
                              )
                            ) {
                              removeActivity(row.contact.id, a.id);
                            }
                          }}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      )}

      {view === "timeline" && (
        <div>
          {timelineItems.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--line-soft)] bg-white p-8 text-center text-sm text-[var(--text-muted)]">
              No activity logged yet. Switch to List and log a marketing touch.
            </p>
          ) : (
            timelineItems.map((item, i) => {
              const isLatest = i === 0;
              const ml = monthLabel(item.activity.date);
              const showDivider = i === 0 || ml !== monthLabel(timelineItems[i - 1].activity.date);
              return (
                <div key={item.activity.id}>
                  {showDivider && (
                    <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] first:mt-0">
                      {ml}
                    </div>
                  )}
                  <div className="grid gap-3" style={{ gridTemplateColumns: "16px 1fr" }}>
                    <div className="relative flex justify-center">
                      <div className="absolute inset-y-0 w-0.5 bg-[var(--line-strong)]" />
                      <span
                        className={`relative z-10 mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                          isLatest
                            ? "border-[var(--brand-primary)] bg-blue-100"
                            : "border-[var(--line-strong)] bg-white"
                        }`}
                      />
                    </div>
                    <div className="pb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)]">{item.activity.date}</span>
                        {isLatest && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            Latest
                          </span>
                        )}
                      </div>
                      <div className="mt-1 rounded-xl border border-[var(--line-soft)] bg-white p-3">
                        <div className="text-sm font-semibold">{item.firmName}</div>
                        <div className="mt-0.5 text-sm">{typesLabel(item.activity.types)}</div>
                        {(item.activity.repName || item.activity.notes) && (
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {[item.activity.repName, item.activity.notes].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {totalActivities > 0 && (
        <p className="text-center text-xs text-[var(--text-muted)]">
          {totalActivities} total {totalActivities === 1 ? "activity" : "activities"} logged.
        </p>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "blue";
}) {
  const valueColor =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "blue"
        ? "text-blue-700"
        : "text-[var(--text-main)]";
  return (
    <div className="rounded-2xl border border-[var(--line-soft)] bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}

function LogActivityForm({
  visitTypes,
  initial,
  saveLabel = "Save Activity",
  onSave,
  onCancel,
}: {
  visitTypes: string[];
  initial?: { date: string; types: string[]; repName?: string; notes?: string };
  saveLabel?: string;
  onSave: (input: { date: string; types: string[]; repName?: string; notes?: string }) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initial?.date ?? getTodayUsDate());
  const [types, setTypes] = useState<string[]>(
    initial?.types ?? (visitTypes[0] ? [visitTypes[0]] : []),
  );
  const toggleType = (t: string) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const [repName, setRepName] = useState(initial?.repName ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <div className="mt-3 grid gap-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3 sm:grid-cols-2">
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Date</span>
        <UsDateInput
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
          onChange={(formatted) => setDate(formatted)}
          value={date}
        />
      </label>
      <div className="grid gap-1 sm:col-span-2">
        <span className="text-xs font-semibold text-[var(--text-muted)]">
          Type of Contact <span className="font-normal">(pick one or more)</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {visitTypes.map((t) => {
            const on = types.includes(t);
            return (
              <button
                key={t}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  on
                    ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.10)] text-[var(--brand-primary)]"
                    : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                }`}
                onClick={() => toggleType(t)}
                type="button"
              >
                {on ? "✓ " : ""}
                {emojiFor(t)} {t}
              </button>
            );
          })}
        </div>
      </div>
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Our Rep (Optional)</span>
        <input
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setRepName(e.target.value)}
          placeholder="e.g. Dr. Rivera"
          value={repName}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Notes (optional)</span>
        <input
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Brought lunch for the whole office"
          value={notes}
        />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button
          className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
          disabled={!date.trim() || types.length === 0}
          onClick={() => onSave({ date, types, repName, notes })}
          type="button"
        >
          {saveLabel}
        </button>
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-main)]"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
