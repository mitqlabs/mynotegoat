/**
 * G.O.A.T. Page briefing board. The layout is a per-person preference and is
 * mirrored to that person's cloud row (user-prefs-cloud.ts). A browser
 * cache is only the local copy of that account setting.
 */
import { isNewPatientAppointmentType } from "@/lib/initial-exam-date";
import { findClosedKeyDateForDate, type KeyDateRecord } from "@/lib/key-dates";
import { onLocalChange } from "@/lib/local-sync";
import type { AppointmentStatus } from "@/lib/schedule-appointments";
import { getNextBusinessDayIso, getOfficeHoursForDate, type ScheduleSettingsConfig } from "@/lib/schedule-settings";

export const GOAT_BOARD_KEY = "casemate.goat-board-layout.v1";
/** Office-wide starting layout. A person's own board wins when they have one. */
export const GOAT_OFFICE_DEFAULT_KEY = "casemate.goat-page-office-default.v1";

export const DEFAULT_BOX_ORDER = [
  "goat-mail",
  "appointment-check",
  "quick-biz",
  "case-review",
  "schedule",
  "tomorrow-schedule",
  "intake",
  "todos",
  "case-snapshot",
  "end-of-day",
] as const;

export type BuiltinKind = (typeof DEFAULT_BOX_ORDER)[number] | "cases-by-month" | "imaging-referrals" | "specialist-referrals" | "status-cases";

export type SnapshotPeriod = "this-year" | "last-year" | "all" | `year:${number}`;

export type RowField = "time" | "name" | "type" | "status";

export const ROW_FIELDS: Array<{ id: RowField; label: string }> = [
  { id: "time", label: "Time" },
  { id: "name", label: "Name" },
  { id: "type", label: "Type" },
  { id: "status", label: "Status" },
];

export const DEFAULT_ROW_FIELDS: RowField[] = ["time", "name", "type", "status"];

export type BoardBox = {
  i: string;
  kind: BuiltinKind;
  /** Optional name the user typed. Status boxes use this as the title. */
  title?: string;
  /** Office case status this custom box lists. */
  statusName?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Group or handoff item ids the box hides. Missing means show the defaults. */
  hiddenItems?: string[];
  /** Group or handoff item ids, first shown first. */
  itemOrder?: string[];
  /** Appointment type names this box hides. */
  hiddenTypes?: string[];
  /** Appointment type names, priority first. Missing uses New Patient types first. */
  typePriority?: string[];
  /** Case Snapshot window. Missing means This Year. */
  period?: SnapshotPeriod;
  /** Appointment row fields. Missing means time, name, type, and status. */
  fields?: RowField[];
  /** Tallest this box is allowed to grow, in grid rows. */
  maxH?: number;
};

export const BOX_TITLES: Record<Exclude<BuiltinKind, "status-cases">, string> = {
  "goat-mail": "G.O.A.T. Mail",
  "appointment-check": "Appointment Check",
  "quick-biz": "Quick Biz",
  "case-review": "Case Review",
  schedule: "Today's Schedule",
  "tomorrow-schedule": "Tomorrow's Schedule",
  intake: "New Patient Intake",
  todos: "To-Do's & Alerts",
  "case-snapshot": "Case Snapshot",
  "end-of-day": "End of Day Handoff",
  "cases-by-month": "Cases By Month",
  "imaging-referrals": "Imaging Referrals",
  "specialist-referrals": "Specialist Referrals",
};

const BOX_SIZE: Record<BuiltinKind, { w: number; h: number }> = {
  "goat-mail": { w: 4, h: 8 },
  "appointment-check": { w: 4, h: 8 },
  "quick-biz": { w: 6, h: 7 },
  "case-review": { w: 6, h: 7 },
  schedule: { w: 6, h: 10 },
  "tomorrow-schedule": { w: 6, h: 10 },
  intake: { w: 3, h: 8 },
  todos: { w: 6, h: 8 },
  "case-snapshot": { w: 6, h: 10 },
  "end-of-day": { w: 12, h: 11 },
  "cases-by-month": { w: 4, h: 8 },
  "imaging-referrals": { w: 4, h: 8 },
  "specialist-referrals": { w: 4, h: 8 },
  "status-cases": { w: 4, h: 8 },
};

export function boxTitle(box: Pick<BoardBox, "kind" | "title" | "statusName">): string {
  if (box.title?.trim()) return box.title.trim();
  if (box.kind === "status-cases") return box.statusName ? `Cases: ${box.statusName}` : "Cases";
  return BOX_TITLES[box.kind];
}

/** Today's visit groups. Canceled is included. Waiting / checked-in is not — that stays off this box. */
export const VISIT_GROUP_LABELS = ["New Patient", "Seen", "No Show", "Rebook", "Canceled"] as const;

/** Today's column on the handoff. Waiting / checked-in is not one of these. */
export const HANDOFF_TODAY_ITEMS = [
  { id: "seen", label: "Seen" },
  { id: "new-seen", label: "New patients seen" },
  { id: "no-show", label: "No-shows" },
  { id: "canceled", label: "Canceled" },
  { id: "rebook", label: "Rebooks needed" },
  { id: "unsigned", label: "Unsigned notes" },
  { id: "no-note", label: "Checked in, no note" },
] as const;

/** Tomorrow's column. The appointment list only. */
export const HANDOFF_TOMORROW_ITEMS = [{ id: "tomorrow-list", label: "Tomorrow's Appointments" }] as const;

export const SCHEDULE_ITEMS = [
  { id: "list", label: "Appointment list" },
  ...VISIT_GROUP_LABELS.map((label) => ({ id: label, label })),
] as const;

export type VisitLike = {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  startTime: string;
  status: AppointmentStatus | string;
  appointmentType?: string;
};

export type NamedRow = { id: string; name: string; href: string; detail?: string };

export function todayVisitGroups(appointments: VisitLike[], todayIso: string): Array<{ label: (typeof VISIT_GROUP_LABELS)[number]; rows: NamedRow[] }> {
  const today = appointments.filter((row) => row.date === todayIso);
  const row = (visit: VisitLike, detail?: string): NamedRow => ({
    id: visit.id,
    name: visit.patientName,
    href: `/patients/${visit.patientId}`,
    detail,
  });
  return [
    {
      label: "New Patient",
      rows: today.filter((visit) => visit.status !== "Canceled" && isNewPatientAppointmentType(visit.appointmentType ?? "")).map((visit) => row(visit)),
    },
    { label: "Seen", rows: today.filter((visit) => visit.status === "Check Out").map((visit) => row(visit)) },
    { label: "No Show", rows: today.filter((visit) => visit.status === "No Show").map((visit) => row(visit)) },
    {
      label: "Rebook",
      rows: appointments.filter((visit) => visit.status === "Reschedule" && visit.date === todayIso).map((visit) => row(visit)),
    },
    { label: "Canceled", rows: today.filter((visit) => visit.status === "Canceled").map((visit) => row(visit)) },
  ];
}

export function patientsInStatus<T extends { id: string; fullName: string; caseStatus: string; deleted?: boolean }>(
  patients: T[],
  statusName: string,
): T[] {
  const want = statusName.trim().toLowerCase();
  return patients.filter((patient) => !patient.deleted && patient.caseStatus.trim().toLowerCase() === want);
}

function pack(kinds: BuiltinKind[]): BoardBox[] {
  const cols = 12;
  let x = 0;
  let y = 0;
  let rowH = 0;
  return kinds.map((kind) => {
    const size = BOX_SIZE[kind];
    if (x + size.w > cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    const box: BoardBox = { i: kind, kind, x, y, w: size.w, h: size.h };
    x += size.w;
    rowH = Math.max(rowH, size.h);
    return box;
  });
}

export function defaultBoard(): BoardBox[] {
  return pack([...DEFAULT_BOX_ORDER]);
}

export function newStatusBox(statusName: string, title: string | undefined, existing: BoardBox[]): BoardBox {
  const size = BOX_SIZE["status-cases"];
  const y = existing.reduce((max, box) => Math.max(max, box.y + box.h), 0);
  return {
    i: `status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "status-cases",
    statusName,
    title: title?.trim() || undefined,
    x: 0,
    y,
    w: size.w,
    h: size.h,
  };
}

export function newBuiltinBox(kind: Exclude<BuiltinKind, "status-cases">, existing: BoardBox[]): BoardBox | null {
  if (existing.some((box) => box.kind === kind)) return null;
  const size = BOX_SIZE[kind];
  const y = existing.reduce((max, box) => Math.max(max, box.y + box.h), 0);
  return { i: kind, kind, x: 0, y, w: size.w, h: size.h };
}

function isBox(value: unknown): value is BoardBox {
  if (!value || typeof value !== "object") return false;
  const row = value as BoardBox;
  return typeof row.i === "string" && typeof row.kind === "string" && typeof row.x === "number" && typeof row.w === "number";
}

export function parseBoard(raw: string | null): BoardBox[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isBox)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadOfficeDefault(): BoardBox[] | null {
  if (typeof window === "undefined") return null;
  return parseBoard(window.localStorage.getItem(GOAT_OFFICE_DEFAULT_KEY));
}

export function loadBoard(): BoardBox[] {
  if (typeof window === "undefined") return defaultBoard();
  return dropRetiredBoxes(parseBoard(window.localStorage.getItem(GOAT_BOARD_KEY)) ?? loadOfficeDefault() ?? defaultBoard());
}

export function saveBoard(boxes: BoardBox[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOAT_BOARD_KEY, JSON.stringify(boxes));
  void import("@/lib/local-sync").then((m) => m.notifyChange(GOAT_BOARD_KEY));
}

/** Office starting layout. Written to the shared workspace row, not only this browser. */
export function saveOfficeDefault(boxes: BoardBox[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GOAT_OFFICE_DEFAULT_KEY, JSON.stringify(boxes));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(GOAT_OFFICE_DEFAULT_KEY, "tasks", boxes));
  void import("@/lib/local-sync").then((m) => m.notifyChange(GOAT_OFFICE_DEFAULT_KEY));
}

export function boardSnapshot(): string {
  if (typeof window === "undefined") return "";
  return `${window.localStorage.getItem(GOAT_BOARD_KEY) ?? ""}\u0000${window.localStorage.getItem(GOAT_OFFICE_DEFAULT_KEY) ?? ""}`;
}

export function boxesFromSnapshot(raw: string): BoardBox[] {
  if (!raw) return defaultBoard();
  const splitAt = raw.indexOf("\u0000");
  const personal = splitAt === -1 ? raw : raw.slice(0, splitAt);
  const office = splitAt === -1 ? "" : raw.slice(splitAt + 1);
  return dropRetiredBoxes(parseBoard(personal || null) ?? parseBoard(office || null) ?? defaultBoard());
}

const RETIRED_KINDS = new Set(["morning-rundown", "goat-answers"]);

/**
 * Saved layouts from before a box was removed. The old answers box is retired
 * because G.O.A.T. Mail already lists mail that needs an answer. Boxes that
 * sat to the right of a retired box slide left so the row does not keep a hole.
 */
export function dropRetiredBoxes(boxes: BoardBox[]): BoardBox[] {
  const retired = boxes.filter((box) => RETIRED_KINDS.has(box.kind as string));
  if (!retired.length) return boxes;
  let next = boxes.filter((box) => !RETIRED_KINDS.has(box.kind as string));
  for (const gone of retired) {
    next = next.map((box) => {
      const overlapsY = box.y < gone.y + gone.h && gone.y < box.y + box.h;
      if (overlapsY && box.x >= gone.x + gone.w) return { ...box, x: Math.max(0, box.x - gone.w) };
      return box;
    });
  }
  return next;
}

export function subscribeBoard(onStoreChange: () => void): () => void {
  const stopPersonal = onLocalChange(GOAT_BOARD_KEY, onStoreChange);
  const stopOffice = onLocalChange(GOAT_OFFICE_DEFAULT_KEY, onStoreChange);
  return () => {
    stopPersonal();
    stopOffice();
  };
}

export function resetBoard(): BoardBox[] {
  const next = loadOfficeDefault() ?? defaultBoard();
  saveBoard(next);
  return next;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function examMonth(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return Number(iso[2]) - 1;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  if (!us) return null;
  const month = Number(us[1]) - 1;
  return month >= 0 && month < 12 ? month : null;
}

export function casesByMonth(patients: Array<{ id?: string; fullName?: string; deleted?: boolean; matrix?: { initialExam?: string } }>): Array<{ month: string; count: number; people: Array<{ id: string; name: string }> }> {
  const groups = MONTHS.map(() => [] as Array<{ id: string; name: string }>);
  for (const patient of patients) {
    if (patient.deleted || !patient.id) continue;
    const month = examMonth(patient.matrix?.initialExam);
    if (month !== null) groups[month].push({ id: patient.id, name: patient.fullName || "Case" });
  }
  return MONTHS.map((month, index) => ({ month, count: groups[index].length, people: groups[index] }));
}

type RefRecord = Record<string, unknown>;

function studyCount(ref: RefRecord): number {
  const regions = Array.isArray(ref.regions) ? (ref.regions as string[]) : [];
  if (!regions.length) return 1;
  const laterality = ref.lateralityByRegion && typeof ref.lateralityByRegion === "object" ? (ref.lateralityByRegion as Record<string, string>) : {};
  return regions.reduce((sum, region) => sum + (laterality[region] === "BL" ? 2 : 1), 0);
}

export function imagingReferralRows(patients: Array<{ id: string; fullName?: string; deleted?: boolean; xrayReferrals?: unknown[]; mriReferrals?: unknown[] }>): Array<{ facility: string; cases: number; xray: number; mri: number; total: number; people: Array<{ id: string; name: string }> }> {
  const grouped = new Map<string, { facility: string; cases: Map<string, string>; xray: number; mri: number }>();
  const add = (patientId: string, name: string, facility: string, type: "xray" | "mri", count: number) => {
    const key = facility.toLowerCase();
    const row = grouped.get(key) ?? { facility, cases: new Map<string, string>(), xray: 0, mri: 0 };
    row.cases.set(patientId, name);
    row[type] += count;
    grouped.set(key, row);
  };
  for (const patient of patients) {
    if (patient.deleted) continue;
    const name = patient.fullName || "Case";
    for (const raw of patient.xrayReferrals ?? []) {
      const ref = raw as RefRecord;
      if (ref.isPrior === true || typeof ref.center !== "string" || !ref.center.trim()) continue;
      add(patient.id, name, ref.center.trim(), "xray", studyCount(ref));
    }
    for (const raw of patient.mriReferrals ?? []) {
      const ref = raw as RefRecord;
      if (ref.isPrior === true || typeof ref.center !== "string" || !ref.center.trim()) continue;
      add(patient.id, name, ref.center.trim(), "mri", studyCount(ref));
    }
  }
  return [...grouped.values()]
    .map((row) => ({
      facility: row.facility,
      cases: row.cases.size,
      xray: row.xray,
      mri: row.mri,
      total: row.xray + row.mri,
      people: [...row.cases.entries()].map(([id, person]) => ({ id, name: person })),
    }))
    .sort((a, b) => b.total - a.total);
}

function addDaysUtc(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export type OfficeDay = { date: string; closed: boolean };

/**
 * The next day the office is open after today. Skips weekdays whose hours
 * are off and full-day closed dates. A partial-day closure still counts as open.
 */
export function nextOpenOfficeDay(
  todayIso: string,
  settings: Pick<ScheduleSettingsConfig, "officeHours">,
  keyDates: KeyDateRecord[],
): OfficeDay {
  const closed = new Set<string>();
  for (let offset = 1; offset <= 60; offset += 1) {
    const date = addDaysUtc(todayIso, offset);
    if (findClosedKeyDateForDate(keyDates, date)) closed.add(date);
  }
  const date = getNextBusinessDayIso(settings as ScheduleSettingsConfig, closed, todayIso, false);
  const hours = getOfficeHoursForDate(settings as ScheduleSettingsConfig, date);
  if (!hours?.enabled || date === todayIso || closed.has(date)) {
    return { date: addDaysUtc(todayIso, 1), closed: true };
  }
  return { date, closed: false };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Next open day: Wed, Nov 12" */
export function nextOpenDayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return "Next open day";
  const date = new Date(Date.UTC(year, month - 1, day));
  return `Next open day: ${WEEKDAYS[date.getUTCDay()]}, ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** New Patient types first, when the office has one. Other types keep their list order. */
export function defaultTypePriority(typeNames: string[]): string[] {
  return typeNames.filter((name) => isNewPatientAppointmentType(name));
}

export function typeOrder(typeNames: string[], saved: string[] | undefined): string[] {
  const wanted = (saved?.length ? saved : defaultTypePriority(typeNames)).map((name) => name.trim()).filter(Boolean);
  const known = new Map(typeNames.map((name) => [name.toLowerCase(), name]));
  const ordered: string[] = [];
  const placed = new Set<string>();
  for (const name of wanted) {
    const match = known.get(name.toLowerCase());
    if (!match || placed.has(match.toLowerCase())) continue;
    ordered.push(match);
    placed.add(match.toLowerCase());
  }
  for (const name of typeNames) {
    if (!placed.has(name.toLowerCase())) ordered.push(name);
  }
  return ordered;
}

export function appointmentVisible(type: string | undefined, hidden: string[] | undefined): boolean {
  if (!hidden?.length) return true;
  const name = (type ?? "").trim().toLowerCase();
  return !hidden.some((row) => row.trim().toLowerCase() === name);
}

/** Priority types first, then everyone else by time. Same priority sorts by time. */
export function sortAppointments<T extends { startTime: string; appointmentType?: string }>(rows: T[], priority: string[]): T[] {
  const rank = new Map(priority.map((name, index) => [name.trim().toLowerCase(), index]));
  const last = priority.length;
  return rows.slice().sort((a, b) => {
    const ar = rank.get((a.appointmentType ?? "").trim().toLowerCase());
    const br = rank.get((b.appointmentType ?? "").trim().toLowerCase());
    const aRank = ar ?? last;
    const bRank = br ?? last;
    if (aRank !== bRank) return aRank - bRank;
    return a.startTime.localeCompare(b.startTime);
  });
}

/** Rows a box can be dragged to when it has no height limit of its own. Twice the old 14. */
export const DEFAULT_MAX_H = 28;
/** Highest row span the height setting or a drag can use. Twice the old 20. */
export const MAX_BOX_H = 40;

export function clampMaxH(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_H;
  return Math.max(4, Math.min(MAX_BOX_H, Math.round(value)));
}

export function rowFields(box: Pick<BoardBox, "fields">): RowField[] {
  const allowed = new Set(DEFAULT_ROW_FIELDS);
  const picked = (box.fields ?? []).filter((field): field is RowField => allowed.has(field));
  return picked.length ? picked : DEFAULT_ROW_FIELDS;
}

export function orderedIds(ids: string[], saved: string[] | undefined): string[] {
  const rank = new Map((saved ?? ids).map((id, index) => [id, index]));
  return ids.slice().sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || ids.indexOf(a) - ids.indexOf(b));
}

export function itemShown(hidden: string[] | undefined, id: string): boolean {
  return !(hidden ?? []).includes(id);
}

export function showsAppointments(kind: BuiltinKind): boolean {
  return kind === "schedule" || kind === "tomorrow-schedule" || kind === "end-of-day";
}

export function groupsFor(kind: BuiltinKind, statusNames: string[]): Array<{ id: string; label: string }> {
  if (kind === "schedule" || kind === "tomorrow-schedule") return SCHEDULE_ITEMS.map((item) => ({ ...item }));
  if (kind === "end-of-day") return [...HANDOFF_TODAY_ITEMS, ...HANDOFF_TOMORROW_ITEMS].map((item) => ({ ...item }));
  if (kind === "case-snapshot") return statusNames.map((name) => ({ id: `status:${name}`, label: name }));
  return [];
}

export function moveId(order: string[], id: string, direction: -1 | 1): string[] {
  const index = order.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= order.length) return order;
  const copy = order.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

function yearOf(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  const iso = /^(\d{4})-\d{2}-\d{2}/.exec(text);
  if (iso) return Number(iso[1]);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  if (!us) return null;
  const year = Number(us[3]);
  if (!Number.isFinite(year)) return null;
  return year < 100 ? 2000 + year : year;
}

/** Initial exam year, otherwise the date-of-loss year. Undated cases have no year. */
export function caseYear(patient: { matrix?: { initialExam?: string }; dateOfLoss?: string }): number | null {
  return yearOf(patient.matrix?.initialExam) ?? yearOf(patient.dateOfLoss);
}

export function matchesPeriod(
  patient: { matrix?: { initialExam?: string }; dateOfLoss?: string },
  period: SnapshotPeriod | undefined,
  todayIso: string,
): boolean {
  const choice = period ?? "this-year";
  if (choice === "all") return true;
  const year = caseYear(patient);
  if (year === null) return false;
  const todayYear = Number(todayIso.slice(0, 4));
  if (choice === "this-year") return year === todayYear;
  if (choice === "last-year") return year === todayYear - 1;
  const specific = /^year:(\d{4})$/.exec(choice);
  return specific ? year === Number(specific[1]) : year === todayYear;
}

export function specialistReferralRows(patients: Array<{ id: string; fullName?: string; deleted?: boolean; specialistReferrals?: unknown[] }>): Array<{ specialist: string; cases: number; people: Array<{ id: string; name: string }> }> {
  const grouped = new Map<string, { specialist: string; cases: Map<string, string> }>();
  for (const patient of patients) {
    if (patient.deleted) continue;
    const person = patient.fullName || "Case";
    for (const raw of patient.specialistReferrals ?? []) {
      const ref = raw as RefRecord;
      const name = typeof ref.specialist === "string" ? ref.specialist.trim() : "";
      if (!name || name === "-") continue;
      const row = grouped.get(name.toLowerCase()) ?? { specialist: name, cases: new Map<string, string>() };
      row.cases.set(patient.id, person);
      grouped.set(name.toLowerCase(), row);
    }
  }
  return [...grouped.values()]
    .map((row) => ({
      specialist: row.specialist,
      cases: row.cases.size,
      people: [...row.cases.entries()].map(([id, name]) => ({ id, name })),
    }))
    .sort((a, b) => b.cases - a.cases);
}
