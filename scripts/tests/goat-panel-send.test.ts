/**
 * Patient-page G.O.A.T. box: Send always answers from files already read,
 * and names files that still need OCR. Mock text only.
 * Run: npx tsx scripts/tests/goat-panel-send.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askGoat } from "../../src/lib/goat";
import { pendingFilesNote, type GoatFile } from "../../src/lib/goat-docs";
import { mockContext } from "./goat-eval/mock-patient";

let pass = 0;
let fail = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.log(`FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
  }
};

const scan: GoatFile = {
  id: "scan",
  name: "Scanned PM notes.pdf",
  folder: "Records",
  uploaded: "2026-03-02",
  status: "needsOcr",
  pages: null,
};

check("pm rom answers from the read report and names the unread scan", () => {
  const ctx = mockContext({
    files: [...(mockContext().files ?? []), scan],
  });
  const r = askGoat(ctx, "pm rom");
  const text = [
    ...r.answers.flatMap((a) => [a.title, ...a.lines, ...(a.groups ?? []).flatMap((g) => [g.lead, ...g.blocks.flatMap((b) => b.items)])]),
    ...(r.files?.notes ?? []),
  ].join("\n");
  assert.ok(r.answers.length > 0, "an answer is returned");
  assert.match(text, /35|flexion|Range of motion/i, text);
  assert.match(text, /isn'?t read yet|aren'?t read yet/i, text);
  assert.match(text, /scan/i, text);
});

check("pending note names scans and a file still being read", () => {
  const note = pendingFilesNote([
    { status: "read" },
    { status: "needsOcr" },
    { status: "needsOcr" },
    { status: "needsOcr" },
    { status: "reading" },
  ]);
  assert.match(note ?? "", /4 files aren't read yet \(3 scanned\)/);
  assert.match(note ?? "", /One is still being read/);
  assert.equal(pendingFilesNote([{ status: "read" }]), null);
});

const panel = readFileSync("src/components/goat-panel.tsx", "utf8");
check("patient-page button says Send and is not a disabled form submit", () => {
  assert.match(panel, />\s*Send\s*</);
  assert.doesNotMatch(panel, />\s*Ask\s*</);
  assert.match(panel, /type="button"/);
  assert.match(panel, /onKeyDown/);
  assert.match(panel, /submitBox/);
  assert.doesNotMatch(panel, /disabled=\{/);
  assert.doesNotMatch(panel, /<form/);
});

const popup = readFileSync("src/components/global-goat.tsx", "utf8");
check("global G.O.A.T. does not wait on a file read before answering", () => {
  assert.doesNotMatch(popup, /reader\.running && Date\.now\(\)/);
  assert.match(popup, />\s*Send\s*</);
});

console.log(`goat-panel-send: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
