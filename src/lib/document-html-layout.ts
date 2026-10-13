/**
 * Post-processing helpers for document-template HTML. Shared between
 * the generated PDF (patient-case-file `buildPrintableDocumentHtml`)
 * and the live settings preview (document-template-settings-panel) so
 * both see the exact same label/value layout.
 *
 * The markup produced here pairs with the `.kv` / `.kv-cont` / `.kv-label`
 * / `.kv-value` CSS defined in both places. See globals.css for the
 * preview rules and patient-case-file's inline style block for the PDF.
 */

/** Strip leading whitespace from each line ONLY IF the line is HTML
 *  source-formatting whitespace (line begins with whitespace followed by
 *  `<`). Lines whose first non-whitespace char is text content (e.g. a
 *  user-aligned column like `                          818-548-0022`)
 *  keep their leading whitespace so `white-space: pre-wrap` rendering
 *  preserves the alignment the template author intended.
 *
 *  Original behaviour was `^[ \t]+` (strip ALL leading whitespace per
 *  line). That destroyed manually-aligned templates while still helping
 *  AI-generated narrative HTML where the indent is just nesting. */
export function stripHtmlIndentation(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html; // plain text — keep tabs
  return html.replace(/^[ \t]+(?=<)/gm, "");
}

/**
 * Rewrite `<p>Label:  value</p>` (or `<div>...</div>`) paragraphs as
 * `<div class="kv">` rows with a fixed-width label column, then re-tag
 * subsequent orphan paragraphs as `<div class="kv-cont">` continuation
 * rows so multi-line values (Imaging Center → phone → address) all sit
 * in the value column instead of wrapping back to the left margin.
 *
 * Handles BOTH `<p>` and `<div>` blocks because contenteditable rich-text
 * editors emit either depending on the browser, and merges any existing
 * `class="..."` attribute on the original block so we don't end up with
 * duplicate `class` attributes that some browsers resolve by dropping
 * our `kv-cont` and breaking the continuation indent silently.
 */
export function applyLabelValueHangingIndent(html: string): string {
  // Diagnostic: dump the raw input HTML (pre-transform) so we can
  // see EXACTLY what the helper is being asked to process. The
  // alignment bugs I keep failing to fix correctly are caused by my
  // assumptions about the template's HTML structure not matching the
  // truth. Opt-in, dev builds only (it prints patient report HTML): set window.__DOC_LAYOUT_DEBUG = true.
  if (typeof window !== "undefined") {
    const w = window as unknown as { __DOC_LAYOUT_DEBUG?: boolean };
    if (process.env.NODE_ENV !== "production" && w.__DOC_LAYOUT_DEBUG === true) {
      console.log("[doc-layout] input HTML:\n" + html);
    }
  }

  const labelPatternSource = "[A-Z][A-Za-z0-9 ()&/\\-]*?:";
  // Match either <p ...> ... </p> or <div ...> ... </div> as a "block".
  // Case-insensitive so contenteditable's mix of <P> / <DIV> works too.
  const blockOpen = "<(?:p|div)";
  const blockClose = "<\\/(?:p|div)>";

  // Defensive cleanup: strip soft-hyphens and zero-width spaces that
  // sometimes survive copy/paste from PDFs. These characters allow
  // mid-word line breaks (e.g. "s&shy;econdary" -> "s | econdary")
  // -- the "derangements econdary" artifact we kept seeing.
  let next = html.replace(/[­​‌‍﻿]/g, "");

  // (Removed an earlier pre-process that split <p|div>A<br>B</p|div>
  // into separate blocks. It tore through nested elements — e.g. the
  // title <div><span><u><br></u></span></div> ended up as orphaned
  // `<p><span><u></p>` / `<p></u></span></p>` halves with the open/
  // close tags split across paragraphs. Instead we now guard Phase 1
  // and Phase 2 against multi-line blocks below.)

  // Helper: is this a "blank spacer" block — i.e. nothing but
  // whitespace, &nbsp; and / or <br>? Used to BREAK the kv-cont chain
  // so the section AFTER a blank line (Attorney Information, doctor
  // signature, etc.) doesn't keep getting indented under the previous
  // value column.
  const isBlankInner = (inner: string): boolean => {
    const stripped = inner
      .replace(/<br\s*\/?>/gi, "")
      .replace(/&nbsp;/gi, "")
      .replace(/\s+/g, "");
    return stripped.length === 0;
  };

  // Helper: does the content of a block contain its own internal line
  // breaks (literal `\n` between text content, not just decorative
  // whitespace at the very start/end)? Multi-line blocks indicate the
  // template uses pre-wrap + manual whitespace alignment for layout —
  // we MUST NOT convert those to kv-rows because Phase 1's lazy
  // `[\s\S]*?</block>` will swallow every line into the first label's
  // value, gluing DOB / DOI / Phone into "Name:"'s value column and
  // pushing Attorney Information into Clinical Impression's value.
  const hasInnerLineBreak = (inner: string): boolean => {
    const stripped = inner.replace(/^\s+|\s+$/g, "");
    return /\n/.test(stripped) || /<br\s*\/?>/i.test(stripped);
  };

  // Helper: take an attrs string from the original block and merge our
  // own class into any existing class="..." so we don't emit duplicate
  // class attributes (which browsers may resolve by keeping the LATER
  // class and dropping ours, breaking the kv-cont layout silently).
  const mergeClassAttr = (attrs: string, ourClass: string): string => {
    const trimmed = attrs.trim();
    if (!trimmed) return ` class="${ourClass}"`;
    const classRe = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
    const m = trimmed.match(classRe);
    if (!m) return ` class="${ourClass}" ${trimmed}`;
    const existing = (m[2] ?? m[3] ?? "").trim();
    const merged = existing ? `${ourClass} ${existing}` : ourClass;
    const replaced = trimmed.replace(classRe, `class="${merged}"`);
    return ` ${replaced}`;
  };

  // Phase 1: turn single-line "Label: value" blocks into .kv rows.
  // Handles both <p> and <div> as the wrapping block. Multi-line
  // blocks (literal `\n` or <br> inside the content) are LEFT ALONE
  // — those rely on `white-space: pre-wrap` + manual whitespace for
  // their own column alignment, and the regex's lazy quantifier would
  // otherwise swallow every following line into the first label's
  // value column.
  next = next.replace(
    new RegExp(
      `${blockOpen}([^>]*)>\\s*(${labelPatternSource})(?:&nbsp;|\\s)+([\\s\\S]*?)${blockClose}`,
      "gi",
    ),
    (match, attrs: string, label: string, rest: string) => {
      if (hasInnerLineBreak(rest)) return match;
      const mergedAttrs = mergeClassAttr(attrs, "kv");
      return `<div${mergedAttrs}><span class="kv-label">${label}</span><span class="kv-value">${rest.trim()}</span></div>`;
    },
  );

  // Phase 2: tag every block that immediately follows a .kv row or a
  // previous .kv-cont AND doesn't start with a new label as a
  // continuation. Emits <div class="kv-cont"> so the universal
  // paragraph rules don't interfere. Iterates so chains of 3+
  // continuation lines (Imaging Center -> phone -> address) all flip.
  //
  // The negative lookahead at the start of the right-side attrs
  // excludes blocks that ALREADY have a kv / kv-cont class — without
  // it, each iteration re-matches the just-converted kv-cont div as a
  // fresh `<div>` to "continue" and stamps the class on itself again
  // (we'd loop forever stacking duplicate classes and never advance to
  // the actual orphan block).
  const continuationRe = new RegExp(
    `(<div\\s[^>]*class="(?:[^"]*\\s)?kv(?:-cont)?(?:\\s[^"]*)?"[^>]*>[\\s\\S]*?<\\/div>)` +
      `\\s*` +
      `${blockOpen}` +
      `(?![^>]*\\bclass\\s*=\\s*["'][^"']*\\bkv(?:-cont)?\\b)` +
      `([^>]*)>` +
      `(?!\\s*${labelPatternSource}(?:&nbsp;|\\s))` +
      `([\\s\\S]*?)` +
      `${blockClose}`,
    "gi",
  );
  for (let i = 0; i < 20; i++) {
    const before = next;
    next = next.replace(continuationRe, (match, prev: string, attrs: string, cont: string) => {
      // Blank spacer block — leave it as-is so the chain naturally
      // breaks here. Without this guard, a `<p><br></p>` between two
      // sections (imaging block -> blank line -> attorney info) gets
      // tagged kv-cont and every section after it inherits the value-
      // column indent, pushing the entire bottom of the document to
      // the right.
      if (isBlankInner(cont)) return match;
      const mergedAttrs = mergeClassAttr(attrs, "kv-cont");
      return `${prev}<div${mergedAttrs}>${cont.trim()}</div>`;
    });
    if (before === next) break;
  }

  if (typeof window !== "undefined") {
    const w = window as unknown as { __DOC_LAYOUT_DEBUG?: boolean };
    if (process.env.NODE_ENV !== "production" && w.__DOC_LAYOUT_DEBUG === true) {
      console.log("[doc-layout] output HTML:\n" + next);
    }
  }

  return next;
}
