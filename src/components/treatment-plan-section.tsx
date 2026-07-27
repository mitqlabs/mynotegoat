"use client";

import { useEffect, useMemo, useState } from "react";
import { useTreatmentPlans } from "@/hooks/use-treatment-plans";
import { useTreatmentPlanSettings } from "@/hooks/use-treatment-plan-settings";
import { useScheduleSettings } from "@/hooks/use-schedule-settings";
import { useMacroTemplates } from "@/hooks/use-macro-templates";
import { UsDateInput, formatUsDateInput, isoToUsDate } from "@/components/us-date-input";
import type { ScheduleAppointmentRecord } from "@/lib/schedule-appointments";
import type { MacroQuestion } from "@/lib/macro-templates";
import type { WeekdayRegion } from "@/lib/treatment-plans";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getTodayUsDate(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${m}/${d}/${String(now.getFullYear())}`;
}

/** US MM/DD/YYYY → sortable YYYYMMDD number, or null if malformed. */
function usDateToStamp(us: string): number | null {
  const m = us.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return Number(m[3]) * 10000 + Number(m[1]) * 100 + Number(m[2]);
}

type PlanRegion = {
  macroId: string;
  name: string;
  treatments: string[];
  otherQuestions: MacroQuestion[];
};

type Props = {
  patientId: string;
  appointments: ScheduleAppointmentRecord[];
  /** This patient's encounters — used to count completed visits in range. */
  encounters: { encounterDate: string }[];
};

export function TreatmentPlanSection({ patientId, appointments, encounters }: Props) {
  const { getPlansForPatient, addPlan, updatePlan, removePlan, copyDayRegions, setDayRegions } =
    useTreatmentPlans();
  const { settings } = useTreatmentPlanSettings();
  const { scheduleSettings } = useScheduleSettings();
  const { macroLibrary } = useMacroTemplates();

  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [startDraft, setStartDraft] = useState(getTodayUsDate());
  const [endDraft, setEndDraft] = useState("");
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(1); // Monday

  // Only offer the office's open days (from Schedule Settings → office hours).
  // Falls back to all seven if none are enabled (misconfigured/blank).
  const openDays = useMemo(() => {
    const enabled = scheduleSettings.officeHours
      .filter((h) => h.enabled)
      .map((h) => h.dayOfWeek);
    return enabled.length ? [...enabled].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
  }, [scheduleSettings.officeHours]);

  // Keep the selected day within the open set (e.g. if Monday is closed).
  useEffect(() => {
    if (!openDays.includes(activeDay)) setActiveDay(openDays[0]);
  }, [openDays, activeDay]);

  const plans = useMemo(
    () => getPlansForPatient(patientId),
    [getPlansForPatient, patientId],
  );

  // Resolve each configured region → the charge-linked treatments plus the
  // macro's OTHER options-questions (e.g. Left/Right) so they're pickable too.
  const regions = useMemo(() => {
    return settings.regionMacroIds
      .map((macroId) => {
        const macro = macroLibrary.templates.find((m) => m.id === macroId);
        if (!macro) return null;
        const treatmentsQuestion =
          macro.questions.find((qq) => qq.linksCharges) ??
          macro.questions.find((qq) => (qq.options?.length ?? 0) > 0);
        // Everything else that has options (skip free-text / date questions).
        const otherQuestions = macro.questions.filter(
          (qq) => qq.id !== treatmentsQuestion?.id && (qq.options?.length ?? 0) > 0,
        );
        return {
          macroId,
          name: macro.buttonName,
          treatments: treatmentsQuestion?.options ?? [],
          otherQuestions,
        };
      })
      .filter((r): r is PlanRegion => Boolean(r));
  }, [settings.regionMacroIds, macroLibrary.templates]);

  // Appointment dates (US) with their visit type, for the start/end
  // quick-pick — so you know which visit you're picking. Sorted by date.
  const apptOptions = useMemo(() => {
    const seen = new Set<string>();
    const rows: { value: string; label: string; iso: string }[] = [];
    for (const a of appointments) {
      const us = isoToUsDate(a.date);
      if (!us) continue;
      const type = (a.appointmentType || "").trim();
      const k = `${us}|${type}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ value: us, label: type ? `${us} — ${type}` : us, iso: a.date });
    }
    return rows.sort((x, y) => x.iso.localeCompare(y.iso));
  }, [appointments]);

  const handleAdd = () => {
    if (!startDraft.trim() || !endDraft.trim()) return;
    const plan = addPlan(patientId, { startDate: startDraft, endDate: endDraft });
    setShowAdd(false);
    setStartDraft(getTodayUsDate());
    setEndDraft("");
    if (plan) setExpandedPlanId(plan.id);
  };

  return (
    <section className="panel-card p-4">
      <button
        className="flex w-full items-center justify-between rounded-xl bg-[#5b8f7d] px-3 py-2 text-lg font-semibold text-white"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="flex items-center gap-2">
          Treatment Plan
          {plans.length > 0 && (
            <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-bold">
              {plans.length}
            </span>
          )}
        </span>
        <span className="text-xl">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {settings.regionMacroIds.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No treatment regions set up yet. Add them in Settings → Macros → Treatment Plan
              Settings first.
            </p>
          )}

          {plans.map((plan) => {
            const isExpanded = expandedPlanId === plan.id;
            const dayRegions: WeekdayRegion[] = plan.days[activeDay] ?? [];
            const setDay = (next: WeekdayRegion[]) =>
              setDayRegions(patientId, plan.id, activeDay, next);
            // Completed visits = this patient's encounters dated within the
            // plan's range (each encounter is one treatment session).
            const startStamp = usDateToStamp(plan.startDate);
            const endStamp = usDateToStamp(plan.endDate);
            const completedVisits =
              startStamp !== null && endStamp !== null
                ? encounters.filter((e) => {
                    const s = usDateToStamp(e.encounterDate);
                    return s !== null && s >= startStamp && s <= endStamp;
                  }).length
                : null;
            return (
              <div key={plan.id} className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{plan.startDate || "—"}</span>
                    <span className="text-[var(--text-muted)]">to</span>
                    <span className="font-semibold">{plan.endDate || "—"}</span>
                    {completedVisits !== null && (
                      <span
                        className="rounded-full bg-[#eaf3ef] px-2 py-0.5 text-xs font-semibold text-[#3f6d5c]"
                        title="Encounters recorded within this plan's date range"
                      >
                        {completedVisits} visit{completedVisits === 1 ? "" : "s"}
                      </span>
                    )}
                    {!plan.active && (
                      <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                        paused
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold"
                      onClick={() => updatePlan(patientId, plan.id, { active: !plan.active })}
                      type="button"
                    >
                      {plan.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2.5 py-1 text-xs font-semibold"
                      onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                      type="button"
                    >
                      {isExpanded ? "Done" : "Edit"}
                    </button>
                    <button
                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                      onClick={() => {
                        if (window.confirm("Delete this treatment plan?")) removePlan(patientId, plan.id);
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1">
                        <span className="text-xs font-semibold text-[var(--text-muted)]">Start</span>
                        <UsDateInput
                          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                          onChange={(v) => updatePlan(patientId, plan.id, { startDate: v })}
                          value={plan.startDate}
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-semibold text-[var(--text-muted)]">End</span>
                        <UsDateInput
                          className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                          onChange={(v) => updatePlan(patientId, plan.id, { endDate: v })}
                          value={plan.endDate}
                        />
                      </label>
                    </div>

                    {/* Weekday selector — open office days only; a dot marks
                        days that have regions. The Copy-to control sits inline
                        at the end of the same row to save vertical space. */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {openDays.map((day) => {
                        const label = WEEKDAYS[day];
                        const configured = (plan.days[day]?.length ?? 0) > 0;
                        return (
                          <button
                            key={day}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                              activeDay === day
                                ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-white"
                                : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                            }`}
                            onClick={() => setActiveDay(day)}
                            type="button"
                          >
                            {label}
                            {configured && (
                              <span className={activeDay === day ? "text-white" : "text-emerald-600"}> •</span>
                            )}
                          </button>
                        );
                      })}
                      {dayRegions.length > 0 && openDays.length > 1 && (
                        <select
                          className="ml-auto rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
                          onChange={(e) => {
                            const day = Number(e.target.value);
                            e.target.value = "";
                            if (!Number.isInteger(day)) return;
                            const targetHasRegions = (plan.days[day]?.length ?? 0) > 0;
                            const prompt = targetHasRegions
                              ? `${WEEKDAYS[day]} already has treatments. Overwrite them with ${WEEKDAYS[activeDay]}'s?`
                              : `Copy ${WEEKDAYS[activeDay]}'s setup to ${WEEKDAYS[day]}?`;
                            if (!window.confirm(prompt)) return;
                            copyDayRegions(patientId, plan.id, activeDay, day);
                            setActiveDay(day);
                          }}
                          title={`Copy ${WEEKDAYS[activeDay]}'s setup to another day`}
                          value=""
                        >
                          <option value="">Copy {WEEKDAYS[activeDay]} to…</option>
                          {openDays
                            .filter((day) => day !== activeDay)
                            .map((day) => (
                              <option key={day} value={day}>
                                {WEEKDAYS[day]}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>

                    {/* Regions for the selected weekday. */}
                    <div className="space-y-2">
                      {regions.length === 0 && (
                        <p className="text-xs text-[var(--text-muted)]">No regions configured.</p>
                      )}
                      {regions.map((region) => {
                        const onDay = dayRegions.find((r) => r.macroId === region.macroId);
                        const included = Boolean(onDay);
                        const toggleRegion = () => {
                          setDay(
                            included
                              ? dayRegions.filter((r) => r.macroId !== region.macroId)
                              : [...dayRegions, { macroId: region.macroId, treatments: [] }],
                          );
                        };
                        const toggleTreatment = (t: string) => {
                          setDay(
                            dayRegions.map((r) =>
                              r.macroId === region.macroId
                                ? {
                                    ...r,
                                    treatments: r.treatments.includes(t)
                                      ? r.treatments.filter((x) => x !== t)
                                      : [...r.treatments, t],
                                  }
                                : r,
                            ),
                          );
                        };
                        // Toggle an answer to a non-treatment question (e.g.
                        // Left/Right). Single-select questions replace; multi
                        // toggle. Empty selection drops the key.
                        const toggleAnswer = (qid: string, option: string, multi: boolean) => {
                          setDay(
                            dayRegions.map((r) => {
                              if (r.macroId !== region.macroId) return r;
                              const current = r.answers?.[qid] ?? [];
                              const next = multi
                                ? current.includes(option)
                                  ? current.filter((x) => x !== option)
                                  : [...current, option]
                                : current.includes(option)
                                  ? []
                                  : [option];
                              const answers = { ...(r.answers ?? {}) };
                              if (next.length) answers[qid] = next;
                              else delete answers[qid];
                              return { ...r, answers };
                            }),
                          );
                        };
                        return (
                          <div
                            key={region.macroId}
                            className={`rounded-lg border p-2 ${
                              included ? "border-[var(--brand-primary)]" : "border-[var(--line-soft)]"
                            }`}
                          >
                            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                              <input checked={included} onChange={toggleRegion} type="checkbox" />
                              {region.name}
                            </label>
                            {included && region.treatments.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                                {region.treatments.map((t) => {
                                  const on = onDay?.treatments.includes(t) ?? false;
                                  return (
                                    <button
                                      key={t}
                                      className={`rounded-full border px-2 py-0.5 text-xs ${
                                        on
                                          ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.10)] text-[var(--brand-primary)]"
                                          : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                                      }`}
                                      onClick={() => toggleTreatment(t)}
                                      type="button"
                                    >
                                      {on ? "✓ " : ""}
                                      {t}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {included &&
                              region.otherQuestions.map((question) => {
                                const selected = onDay?.answers?.[question.id] ?? [];
                                return (
                                  <div key={question.id} className="mt-1.5 pl-6">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                                      {question.label}
                                      {question.multiSelect ? "" : " (pick one)"}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                      {question.options.map((opt) => {
                                        const on = selected.includes(opt);
                                        return (
                                          <button
                                            key={opt}
                                            className={`rounded-full border px-2 py-0.5 text-xs ${
                                              on
                                                ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.10)] text-[var(--brand-primary)]"
                                                : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                                            }`}
                                            onClick={() =>
                                              toggleAnswer(
                                                question.id,
                                                opt,
                                                Boolean(question.multiSelect),
                                              )
                                            }
                                            type="button"
                                          >
                                            {on ? "✓ " : ""}
                                            {opt}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {showAdd ? (
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">Start date</span>
                  <UsDateInput
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(v) => setStartDraft(v)}
                    value={startDraft}
                  />
                  {apptOptions.length > 0 && (
                    <select
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs"
                      onChange={(e) => e.target.value && setStartDraft(formatUsDateInput(e.target.value))}
                      value=""
                    >
                      <option value="">…or pick a visit date</option>
                      {apptOptions.map((o, i) => (
                        <option key={`${o.value}-${i}`} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">End date</span>
                  <UsDateInput
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5 text-sm"
                    onChange={(v) => setEndDraft(v)}
                    value={endDraft}
                  />
                  {apptOptions.length > 0 && (
                    <select
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs"
                      onChange={(e) => e.target.value && setEndDraft(formatUsDateInput(e.target.value))}
                      value=""
                    >
                      <option value="">…or pick a visit date</option>
                      {apptOptions.map((o, i) => (
                        <option key={`${o.value}-${i}`} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
                  disabled={!startDraft.trim() || !endDraft.trim()}
                  onClick={handleAdd}
                  type="button"
                >
                  Create Plan
                </button>
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 text-sm font-semibold"
                  onClick={() => setShowAdd(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition-all active:scale-[0.97]"
              onClick={() => setShowAdd(true)}
              type="button"
            >
              + Treatment Plan
            </button>
          )}
        </div>
      )}
    </section>
  );
}
