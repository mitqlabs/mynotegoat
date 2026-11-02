/**
 * Report "Specialists" section: G.O.A.T.-card layout — "1. Dr. Name", "Recommendations:",
 * each region as a bold heading with its text on the line below, one alternative per
 * line, no 1a/1b lettering. Mock data only.
 * Run:  npx tsx scripts/tests/report-specialists.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatSpecialistSummary, parseRecommendationGroups } from "../../src/lib/report-generator";

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };

const entry = (specialist: string, recommendations: string) =>
  ({ specialist, recommendations, sentDate: "", completedDate: "" }) as unknown as Parameters<typeof formatSpecialistSummary>[0][number];

const goatText = [
  "Cervical",
  "- Right C5-C6 interlaminar epidural injection with platelet rich plasma.",
  "",
  "Lumbar",
  "- Left L4-L5 transforaminal epidural injection.",
  "- Left L5-S1 facet injection.",
  "",
  "Alternatives",
  "- Alternative to Injection Therapy: Four sessions of electrical nerve stimulation.",
  "- Alternative to Pain Management: Chiropractic care.",
].join("\n");

const text = (html: string) =>
  html.replace(/<\/div>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").trim().split("\n");

test("groups: headings with their items, bullets stripped", () => {
  const g = parseRecommendationGroups(goatText);
  assert.deepEqual(g.map((x) => x.heading), ["Cervical", "Lumbar", "Alternatives"]);
  assert.equal(g[1].items.length, 2);
  assert.ok(!g[0].items[0].startsWith("-"));
});
test("unbulleted lines (as typed by hand) group the same way", () => {
  const g = parseRecommendationGroups("Cervical\nRight C4-C5 facet PRP injections.\nLumbar\nLeft L4-L5 epidural.");
  assert.deepEqual(g.map((x) => x.heading), ["Cervical", "Lumbar"]);
  assert.deepEqual(g[0].items, ["Right C4-C5 facet PRP injections."]);
});
test("no headings: items under Recommendations, no invented heading", () => {
  const g = parseRecommendationGroups("Continue conservative care.\nRe-evaluate in four weeks.");
  assert.equal(g.length, 1);
  assert.equal(g[0].heading, "");
  assert.equal(g[0].items.length, 2);
});
test("layout: name, Recommendations:, bold heading then text on the next line", () => {
  const html = formatSpecialistSummary([entry("Dr. Jane Roe", goatText)]);
  assert.deepEqual(text(html), [
    "1. Dr. Jane Roe",
    "Recommendations:",
    "Cervical",
    "Right C5-C6 interlaminar epidural injection with platelet rich plasma.",
    "Lumbar",
    "Left L4-L5 transforaminal epidural injection.",
    "Left L5-S1 facet injection.",
    "Alternatives",
    "Alternative to Injection Therapy: Four sessions of electrical nerve stimulation.",
    "Alternative to Pain Management: Chiropractic care.",
  ]);
  assert.ok(html.includes("<b>Cervical</b>") && html.includes("<b>Alternatives</b>"));
});
test("no inline 'Cervical:' and no 1a/1b lettering", () => {
  const html = formatSpecialistSummary([entry("Dr. Jane Roe", goatText), entry("Dr. Sam Poe", goatText)]);
  const plain = text(html).join("\n");
  assert.ok(!/Cervical:/.test(plain));
  assert.ok(!/^\s*\d[a-z][.)]/m.test(plain));
  assert.ok(plain.includes("2. Dr. Sam Poe"));
});
test("alternatives are indented deeper; wrapped lines stay inside their block", () => {
  const html = formatSpecialistSummary([entry("Dr. Jane Roe", goatText)]);
  assert.ok(html.includes('padding-left:3em">Alternative to Injection Therapy'));
  assert.ok(html.includes('padding-left:1.5em">Right C5-C6'));
  assert.ok(!html.includes("\n"));
});
test("text is escaped; specialist with no recommendations is just the name; empty list is empty", () => {
  const html = formatSpecialistSummary([entry("Dr. <b>X</b>", "Lumbar\n<script>alert(1)</script>")]);
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.equal(text(formatSpecialistSummary([entry("Dr. Jane Roe", "")])).join("|"), "1. Dr. Jane Roe");
  assert.equal(formatSpecialistSummary([]), "");
});
test("wiring: SPECIALIST_SUMMARY is a raw-HTML token and the cleanup keeps these headings tight", () => {
  const gen = readFileSync("src/lib/report-generator.ts", "utf8");
  assert.ok(/new Set<string>\(\["SPECIALIST_SUMMARY"\]\)/.test(gen));
  const clean = readFileSync("src/lib/report-html-cleanup.ts", "utf8");
  assert.ok(clean.includes('closest("[data-rec-block]")'));
});

console.log(`\n${passed} passed`);
