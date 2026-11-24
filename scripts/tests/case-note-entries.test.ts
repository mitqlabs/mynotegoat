/**
 * Patient Notes quick-entry log: stamping, order, permissions, edit/delete, team merge.
 * Mock data only.
 * Run:  npx tsx scripts/tests/case-note-entries.test.ts
 */
import assert from "node:assert/strict";
import {
  addEntry, authorDisplayName, canEditEntryDate, canEditEntryText, caseNotesPlainText, deleteEntry,
  entriesForPatient, formatEntryDate, makeEntry, mergeEntries, normalizeEntries, restoreEntry, todayIso, updateEntry,
  type CaseNoteEntry,
} from "../../src/lib/case-note-entries";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`ok - ${name}`); };
const at = (iso: string) => new Date(iso);
const mk = (text: string, author: string, uid: string, when: string, pid = "p1") =>
  makeEntry({ patientId: pid, text, author, authorUserId: uid, now: at(when) })!;

t("stamps today's local date, MM/DD/YY display", () => {
  const e = mk("  Pt reports less pain  ", "Dr. Mike", "u-owner", "2026-10-27T12:00:00");
  assert.equal(e.date, "2026-10-27");
  assert.equal(formatEntryDate(e.date), "10/27/26");
  assert.equal(e.text, "Pt reports less pain");
  assert.equal(todayIso(at("2026-01-05T09:00:00")), "2026-01-05");
});

t("empty / whitespace note is not created", () => {
  assert.equal(makeEntry({ patientId: "p1", text: "   \n ", author: "x" }), null);
  assert.equal(makeEntry({ patientId: "", text: "hi", author: "x" }), null);
});

t("author names: owner Dr. Mike, staff Hannah M.", () => {
  const doctors = [{ name: "Dr. Mike Galstyan" }];
  assert.equal(authorDisplayName({ userId: "u-o", isMember: false, memberLabel: "", ownerName: "Dr. Mike Galstyan", doctors }), "Dr. Mike");
  assert.equal(authorDisplayName({ userId: "u-h", isMember: true, memberLabel: "Front Desk", memberFirstName: "Hannah", memberLastName: "Miller", ownerName: "Dr. Mike Galstyan", doctors }), "Hannah M.");
  assert.equal(authorDisplayName({ userId: "u-h", isMember: true, memberLabel: "Hannah Miller", ownerName: "Dr. Mike Galstyan", doctors }), "Hannah M.");
  // a team doctor linked to a member record
  assert.equal(authorDisplayName({ userId: "u-d", isMember: true, memberLabel: "Sara Lee", ownerName: "Dr. Mike Galstyan", doctors: [{ name: "Dr. Sara Lee", memberUserId: "u-d" }] }), "Dr. Sara");
  // never blank
  assert.equal(authorDisplayName({ userId: null, isMember: true, memberLabel: "", ownerName: "", doctors: [] }), "Team Member");
});

t("newest date first; same day newest entry first; per patient; deleted hidden", () => {
  let all: CaseNoteEntry[] = [];
  all = addEntry(all, mk("old", "A", "u1", "2026-10-20T09:00:00"));
  all = addEntry(all, mk("today-1", "A", "u1", "2026-10-27T09:00:00"));
  all = addEntry(all, mk("today-2", "B", "u2", "2026-10-27T10:00:00"));
  all = addEntry(all, mk("other patient", "A", "u1", "2026-10-27T11:00:00", "p2"));
  const gone = mk("gone", "A", "u1", "2026-10-27T12:00:00");
  all = deleteEntry(addEntry(all, gone), gone.id, "A");
  assert.deepEqual(entriesForPatient(all, "p1").map((e) => e.text), ["today-2", "today-1", "old"]);
  assert.deepEqual(entriesForPatient(all, "p2").map((e) => e.text), ["other patient"]);
});

t("edit text/date; rejects empty text and bad dates; no-op leaves updatedAt", () => {
  const e = mk("hello", "Hannah M.", "u-h", "2026-10-27T09:00:00");
  let all = [e];
  all = updateEntry(all, e.id, { date: "2026-10-25" }, "Dr. Mike", at("2026-10-27T10:00:00"));
  assert.equal(all[0].date, "2026-10-25");
  assert.equal(all[0].editedBy, "Dr. Mike");
  assert.equal(all[0].author, "Hannah M.", "author stamp never changes");
  const before = all[0];
  assert.equal(updateEntry(all, e.id, { date: "2026-13-40" }, "x")[0], before);
  assert.equal(updateEntry(all, e.id, { text: "  " }, "x")[0], before);
  assert.equal(updateEntry(all, e.id, { text: "hello" }, "x")[0], before);
  assert.equal(updateEntry(all, e.id, { text: "hello there" }, "Hannah M.")[0].text, "hello there");
});

t("permissions: date = owner/admin only; text = author, owner, admin", () => {
  assert.equal(canEditEntryDate("owner"), true);
  assert.equal(canEditEntryDate("admin"), true);
  assert.equal(canEditEntryDate("manager"), false);
  assert.equal(canEditEntryDate("staff"), false);
  const e = { authorUserId: "u-h" };
  assert.equal(canEditEntryText(e, "u-h", "staff"), true, "author edits own");
  assert.equal(canEditEntryText(e, "u-x", "staff"), false, "other staff cannot");
  assert.equal(canEditEntryText(e, "u-x", "manager"), false);
  assert.equal(canEditEntryText(e, "u-x", "admin"), true);
  assert.equal(canEditEntryText(e, null, "owner"), true);
  assert.equal(canEditEntryText({ authorUserId: "" }, "", "staff"), false, "blank ids never match");
});

t("two devices adding at once: both notes survive the merge (either direction)", () => {
  const a = mk("from laptop", "Dr. Mike", "u-o", "2026-10-27T09:00:00");
  const b = mk("from phone", "Hannah M.", "u-h", "2026-10-27T09:00:05");
  const laptop = [a], phone = [b];
  const m1 = mergeEntries(laptop, phone), m2 = mergeEntries(phone, laptop);
  assert.deepEqual(m1.map((e) => e.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(m2.map((e) => e.id).sort(), [a.id, b.id].sort());
});

t("newest edit wins; delete tombstone beats an older copy; restore beats the tombstone", () => {
  const e = mk("v1", "A", "u1", "2026-10-27T09:00:00");
  const edited = updateEntry([e], e.id, { text: "v2" }, "A", at("2026-10-27T10:00:00"));
  assert.equal(mergeEntries([e], edited)[0].text, "v2");
  assert.equal(mergeEntries(edited, [e])[0].text, "v2");
  const del = deleteEntry(edited, e.id, "Dr. Mike", at("2026-10-27T11:00:00"));
  // a stale device still holding v2 (older updatedAt) cannot resurrect it
  assert.equal(entriesForPatient(mergeEntries(edited, del), "p1").length, 0);
  assert.equal(entriesForPatient(mergeEntries(del, edited), "p1").length, 0);
  const back = restoreEntry(del, e.id, "Dr. Mike", at("2026-10-27T12:00:00"));
  assert.equal(entriesForPatient(mergeEntries(del, back), "p1")[0].text, "v2");
});

t("normalize drops junk and keeps good rows (bad cloud data cannot crash the page)", () => {
  assert.deepEqual(normalizeEntries(null), []);
  assert.deepEqual(normalizeEntries("nope"), []);
  const good = mk("ok", "A", "u1", "2026-10-27T09:00:00");
  const out = normalizeEntries([good, null, 5, { id: "x" }, { id: "y", patientId: "p1", text: "t", date: "bad" }]);
  assert.ok(out.find((e) => e.id === good.id));
  assert.ok(out.every((e) => e.id && e.patientId));
});

t("plain text for G.O.A.T./templates: entries then the earlier free-form notes", () => {
  const e1 = mk("Line one\nline two", "Dr. Mike", "u-o", "2026-10-27T09:00:00");
  const txt = caseNotesPlainText(entriesForPatient([e1], "p1"), "Old freeform");
  assert.equal(txt, "10/27/26 - Line one line two -Dr. Mike\nOld freeform");
  assert.equal(caseNotesPlainText([], "  "), "");
});

console.log(`\n${n} passed`);
