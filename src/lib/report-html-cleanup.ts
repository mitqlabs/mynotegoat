/**
 * Post-processing for generated narrative reports (patient page →
 * Reports → Generate Narrative).
 *
 * Two jobs, both purely presentational — the report's words are never
 * changed:
 *
 * 1. Empty sections disappear. When a section heading (a bold line such
 *    as "Spinal Decompression", or a "Label:" line in plain templates)
 *    is followed only by auto-fields that came out empty, the heading
 *    and its blank body are removed, so nobody has to remember to delete
 *    a heading with nothing under it. Sections that contain any real
 *    text — typed into the template or produced by a field — are kept.
 *
 * 2. Spacing is made consistent. Templates built in the rich-text editor
 *    mix several kinds of spacing (empty `<blockquote><br></blockquote>`
 *    spacers, a `<br>` at the start of a block, literal blank lines that
 *    show because the report renders with `white-space: pre-wrap`, and
 *    nothing at all). After cleanup every section heading has exactly
 *    one blank line above it and none below it, and no run of blank
 *    lines is ever longer than one line.
 *
 * Runs in the browser (it needs DOMParser). Without DOMParser it only
 * strips the empty-field markers, so the output is never worse.
 */

/** Marks the spot where an auto-field resolved empty. A private-use
 *  character, so it can never collide with real report text. */
export const EMPTY_TOKEN_MARK = "\uE000";

/** Replace every plain `{{TOKEN}}` whose value is missing or blank with
 *  the empty-field marker, so the cleanup can tell "a field was empty
 *  here" apart from "the template author left this blank on purpose".
 *  `{{#if}}` / `{{/if}}` markers are left untouched. */
export function markEmptyTemplateTokens(body: string, context: Record<string, string>): string {
  return body.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (match, tokenRaw: string) => {
    const value = context[tokenRaw.toUpperCase()];
    return typeof value === "string" && value.trim().length > 0 ? match : EMPTY_TOKEN_MARK;
  });
}

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "CENTER", "DD", "DIV", "DL", "DT", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR",
  "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH",
  "THEAD", "TR", "UL",
]);
const OBJECT_TAGS = new Set(["IMG", "HR", "SVG", "CANVAS", "VIDEO", "IFRAME", "INPUT", "OBJECT", "EMBED"]);
const BOLD_TAGS = new Set(["B", "STRONG", "H1", "H2", "H3", "H4", "H5", "H6"]);
/** Elements that are meaningful even with no text inside. */
const KEEP_WHEN_EMPTY = new Set([
  "BR", "IMG", "HR", "LI", "TD", "TH", "TR", "TABLE", "TBODY", "THEAD", "TFOOT", "COL", "COLGROUP",
  "INPUT", "SVG", "CANVAS", "VIDEO", "IFRAME", "OBJECT", "EMBED",
]);

type Segment = { node: Text; start: number; end: number; bold: boolean };
type Terminator =
  | { kind: "br"; el: Element }
  | { kind: "nl"; node: Text; offset: number }
  | { kind: "soft" };

interface Line {
  segs: Segment[];
  term: Terminator;
  hasObject: boolean;
  inList: boolean;
}

// Invisible characters: whitespace, nbsp, zero-width chars, the marker.
const INVISIBLE_RE = /[\s\u00a0\u200b\u200c\u200d\u2060\ufeff\uE000]/g;

function segText(seg: Segment) {
  return seg.node.data.slice(seg.start, seg.end);
}
function lineText(line: Line) {
  return line.segs.map(segText).join("");
}
function visibleText(text: string) {
  return text.replace(INVISIBLE_RE, "");
}
function lineHasContent(line: Line) {
  return line.hasObject || visibleText(lineText(line)).length > 0;
}
function lineHasMark(line: Line) {
  return lineText(line).includes(EMPTY_TOKEN_MARK);
}
/** A visible empty line: a forced break (br / newline) with nothing on
 *  it, or a block whose only text is spaces / &nbsp;. Empty block
 *  boundaries take no height and are never recorded as lines. */
function lineIsBlank(line: Line) {
  if (lineHasContent(line) || lineHasMark(line)) return false;
  return line.term.kind !== "soft" || line.segs.some((seg) => seg.end > seg.start);
}
function headingText(line: Line) {
  return lineText(line).replace(INVISIBLE_RE, " ").replace(/\s+/g, " ").trim();
}
function lineIsAllBold(line: Line) {
  const visible = line.segs.filter((seg) => visibleText(segText(seg)).length > 0);
  return visible.length > 0 && visible.every((seg) => seg.bold);
}
function isBoldHeading(line: Line) {
  if (line.inList || line.hasObject || lineHasMark(line) || !lineIsAllBold(line)) return false;
  const text = headingText(line);
  // Dates / numbered rows ("01/02/2026 (Re-Exam)") are row labels, not headings.
  return text.length > 0 && text.length <= 100 && !/^\d/.test(text);
}
/** Headings that get the "one blank line above" treatment. Bold lines
 *  ending in ":" are inline lead-ins ("Cervical:", "Research title:"),
 *  so their spacing is left exactly as written. */
function isSpacingHeading(line: Line) {
  return isBoldHeading(line) && headingText(line).length <= 80 && !/:$/.test(headingText(line));
}
/** Headings whose section may be removed when empty: bold headings, or
 *  a short "Label:" line on its own (plain-text templates). */
function isRemovableHeading(line: Line) {
  if (isBoldHeading(line)) return true;
  if (line.inList || line.hasObject || lineHasMark(line) || !lineHasContent(line)) return false;
  const text = headingText(line);
  return text.length <= 60 && /^[A-Za-z]/.test(text) && /:$/.test(text);
}

function isBoldElement(el: Element) {
  if (BOLD_TAGS.has(el.tagName)) return true;
  const weight = (el as HTMLElement).style?.fontWeight ?? "";
  return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
}

function buildLines(root: Element): Line[] {
  const lines: Line[] = [];
  const newLine = (inList: boolean): Line => ({ segs: [], term: { kind: "soft" }, hasObject: false, inList });
  let current = newLine(false);
  const flush = (term: Terminator, inList: boolean) => {
    if (term.kind === "soft" && current.segs.length === 0 && !current.hasObject) {
      current = newLine(inList);
      return;
    }
    current.term = term;
    lines.push(current);
    current = newLine(inList);
  };

  const walk = (node: Node, bold: boolean, inList: boolean) => {
    if (node.nodeType === 3) {
      const text = node as Text;
      const data = text.data;
      if (inList) current.inList = true;
      let pos = 0;
      for (let idx = data.indexOf("\n"); idx !== -1; idx = data.indexOf("\n", pos)) {
        if (idx > pos) current.segs.push({ node: text, start: pos, end: idx, bold });
        flush({ kind: "nl", node: text, offset: idx }, inList);
        pos = idx + 1;
      }
      if (pos < data.length) current.segs.push({ node: text, start: pos, end: data.length, bold });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === "BR") {
      if (inList) current.inList = true;
      flush({ kind: "br", el }, inList);
      return;
    }
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return;
    const isBlock = BLOCK_TAGS.has(tag);
    const childList = inList || tag === "LI" || tag === "OL" || tag === "UL";
    if (isBlock) flush({ kind: "soft" }, childList);
    if (OBJECT_TAGS.has(tag)) {
      current.hasObject = true;
      if (isBlock) flush({ kind: "soft" }, inList);
      return;
    }
    const childBold = bold || isBoldElement(el);
    el.childNodes.forEach((child) => walk(child, childBold, childList));
    if (isBlock) flush({ kind: "soft" }, inList);
  };

  root.childNodes.forEach((child) => walk(child, false, false));
  flush({ kind: "soft" }, false);
  return lines;
}

/** Collects text deletions so offsets stay valid until they're applied. */
class TextEdits {
  private ranges = new Map<Text, Array<{ start: number; end: number; insert: string }>>();
  private brs: Element[] = [];

  cut(node: Text, start: number, end: number, insert = "") {
    if (end <= start && !insert) return;
    const list = this.ranges.get(node) ?? [];
    list.push({ start, end, insert });
    this.ranges.set(node, list);
  }

  removeLine(line: Line) {
    for (const seg of line.segs) this.cut(seg.node, seg.start, seg.end);
    this.removeTerminator(line);
  }

  removeTerminator(line: Line) {
    if (line.term.kind === "br") this.brs.push(line.term.el);
    else if (line.term.kind === "nl") this.cut(line.term.node, line.term.offset, line.term.offset + 1);
  }

  apply() {
    for (const [node, list] of this.ranges) {
      let data = node.data;
      list
        .sort((a, b) => b.start - a.start)
        .forEach(({ start, end, insert }) => {
          data = data.slice(0, start) + insert + data.slice(end);
        });
      node.data = data;
    }
    for (const br of this.brs) br.remove();
    const changed = this.ranges.size > 0 || this.brs.length > 0;
    this.ranges.clear();
    this.brs = [];
    return changed;
  }
}

/** Remove a heading plus its body when the body holds nothing but
 *  empty auto-fields. Repeats so a parent heading whose sub-sections
 *  all vanished goes too (its body is then only empty-field markers). */
function removeEmptySections(root: Element) {
  for (let pass = 0; pass < 20; pass++) {
    const lines = buildLines(root);
    const edits = new TextEdits();
    let removed = false;
    for (let i = 0; i < lines.length; i++) {
      if (!isRemovableHeading(lines[i])) continue;
      // A bold heading owns everything up to the next heading. A plain
      // "Label:" line (plain-text templates) owns only the lines up to
      // the next blank line, the way those templates separate sections.
      const plainLabel = !isBoldHeading(lines[i]);
      let end = i + 1;
      while (end < lines.length && !isRemovableHeading(lines[end])) {
        if (plainLabel && lineIsBlank(lines[end])) {
          end++; // the blank line separating it from the next section goes with it
          break;
        }
        end++;
      }
      const body = lines.slice(i + 1, end);
      const bodyIsEmpty = body.length > 0 && body.some(lineHasMark) && body.every((line) => !lineHasContent(line));
      if (!bodyIsEmpty) continue;
      // Leave one marker where the heading was so an enclosing heading
      // can see that this spot held an (empty) field.
      const [firstSeg, ...restSegs] = lines[i].segs;
      edits.cut(firstSeg.node, firstSeg.start, firstSeg.end, EMPTY_TOKEN_MARK);
      restSegs.forEach((seg) => edits.cut(seg.node, seg.start, seg.end));
      edits.removeTerminator(lines[i]);
      body.forEach((line) => edits.removeLine(line));
      removed = true;
      i = end - 1;
    }
    edits.apply();
    if (!removed) break;
  }
}

function stripMarks(root: Element) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  texts.forEach((text) => {
    if (text.data.includes(EMPTY_TOKEN_MARK)) text.data = text.data.split(EMPTY_TOKEN_MARK).join("");
  });
}

/** Drop elements left with no text and no line breaks / images inside
 *  (e.g. the `<b><u></u></b>` an empty conditional section leaves). */
function removeEmptyElements(root: Element) {
  const all = Array.from(root.querySelectorAll("*")).reverse();
  for (const el of all) {
    if (KEEP_WHEN_EMPTY.has(el.tagName.toUpperCase())) continue;
    if (el.textContent !== "") continue;
    if (el.querySelector("br, img, hr, li, table, input, svg, canvas, video, iframe, object, embed")) continue;
    el.remove();
  }
}

function normalizeSpacing(root: Element) {
  // Pass 1: trim runs of blank lines.
  {
    const lines = buildLines(root);
    const edits = new TextEdits();
    let i = 0;
    while (i < lines.length) {
      if (!lineIsBlank(lines[i])) {
        i++;
        continue;
      }
      let end = i;
      while (end < lines.length && lineIsBlank(lines[end])) end++;
      const prev = lines.slice(0, i).reverse().find(lineHasContent);
      const next = lines.slice(end).find(lineHasContent);
      const keep = !prev || !next ? 0 : isSpacingHeading(next) ? 1 : isSpacingHeading(prev) ? 0 : 1;
      for (let k = i; k < end - keep; k++) edits.removeLine(lines[k]);
      i = end;
    }
    edits.apply();
    removeEmptyElements(root);
  }
  // Pass 2: give every heading that has no blank line above it one.
  {
    const lines = buildLines(root);
    const doc = root.ownerDocument;
    const needsGap: Segment[] = [];
    let sawContent = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!lineHasContent(line)) continue;
      if (sawContent && isSpacingHeading(line) && !lineIsBlank(lines[i - 1])) needsGap.push(line.segs[0]);
      sawContent = true;
    }
    // Insert back to front so splitting a text node never shifts the
    // offsets of a heading still waiting earlier in the same node.
    needsGap.reverse().forEach((seg) => {
      const target = seg.start > 0 ? seg.node.splitText(seg.start) : seg.node;
      target.parentNode?.insertBefore(doc.createElement("br"), target);
    });
  }
}

/** Clean a rendered narrative report body (see the file comment). */
export function cleanNarrativeReportHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html.split(EMPTY_TOKEN_MARK).join("");
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  const root = doc.body;
  removeEmptySections(root);
  stripMarks(root);
  removeEmptyElements(root);
  normalizeSpacing(root);
  return root.innerHTML;
}

/** Trim per-line indentation / trailing spaces and collapse blank-line
 *  runs in free text (imaging findings pasted from a radiology report). */
export function normalizeMultilineText(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
