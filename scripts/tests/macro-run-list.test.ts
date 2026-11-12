/**
 * Inserted macro chips stay unique: a second run that never landed in the
 * note is dropped immediately (including the old click-in/out reconcile),
 * and a mirrored copy of the section HTML is not kept.
 * Run: npx tsx scripts/tests/macro-run-list.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collapseMirroredHtml,
  macroRunIdInHtml,
  markMacroRunSeen,
  reconcileMacroRuns,
  type MacroRunPresence,
} from "../../src/lib/macro-run-list";

type Run = { id: string; section: string; macroName: string };

function presence(): MacroRunPresence {
  return { seen: new Set(), missingSince: new Map() };
}

function span(id: string, label: string) {
  return `<span class="macro-prompt" contenteditable="false" data-macro-run-id="${id}" data-prompt-id="pain">${label}</span>`;
}

function sectionHtml(id: string, name: string) {
  return `<p><strong>${name}</strong></p><p>Pain: ${span(id, "8 /10")}</p>`;
}

const cervical = sectionHtml("run-cervical", "Cervical");
const both =
  cervical + sectionHtml("run-thoracic", "Thoracic");

// Insert records a run only when its id is in the HTML. A second call with
// another id (the doubled chip) is refused. Blur / click-out runs the same
// reconcile and the chip list stays the unique set.
{
  const memory = presence();
  const html = collapseMirroredHtml(cervical);
  assert.equal(macroRunIdInHtml(html, "run-cervical"), true);
  assert.equal(macroRunIdInHtml(html, "run-cervical-ghost"), false);

  const inserted: Run[] = [];
  const add = (run: Run, noteHtml: string) => {
    if (inserted.some((entry) => entry.id === run.id)) return;
    if (!macroRunIdInHtml(noteHtml, run.id)) return;
    markMacroRunSeen(memory, "enc-1", run.id);
    inserted.push(run);
  };
  add({ id: "run-cervical", section: "subjective", macroName: "Cervical" }, html);
  add({ id: "run-cervical", section: "subjective", macroName: "Cervical" }, html);
  add({ id: "run-cervical-ghost", section: "subjective", macroName: "Cervical" }, html);
  assert.deepEqual(inserted.map((run) => run.id), ["run-cervical"]);

  const afterBlur = reconcileMacroRuns({
    runs: [
      ...inserted,
      { id: "run-cervical-ghost", section: "subjective", macroName: "Cervical" },
    ],
    encounterId: "enc-1",
    section: "subjective",
    sectionHtml: html,
    presence: memory,
    now: 1_000,
  });
  assert.equal(afterBlur.anyMissing, false);
  assert.deepEqual(afterBlur.runs.map((run) => run.macroName), ["Cervical"]);
}

// Five inserts, then the click-in/out reconcile, stay at five unique chips
// even if a ghost copy of each run was sitting on the note.
{
  const memory = presence();
  const names = ["Cervical", "Thoracic", "Lumbar", "Shoulder", "Wrist/Hand"];
  let html = "";
  const runs: Run[] = [];
  for (const name of names) {
    const id = `run-${name}`;
    html += sectionHtml(id, name);
    if (macroRunIdInHtml(html, id) && !runs.some((run) => run.id === id)) {
      markMacroRunSeen(memory, "enc-1", id);
      runs.push({ id, section: "subjective", macroName: name });
    }
    const ghostId = `${id}-ghost`;
    if (macroRunIdInHtml(html, ghostId)) {
      runs.push({ id: ghostId, section: "subjective", macroName: name });
    }
  }
  const ghosts = names.map((name) => ({
    id: `run-${name}-ghost`,
    section: "subjective",
    macroName: name,
  }));
  const afterBlur = reconcileMacroRuns({
    runs: [...runs, ...ghosts],
    encounterId: "enc-1",
    section: "subjective",
    sectionHtml: html,
    presence: memory,
    now: 5_000,
  });
  assert.deepEqual(
    afterBlur.runs.map((run) => run.macroName),
    names,
  );
}

// A pill that was on the note and then cut is kept during grace, and dropped
// once the grace window has passed without it coming back.
{
  const memory = presence();
  const html = both;
  const first = reconcileMacroRuns({
    runs: [
      { id: "run-cervical", section: "subjective", macroName: "Cervical" },
      { id: "run-thoracic", section: "subjective", macroName: "Thoracic" },
    ],
    encounterId: "enc-1",
    section: "subjective",
    sectionHtml: html,
    presence: memory,
    now: 10_000,
  });
  assert.equal(first.runs.length, 2);
  const cut = reconcileMacroRuns({
    runs: first.runs,
    encounterId: "enc-1",
    section: "subjective",
    sectionHtml: sectionHtml("run-thoracic", "Thoracic"),
    presence: memory,
    now: 10_100,
  });
  assert.equal(cut.anyMissing, true);
  assert.deepEqual(cut.runs.map((run) => run.id), ["run-cervical", "run-thoracic"]);
  const expired = reconcileMacroRuns({
    runs: cut.runs,
    encounterId: "enc-1",
    section: "subjective",
    sectionHtml: sectionHtml("run-thoracic", "Thoracic"),
    presence: memory,
    now: 10_100 + 5_000,
  });
  assert.deepEqual(expired.runs.map((run) => run.id), ["run-thoracic"]);
}

// The whole section mirrored (same run id twice) collapses to one copy.
{
  const mirrored = `${both}${both}`;
  assert.equal(collapseMirroredHtml(mirrored), both);
  assert.equal((collapseMirroredHtml(mirrored).match(/run-cervical/g) ?? []).length, 1);
}

// Two real inserts are not an exact mirror, so both stay.
{
  const distinct = sectionHtml("run-a", "Cervical") + sectionHtml("run-b", "Cervical");
  assert.equal(collapseMirroredHtml(distinct), distinct);
}

const editor = readFileSync(new URL("../../src/components/rich-text-template-editor.tsx", import.meta.url), "utf8");
assert.match(editor, /collapseMirroredHtml/);
const hook = readFileSync(new URL("../../src/hooks/use-encounter-notes.ts", import.meta.url), "utf8");
assert.match(hook, /macroRunIdInHtml\(sectionHtml, createdId\)/);
assert.match(hook, /markMacroRunSeen/);

console.log("macro-run-list: ok");
