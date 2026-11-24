/** Chained one-paragraph Plan macros continue the same paragraph. Mock text only. Run: npx tsx scripts/tests/macro-inline.test.ts */
import assert from "node:assert/strict";
import { appendInlineToLastBlock, toInlineMacroHtml } from "../../src/lib/macro-inline";

const begin = "<p>Sample will begin decompression on the lumbar spine.</p>";
const second = "<p>Mr. Sample will also undergo 12 treatments of their lumbar spine.</p>";

// 1. One paragraph + one paragraph -> a single paragraph, one space between the sentences.
assert.equal(
  appendInlineToLastBlock(begin, second),
  "<p>Sample will begin decompression on the lumbar spine. Mr. Sample will also undergo 12 treatments of their lumbar spine.</p>",
);

// 2. A soft-wrapped source line (newline inside the paragraph) still joins inline.
const wrapped = "<p>Mr. Sample will also undergo\n12 treatments of their lumbar spine.</p>";
assert.equal(toInlineMacroHtml(wrapped), "Mr. Sample will also undergo 12 treatments of their lumbar spine.");
assert.ok(appendInlineToLastBlock(begin, wrapped)?.endsWith("undergo 12 treatments of their lumbar spine.</p>"));

// 3. Trailing <br> / blank wrappers don't break it; no double space; no extra paragraph.
const out = appendInlineToLastBlock("<p>First sentence.<br></p>", "<p>Second sentence.<br></p>");
assert.equal(out, "<p>First sentence. Second sentence.</p>");
assert.equal((out!.match(/<p>/g) ?? []).length, 1);

// 4. Only the LAST paragraph is extended; earlier lines stay separate.
assert.equal(
  appendInlineToLastBlock("<p>Cervical line.</p><p>Begin.</p>", "<p>Next.</p>"),
  "<p>Cervical line.</p><p>Begin. Next.</p>",
);

// 5. Prompt pills in the previous paragraph are kept.
const pill = '<span class="macro-prompt" contenteditable="false" data-macro-run-id="r1" data-prompt-id="q1">L4-L5</span>';
assert.equal(appendInlineToLastBlock(`<p>Segment ${pill}.</p>`, "<p>More.</p>"), `<p>Segment ${pill}. More.</p>`);

// 6. Multi-block or hard-line-break snippets are NOT merged (caller stacks them as before).
assert.equal(toInlineMacroHtml("<p>One.</p><p>Two.</p>"), null);
assert.equal(toInlineMacroHtml("<p>One.<br>Two.</p>"), null);
assert.equal(appendInlineToLastBlock(begin, "<p>One.</p><p>Two.</p>"), null);

// 7. Nothing to continue (empty note / empty last block / no block) -> null, stacks normally.
assert.equal(appendInlineToLastBlock("", second), null);
assert.equal(appendInlineToLastBlock("<p><br></p>", second), null);
assert.equal(appendInlineToLastBlock("plain text", second), null);

console.log("macro-inline: ok");
