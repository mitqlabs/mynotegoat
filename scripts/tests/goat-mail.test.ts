/**
 * G.O.A.T. Mail triage. No network, no mailbox.
 * Run: npx tsx scripts/tests/goat-mail.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLOUD_KEY_REGISTRY } from "../../src/lib/cloud-key-registry";
import { chosenFolderIds, GOAT_MAIL_FOLDERS_KEY, GOAT_MAIL_SECRET_EXPIRED, GOAT_MAIL_SECRET_KEY, isInvalidClientSecretError, mailSecretAlertText, mailSecretDateLabel, mailSecretDue, mergeMailMessages, planMailIntake, triageGoatMail, type GoatMailMessage, type MailFolderChoice } from "../../src/lib/goat-mail";
import { parseIntakeText } from "../../src/lib/new-patient-intake";

const today = "2026-11-09";
const msg = (over: Partial<GoatMailMessage>): GoatMailMessage => ({
  id: "m1",
  subject: "",
  from: "front@firm.test",
  receivedAt: "2026-11-09T15:00:00Z",
  body: "",
  ...over,
});

const referral = "New patient referral. Patient: Kara Testpatient. Phone 818-555-0142. Date of injury 09/25/2026.";

const row = (body: string, extra: Parameters<typeof triageGoatMail>[0] = { messages: [], patients: [], appointments: [], todayIso: today, claimDocument: "lien" }) =>
  triageGoatMail({ ...extra, messages: [msg({ body, subject: body.split("\n")[0] })] })[0];

const added = row(referral);
assert.equal(added.category, "new-patient");
assert.equal(added.label, "New Patient referral");
assert.equal(added.create, true);
assert.equal(added.draft?.firstName, "Kara");
assert.equal(added.draft?.lastName, "Testpatient");
assert.equal(added.needsAnswer, false);
assert.deepEqual(added.flags, ["unbooked"]);

const lop = row("Please send the LOP for the Smith file. We need it signed.", { messages: [], patients: [], appointments: [], todayIso: today, claimDocument: "lop" });
assert.equal(lop.category, "lien");
assert.equal(lop.label, "LOP request needed");
assert.equal(lop.create, false);

const lien = row("Please send the lien. It is needed before we can move the file.");
assert.equal(lien.label, "Lien request needed");

const rb = row("Please send the R&B for this patient. Report and bill requested.");
assert.equal(rb.category, "rb");
assert.equal(rb.label, "R&B / Report & Bill requested");

const medicals = row("Medical records request. Please send the medicals.");
assert.equal(medicals.category, "medicals");

const imaging = row("MRI report attached. Impression: no acute fracture.");
assert.equal(imaging.category, "specialist");
assert.equal(imaging.label, "Specialist/imaging reply");

assert.equal(triageGoatMail({
  messages: [msg({ from: "MAILER-DAEMON@office.test", subject: "Undeliverable", body: "New patient referral\nPatient: Kara Testpatient" })],
  patients: [],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
})[0].category, "bounced");

const other = row("The conference room is booked for Thursday.");
assert.equal(other.category, "other");
assert.equal(other.needsAnswer, false);
assert.equal(other.create, false);

const unsure = row("New patient referral for Kara Testpatient. Please also send the lien.");
assert.equal(unsure.needsAnswer, true);
assert.equal(unsure.question, "Which is this?");
assert.equal(unsure.create, false);
assert.ok(unsure.choices.some((choice) => choice.id === "new-patient"));
assert.ok(unsure.choices.some((choice) => choice.id === "lien"));

const noName = row("New patient referral. Please schedule. Date of injury 09/25/2026.");
assert.equal(noName.needsAnswer, true);
assert.equal(noName.question, "Who is the new patient?");
assert.equal(noName.create, false);

const duplicate = triageGoatMail({
  messages: [msg({ subject: "New patient referral", body: referral })],
  patients: [{ id: "p1", fullName: "Testpatient, Kara", dateOfLoss: "2026-09-25" }],
  appointments: [{ patientId: "p1", date: "2026-11-12", status: "Scheduled" }],
  todayIso: today,
  claimDocument: "lien",
})[0];
assert.equal(duplicate.create, false);
assert.equal(duplicate.patientId, "p1");
assert.equal(duplicate.flags.includes("unbooked"), false);

const second = triageGoatMail({
  messages: [msg({ subject: "New patient referral", body: referral })],
  patients: [{ id: "p1", fullName: "Testpatient, Kara", dateOfLoss: "2026-01-15" }],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
})[0];
assert.equal(second.create, true);
assert.equal(second.flags.includes("second-crash"), true);
assert.equal(second.flags.includes("unbooked"), true);

const filler = "New patient referral. Patient: D This. Phone 305-295-7810. Date of injury 01/15/2026.";
const parsedFiller = parseIntakeText(filler, { todayIso: today });
assert.equal(parsedFiller.draft.firstName, undefined);
assert.equal(parsedFiller.draft.lastName, undefined);
assert.ok(parsedFiller.ask.some((line) => /name/i.test(line)));
const badName = row(filler);
assert.equal(badName.create, false);
assert.equal(badName.needsAnswer, true);
assert.equal(badName.question, "Who is the new patient?");

const samePhone = triageGoatMail({
  messages: [msg({ id: "m-phone", subject: "New patient referral", body: referral })],
  patients: [{ id: "p9", fullName: "Testpatient, Kara", phone: "(818) 555-0142", dateOfLoss: "2026-01-02", dob: "1990-04-04" }],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
})[0];
assert.equal(samePhone.create, false);
assert.equal(samePhone.patientId, "p9");

const sameDob = triageGoatMail({
  messages: [msg({ id: "m-dob", subject: "New patient referral", body: "New patient referral. Patient: Kara Testpatient. DOB 04/04/1990. Date of injury 03/01/2026." })],
  patients: [{ id: "p8", fullName: "Testpatient, Kara", phone: "818-555-0199", dob: "04/04/1990", dateOfLoss: "2025-01-01" }],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
})[0];
assert.equal(sameDob.create, false);
assert.equal(sameDob.patientId, "p8");

assert.deepEqual(planMailIntake({
  messageId: "m1",
  draft: { firstName: "D", lastName: "This", phone: "305-295-7810" },
  decisions: [],
  patients: [],
}), { action: "skip" });
assert.deepEqual(planMailIntake({
  messageId: "m1",
  draft: { firstName: "Kara", lastName: "Testpatient", phone: "818-555-0142" },
  decisions: [{ id: "m1", patientId: "p1", updatedAt: "2026-11-09T16:00:00Z" }],
  patients: [],
}), { action: "skip" });
assert.deepEqual(planMailIntake({
  messageId: "m2",
  draft: { firstName: "Kara", lastName: "Testpatient", phone: "818-555-0142" },
  decisions: [{ id: "m1", patientId: "p1", updatedAt: "2026-11-09T16:00:00Z" }],
  patients: [{ id: "p1", fullName: "Testpatient, Kara", phone: "305-295-7810" }],
}), { action: "create" });
assert.deepEqual(planMailIntake({
  messageId: "m2",
  draft: { firstName: "Kara", lastName: "Testpatient", phone: "818-555-0142" },
  decisions: [],
  patients: [{ id: "p1", fullName: "Testpatient, Kara", phone: "818.555.0142" }],
}), { action: "link", patientId: "p1" });
assert.equal(readFileSync(new URL("../../src/components/goat-mail-board.tsx", import.meta.url), "utf8").includes("planMailIntake"), true);

const passengers = row(`New patient referral
Patient: Kara Testpatient
Patient: Tyler Smith
Date of injury: 09/25/2026
The driver and passenger were both hurt.`);
assert.equal(passengers.needsAnswer, true);
assert.equal(passengers.create, false);
assert.equal(passengers.flags.includes("multi-passenger"), true);

const missing = row(`New patient referral
Patient: Kara Testpatient`);
assert.equal(missing.create, true);
assert.ok(missing.missing.includes("phone"));
assert.ok(missing.missing.includes("date of injury"));

const answered = triageGoatMail({
  messages: [msg({ subject: "New patient referral", body: "New patient referral. Patient: Kara Testpatient. Please also send the lien." })],
  patients: [],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
  decisions: [{ id: "m1", category: "new-patient", updatedAt: "2026-11-09T16:00:00Z" }],
})[0];
assert.equal(answered.needsAnswer, false);
assert.equal(answered.category, "new-patient");

const custom = triageGoatMail({
  messages: [msg({ subject: "Records", body: "Please send the records for the file." })],
  patients: [],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
  buckets: [{ id: "records", name: "Records ask", keywords: ["records for the file"] }, { id: "other", name: "Other", keywords: [] }],
})[0];
assert.equal(custom.category, "records");
assert.equal(custom.label, "Records ask");
assert.equal(triageGoatMail({
  messages: [msg({ body: referral })],
  patients: [],
  appointments: [],
  todayIso: today,
  claimDocument: "lien",
  buckets: null,
})[0].category, "new-patient");

const steps = readFileSync(new URL("../../docs/goat-mail-setup.md", import.meta.url), "utf8");
assert.match(steps, /Mail\.Read/);
assert.match(steps, /GOAT_MAIL_CLIENT_ID/);
assert.match(steps, /GOAT_MAIL_CLIENT_SECRET/);
assert.match(steps, /api\/goat-mail\/callback/);
assert.match(steps, /20261109210000_goat_mail_connections\.sql/);
assert.match(steps, /Do not add Mail\.Send, Mail\.ReadWrite/);

const board = readFileSync(new URL("../../src/components/goat-mail-board.tsx", import.meta.url), "utf8");
const handbook = readFileSync(new URL("../../src/lib/handbook-goat.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/components/goat-page-view.tsx", import.meta.url), "utf8");
const copy = readFileSync(new URL("../../src/lib/goat-mail.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../src/components/app-shell.tsx", import.meta.url), "utf8");
const goatPage = readFileSync(new URL("../../src/app/(portal)/goat-page/page.tsx", import.meta.url), "utf8");
for (const src of [board, handbook, page, copy]) {
  assert.doesNotMatch(src, /GOAT_MAIL_CLIENT_ID|goat_mail_connections|Register the Microsoft app/);
  assert.doesNotMatch(src, /coming soon/i);
}
assert.doesNotMatch(board, /Entra/);
assert.doesNotMatch(page, /Entra/);
assert.match(copy, /isn't turned on for this office yet/);
assert.match(copy, /Sign in with your office Outlook to let G.O.A.T. read \(never send\) your email\./);
assert.match(board, /GOAT_MAIL_SETUP_LINE/);
assert.match(board, /GOAT_MAIL_CONNECT_LINE/);
assert.match(board, /Connect Outlook/);
assert.match(board, /data-goat-mail-page/);
assert.match(board, /Needs your answer/);
assert.match(board, /grid-cols-1/);
assert.doesNotMatch(board, /max-w-3xl/);
assert.match(board, /href="\/api\/goat-mail\/connect"/);
assert.match(board, /Open G.O.A.T. Mail/);
assert.match(board, /: "Connect"/);
assert.match(board, /href="\/goat-mail"/);
assert.match(shell, /href="\/goat-mail"/);
assert.ok(shell.indexOf('href="/goat-mail"') < shell.indexOf("<GlobalGoatButton"), "G.O.A.T. Mail sits with the G.O.A.T. sidebar link");
assert.equal(CLOUD_KEY_REGISTRY[GOAT_MAIL_FOLDERS_KEY], "workspace");
assert.equal(CLOUD_KEY_REGISTRY[GOAT_MAIL_SECRET_KEY], "workspace");
assert.match(board, /Microsoft secret expires on/);
assert.match(goatPage, /GoatMailSecretNotice/);
assert.equal(mailSecretDateLabel("2026-11-11"), "Nov. 11, 2026");
assert.equal(mailSecretDateLabel("2026-06-05"), "June 5, 2026");
assert.equal(mailSecretDateLabel("2026-05-01"), "May 1, 2026");
assert.equal(mailSecretDateLabel("2026-07-04"), "July 4, 2026");
const alert = mailSecretAlertText("2026-12-01");
assert.equal(alert, "G.O.A.T. Mail's Microsoft secret expires on Dec. 1, 2026. Create a new secret in Entra and update GOAT_MAIL_CLIENT_SECRET in Vercel.");
const secretToday = new Date(2026, 10, 11);
assert.equal(mailSecretDue("2026-12-11", secretToday), true);
assert.equal(mailSecretDue("2026-12-12", secretToday), false);
assert.equal(mailSecretDue("2026-11-01", secretToday), true);
assert.equal(mailSecretDue("", secretToday), false);
assert.equal(isInvalidClientSecretError("AADSTS7000215: Invalid client secret provided."), true);
assert.equal(isInvalidClientSecretError("AADSTS7000222: The provided client secret keys are expired."), true);
assert.equal(isInvalidClientSecretError("invalid_client"), true);
assert.equal(isInvalidClientSecretError("The mailbox connection expired. Connect it again."), false);
assert.match(GOAT_MAIL_SECRET_EXPIRED, /secret has expired/);

const folders: MailFolderChoice[] = [
  { id: "in", name: "Inbox", path: "Inbox", wellKnownName: "inbox" },
  { id: "ref", name: "Referrals", path: "Inbox / Referrals" },
  { id: "sent", name: "Sent Items", path: "Sent Items", wellKnownName: "sentitems" },
];
assert.deepEqual(chosenFolderIds(folders, null), ["in"]);
assert.deepEqual(chosenFolderIds(folders, ["missing", "ref"]), ["ref"]);
assert.deepEqual(chosenFolderIds(folders, []), ["in"]);
const merged = mergeMailMessages([
  [{ id: "a", subject: "Older", from: "a@firm.test", receivedAt: "2026-11-01T00:00:00Z", body: "" }, { id: "b", subject: "Shared", from: "b@firm.test", receivedAt: "2026-11-09T12:00:00Z", body: "" }],
  [{ id: "b", subject: "Shared", from: "b@firm.test", receivedAt: "2026-11-09T12:00:00Z", body: "" }, { id: "c", subject: "Newest", from: "c@firm.test", receivedAt: "2026-11-10T00:00:00Z", body: "" }],
]);
assert.deepEqual(merged.map((message) => message.id), ["c", "b", "a"]);

const server = readFileSync(new URL("../../src/lib/goat-mail-server.ts", import.meta.url), "utf8");
assert.match(server, /offline_access Mail\.Read User\.Read/);
assert.match(server, /\/me\/mailFolders\//);
assert.match(server, /childFolders/);
assert.match(server, /workspace_kv/);
assert.match(server, /https:\/\/www\.mynotegoat\.com/);
assert.match(server, /NEXT_PUBLIC_SITE_URL/);
assert.match(server, /GOAT_MAIL_REDIRECT_ORIGIN/);
assert.match(server, /GOAT_MAIL_SECRET_KEY/);
assert.match(server, /secretExpired/);
assert.doesNotMatch(server, /\/me\/messages\?/);
assert.doesNotMatch(server, /sendMail|Mail\.Send|Mail\.ReadWrite|\/reply|\/forward|\/move/);
assert.equal(server.includes('method: "POST"'), true);
assert.equal((server.match(/graph\.microsoft\.com/g) ?? []).length >= 1, true);

console.log("goat mail ok");
