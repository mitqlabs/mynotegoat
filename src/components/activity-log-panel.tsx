"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_CATEGORIES,
  clearActivity,
  fetchActivity,
  type ActivityEntry,
} from "@/lib/activity-log";

/**
 * Dashboard Activity Log: who did what. Filter by category (e.g. Billing
 * only), time period, person and patient. Admins can clear the log, and old
 * entries auto-delete after the retention period (default 120 days). The
 * "log cleared" entries themselves are never deleted.
 */

const SETTINGS_KEY = "casemate.activity-log-settings.v1";
const DEFAULT_RETENTION_DAYS = 120;
const RETENTION_CHOICES = [30, 60, 90, 120, 180, 365, 0]; // 0 = never
const PERIOD_CHOICES = [
  { days: 1, label: "Today" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 120, label: "Last 120 days" },
  { days: 0, label: "Everything" },
];
const DAY_MS = 86_400_000;

const categoryLabel = (key: string) =>
  ACTIVITY_CATEGORIES.find((c) => c.key === key)?.label ?? (key || "Other");

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActivityLogPanel() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [periodDays, setPeriodDays] = useState(7);
  const [person, setPerson] = useState("ALL");
  const [patientQuery, setPatientQuery] = useState("");
  const [retentionDays, setRetentionDays] = useState<number>(DEFAULT_RETENTION_DAYS);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const sinceIso = periodDays > 0 ? new Date(Date.now() - periodDays * DAY_MS).toISOString() : undefined;
    const rows = await fetchActivity({ sinceIso, categories: [...categories], limit: 1000 });
    if (!rows) {
      setLoadError(true);
      setEntries([]);
      return;
    }
    setLoadError(false);
    setEntries(rows);
  }, [periodDays, categories]);

  // Retention: read the setting, then quietly delete anything older.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { fetchKvValue } = await import("@/lib/kv-cloud");
      const saved = await fetchKvValue<{ retentionDays?: number }>(SETTINGS_KEY);
      const days =
        typeof saved?.retentionDays === "number" ? saved.retentionDays : DEFAULT_RETENTION_DAYS;
      if (cancelled) return;
      setRetentionDays(days);
      if (days > 0) {
        await clearActivity({ olderThanIso: new Date(Date.now() - days * DAY_MS).toISOString() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Fetching is async; state is only set after the await resolves.
    void load();
  }, [load]);

  const people = useMemo(
    () => Array.from(new Set((entries ?? []).map((e) => e.actorLabel))).sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    return (entries ?? []).filter(
      (e) =>
        (person === "ALL" || e.actorLabel === person) &&
        (!q || e.patientName.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q)),
    );
  }, [entries, person, patientQuery]);

  const toggleCategory = (key: string) =>
    setCategories((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const saveRetention = async (days: number) => {
    setRetentionDays(days);
    try {
      const { upsertKvValue } = await import("@/lib/kv-cloud");
      await upsertKvValue(SETTINGS_KEY, { retentionDays: days });
      if (days > 0) {
        await clearActivity({ olderThanIso: new Date(Date.now() - days * DAY_MS).toISOString() });
      }
      setNotice(days > 0 ? `Entries now auto-delete after ${days} days.` : "Entries are kept until you clear them.");
    } catch {
      setNotice("Couldn't save the auto-delete setting. Try again.");
    }
    void load();
  };

  const handleClear = async () => {
    setConfirmClear(false);
    const ok = await clearActivity({ recordClear: { summary: "Cleared the activity log" } });
    setNotice(ok ? "Activity log cleared." : "Couldn't clear the log.");
    void load();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            categories.size === 0
              ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
              : "border-[var(--line-soft)] bg-white text-[var(--text-muted)]"
          }`}
          onClick={() => setCategories(new Set())}
          type="button"
        >
          All
        </button>
        {ACTIVITY_CATEGORIES.map((c) => (
          <button
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              categories.has(c.key)
                ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                : "border-[var(--line-soft)] bg-white text-[var(--text-muted)]"
            }`}
            key={c.key}
            onClick={() => toggleCategory(c.key)}
            type="button"
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Period
          <select
            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm font-normal text-[var(--text-primary)]"
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            value={periodDays}
          >
            {PERIOD_CHOICES.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Person
          <select
            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm font-normal text-[var(--text-primary)]"
            onChange={(e) => setPerson(e.target.value)}
            value={person}
          >
            <option value="ALL">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[12rem] flex-1 gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Patient or action
          <input
            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm font-normal text-[var(--text-primary)]"
            onChange={(e) => setPatientQuery(e.target.value)}
            placeholder="Search…"
            value={patientQuery}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          Auto-delete after
          <select
            className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm font-normal text-[var(--text-primary)]"
            onChange={(e) => void saveRetention(Number(e.target.value))}
            value={retentionDays}
          >
            {RETENTION_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? "Never" : `${d} days`}
              </option>
            ))}
          </select>
        </label>
        {confirmClear ? (
          <span className="inline-flex gap-1">
            <button
              className="rounded-lg bg-[#b43b34] px-3 py-1.5 text-sm font-semibold text-white"
              onClick={() => void handleClear()}
              type="button"
            >
              Confirm clear all
            </button>
            <button
              className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 text-sm font-semibold"
              onClick={() => setConfirmClear(false)}
              type="button"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            className="rounded-lg border border-[rgba(201,66,58,0.4)] bg-[rgba(201,66,58,0.08)] px-3 py-1.5 text-sm font-semibold text-[#b43b34]"
            onClick={() => setConfirmClear(true)}
            type="button"
          >
            Clear log
          </button>
        )}
      </div>

      {notice && <p className="text-xs font-semibold text-[var(--brand-primary)]">{notice}</p>}

      {loadError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Couldn&apos;t load the activity log. If this is new, the database step for it may not have been run yet.
        </p>
      )}

      <div className="max-h-[60vh] overflow-auto rounded-xl border border-[var(--line-soft)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-[var(--bg-soft)] text-left">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">When</th>
              <th className="px-3 py-2">Who</th>
              <th className="px-3 py-2">Area</th>
              <th className="px-3 py-2">What</th>
              <th className="px-3 py-2">Patient</th>
            </tr>
          </thead>
          <tbody>
            {entries === null ? (
              <tr>
                <td className="px-3 py-4 text-[var(--text-muted)]" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-[var(--text-muted)]" colSpan={5}>
                  Nothing logged for these filters yet.
                </td>
              </tr>
            ) : (
              visible.map((e) => (
                <tr className="border-t border-[var(--line-soft)] align-top" key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--text-muted)]">{whenLabel(e.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">{e.actorLabel}</td>
                  <td className="whitespace-nowrap px-3 py-2">{categoryLabel(e.category)}</td>
                  <td className="px-3 py-2">
                    {e.summary}
                    {typeof e.details.copy === "string" && e.details.copy && (
                      <div className="mt-1 rounded-md bg-[var(--bg-soft)] px-2 py-1 text-xs text-[var(--text-muted)]">
                        “{e.details.copy}”
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{e.patientName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">
        Showing {visible.length} entr{visible.length === 1 ? "y" : "ies"}. “Cleared the activity log” entries are always kept.
      </p>
    </div>
  );
}
