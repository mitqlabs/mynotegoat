/**
 * Which automatic texts exist, when the phone should run, and what the
 * queue is allowed to hand out. Pure: no network, no saved data.
 *
 * Older offices stored one send hour plus a birthday on/off. Those become
 * rows here the first time someone opens Text Reminders, and the same rows
 * are written back onto the old fields so the phone keeps sending.
 */
import { localNow, type OfficeHoursDay } from "@/lib/reminder-automation";
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

/** Send time plus 30 and 60 minutes later, once per clock time. */
export function automationClocks(rules: TextRule[]): { hour: number; minute: number }[] {
  const mins = new Set<number>();
  for (const rule of rules) {
    if (!rule.on) continue;
    const start = rule.hour * 60;
    mins.add(start);
    mins.add(start + 30);
    mins.add(start + 60);
  }
  return [...mins]
    .sort((a, b) => a - b)
    .map((total) => ({ hour: Math.floor(total / 60) % 24, minute: total % 60 }));
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
