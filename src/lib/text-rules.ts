/**
 * Which automatic texts exist, when the phone should run, and what the
 * queue is allowed to hand out. Pure: no network, no saved data.
 *
 * Older offices stored one send hour plus a birthday on/off. Those become
 * rows here the first time someone opens Text Reminders, and the same rows
 * are written back onto the old fields so the phone keeps sending.
 */
import { localNow, type OfficeHoursDay } from "@/lib/reminder-automation";
import { fmtDateTime } from "@/lib/reminder-format";
import type { SmsReminderSettings, TextRule, TextWhenKind } from "@/lib/sms-reminders";

export function newRuleId(): string {
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

export function clockWords(hour: number, minute = 0): string {
  const h = ((hour % 24) + 24) % 24;
  const shown = h % 12 === 0 ? 12 : h % 12;
  return `${shown}:${String(minute).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function ruleWhen(rule: TextRule): string {
  const time = clockWords(rule.hour);
  if (rule.kind === "birthday") return `Birthdays, ${time}`;
  if (rule.kind === "open-day") return `Days the office is open, ${time}`;
  if (rule.kind === "hours-before") return `24 hours before the visit, ${time}`;
  return `Day before the visit, ${time}`;
}

/** Rows for an office that has not saved the new list yet. Nothing is turned on that was off. */
export function legacyRules(settings: SmsReminderSettings): TextRule[] {
  const rules: TextRule[] = [];
  if (settings.enabled || settings.templateId) {
    rules.push({
      id: "reminder",
      templateId: settings.templateId,
      on: settings.enabled,
      kind: "day-before",
      hour: settings.sendHour,
    });
  }
  if (settings.birthdayTexts || settings.birthdayTemplateId) {
    rules.push({
      id: "birthday",
      templateId: settings.birthdayTemplateId,
      on: settings.birthdayTexts,
      kind: "birthday",
      hour: settings.birthdayHour || settings.sendHour,
    });
  }
  return rules;
}

/**
 * Write the rows back onto the fields the queue already reads.
 * The visit message is the day-before row when there is one.
 * Birthday texts wait until their own hour.
 */
export function withRules(settings: SmsReminderSettings, rules: TextRule[]): SmsReminderSettings {
  const on = rules.filter((rule) => rule.on);
  const visits = on.filter((rule) => rule.kind !== "birthday");
  const dayBefore = visits.filter((rule) => rule.kind === "day-before");
  const birthdays = on.filter((rule) => rule.kind === "birthday");
  const sendHour = visits.length ? Math.min(...visits.map((rule) => rule.hour)) : settings.sendHour;
  const birthdayHour = birthdays.length ? Math.min(...birthdays.map((rule) => rule.hour)) : settings.birthdayHour;
  return {
    ...settings,
    rules,
    enabled: visits.length > 0,
    sendHour,
    birthdayHour,
    templateId: (dayBefore[0] ?? visits[0])?.templateId ?? settings.templateId,
    birthdayTexts: birthdays.length > 0,
    birthdayTemplateId: birthdays[0]?.templateId ?? settings.birthdayTemplateId,
    daysAhead: dayBefore.length ? 1 : settings.daysAhead,
  };
}

/**
 * One alarm per send time, plus one shared catch-up an hour after the last.
 * 8:00 and 9:00 become 8:00, 9:00, and 10:00. Never more than three.
 * The catch-up run is the same shortcut, so anything still unsent that day
 * is offered again once its claim expires.
 */
export function automationClocks(rules: TextRule[]): { hour: number; minute: number }[] {
  const hours = [...new Set(rules.filter((rule) => rule.on).map((rule) => rule.hour))].sort((a, b) => a - b);
  if (!hours.length) return [];
  const catchUp = (hours[hours.length - 1] + 1) % 24;
  const extra = hours.includes(catchUp) ? 0 : 1;
  const send = hours.length + extra > 3 ? [hours[0], hours[hours.length - 1]].filter((hour, index, list) => list.indexOf(hour) === index) : hours;
  const start = send[0];
  const ordered = [...new Set([...send, catchUp])].sort((a, b) => ((a - start + 24) % 24) - ((b - start + 24) % 24));
  return ordered.slice(0, 3).map((hour) => ({ hour, minute: 0 }));
}

export interface DueScope {
  today: boolean;
  tomorrow: boolean;
  /** Tomorrow's visits only count when they are inside the next 24 hours. */
  limitTomorrowToNow: boolean;
  birthday: boolean;
}

/**
 * Which visits and birthdays may go out now.
 * A row waits until its own hour. Friday is not assumed closed or open:
 * "days the office is open" follows office hours and full-day Key Dates.
 */
export function dueScope(input: {
  rules: TextRule[];
  now: Date;
  timeZone: string;
  officeHours: OfficeHoursDay[];
  closedIsoDates: Set<string>;
}): DueScope {
  const local = localNow(input.now, input.timeZone);
  const due = (hour: number) => local.hour >= hour;
  const on = input.rules.filter((rule) => rule.on && due(rule.hour));
  const has = (kind: TextWhenKind) => on.some((rule) => rule.kind === kind);
  const officeOpen =
    !input.closedIsoDates.has(local.iso) &&
    input.officeHours.some((day) => day.dayOfWeek === local.dow && day.enabled);
  const dayBefore = has("day-before");
  const within = has("hours-before");
  return {
    today: dayBefore || within || (has("open-day") && officeOpen),
    tomorrow: dayBefore || within,
    limitTomorrowToNow: within && !dayBefore,
    birthday: has("birthday"),
  };
}

const SHORTCUT_KIND: Record<TextWhenKind, string> = {
  birthday: "Birthdays",
  "open-day": "Open Days",
  "hours-before": "24 Hours Before",
  "day-before": "Day Before",
};

/** "9 AM" for a shortcut name. Steps still say "9:00 AM". */
export function shortcutClock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const shown = h % 12 === 0 ? 12 : h % 12;
  return `${shown} ${h >= 12 ? "PM" : "AM"}`;
}

/** The shortcut the Device runs. Example: NoteGoat – Birthdays 9 AM. */
export function shortcutName(rule: Pick<TextRule, "kind" | "hour">): string {
  return `NoteGoat – ${SHORTCUT_KIND[rule.kind]} ${shortcutClock(rule.hour)}`;
}

/** Give every saved row the shortcut name for its when and time. Does not turn anything on or off. */
export function ensureShortcutNames(settings: SmsReminderSettings): SmsReminderSettings {
  if (!settings.rules) return settings;
  let changed = false;
  const rules = settings.rules.map((rule) => {
    const name = shortcutName(rule);
    if (rule.shortcutName === name) return rule;
    changed = true;
    return { ...rule, shortcutName: name };
  });
  return changed ? { ...settings, rules } : settings;
}

export const SHORTCUT_RUNS_KEY = "casemate.shortcut-runs.v1";
export const SHORTCUT_SEAL_PREFIX = "casemate.reminder-shortcut-seal.";
export const SHORTCUT_HASH_PREFIX = "casemate.reminder-shortcut-hash.";

export interface ShortcutRun {
  at: string;
  status: "ok" | "error";
  summary: string;
}

export function shortcutStatusText(rule: Pick<TextRule, "on">, run: ShortcutRun | undefined, timeZone: string): string {
  if (!rule.on) return "Off";
  if (!run) return "Not run yet";
  const when = fmtDateTime(run.at, timeZone);
  return run.status === "error" ? `Last run ${when} · Error` : `Last run ${when} · OK`;
}

export function normalizeShortcutRuns(value: unknown): Record<string, ShortcutRun> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, ShortcutRun> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.status !== "ok" && row.status !== "error") continue;
    if (typeof row.at !== "string" || !row.at) continue;
    out[id.slice(0, 40)] = {
      at: row.at,
      status: row.status,
      summary: typeof row.summary === "string" ? row.summary.slice(0, 200) : "",
    };
  }
  return out;
}

export interface RuleQueuePick {
  rule: TextRule | null;
  scope: DueScope;
  /** Visit wording for this rule. Empty means keep the office default. */
  templateBody: string;
  /** Birthday wording for this rule. Empty means keep the office default. */
  birthdayBody: string;
}

/**
 * One named shortcut asks for one rule.
 * Closed days and Key Dates stay in dueScope. Other rules are left out.
 * An unknown or off rule sends none of its texts.
 */
export function pickRuleQueue(input: {
  ruleId: string;
  settings: SmsReminderSettings;
  templates: { id: string; body: string; deleted?: boolean }[];
  now: Date;
  officeHours: OfficeHoursDay[];
  closedIsoDates: Set<string>;
}): RuleQueuePick {
  const rules = input.settings.rules ?? legacyRules(input.settings);
  const rule = rules.find((item) => item.id === input.ruleId && item.on) ?? null;
  const scope = dueScope({
    rules: rule ? [rule] : [],
    now: input.now,
    timeZone: input.settings.timeZone,
    officeHours: input.officeHours,
    closedIsoDates: input.closedIsoDates,
  });
  const template = rule
    ? input.templates.find((item) => item.id === rule.templateId && !item.deleted && item.body.trim())
    : undefined;
  const body = template?.body ?? "";
  return {
    rule,
    scope,
    templateBody: rule && rule.kind !== "birthday" ? body : "",
    birthdayBody: rule && rule.kind === "birthday" ? body : "",
  };
}
