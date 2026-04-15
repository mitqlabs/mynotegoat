export const macroSections = [
  "subjective",
  "objective",
  "assessment",
  "plan",
] as const;

export type MacroSection = (typeof macroSections)[number];

export interface MacroQuestion {
  id: string;
  label: string;
  options: string[];
  multiSelect?: boolean;
  /**
   * Optional per-option encounter charges, keyed by option label (exact match).
   * When a user picks an option during macro run that has an entry here, the
   * matching charge is added to the encounter's billing list. De-duplication
   * happens by procedureCode — if the same option charge is picked across
   * multiple regions/macros, only one billing row is created.
   *
   * Example: a "Treatments Performed" question with options ["Laser",
   * "Massage", "E-Stim"] can link "Massage" to CPT 97124 so that answering
   * "Massage" auto-adds the Therapeutic Massage charge.
   *
   * Keyed by label string (not index) so option reordering is safe. If an
   * option is renamed in the editor, the user must re-link — that's cheaper
   * than a fuzzy match that could silently bill the wrong code.
   */
  optionCharges?: Record<string, MacroLinkedCharge>;
}

/**
 * Optional encounter charge attached to a specific answer option within a
 * MacroQuestion. When a user picks that option at macro-run time, the
 * matching charge is added to the encounter's billing list — but only once
 * per encounter (de-duped by `procedureCode`). If the same option is picked
 * again for a different region, no duplicate row is created and no unit
 * doubling occurs. Units always start at 1 and must be bumped manually by
 * the user.
 *
 * Example: a "Treatments Performed" question with options ["Laser",
 * "Massage", "E-Stim"] can have `optionCharges["Massage"] = { procedureCode:
 * "97124", name: "Therapeutic Massage", unitPrice: 45 }` so that picking
 * "Massage" in the encounter auto-drops the charge into billing.
 */
export interface MacroLinkedCharge {
  /** CPT / HCPCS code, e.g. "97124". Uppercased on normalization. */
  procedureCode: string;
  /** Display name, e.g. "Therapeutic Massage". */
  name: string;
  /** Charge per unit in dollars. */
  unitPrice: number;
}

export interface MacroTemplate {
  id: string;
  section: MacroSection;
  buttonName: string;
  body: string;
  questions: MacroQuestion[];
  active: boolean;
  /** Optional folder name for grouping macros within a section */
  folder?: string;
}

export interface MacroLibraryConfig {
  setName: string;
  enabledAutoFields: MacroAutoField[];
  saltDefaults: {
    enabled: boolean;
    sections: Record<MacroSection, boolean>;
  };
  templates: MacroTemplate[];
}

export type MacroRenderContext = Record<string, string>;
export type MacroAnswerValue = string | string[];
export type MacroAnswerMap = Record<string, MacroAnswerValue>;

export const macroSectionLabels: Record<MacroSection, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  plan: "Plan",
};

export const macroAutoFieldLabels = {
  FIRST_NAME: "Patient first name",
  LAST_NAME: "Patient last name",
  FULL_NAME: "Patient full name",
  AGE: "Patient age",
  SEX: "Patient sex",
  DOB: "Date of birth",
  INJURY_DATE: "Date of injury",
  ATTORNEY: "Attorney",
  HE_SHE: "he/she",
  HIM_HER: "him/her",
  HIS_HER: "his/her",
  MR_MRS_MS_LAST_NAME: "Mr./Mrs./Ms. Last name",
  SPECIALIST_REFERRED: "Specialist (pick from contacts)",
} as const;

export type MacroAutoField = keyof typeof macroAutoFieldLabels;
export const macroAutoFields = Object.keys(macroAutoFieldLabels) as MacroAutoField[];

const STORAGE_KEY = "casemate.macro-library.v1";

const defaultObjectiveBody = `{{FIRST_NAME}} {{LAST_NAME}} is a {{AGE}} year old {{SEX}} who stated that they were the [[where_seated]] in a [[vehicle_type_driven]], wearing their seatbelt involved in a motor vehicle collision with a [[other_vehicle_type]].

Patient describes the collision occurred while {{HE_SHE}} was [[vehicle_motion]].
{{MR_MRS_MS_LAST_NAME}} stated the area of impact was [[impact_area]].
{{MR_MRS_MS_LAST_NAME}} states that the vehicle was [[vehicle_pushed]].
Patient stated that {{HE_SHE}} was [[prepared_for_impact]].
Upon impact, {{MR_MRS_MS_LAST_NAME}} felt [[thrown_around]].
{{MR_MRS_MS_LAST_NAME}} mentioned that the airbags [[airbag_deployed]].
Immediately after impact they felt [[post_impact_feeling]].
Patient reported that they [[lost_consciousness]].
{{MR_MRS_MS_LAST_NAME}} stated they [[body_strike]] in the vehicle.
{{MR_MRS_MS_LAST_NAME}} developed pain [[pain_onset]].
Since the collision, {{HE_SHE}} has been experiencing [[symptoms_since_collision]].
Patient reported police [[police_arrival]].
{{MR_MRS_MS_LAST_NAME}} was seen at emergency/urgent care: [[seen_urgent_care]].
Taken by ambulance: [[taken_ambulance]].
Medications prescribed: [[medications_prescribed]].
Diagnostic imaging taken: [[diagnostic_imaging_taken]].

{{MR_MRS_MS_LAST_NAME}} stated symptoms persisted and continued to get worse. At that time {{HE_SHE}} presented {{HIM_HER}}self for evaluation and treatment.
{{MR_MRS_MS_LAST_NAME}} stated that {{HE_SHE}} did not have these presenting complaints prior to the collision on {{INJURY_DATE}}.`;

export function createQuestionId(label: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `question_${Date.now()}`;
}

function defaultMacroTemplate(
  id: string,
  section: MacroSection,
  buttonName: string,
  body: string,
  questions: MacroQuestion[] = [],
): MacroTemplate {
  return {
    id,
    section,
    buttonName,
    body,
    questions,
    active: true,
  };
}

export function getDefaultMacroLibrary(): MacroLibraryConfig {
  return {
    setName: "Prime Spine PI Macros",
    enabledAutoFields: [...macroAutoFields],
    saltDefaults: {
      enabled: true,
      sections: {
        subjective: true,
        objective: true,
        assessment: true,
        plan: true,
      },
    },
    templates: [
      defaultMacroTemplate("macro-objective-mvc-hx", "objective", "MVC HX", defaultObjectiveBody, [
        {
          id: "where_seated",
          label: "Where were you seated?",
          options: [
            "driver",
            "front seat passenger",
            "rear right seat passenger",
            "rear left seat passenger",
            "rear middle seat passenger",
          ],
        },
        { id: "vehicle_type_driven", label: "What type of vehicle were you driving?", options: [] },
        { id: "other_vehicle_type", label: "What type of vehicle was the other vehicle?", options: [] },
        { id: "vehicle_motion", label: "Was your vehicle stopped/moving, etc.?", options: [] },
        { id: "impact_area", label: "Where was the area of impact?", options: [] },
        { id: "vehicle_pushed", label: "Was your vehicle pushed into another vehicle?", options: [] },
        { id: "prepared_for_impact", label: "Were you prepared for impact?", options: [] },
        { id: "thrown_around", label: "Were you thrown around in the vehicle?", options: [] },
        { id: "airbag_deployed", label: "Did your airbags deploy?", options: [] },
        { id: "post_impact_feeling", label: "How did you feel after the impact?", options: [] },
        { id: "lost_consciousness", label: "Did you lose consciousness?", options: [] },
        { id: "body_strike", label: "Did you strike any part of your body in the vehicle?", options: [] },
        { id: "pain_onset", label: "When did you develop the pains?", options: [] },
        { id: "symptoms_since_collision", label: "Symptoms since collision", options: [] },
        { id: "police_arrival", label: "Did police arrive to the scene?", options: [] },
        { id: "seen_urgent_care", label: "Were you seen at emergency/urgent care?", options: [] },
        { id: "taken_ambulance", label: "Were you taken by ambulance?", options: [] },
        { id: "medications_prescribed", label: "Were medications prescribed?", options: [] },
        { id: "diagnostic_imaging_taken", label: "Was diagnostic imaging taken?", options: [] },
      ]),
      defaultMacroTemplate(
        "macro-subjective-pain-intake",
        "subjective",
        "Pain Intake",
        "{{MR_MRS_MS_LAST_NAME}} reports pain level [[pain_scale]]/10 in the [[pain_region]], with frequency [[frequency]] and aggravating factors [[aggravating_factors]].",
        [
          { id: "pain_scale", label: "Pain scale", options: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] },
          { id: "pain_region", label: "Primary region", options: [] },
          { id: "frequency", label: "Frequency", options: ["intermittent", "constant", "daily"] },
          { id: "aggravating_factors", label: "Aggravating factors", options: [] },
        ],
      ),
      defaultMacroTemplate(
        "macro-assessment-progress",
        "assessment",
        "Progress Note",
        "Patient demonstrates [[progress_level]] progress with ongoing complaints in the [[focus_area]]. Continue monitoring functional limitations.",
        [
          { id: "progress_level", label: "Progress level", options: ["improving", "plateau", "worsening"] },
          { id: "focus_area", label: "Focus area", options: [] },
        ],
      ),
      defaultMacroTemplate(
        "macro-plan-followup",
        "plan",
        "Follow-Up Plan",
        "Continue care plan with [[treatment_frequency]] visits per week for [[duration_weeks]] weeks. Re-evaluate on [[re_eval_date]].",
        [
          { id: "treatment_frequency", label: "Visits per week", options: ["1", "2", "3"] },
          { id: "duration_weeks", label: "Duration (weeks)", options: ["2", "4", "6", "8"] },
          { id: "re_eval_date", label: "Re-evaluation date", options: [] },
        ],
      ),
    ],
  };
}

function normalizeQuestion(value: unknown): MacroQuestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<MacroQuestion>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!id || !label) {
    return null;
  }
  const options =
    Array.isArray(row.options)
      ? row.options
          .map((option) => (typeof option === "string" ? option.trim() : ""))
          .filter((option) => option.length > 0)
      : [];
  const multiSelect = row.multiSelect === true;
  const optionCharges: Record<string, MacroLinkedCharge> = {};
  if (row.optionCharges && typeof row.optionCharges === "object") {
    for (const [key, raw] of Object.entries(
      row.optionCharges as Record<string, unknown>,
    )) {
      const normalized = normalizeLinkedCharge(raw);
      if (normalized && key.trim()) {
        optionCharges[key.trim()] = normalized;
      }
    }
  }
  const result: MacroQuestion = { id, label, options, multiSelect };
  if (Object.keys(optionCharges).length) {
    result.optionCharges = optionCharges;
  }
  return result;
}

function normalizeLinkedCharge(value: unknown): MacroLinkedCharge | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const procedureCode =
    typeof row.procedureCode === "string" ? row.procedureCode.trim().toUpperCase() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const unitPriceRaw = row.unitPrice;
  let unitPrice: number;
  if (typeof unitPriceRaw === "number" && Number.isFinite(unitPriceRaw)) {
    unitPrice = unitPriceRaw;
  } else if (typeof unitPriceRaw === "string" && unitPriceRaw.trim()) {
    const parsed = Number(unitPriceRaw);
    unitPrice = Number.isFinite(parsed) ? parsed : 0;
  } else {
    unitPrice = 0;
  }
  if (unitPrice < 0) unitPrice = 0;
  if (!procedureCode || !name) {
    return null;
  }
  return { procedureCode, name, unitPrice };
}

function normalizeTemplate(value: unknown): MacroTemplate | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<MacroTemplate>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const buttonName = typeof row.buttonName === "string" ? row.buttonName.trim() : "";
  const body = typeof row.body === "string" ? row.body : "";
  const section = row.section;
  if (!id || !buttonName || !body || !section || !macroSections.includes(section)) {
    return null;
  }
  const questions = Array.isArray(row.questions)
    ? row.questions.map(normalizeQuestion).filter((item): item is MacroQuestion => Boolean(item))
    : [];
  const folder = typeof row.folder === "string" && row.folder.trim() ? row.folder.trim() : undefined;
  return {
    id,
    section,
    buttonName,
    body,
    questions,
    active: row.active !== false,
    ...(folder ? { folder } : {}),
  };
}

function normalizeAutoFields(value: unknown): MacroAutoField[] {
  if (!Array.isArray(value)) {
    return [...macroAutoFields];
  }

  const allowed = new Set<MacroAutoField>(macroAutoFields);
  const selected: MacroAutoField[] = [];
  const seen = new Set<string>();

  value.forEach((item) => {
    if (typeof item !== "string") {
      return;
    }
    const candidate = item.trim() as MacroAutoField;
    if (!allowed.has(candidate)) {
      return;
    }
    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);
    selected.push(candidate);
  });

  return selected.length ? selected : [...macroAutoFields];
}

function normalizeSaltDefaults(
  value: unknown,
  defaults: MacroLibraryConfig["saltDefaults"],
): MacroLibraryConfig["saltDefaults"] {
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const row = value as Partial<MacroLibraryConfig["saltDefaults"]> & {
    sections?: Partial<Record<MacroSection, unknown>>;
  };

  const enabled = row.enabled !== false;
  const sectionsInput: Partial<Record<MacroSection, unknown>> = row.sections ?? {};

  const sections: Record<MacroSection, boolean> = {
    subjective: sectionsInput.subjective !== false,
    objective: sectionsInput.objective !== false,
    assessment: sectionsInput.assessment !== false,
    plan: sectionsInput.plan !== false,
  };

  return {
    enabled,
    sections,
  };
}

export function normalizeMacroLibrary(value: unknown): MacroLibraryConfig {
  const defaults = getDefaultMacroLibrary();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const row = value as Partial<MacroLibraryConfig>;
  const setName = typeof row.setName === "string" && row.setName.trim() ? row.setName.trim() : defaults.setName;
  const templates = Array.isArray(row.templates)
    ? row.templates.map(normalizeTemplate).filter((item): item is MacroTemplate => Boolean(item))
    : [];

  return {
    setName,
    enabledAutoFields: normalizeAutoFields(row.enabledAutoFields),
    saltDefaults: normalizeSaltDefaults(row.saltDefaults, defaults.saltDefaults),
    templates: templates.length ? templates : defaults.templates,
  };
}

export function loadMacroLibrary(): MacroLibraryConfig {
  if (typeof window === "undefined") {
    return getDefaultMacroLibrary();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultMacroLibrary();
    }
    return normalizeMacroLibrary(JSON.parse(raw));
  } catch {
    return getDefaultMacroLibrary();
  }
}

export function saveMacroLibrary(config: MacroLibraryConfig) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  void import("@/lib/kv-cloud").then((m) => m.dualWriteKv(STORAGE_KEY, "macros", config));
}

export function insertAutoFieldToken(field: MacroAutoField) {
  return `{{${field}}}`;
}

export function insertQuestionToken(questionId: string) {
  return `[[${questionId}]]`;
}

export function getQuestionIdsFromBody(body: string) {
  const matches = body.match(/\[\[\s*([a-zA-Z0-9_-]+)\s*\]\]/g) ?? [];
  const ids = matches
    .map((token) => token.replace(/\[\[|\]\]/g, "").trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(ids));
}

export function formatMacroAnswerValue(value: MacroAnswerValue | undefined): string {
  const conjunctionFormatter =
    typeof Intl !== "undefined" && typeof Intl.ListFormat === "function"
      ? new Intl.ListFormat("en-US", { style: "long", type: "conjunction" })
      : null;
  if (Array.isArray(value)) {
    const selected = value
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (!selected.length) {
      return "";
    }
    if (selected.length === 1) {
      return selected[0];
    }
    if (conjunctionFormatter) {
      return conjunctionFormatter.format(selected);
    }
    if (selected.length === 2) {
      return `${selected[0]} and ${selected[1]}`;
    }
    return `${selected.slice(0, -1).join(", ")}, and ${selected[selected.length - 1]}`;
  }
  return typeof value === "string" ? value : "";
}

export function escapeMacroHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the inline atomic span used to wrap a single answer to a macro prompt.
 * The span is contenteditable=false so the user cannot type inside it, but the
 * surrounding macro text remains fully editable. Tapping the span re-opens
 * the picker for that single prompt.
 */
export function renderMacroPromptSpan(
  runId: string,
  promptId: string,
  value: string,
): string {
  const display = value && value.trim() ? escapeMacroHtml(value) : "&nbsp;";
  return `<span class="macro-prompt" contenteditable="false" data-macro-run-id="${runId}" data-prompt-id="${promptId}">${display}</span>`;
}

export function renderMacroTemplate(
  template: string,
  answers: MacroAnswerMap,
  context: MacroRenderContext,
) {
  const withAutoFields = template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return context[key] ?? "";
  });

  const withQuestions = withAutoFields.replace(/\[\[\s*([a-zA-Z0-9_-]+)\s*\]\]/g, (_, key: string) => {
    return formatMacroAnswerValue(answers[key]);
  });

  return withQuestions
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, "")
    .replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "")
    .replace(/^(<p>\s*<\/p>\s*)+/gi, "")
    .replace(/(<p>\s*<\/p>\s*)+$/gi, "")
    .trim();
}

/**
 * Render a macro template, but wrap each prompt answer in an inline atomic
 * span (`renderMacroPromptSpan`). The static text of the macro stays freely
 * editable inside the SOAP editor; only the answer values are clickable to
 * re-open the picker for that one question.
 */
export function renderMacroTemplateWithPromptSpans(
  template: string,
  answers: MacroAnswerMap,
  context: MacroRenderContext,
  runId: string,
) {
  const withAutoFields = template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return context[key] ?? "";
  });

  const withQuestions = withAutoFields.replace(/\[\[\s*([a-zA-Z0-9_-]+)\s*\]\]/g, (_, key: string) => {
    return renderMacroPromptSpan(runId, key, formatMacroAnswerValue(answers[key]));
  });

  return withQuestions
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, "")
    .replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "")
    .replace(/^(<p>\s*<\/p>\s*)+/gi, "")
    .replace(/(<p>\s*<\/p>\s*)+$/gi, "")
    .trim();
}

export function createEmptyMacro(section: MacroSection, folder?: string): MacroTemplate {
  const timestamp = Date.now();
  return {
    id: `macro-${section}-${timestamp}`,
    section,
    buttonName: "New Macro",
    body: "",
    questions: [],
    active: true,
    ...(folder ? { folder } : {}),
  };
}

export interface MacroFolderGroup {
  folder: string; // "" = ungrouped (top-level)
  macros: MacroTemplate[];
}

/** Group macros by folder, preserving order. Ungrouped macros come first. */
export function groupMacrosByFolder(macros: MacroTemplate[]): MacroFolderGroup[] {
  const folderOrder: string[] = [];
  const folderMap = new Map<string, MacroTemplate[]>();

  for (const macro of macros) {
    const key = macro.folder?.trim() || "";
    if (!folderMap.has(key)) {
      folderOrder.push(key);
      folderMap.set(key, []);
    }
    folderMap.get(key)!.push(macro);
  }

  // Ungrouped ("") first, then named folders in order of first appearance
  const result: MacroFolderGroup[] = [];
  const ungrouped = folderMap.get("");
  if (ungrouped?.length) {
    result.push({ folder: "", macros: ungrouped });
  }
  for (const key of folderOrder) {
    if (key === "") continue;
    const macros = folderMap.get(key);
    if (macros?.length) {
      result.push({ folder: key, macros });
    }
  }
  return result;
}

/** Get all unique folder names used in a macro section */
export function getMacroFolderNames(macros: MacroTemplate[]): string[] {
  const names = new Set<string>();
  for (const macro of macros) {
    if (macro.folder?.trim()) {
      names.add(macro.folder.trim());
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
