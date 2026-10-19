/**
 * Eval: list replies link each patient ON its line (no duplicate "Name ↗" chip block),
 * and a junk record with no letters in its name ("†, †") shows "(No name) · Case #…".
 * Mock data only. Run: npx tsx scripts/tests/goat-eval/brief-links.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appointmentCheck, briefName, splitLinks, viewSchedule, type BriefData } from "../../../src/lib/goat-briefs";

const TODAY = "2026-10-19";
const appt = (id: string, pid: string, name: string, date: string) => ({ id, patientId: pid, patientName: name, provider: "", location: "", appointmentType: "Follow-Up Visit", caseLabel: "", room: "", date, startTime: "09:00", durationMin: 15, status: "Scheduled", note: "", overrideOfficeHours: false });
const data = {
  today: TODAY, tasks: [], locations: [], unreadMessages: 0,
  patients: [
    { id: "PT-1", fullName: "Mockian, Romy", caseStatus: "Active" },
    { id: "PT-2", fullName: "Sample, Ned", caseStatus: "Active" },
    { id: "PT-1700000000000-232", fullName: briefName("†, †", "PT-1700000000000-232"), caseStatus: "Active" },
  ],
  appointments: [appt("a1", "PT-1", "Mockian, Romy", "2026-07-16"), appt("a2", "PT-2", "Sample, Ned", "2026-10-20"), appt("a3", "PT-1700000000000-232", "†, †", "2026-07-16")],
} as unknown as BriefData;

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };

check("briefName keeps real names", () => assert.equal(briefName("Mockian, Romy", "PT-1"), "Mockian, Romy"));
check("briefName accented", () => assert.equal(briefName("Núñez, Ána", "PT-9"), "Núñez, Ána"));
for (const junk of ["†, †", "", "  ", ", ", "-", "??"]) check(`briefName junk "${junk}"`, () => assert.equal(briefName(junk, "PT-1700000000000-232"), "(No name) · Case #232"));

const ac = appointmentCheck(data);
check("no dagger row", () => assert.ok(!ac.text.includes("†")));
check("fallback row shown", () => assert.match(ac.text, /- \(No name\) · Case #232 — last visit 07\/16\/2026/));
const sp = splitLinks(ac.text, ac.links);
check("every patient link is inline", () => { assert.equal(sp.rest.length, 0); assert.equal(sp.inline.size, ac.links!.length); });
check("each inline link sits on its own name's line", () => { const lines = ac.text.split("\n"); for (const [i, l] of sp.inline) assert.ok(lines[i].includes(l.label)); });

const vs = viewSchedule(data);
const sv = splitLinks(vs.text, vs.links);
check("schedule: Open Schedule stays below", () => assert.ok(sv.rest.some((l) => l.label === "Open Schedule")));
check("schedule: no patient chip duplicated below", () => assert.ok(!sv.rest.some((l) => l.href.startsWith("/patients/"))));
check("non-patient links never inline", () => assert.equal(splitLinks("- Open Schedule", [{ label: "Open Schedule", href: "/appointments" }]).rest.length, 1));
check("same name twice → two lines", () => { const r = splitLinks("- Mock A — x\n- Mock A — y", [{ label: "Mock A", href: "/patients/1" }, { label: "Mock A", href: "/patients/2" }]); assert.deepEqual([...r.inline.keys()], [0, 1]); });

const ui = readFileSync("src/components/global-goat.tsx", "utf8");
check("UI renders LinkedText and only leftover links", () => { assert.ok(ui.includes("<LinkedText text={m.text} links={m.links} />")); assert.ok(ui.includes("splitLinks(m.text, m.links).rest.map")); });
check("UI cleans names for briefs", () => assert.ok(ui.includes("fullName: briefName(p.fullName, p.id)")));

console.log(`brief-links: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
