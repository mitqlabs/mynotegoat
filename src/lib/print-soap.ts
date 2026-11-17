/**
 * Print layout for a case's SOAP notes.
 *
 * Used by Print Encounters and by narratives that attach the same notes.
 * Each visit starts on its own page. A long visit may continue onto later
 * pages. The printed page is black text on white, with no card borders that
 * would slice in half at a page break.
 */

export type SoapPrintSection = "subjective" | "objective" | "assessment" | "plan";

export type SoapPrintEncounter = {
  encounterDate: string;
  provider: string;
  appointmentType: string;
  soap: Partial<Record<SoapPrintSection, string>>;
};

export type SoapPrintOffice = {
  officeName: string;
  officeAddress: string;
  officePhone: string;
  officeFax: string;
  officeEmail: string;
  logoDataUrl: string;
  patientName: string;
  documentTitle?: string;
};

const SECTIONS: Array<{ key: SoapPrintSection; label: string }> = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
];

/** A region line or short paragraph. Taller blocks stay breakable so Chrome
 *  does not shrink the whole printout to fit one unbreakable box. */
const KEEP_TOGETHER_CHARS = 900;

export function escapePrintHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function visibleText(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPrintChrome(html: string) {
  return html
    .replace(/<span\b[^>]*\bclass\s*=\s*["'][^"']*\bmacro-prompt\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, "$1")
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\scontenteditable\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\t/g, "")
    .replace(/&(emsp|ensp|Tab|#9|#x9);/gi, "")
    .replace(/^[ \t]+/gm, "");
}

function isHeadingLine(text: string, inner: string) {
  if (text.length < 2 || text.length > 48 || /^\d/.test(text)) return false;
  if (/:\s*$/.test(text) && !/[.!?]/.test(text.slice(0, -1))) return true;
  const only = inner.replace(/&nbsp;|&#160;/gi, " ").trim();
  return /^<(strong|b)\b[^>]*>[\s\S]*<\/\1>$/i.test(only);
}

function decorateBlock(tag: string, inner: string) {
  const body = inner.trim();
  const text = visibleText(body);
  if (!text) return "";
  const classes: string[] = [];
  const hasImage = /<img\b/i.test(body);
  if (!hasImage && text.length <= KEEP_TOGETHER_CHARS) classes.push("soap-keep");
  if (isHeadingLine(text, body)) classes.push("soap-heading");
  const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
  return `<${tag}${classAttr}>${body}</${tag}>`;
}

function splitOnBreaks(inner: string) {
  return inner
    .split(/<br\s*\/?\s*>/gi)
    .map((part) => part.trim())
    .filter((part) => visibleText(part).length > 0);
}

function paragraphsFrom(inner: string) {
  const pieces = splitOnBreaks(inner);
  const source = pieces.length ? pieces : [inner];
  return source.map((piece) => decorateBlock("p", piece)).join("");
}

function rewriteList(html: string) {
  return html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => {
    const pieces = splitOnBreaks(inner);
    if (pieces.length <= 1) return decorateBlock("li", inner);
    return pieces.map((piece) => decorateBlock("li", piece)).join("");
  });
}

const TOP_LEVEL_SOURCE =
  "<(p|div|li|h[1-6]|blockquote)\\b[^>]*>[\\s\\S]*?<\\/\\1>|<ul\\b[^>]*>[\\s\\S]*?<\\/ul>|<ol\\b[^>]*>[\\s\\S]*?<\\/ol>|<table\\b[^>]*>[\\s\\S]*?<\\/table>";

function rewriteTopLevel(html: string): string {
  const re = new RegExp(TOP_LEVEL_SOURCE, "gi");
  let out = "";
  let last = 0;
  for (const match of html.matchAll(re)) {
    const index = match.index ?? 0;
    const before = html.slice(last, index);
    if (visibleText(before)) out += paragraphsFrom(before);
    const full = match[0];
    const tag = (match[1] || "").toLowerCase();
    if (!tag) {
      out += /<li\b/i.test(full) ? rewriteList(full) : full;
    } else {
      const inner = full.replace(/^<[^>]+>/, "").replace(new RegExp(`</${tag}>$`, "i"), "");
      if (/<(p|div|ul|ol|table|li|h[1-6]|blockquote)\b/i.test(inner)) {
        out += `<${tag}>${rewriteTopLevel(inner)}</${tag}>`;
      } else {
        const pieces = splitOnBreaks(inner);
        if (pieces.length <= 1) out += decorateBlock(tag, inner);
        else out += pieces.map((piece) => decorateBlock(tag === "li" ? "li" : "p", piece)).join("");
      }
    }
    last = index + full.length;
  }
  const tail = html.slice(last);
  if (visibleText(tail)) out += paragraphsFrom(tail);
  return out;
}

/** Turn stored note HTML into print HTML. Short region lines stay whole. */
export function prepareSoapPrintHtml(html: string | undefined | null) {
  const cleaned = stripPrintChrome(html ?? "").trim();
  if (!visibleText(cleaned)) return '<p class="soap-keep">-</p>';
  const prepared = rewriteTopLevel(cleaned);
  return visibleText(prepared) ? prepared : '<p class="soap-keep">-</p>';
}

function officeBlock(config: SoapPrintOffice) {
  const logo = config.logoDataUrl.trim()
    ? `<img alt="Office logo" src="${escapePrintHtml(config.logoDataUrl)}" class="logo" />`
    : "";
  const fax = config.officeFax.trim() ? ` &nbsp;|&nbsp; F: ${escapePrintHtml(config.officeFax)}` : "";
  return `<header class="letterhead">
      ${logo}
      <div class="office-info">
        <p class="office-name">${escapePrintHtml(config.officeName)}</p>
        <p class="office-detail">${escapePrintHtml(config.officeAddress)}<br />T: ${escapePrintHtml(config.officePhone)}${fax}<br />${escapePrintHtml(config.officeEmail)}</p>
      </div>
    </header>
    <div class="patient-banner">
      <div>
        <p class="label">Patient</p>
        <p class="name">${escapePrintHtml(config.patientName)}</p>
      </div>
      <p class="doc-title">Clinical SOAP Notes</p>
    </div>`;
}

export function buildSoapEncounterMarkup(encounters: SoapPrintEncounter[]) {
  return encounters
    .map((encounter, index) => {
      const pageClass = index === 0 ? "encounter" : "encounter encounter-new-page";
      const sections = SECTIONS.map(
        (section) => `<section class="soap-section">
      <div class="soap-label">${section.label}</div>
      <div class="soap-content">${prepareSoapPrintHtml(encounter.soap[section.key])}</div>
    </section>`,
      ).join("");
      return `<article class="${pageClass}">
    <header class="visit-header">
      <div class="visit-title">
        <p class="visit-date">${escapePrintHtml(encounter.encounterDate)}</p>
        <p class="visit-type">${escapePrintHtml(encounter.appointmentType)}</p>
      </div>
      <p class="visit-provider">Provider: <strong>${escapePrintHtml(encounter.provider)}</strong></p>
    </header>
    ${sections}
  </article>`;
    })
    .join("");
}

function notesFooter(officeName: string) {
  return `<p class="print-footer">${escapePrintHtml(officeName)} &bull; Confidential Medical Record</p>`;
}

/** Encounter pages that precede a narrative or billing statement. */
export function buildSoapPrintFragment(config: SoapPrintOffice & { encounters: SoapPrintEncounter[] }) {
  if (!config.encounters.length) return "";
  return `<div class="soap-pages soap-print">
    ${officeBlock(config)}
    ${buildSoapEncounterMarkup(config.encounters)}
    ${notesFooter(config.officeName)}
  </div>`;
}

/** Standalone Print Encounters document. */
export function buildSoapPrintDocument(config: SoapPrintOffice & { encounters: SoapPrintEncounter[] }) {
  const title = config.documentTitle?.trim() || `SOAP Notes - ${config.patientName}`;
  const encounters = config.encounters.length
    ? buildSoapEncounterMarkup(config.encounters)
    : '<p class="empty-notes">No encounters found for this patient.</p>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapePrintHtml(title)}</title>
    <style>
      ${SOAP_PRINT_PAGE_CSS}
      ${SOAP_PRINT_BASE_CSS}
      ${SOAP_PRINT_CSS}
    </style>
  </head>
  <body class="soap-print">
    <main>
      ${officeBlock(config)}
      ${encounters}
      ${notesFooter(config.officeName)}
    </main>
  </body>
</html>`;
}

/** Page box for the standalone notes. Narratives keep their own @page. */
export const SOAP_PRINT_PAGE_CSS = `
@page {
  size: Letter;
  margin: 0.7in;
}
`;

const SOAP_PRINT_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body.soap-print {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #111;
}
body.soap-print {
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 12px;
  line-height: 1.45;
}
`;

/**
 * Rules for `.soap-print`. Safe inside the narrative document after its
 * `.soap-pages * { all: unset }` reset: every property the notes need is
 * set again here. Page breaks use !important so a later reset cannot stack
 * the next visit under the previous one.
 */
export const SOAP_PRINT_CSS = `
.soap-print {
  display: block;
  background: #fff;
  color: #111;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 12px;
  line-height: 1.45;
}
.soap-print, .soap-print * {
  overflow-wrap: anywhere;
  max-width: 100%;
}
.soap-print button,
.soap-print input,
.soap-print select,
.soap-print textarea,
.soap-print nav,
.soap-print .no-print {
  display: none !important;
}
.soap-print .letterhead {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 0 0 12px 0;
  padding: 0 0 8px 0;
  border: 0;
  border-bottom: 1.5pt solid #111;
  background: transparent;
  break-inside: avoid;
  page-break-inside: avoid;
}
.soap-print .logo {
  display: block;
  height: 64px;
  width: auto;
  max-width: 180px;
  object-fit: contain;
  flex-shrink: 0;
}
.soap-print .office-info { flex: 1; text-align: right; margin: 0; padding: 0; }
.soap-print .office-name {
  display: block;
  margin: 0;
  padding: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  color: #111;
}
.soap-print .office-detail {
  display: block;
  margin: 2px 0 0 0;
  padding: 0;
  font-size: 11px;
  line-height: 1.45;
  color: #111;
}
.soap-print .patient-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  margin: 0 0 16px 0;
  padding: 0 0 8px 0;
  border: 0;
  border-bottom: 1pt solid #111;
  border-radius: 0;
  background: transparent;
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: avoid;
  page-break-after: avoid;
}
.soap-print .patient-banner .label {
  display: block;
  margin: 0;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #111;
}
.soap-print .patient-banner .name {
  display: block;
  margin: 1px 0 0 0;
  font-size: 14px;
  font-weight: 700;
  color: #111;
}
.soap-print .patient-banner .doc-title {
  display: block;
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #111;
}
.soap-print .encounter {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  break-inside: auto;
  page-break-inside: auto;
}
.soap-print .encounter-new-page {
  break-before: page !important;
  page-break-before: always !important;
}
.soap-print .visit-header {
  display: block;
  margin: 0 0 12px 0;
  padding: 0 0 6px 0;
  border: 0;
  border-bottom: 1.25pt solid #111;
  background: transparent;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  break-after: avoid !important;
  page-break-after: avoid !important;
}
.soap-print .visit-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
}
.soap-print .visit-date,
.soap-print .visit-type,
.soap-print .visit-provider {
  display: block;
  margin: 0;
  padding: 0;
  color: #111;
  background: transparent;
}
.soap-print .visit-date { font-size: 14px; font-weight: 700; }
.soap-print .visit-type { font-size: 12px; font-weight: 700; text-align: right; }
.soap-print .visit-provider { margin-top: 3px; font-size: 12px; }
.soap-print .soap-section {
  display: block;
  margin: 0 0 12px 0;
  padding: 0;
  border: 0;
  background: transparent;
  break-inside: auto;
  page-break-inside: auto;
}
.soap-print .soap-label {
  display: block;
  margin: 0 0 4px 0;
  padding: 0 0 2px 0;
  border: 0;
  border-bottom: 0.6pt solid #111;
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #111;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  break-after: avoid !important;
  page-break-after: avoid !important;
}
.soap-print .soap-label + .soap-content {
  break-before: avoid;
  page-break-before: avoid;
}
.soap-print .soap-content {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  line-height: 1.45;
  color: #111;
  break-inside: auto;
  page-break-inside: auto;
  orphans: 2;
  widows: 2;
}
.soap-print .soap-content p,
.soap-print .soap-content div,
.soap-print .soap-content li {
  display: block;
  margin: 0 0 3px 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #111;
  text-indent: 0;
}
.soap-print .soap-content li { display: list-item; margin-left: 18px; }
.soap-print .soap-keep {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
.soap-print .soap-heading {
  font-weight: 700;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  break-after: avoid !important;
  page-break-after: avoid !important;
}
.soap-print strong, .soap-print b { font-weight: 700; }
.soap-print em, .soap-print i { font-style: italic; }
.soap-print u { text-decoration: underline; }
.soap-print s, .soap-print strike, .soap-print del { text-decoration: line-through; }
.soap-print sub { vertical-align: sub; font-size: smaller; }
.soap-print sup { vertical-align: super; font-size: smaller; }
.soap-print br { display: block; }
.soap-print a { color: #111; }
.soap-print .print-footer {
  display: block;
  margin: 16px 0 0 0;
  padding: 6px 0 0 0;
  border: 0;
  border-top: 0.6pt solid #111;
  background: transparent;
  font-size: 9px;
  color: #111;
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
}
.soap-print .empty-notes { margin: 0; color: #111; }
`;
