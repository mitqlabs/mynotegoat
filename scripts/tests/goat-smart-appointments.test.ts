/**
 * Smart mode sources include the patient's appointments one by one.
 * Mock data only. Run:  npx tsx scripts/tests/goat-smart-appointments.test.ts
 */
import assert from "node:assert/strict";
import { buildAiSources, sourcesForPrompt } from "../../src/lib/goat-ai/sources";
import type { GoatAppointment, GoatContext } from "../../src/lib/goat";

const appt = (date: string, type: string, status: string, startTime = "10:00", note = ""): GoatAppointment => ({ date, startTime, type, status, note });
const base: GoatContext = {
  today: "2026-10-10", patientName: "Doe, Jane", dob: "", phone: "", email: "", address: "", alerts: [], attorney: "", caseStatus: "", lien: "", review: "", isCashPatient: false, doi: "", initialExam: "", priorCare: "", xrayFindings: "", mriFindings: "", specialistRecommendations: "", imaging: [], specialists: [], notes: "", encounters: [], plans: [], diagnoses: [], details: null, billing: null, termGroups: [], people: [],
  appointments: [
    appt("2026-08-03", "New Patient", "Check Out", "09:00"),
    appt("2026-08-12", "Spinal Decompression - L/S", "Canceled", "15:30", "Pt called - car trouble"),
    appt("2026-08-17", "Follow-Up Visit", "Reschedule"),
    appt("2026-09-14", "PI Discharge Visit", "Check Out", "11:15"),
    appt("2026-10-14", "Follow-Up Visit", "Scheduled", "14:00"),
  ],
};
let pass = 0;
const t = (name: string, fn: () => void) => { fn(); pass++; console.log("PASS", name); };

t("cancel question: the canceled appointment is in the prompt", () => {
  const r = buildAiSources(base, "when did they cancel their appt");
  const text = sourcesForPrompt(r.sources);
  assert.match(text, /08\/12\/2026 \(Wed\) 3:30 PM — Spinal Decompression - L\/S — Note: Pt called - car trouble/);
  assert.match(r.sources[0].title, /^Canceled appointments/);
});

t("visit question without a list card: every appointment is added", () => {
  const r = buildAiSources(base, "tell me about her appointments");
  const s = r.sources.find((x) => x.title.startsWith("Appointments, newest first"));
  assert.ok(s, "appointment list source");
  assert.equal(s!.lines[0].text, "10/14/2026 (Wed) 2:00 PM — Follow-Up Visit · Scheduled");
  assert.equal(s!.lines.length, 5);
});

t("hidden appointments: nothing added", () => {
  const r = buildAiSources({ ...base, appointments: null }, "when did they cancel their appt");
  assert.doesNotMatch(sourcesForPrompt(r.sources), /08\/12\/2026/);
});

t("unrelated question: no appointment list", () => {
  const r = buildAiSources(base, "lumbar MRI findings");
  assert.ok(!r.sources.some((x) => x.section === "appointments"));
});
console.log(`\n${pass} passed`);
