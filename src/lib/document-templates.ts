export type DocumentTemplateScope = "specialistReferral" | "imagingRequest" | "generalLetter";

export interface DocumentTemplate {
  id: string;
  name: string;
  scope: DocumentTemplateScope;
  body: string;
  fontFamily: string;
  showOfficeLogo: boolean;
  active: boolean;
}

export interface DocumentTemplateHeader {
  active: boolean;
  body: string;
  fontFamily: string;
  showOfficeLogo: boolean;
}

export interface DocumentTemplateLibrary {
  header: DocumentTemplateHeader;
  templates: DocumentTemplate[];
}

export interface DocumentTemplateField {
  token: string;
  label: string;
}

export interface DocumentFontOption {
  label: string;
  value: string;
}

export interface DocumentTemplateScopeOption {
  value: DocumentTemplateScope;
  label: string;
}

const STORAGE_KEY = "casemate.document-templates.v1";

const defaultDocumentFont =
  "Georgia, 'Times New Roman', 'Baskerville Old Face', serif";

const defaultDocumentHeaderBody = `{{OFFICE_NAME}}
{{OFFICE_ADDRESS}}
T. {{OFFICE_PHONE}}   F. {{OFFICE_FAX}}
E. {{OFFICE_EMAIL}}
`;

export const documentFontOptions: DocumentFontOption[] = [
  { label: "Classic Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Modern Sans", value: "'Avenir Next', 'Trebuchet MS', 'Segoe UI', sans-serif" },
  { label: "Professional", value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: "Formal", value: "'Palatino Linotype', Palatino, serif" },
  { label: "Typewriter", value: "'Courier New', Courier, monospace" },
];

export const documentTemplateScopeOptions: DocumentTemplateScopeOption[] = [
  { value: "specialistReferral", label: "Specialist Referral" },
  { value: "imagingRequest", label: "Imaging Request" },
  { value: "generalLetter", label: "Letter / Note" },
];

export function getDocumentTemplateScopeLabel(scope: DocumentTemplateScope) {
  return (
    documentTemplateScopeOptions.find((option) => option.value === scope)?.label ?? "Specialist Referral"
  );
}

export type DocumentTemplateFieldGroup = {
  label: string;
  fields: DocumentTemplateField[];
};

export const documentTemplateFieldGroups: DocumentTemplateFieldGroup[] = [
  {
    label: "Office",
    fields: [
      { token: "TODAY_DATE", label: "Today Date" },
      { token: "OFFICE_NAME", label: "Office Name" },
      { token: "OFFICE_ADDRESS", label: "Office Address" },
      { token: "OFFICE_PHONE", label: "Office Phone" },
      { token: "OFFICE_FAX", label: "Office Fax" },
      { token: "OFFICE_EMAIL", label: "Office Email" },
      { token: "DOCTOR_NAME", label: "Doctor Name" },
    ],
  },
  {
    label: "Patient",
    fields: [
      { token: "PATIENT_FULL_NAME", label: "Patient Full Name" },
      { token: "PATIENT_FIRST_NAME", label: "Patient First Name" },
      { token: "PATIENT_LAST_NAME", label: "Patient Last Name" },
      { token: "MR_MRS_MS_LAST_NAME", label: "Mr./Mrs./Ms. Last Name" },
      { token: "MR_MRS_MS_FULL_NAME", label: "Mr./Mrs./Ms. Full Name" },
      { token: "PATIENT_DOB", label: "Patient DOB" },
      { token: "PATIENT_PHONE", label: "Patient Phone" },
      { token: "PATIENT_EMAIL", label: "Patient Email" },
    ],
  },
  {
    label: "Case",
    fields: [
      { token: "DATE_OF_INJURY", label: "Date Of Injury" },
      { token: "CASE_NUMBER", label: "Case #" },
    ],
  },
  {
    label: "Attorney",
    fields: [
      { token: "ATTORNEY_NAME", label: "Attorney Name" },
      { token: "ATTORNEY_PHONE", label: "Attorney Phone" },
      { token: "ATTORNEY_FAX", label: "Attorney Fax" },
      { token: "ATTORNEY_EMAIL", label: "Attorney Email" },
      { token: "ATTORNEY_ADDRESS", label: "Attorney Address" },
    ],
  },
  {
    label: "Specialist",
    fields: [
      { token: "SPECIALIST_NAME", label: "Specialist Name" },
      { token: "SPECIALIST_PHONE", label: "Specialist Phone" },
      { token: "SPECIALIST_FAX", label: "Specialist Fax" },
      { token: "SPECIALIST_EMAIL", label: "Specialist Email" },
      { token: "SPECIALIST_ADDRESS", label: "Specialist Address" },
      { token: "SPECIALIST_RECOMMENDATIONS", label: "Specialist Recommendations" },
      { token: "REFERRAL_SENT_DATE", label: "Referral Sent Date" },
      { token: "REFERRAL_SCHEDULED_DATE", label: "Referral Scheduled Date" },
    ],
  },
  {
    label: "Imaging",
    fields: [
      { token: "IMAGING_TYPE", label: "Imaging Type" },
      { token: "IMAGING_CENTER", label: "Imaging Center" },
      { token: "IMAGING_PHONE", label: "Imaging Center Phone" },
      { token: "IMAGING_FAX", label: "Imaging Center Fax" },
      { token: "IMAGING_EMAIL", label: "Imaging Center Email" },
      { token: "IMAGING_ADDRESS", label: "Imaging Center Address" },
      { token: "IMAGING_REGIONS", label: "Imaging Regions" },
      { token: "IMAGING_SENT_DATE", label: "Imaging Sent Date" },
      { token: "IMAGING_DONE_DATE", label: "Imaging Done Date" },
      { token: "IMAGING_REPORT_RECEIVED_DATE", label: "Imaging Report Received Date" },
      { token: "IMAGING_REPORT_REVIEWED_DATE", label: "Imaging Report Reviewed Date" },
      { token: "XRAY_FINDINGS", label: "X-Ray Findings" },
      { token: "MRI_CT_FINDINGS", label: "MRI / CT Findings" },
      // Flag, not a value. Resolves to "yes" when the specialist
      // referral's "Include X-Ray / MRI findings in PDF" checkbox
      // is on, "" when off. Intended use: wrap the WHOLE imaging
      // block (outer header + inner labels + tokens) with
      // {{#if INCLUDE_IMAGING_FINDINGS}}...{{/if}} so the whole
      // section toggles together. Use Conditional Wrap Mode in
      // the editor to wrap a selection with one click.
      { token: "INCLUDE_IMAGING_FINDINGS", label: "Include Imaging Findings (flag)" },
    ],
  },
];

// Flat list — kept for callers that just want every token (e.g. token
// substitution). The grouped form (above) drives the editor UI.
export const documentTemplateFields: DocumentTemplateField[] =
  documentTemplateFieldGroups.flatMap((group) => group.fields);

const defaultSpecialistReferralBody = `Specialist Referral

Date: {{TODAY_DATE}}

Dear {{SPECIALIST_NAME}},

I am writing to refer {{PATIENT_FULL_NAME}} for specialist evaluation and care.

Patient Information:
Name: {{PATIENT_FULL_NAME}}
Date of Birth: {{PATIENT_DOB}}
Date of Injury: {{DATE_OF_INJURY}}
Patient Contact: {{PATIENT_PHONE}}
Case #: {{CASE_NUMBER}}

Referral Information:
Doctor: {{DOCTOR_NAME}}
Date of Referral: {{REFERRAL_SENT_DATE}}
Scheduled Date: {{REFERRAL_SCHEDULED_DATE}}

Attorney Information:
{{ATTORNEY_NAME}}
T. {{ATTORNEY_PHONE}}   F. {{ATTORNEY_FAX}}
E. {{ATTORNEY_EMAIL}}
{{ATTORNEY_ADDRESS}}

Please send the consultation report once available.
`;

const defaultImagingRequestBody = `Imaging Request

Date: {{TODAY_DATE}}

Please perform the following imaging for this patient:

Patient Information:
Name: {{PATIENT_FULL_NAME}}
Date of Birth: {{PATIENT_DOB}}
Date of Injury: {{DATE_OF_INJURY}}
Patient Contact: {{PATIENT_PHONE}}
Case #: {{CASE_NUMBER}}

Imaging Details:
Type: {{IMAGING_TYPE}}
Sent Date: {{IMAGING_SENT_DATE}}
Done Date: {{IMAGING_DONE_DATE}}
Imaging Center: {{IMAGING_CENTER}}
Requested Regions: {{IMAGING_REGIONS}}
Report Received Date: {{IMAGING_REPORT_RECEIVED_DATE}}
Report Reviewed Date: {{IMAGING_REPORT_REVIEWED_DATE}}
X-Ray Findings: {{XRAY_FINDINGS}}
MRI / CT Findings: {{MRI_CT_FINDINGS}}

Attorney Information:
{{ATTORNEY_NAME}}
T. {{ATTORNEY_PHONE}}   F. {{ATTORNEY_FAX}}
E. {{ATTORNEY_EMAIL}}
{{ATTORNEY_ADDRESS}}

Specialist Recommendations:
{{SPECIALIST_RECOMMENDATIONS}}
`;

const defaultGeneralLetterBody = `Letter

Date: {{TODAY_DATE}}

To Whom It May Concern,

{{PATIENT_FULL_NAME}} was seen in our office for evaluation and treatment related to date of injury {{DATE_OF_INJURY}}.

Please contact our office if additional information is needed.
`;

export function getDefaultBodyForDocumentScope(scope: DocumentTemplateScope) {
  if (scope === "imagingRequest") {
    return defaultImagingRequestBody;
  }
  if (scope === "generalLetter") {
    return defaultGeneralLetterBody;
  }
  return defaultSpecialistReferralBody;
}

function createTemplate(
  id: string,
  name: string,
  scope: DocumentTemplateScope,
  body: string,
): DocumentTemplate {
  return {
    id,
    name,
    scope,
    body,
    fontFamily: defaultDocumentFont,
    showOfficeLogo: true,
    active: true,
  };
}

function createDefaultHeader(): DocumentTemplateHeader {
  return {
    active: true,
    body: defaultDocumentHeaderBody,
    fontFamily: defaultDocumentFont,
    showOfficeLogo: true,
  };
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeScope(value: unknown): DocumentTemplateScope | null {
  if (value === "specialistReferral" || value === "imagingRequest" || value === "generalLetter") {
    return value;
  }
  return null;
}

function normalizeTemplate(value: unknown): DocumentTemplate | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<DocumentTemplate>;
  const id = normalizeString(row.id);
  const name = normalizeString(row.name);
  const body = typeof row.body === "string" ? row.body : "";
  const scope = normalizeScope(row.scope);

  if (!id || !name || !scope || !body.trim()) {
    return null;
  }

  return {
    id,
    name,
    scope,
    body,
    fontFamily: normalizeString(row.fontFamily) || defaultDocumentFont,
    showOfficeLogo: row.showOfficeLogo !== false,
    active: row.active !== false,
  };
}

function normalizeHeader(value: unknown): DocumentTemplateHeader {
  const defaults = createDefaultHeader();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const row = value as Partial<DocumentTemplateHeader>;
  const body = typeof row.body === "string" ? row.body : defaults.body;
  return {
    active: row.active !== false,
    body: body.trim() ? body : defaults.body,
    fontFamily: normalizeString(row.fontFamily) || defaults.fontFamily,
    showOfficeLogo: row.showOfficeLogo !== false,
  };
}

export function getDefaultDocumentTemplateLibrary(): DocumentTemplateLibrary {
  return {
    header: createDefaultHeader(),
    templates: [
      createTemplate(
        "doc-specialist-referral",
        "Specialist Referral",
        "specialistReferral",
        defaultSpecialistReferralBody,
      ),
      createTemplate(
        "doc-imaging-request",
        "Imaging Request",
        "imagingRequest",
        defaultImagingRequestBody,
      ),
    ],
  };
}

function ensureRequiredTemplates(templates: DocumentTemplate[]) {
  const specialist = templates.find((entry) => entry.scope === "specialistReferral");
  const imaging = templates.find((entry) => entry.scope === "imagingRequest");
  const letters = templates.filter((entry) => entry.scope === "generalLetter");
  const normalized: DocumentTemplate[] = [];

  if (specialist) {
    normalized.push(specialist);
  } else {
    normalized.push(
      createTemplate(
        "doc-specialist-referral",
        "Specialist Referral",
        "specialistReferral",
        defaultSpecialistReferralBody,
      ),
    );
  }

  if (imaging) {
    normalized.push(imaging);
  } else {
    normalized.push(
      createTemplate(
        "doc-imaging-request",
        "Imaging Request",
        "imagingRequest",
        defaultImagingRequestBody,
      ),
    );
  }

  return [...normalized, ...letters];
}

export function normalizeDocumentTemplateLibrary(value: unknown): DocumentTemplateLibrary {
  const defaults = getDefaultDocumentTemplateLibrary();
  if (!value || typeof value !== "object") {
    return defaults;
  }
  const row = value as Partial<DocumentTemplateLibrary>;
  const templates = Array.isArray(row.templates)
    ? row.templates.map(normalizeTemplate).filter((entry): entry is DocumentTemplate => Boolean(entry))
    : [];
  return {
    header: normalizeHeader((row as { header?: unknown }).header),
    templates: ensureRequiredTemplates(templates.length ? templates : defaults.templates),
  };
}

export function loadDocumentTemplateLibrary(): DocumentTemplateLibrary {
  if (typeof window === "undefined") {
    return getDefaultDocumentTemplateLibrary();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultDocumentTemplateLibrary();
    }
    return normalizeDocumentTemplateLibrary(JSON.parse(raw));
  } catch {
    return getDefaultDocumentTemplateLibrary();
  }
}

export function saveDocumentTemplateLibrary(config: DocumentTemplateLibrary) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "macros", config));
}

export function insertTemplateToken(body: string, token: string) {
  const snippet = `{{${token}}}`;
  if (!body.trim()) {
    return snippet;
  }
  return `${body}${body.endsWith("\n") ? "" : " "}${snippet}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace `{{TOKEN}}` placeholders in a template body with values from `context`.
 *
 * By default every value is HTML-escaped so user-entered strings (names,
 * dates, codes) never inject unexpected markup. Tokens listed in the
 * optional `rawHtmlTokens` set are inserted **without** escaping — use
 * this for SOAP values that are already sanitised HTML and need to keep
 * their `<b>`, `<u>`, `<p>` formatting intact.
 */
export function renderDocumentTemplate(
  body: string,
  context: Record<string, string>,
  rawHtmlTokens?: Set<string>,
  /** Optional answers for [[prompt_id]] tokens collected at run-time
   *  (e.g., "Work Order Number" on a subpoena invoice). Tokens with
   *  no matching answer render as empty so the document doesn't
   *  contain literal "[[token_id]]" strings. */
  promptAnswers?: Record<string, string>,
) {
  // PASS 1: Conditional blocks (supports nesting).
  //
  // Syntax: {{#if TOKEN}}...content...{{/if}}
  //
  // If the named auto-field token has a non-empty value in the
  // context, the block is replaced with its CONTENT (so any inner
  // {{TOKEN}} references still resolve in pass 2). If the value is
  // missing or empty, the entire block is dropped — including the
  // marker tags, so the rendered document doesn't contain literal
  // {{#if ...}} text.
  //
  // Nesting works via iterative innermost-first resolution: we
  // repeatedly find an if/endif pair whose CONTENT contains no
  // further {{#if}} marker, resolve it, and loop until no more
  // {{#if}} tags remain. Each pass collapses one level of nesting.
  // This is the simplest correct approach that doesn't require
  // hand-rolling a parser, and avoids the "outermost-greedy
  // matches wrong endif" bug that comes from naïve non-greedy
  // regex on nested structures.
  //
  // The innermost regex uses a negative lookahead in the content
  // group: `(?:(?!\{\{#if\s).)*?` — match anything that isn't the
  // start of another {{#if}}. That guarantees the matched block
  // contains no nested ifs, so its endif is the correct close.
  let result = body;
  const innermostIfPattern = /\{\{#if\s+([A-Z0-9_]+)\}\}((?:(?!\{\{#if\s)[\s\S])*?)\{\{\/if\}\}/;
  // Hard cap on iterations as a runaway-loop guard — at 1000
  // levels deep the template is broken regardless and we should
  // bail rather than spin forever.
  for (let iteration = 0; iteration < 1000; iteration++) {
    const match = innermostIfPattern.exec(result);
    if (!match) break;
    const [fullMatch, tokenRaw, content] = match;
    const token = tokenRaw.toUpperCase();
    const value = context[token];
    const replacement =
      typeof value === "string" && value.trim().length > 0 ? content : "";
    result = result.slice(0, match.index) + replacement + result.slice(match.index + fullMatch.length);
  }
  // PASS 2: Plain auto-field tokens.
  result = result.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, tokenRaw: string) => {
    const token = tokenRaw.toUpperCase();
    const value = context[token];
    if (typeof value !== "string") return "";
    return rawHtmlTokens?.has(token) ? value : escapeHtml(value);
  });
  // PASS 3: Runtime prompt tokens.
  result = result.replace(/\[\[\s*([a-zA-Z0-9_]+)\s*\]\]/g, (_match, idRaw: string) => {
    const id = idRaw.trim();
    const value = promptAnswers?.[id];
    return typeof value === "string" && value ? escapeHtml(value) : "";
  });
  return result;
}

/** Extract the set of [[prompt_id]] tokens used inside a template
 *  body. Returns unique ids in first-seen order so the prompt modal
 *  can render its inputs in the same sequence the user typed them. */
export function getDocumentTemplatePromptIds(body: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const matches = body.matchAll(/\[\[\s*([a-zA-Z0-9_]+)\s*\]\]/g);
  for (const m of matches) {
    const id = m[1].trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

/** Turn a token id like "work_order_number" into a human label like
 *  "Work Order Number" so the prompt modal doesn't need a separate
 *  label-storage schema. Underscores/dashes become spaces; each word
 *  capitalizes. */
export function humanizeTemplatePromptId(id: string): string {
  const cleaned = id.replace(/[_-]+/g, " ").trim();
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}
