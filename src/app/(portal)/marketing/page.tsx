"use client";

import { useMemo, useState } from "react";
import { useContactDirectory } from "@/hooks/use-contact-directory";
import { useMarketing } from "@/hooks/use-marketing";
import { useMarketingSettings } from "@/hooks/use-marketing-settings";
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
  "Lunch Drop-off": "🥪",
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

type SortKey = "az" | "za" | "cases_desc" | "cases_asc";

export default function MarketingPage() {
  const { contacts } = useContactDirectory();
  const { activitiesByContact, addActivity, removeActivity, totalActivities } = useMarketing();
  const { settings } = useMarketingSettings();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("az");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);

  // How many cases (patients) we have with each firm — matched on the
  // patient's attorney field. This is the number the office cares about.
  const caseCountByName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of patients) {
      const a = normalizeName(p.attorney || "");
      if (!a || a === "self") continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return counts;
  }, []);

  const attorneys = useMemo(
    () => contacts.filter((c) => c.category === "Attorney"),
    [contacts],
  );

  type Row = {
    contact: ContactRecord;
    activities: MarketingActivity[];
    latest: MarketingActivity | null;
    caseCount: number;
  };

  const rows = useMemo<Row[]>(() => {
    const q = normalizeName(search);
    return attorneys
      .map((contact) => ({
        contact,
        activities: activitiesByContact[contact.id] ?? [],
        latest: latestActivity(activitiesByContact[contact.id] ?? []),
        caseCount: caseCountByName.get(normalizeName(contact.name)) ?? 0,
      }))
      .filter((r) => !q || normalizeName(r.contact.name).includes(q))
      .sort((a, b) => {
        const byName = a.contact.name.localeCompare(b.contact.name);
        switch (sortKey) {
          case "za":
            return -byName;
          case "cases_desc":
            return b.caseCount - a.caseCount || byName;
          case "cases_asc":
            return a.caseCount - b.caseCount || byName;
          case "az":
          default:
            return byName;
        }
      });
  }, [attorneys, activitiesByContact, caseCountByName, search, sortKey]);

  const totalCases = useMemo(
    () => rows.reduce((sum, r) => sum + r.caseCount, 0),
    [rows],
  );

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
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Attorneys" value={String(attorneys.length)} />
        <SummaryTile label="Total cases" value={String(totalCases)} accent="blue" />
        <SummaryTile
          label="Activities this month"
          value={String(activitiesThisMonth)}
          accent="emerald"
        />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search attorneys / firms…"
          value={search}
        />
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
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      {row.caseCount} case{row.caseCount === 1 ? "" : "s"}
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
                          {emojiFor(row.latest.type)} {row.latest.type}
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
                    onClick={() => setLoggingId(isLogging ? null : row.contact.id)}
                    type="button"
                  >
                    {isLogging ? "Cancel" : "+ Log Activity"}
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

              {isExpanded && row.activities.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-[var(--line-soft)] pt-3">
                  {sortActivitiesDesc(row.activities).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start justify-between gap-3 rounded-lg bg-[var(--bg-soft)] px-3 py-2"
                    >
                      <div className="min-w-0 text-sm">
                        <span className="font-semibold">
                          {emojiFor(a.type)} {a.type}
                        </span>
                        <span className="ml-2 text-xs text-[var(--text-muted)]">{a.date}</span>
                        {a.repName && (
                          <span className="ml-2 text-xs text-[var(--text-muted)]">
                            by {a.repName}
                          </span>
                        )}
                        {a.notes && <p className="mt-0.5 text-[var(--text-muted)]">{a.notes}</p>}
                      </div>
                      <button
                        className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete this activity — ${a.type} on ${a.date}? This cannot be undone.`,
                            )
                          ) {
                            removeActivity(row.contact.id, a.id);
                          }
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

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
  onSave,
  onCancel,
}: {
  visitTypes: string[];
  onSave: (input: { date: string; type: string; repName?: string; notes?: string }) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(getTodayUsDate());
  const [type, setType] = useState(visitTypes[0] ?? "Visit");
  const [repName, setRepName] = useState("");
  const [notes, setNotes] = useState("");

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
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Type of visit</span>
        <select
          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
          onChange={(e) => setType(e.target.value)}
          value={type}
        >
          {visitTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-xs font-semibold text-[var(--text-muted)]">Who went (optional)</span>
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
          disabled={!date.trim()}
          onClick={() => onSave({ date, type, repName, notes })}
          type="button"
        >
          Save Activity
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
