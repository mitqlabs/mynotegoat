"use client";

import { useMemo, useRef, useState } from "react";
import {
  RichTextTemplateEditor,
  type RichTextTemplateEditorHandle,
} from "@/components/rich-text-template-editor";
import { useReportTemplates } from "@/hooks/use-report-templates";
import { documentFontOptions, renderDocumentTemplate } from "@/lib/document-templates";
import { appointmentTypeToTokenPrefix } from "@/lib/report-generator";
import { narrativeReportAutoFields } from "@/lib/report-templates";
import { loadAppointmentTypes } from "@/lib/schedule-appointment-types";

function insertionTokenForField(fieldToken: string) {
  return `{{${fieldToken}}}`;
}

type FieldCategory = {
  label: string;
  tokens: string[];
};

const autoFieldCategories: FieldCategory[] = [
  {
    label: "Office",
    tokens: ["TODAY_DATE", "OFFICE_NAME", "OFFICE_ADDRESS", "OFFICE_PHONE", "OFFICE_FAX", "OFFICE_EMAIL", "DOCTOR_NAME"],
  },
  {
    label: "Patient",
    tokens: ["PATIENT_FULL_NAME", "PATIENT_FIRST_NAME", "PATIENT_LAST_NAME", "MR_MRS_MS_LAST_NAME", "MR_MRS_MS_FULL_NAME", "HE_SHE", "HIS_HER", "PATIENT_DOB", "PATIENT_PHONE", "PATIENT_EMAIL"],
  },
  {
    label: "Case Info",
    tokens: ["DATE_OF_INJURY", "INITIAL_EXAM", "CASE_NUMBER", "CASE_STATUS", "LIEN_STATUS", "PRIOR_CARE", "PATIENT_NOTES"],
  },
  {
    label: "Findings",
    tokens: ["XRAY_FINDINGS", "MRI_CT_FINDINGS", "SPECIALIST_RECOMMENDATIONS"],
  },
  {
    label: "Billing",
    tokens: ["BILLED_AMOUNT", "PAID_AMOUNT", "PERCENTAGE_PAID", "PAID_DATE", "TOTAL_CHARGE_AMOUNT"],
  },
  {
    label: "Dates & Status",
    tokens: ["DISCHARGE_DATE", "RB_SENT_DATE", "REVIEW_STATUS"],
  },
  {
    label: "Encounters",
    tokens: [
      "FIRST_ENCOUNTER_DATE", "LATEST_ENCOUNTER_DATE", "ENCOUNTER_COUNT", "ENCOUNTER_TIMELINE",
    ],
  },
  {
    label: "SOAP — First",
    tokens: ["FIRST_SUBJECTIVE", "FIRST_OBJECTIVE", "FIRST_ASSESSMENT", "FIRST_PLAN"],
  },
  {
    label: "SOAP — Latest",
    tokens: ["LATEST_SUBJECTIVE", "LATEST_OBJECTIVE", "LATEST_ASSESSMENT", "LATEST_PLAN"],
  },
  {
    label: "SOAP — All",
    tokens: ["ALL_SUBJECTIVE", "ALL_OBJECTIVE", "ALL_ASSESSMENT", "ALL_PLAN"],
  },
  {
    label: "SOAP — Macro",
    tokens: ["MACRO_SUBJECTIVE", "MACRO_OBJECTIVE", "MACRO_ASSESSMENT", "MACRO_PLAN"],
  },
  {
    label: "Diagnosis & Charges",
    tokens: ["DIAGNOSIS_LIST", "DIAGNOSIS_CODES", "CHARGE_LEDGER"],
  },
  {
    label: "Imaging & Referrals",
    tokens: ["XRAY_SUMMARY", "XRAY_SENT_DATE", "XRAY_COMPLETED_DATE", "XRAY_REVIEWED_DATE", "MRI_CT_SUMMARY", "MRI_SENT_DATE", "MRI_SCHEDULED_DATE", "MRI_COMPLETED_DATE", "MRI_REVIEWED_DATE", "SPECIALIST_SUMMARY", "SPECIALIST_NAME"],
  },
  {
    label: "Treatment Summaries",
    tokens: ["DECOMPRESSION_SUMMARY"],
  },
];

const encounterPickerSections = [
  { value: "SUBJECTIVE", label: "Subjective" },
  { value: "OBJECTIVE", label: "Objective" },
  { value: "ASSESSMENT", label: "Assessment" },
  { value: "PLAN", label: "Plan" },
  { value: "DATE", label: "Date" },
  { value: "TYPE", label: "Appointment Type" },
] as const;

// ── Example data for live preview ──────────────────────────────────────────
const examplePreviewContext: Record<string, string> = {
  TODAY_DATE: "04/05/2026",
  OFFICE_NAME: "Valley Chiropractic Center",
  OFFICE_ADDRESS: "1234 Main St, Suite 100, Los Angeles, CA 90001",
  OFFICE_PHONE: "(310) 555-1234",
  OFFICE_FAX: "(310) 555-1235",
  OFFICE_EMAIL: "info@valleychiro.com",
  DOCTOR_NAME: "Dr. Michael Johnson, D.C.",
  PATIENT_FULL_NAME: "Maria Garcia",
  PATIENT_FIRST_NAME: "Maria",
  PATIENT_LAST_NAME: "Garcia",
  PATIENT_DOB: "05/15/1988",
  PATIENT_PHONE: "(818) 555-9876",
  PATIENT_EMAIL: "maria.garcia@email.com",
  MR_MRS_MS_LAST_NAME: "Ms. Garcia",
  MR_MRS_MS_FULL_NAME: "Ms. Maria Garcia",
  HE_SHE: "She",
  HIS_HER: "Her",
  DATE_OF_INJURY: "01/12/2026",
  INITIAL_EXAM: "01/19/2026",
  CASE_NUMBER: "2026-PI-0042",
  ATTORNEY_NAME: "James Mitchell, Esq.",
  ATTORNEY_PHONE: "(213) 555-4567",
  ATTORNEY_FAX: "(213) 555-4568",
  ATTORNEY_EMAIL: "jmitchell@lawfirm.com",
  ATTORNEY_ADDRESS: "567 Legal Ave, Suite 300, Los Angeles, CA 90010",
  CASE_STATUS: "Active",
  LIEN_STATUS: "LOP Signed",
  PRIOR_CARE: "None reported",
  PATIENT_NOTES: "Patient reports no prior chiropractic care. MVA on 01/12/2026, rear-ended at traffic light.",
  XRAY_FINDINGS: "Loss of cervical lordosis. Mild degenerative changes at C5-C6.",
  MRI_CT_FINDINGS: "Small disc protrusion at C5-C6 with mild foraminal narrowing.",
  SPECIALIST_RECOMMENDATIONS: "Orthopedic consult recommended for continued radiculopathy.",
  BILLED_AMOUNT: "8450.00",
  PAID_AMOUNT: "0.00",
  PERCENTAGE_PAID: "0.0%",
  DISCHARGE_DATE: "-",
  RB_SENT_DATE: "-",
  PAID_DATE: "-",
  REVIEW_STATUS: "In Treatment",
  FIRST_ENCOUNTER_DATE: "01/19/2026",
  LATEST_ENCOUNTER_DATE: "03/28/2026",
  ENCOUNTER_COUNT: "12",
  FIRST_SUBJECTIVE: "Patient presents following MVA on 01/12/2026. Reports neck pain rated 7/10, mid-back pain 5/10, headaches 6/10. Pain worsens with sitting, turning head, and lifting. Sleep is disrupted. Denies prior neck or back injuries.",
  FIRST_OBJECTIVE: "Cervical ROM: Flexion 35° (N:50), Extension 40° (N:60), R Lat Flex 30° (N:45), L Lat Flex 28° (N:45). Palpation reveals hypertonicity at C3-C6 paraspinals bilaterally, trigger points trapezius. Orthopedic tests: Cervical compression (+) right, Jackson's (+) right.",
  FIRST_ASSESSMENT: "1. Cervicalgia — M54.2\n2. Muscle spasm of back — M62.830\n3. Sprain of ligaments of cervical spine — S13.4XXA\nPrognosis: Good with continued care.",
  FIRST_PLAN: "Chiropractic adjustments 3x/week for 4 weeks, then reassess. Cervical traction, myofascial release, therapeutic exercises. Re-exam at 30 days.",
  LATEST_SUBJECTIVE: "Patient reports improvement. Neck pain now 3/10 (was 7/10). Headaches have resolved. Mid-back pain occasional 2/10.",
  LATEST_OBJECTIVE: "Cervical ROM: Flexion 45° (N:50), Extension 55° (N:60). Improved from initial. Reduced hypertonicity. Cervical compression (-) bilaterally.",
  LATEST_ASSESSMENT: "Patient responding well to care. Functional improvement noted across all metrics.",
  LATEST_PLAN: "Reduce frequency to 1x/week. Continue therapeutic exercises. Target discharge in 4 weeks.",
  ALL_SUBJECTIVE: "01/19/2026 (Initial Exam)\nPatient presents following MVA on 01/12/2026. Reports neck pain 7/10, mid-back pain 5/10, headaches 6/10.\n\n03/28/2026 (Follow Up)\nPatient reports improvement. Neck pain now 3/10. Headaches have resolved.",
  ALL_OBJECTIVE: "01/19/2026 (Initial Exam)\nCervical ROM: Flexion 35° (N:50), Extension 40° (N:60). Palpation reveals hypertonicity C3-C6.\n\n03/28/2026 (Follow Up)\nCervical ROM: Flexion 45° (N:50), Extension 55° (N:60). Improved from initial.",
  ALL_ASSESSMENT: "01/19/2026 (Initial Exam)\n1. Cervicalgia — M54.2\n2. Muscle spasm of back — M62.830\n\n03/28/2026 (Follow Up)\nPatient responding well to care. Functional improvement noted.",
  ALL_PLAN: "01/19/2026 (Initial Exam)\nChiropractic adjustments 3x/week for 4 weeks.\n\n03/28/2026 (Follow Up)\nReduce frequency to 1x/week. Target discharge in 4 weeks.",
  MACRO_SUBJECTIVE: "01/19/2026 • Initial History Intake\nPatient presents following MVA on 01/12/2026. Reports neck pain rated 7/10.",
  MACRO_OBJECTIVE: "01/19/2026 • ROM Assessment\nCervical ROM: Flexion 35° (N:50), Extension 40° (N:60).",
  MACRO_ASSESSMENT: "-",
  MACRO_PLAN: "-",
  ENCOUNTER_TIMELINE: "1. 01/19/2026 | Initial Exam | Dr. Michael Johnson | Closed\n2. 01/22/2026 | Follow Up | Dr. Michael Johnson | Closed\n3. 01/26/2026 | Follow Up | Dr. Michael Johnson | Closed\n4. 02/02/2026 | Follow Up | Dr. Michael Johnson | Closed\n5. 02/09/2026 | Follow Up | Dr. Michael Johnson | Closed\n6. 02/16/2026 | Re-Exam | Dr. Michael Johnson | Closed\n7. 02/23/2026 | Follow Up | Dr. Michael Johnson | Closed\n8. 03/02/2026 | Follow Up | Dr. Michael Johnson | Closed\n9. 03/09/2026 | Follow Up | Dr. Michael Johnson | Closed\n10. 03/16/2026 | Follow Up | Dr. Michael Johnson | Closed\n11. 03/23/2026 | Re-Exam | Dr. Michael Johnson | Closed\n12. 03/28/2026 | Follow Up | Dr. Michael Johnson | Open",
  DIAGNOSIS_LIST: "1. M54.2 - Cervicalgia\n2. M62.830 - Muscle spasm of back\n3. S13.4XXA - Sprain of ligaments of cervical spine\n4. M54.12 - Radiculopathy, cervical region",
  DIAGNOSIS_CODES: "M54.2, M62.830, S13.4XXA, M54.12",
  CHARGE_LEDGER: "1. 01/19/2026 | 99204 | New Patient E/M | $250.00 x 1 = $250.00\n2. 01/19/2026 | 98941 | CMT 3-4 Regions | $75.00 x 1 = $75.00\n3. 01/22/2026 | 98941 | CMT 3-4 Regions | $75.00 x 1 = $75.00",
  TOTAL_CHARGE_AMOUNT: "$8,450.00",
  XRAY_SUMMARY: "1. X-Ray | Completed: 01/19/2026 | Center: Valley Imaging | Regions: Cervical, Thoracic",
  XRAY_SENT_DATE: "01/19/2026",
  XRAY_COMPLETED_DATE: "01/19/2026",
  XRAY_REVIEWED_DATE: "01/23/2026",
  MRI_CT_SUMMARY: "1. MRI | Completed: 02/12/2026 | Center: Advanced MRI Center | Regions: Cervical",
  MRI_SENT_DATE: "02/05/2026",
  MRI_SCHEDULED_DATE: "02/12/2026",
  MRI_COMPLETED_DATE: "02/12/2026",
  MRI_REVIEWED_DATE: "02/17/2026",
  IMAGING_SUMMARY: "X-Ray:\n1. X-Ray | Completed: 01/19/2026 | Center: Valley Imaging | Regions: Cervical, Thoracic\n\nMRI/CT:\n1. MRI | Completed: 02/12/2026 | Center: Advanced MRI Center | Regions: Cervical",
  SPECIALIST_SUMMARY: "1. Dr. Robert Chen, Orthopedic | Sent: 02/20/2026 | Completed: 03/05/2026\n   Recommendations: Continue conservative care, consider epidural if symptoms persist.\n2. Dr. Sarah Kim, Neurologist | Sent: 03/01/2026 | Completed: 03/15/2026\n   Recommendations: EMG/NCV recommended for upper extremity radiculopathy evaluation.",
  SPECIALIST_NAME: "Dr. Robert Chen, Orthopedic and Dr. Sarah Kim, Neurologist",
  SPECIALIST_1_NAME: "Dr. Robert Chen, Orthopedic",
  SPECIALIST_1_SENT: "02/20/2026",
  SPECIALIST_1_COMPLETED: "03/05/2026",
  SPECIALIST_1_RECOMMENDATIONS: "Continue conservative care, consider epidural if symptoms persist.",
  SPECIALIST_2_NAME: "Dr. Sarah Kim, Neurologist",
  SPECIALIST_2_SENT: "03/01/2026",
  SPECIALIST_2_COMPLETED: "03/15/2026",
  SPECIALIST_2_RECOMMENDATIONS: "EMG/NCV recommended for upper extremity radiculopathy evaluation.",
  // Numbered encounter examples
  ENCOUNTER_1_SUBJECTIVE: "Patient presents following MVA on 01/12/2026. Reports neck pain rated 7/10, mid-back pain 5/10, headaches 6/10.",
  ENCOUNTER_1_OBJECTIVE: "Cervical ROM: Flexion 35° (N:50), Extension 40° (N:60). Palpation reveals hypertonicity at C3-C6 paraspinals bilaterally.",
  ENCOUNTER_1_ASSESSMENT: "1. Cervicalgia — M54.2\n2. Muscle spasm of back — M62.830\n3. Sprain of ligaments of cervical spine — S13.4XXA",
  ENCOUNTER_1_PLAN: "Chiropractic adjustments 3x/week for 4 weeks, then reassess.",
  ENCOUNTER_1_DATE: "01/19/2026",
  ENCOUNTER_1_TYPE: "Initial Exam",
  ENCOUNTER_2_SUBJECTIVE: "Neck pain 6/10, headaches 5/10. Slight improvement since initial visit.",
  ENCOUNTER_2_OBJECTIVE: "Cervical ROM slightly improved. Flexion 38°, Extension 42°.",
  ENCOUNTER_2_ASSESSMENT: "Responding to care. Continue current treatment plan.",
  ENCOUNTER_2_PLAN: "Continue 3x/week adjustments and therapeutic exercises.",
  ENCOUNTER_2_DATE: "01/22/2026",
  ENCOUNTER_2_TYPE: "Follow Up",
  ENCOUNTER_3_SUBJECTIVE: "Neck pain 5/10. Headaches less frequent, 3-4 days/week down from daily.",
  ENCOUNTER_3_OBJECTIVE: "Cervical ROM: Flexion 40°, Extension 45°. Reduced muscle guarding.",
  ENCOUNTER_3_ASSESSMENT: "Continued improvement. Symptoms decreasing.",
  ENCOUNTER_3_PLAN: "Continue current plan. Re-evaluate at 30 days.",
  ENCOUNTER_3_DATE: "01/26/2026",
  ENCOUNTER_3_TYPE: "Follow Up",
  ENCOUNTER_6_SUBJECTIVE: "30-day re-exam. Neck pain 4/10, headaches 2x/week, mid-back pain resolved.",
  ENCOUNTER_6_OBJECTIVE: "Cervical ROM: Flexion 42° (N:50), Extension 50° (N:60). Significant improvement from baseline.",
  ENCOUNTER_6_ASSESSMENT: "Good progress. Recommend reducing visit frequency.",
  ENCOUNTER_6_PLAN: "Reduce to 2x/week. Continue exercises. MRI recommended for persistent radiculopathy.",
  ENCOUNTER_6_DATE: "02/16/2026",
  ENCOUNTER_6_TYPE: "Re-Exam",
  ENCOUNTER_11_SUBJECTIVE: "60-day re-exam. Neck pain 3/10, headaches rare, overall much improved.",
  ENCOUNTER_11_OBJECTIVE: "Cervical ROM near normal. Flexion 45°, Extension 55°. Minimal hypertonicity.",
  ENCOUNTER_11_ASSESSMENT: "Excellent progress. Approaching MMI.",
  ENCOUNTER_11_PLAN: "Reduce to 1x/week for 4 weeks. Target discharge.",
  ENCOUNTER_11_DATE: "03/23/2026",
  ENCOUNTER_11_TYPE: "Re-Exam",
  ENCOUNTER_12_SUBJECTIVE: "Patient reports improvement. Neck pain now 3/10. Headaches have resolved.",
  ENCOUNTER_12_OBJECTIVE: "Cervical ROM: Flexion 45° (N:50), Extension 55° (N:60). Improved from initial.",
  ENCOUNTER_12_ASSESSMENT: "Patient responding well to care. Functional improvement noted.",
  ENCOUNTER_12_PLAN: "Reduce frequency to 1x/week. Continue exercises. Target discharge in 4 weeks.",
  ENCOUNTER_12_DATE: "03/28/2026",
  ENCOUNTER_12_TYPE: "Follow Up",
  // Appointment-type encounter examples
  PERSONAL_INJURY_NEW_PATIENT_1_SUBJECTIVE: "Patient presents following MVA on 01/12/2026. Reports neck pain rated 7/10, mid-back pain 5/10, headaches 6/10.",
  PERSONAL_INJURY_NEW_PATIENT_1_OBJECTIVE: "Cervical ROM: Flexion 35° (N:50), Extension 40° (N:60). Palpation reveals hypertonicity at C3-C6 paraspinals bilaterally.",
  PERSONAL_INJURY_NEW_PATIENT_1_ASSESSMENT: "1. Cervicalgia — M54.2\n2. Muscle spasm of back — M62.830",
  PERSONAL_INJURY_NEW_PATIENT_1_PLAN: "Chiropractic adjustments 3x/week for 4 weeks, then reassess.",
  PERSONAL_INJURY_NEW_PATIENT_1_DATE: "01/19/2026",
  PERSONAL_INJURY_RE_EXAM_1_SUBJECTIVE: "30-day re-exam. Neck pain 4/10, headaches 2x/week, mid-back pain resolved.",
  PERSONAL_INJURY_RE_EXAM_1_OBJECTIVE: "Cervical ROM: Flexion 42° (N:50), Extension 50° (N:60). Significant improvement from baseline.",
  PERSONAL_INJURY_RE_EXAM_1_ASSESSMENT: "Good progress. Recommend reducing visit frequency.",
  PERSONAL_INJURY_RE_EXAM_1_PLAN: "Reduce to 2x/week. Continue exercises. MRI recommended for persistent radiculopathy.",
  PERSONAL_INJURY_RE_EXAM_1_DATE: "02/16/2026",
  PERSONAL_INJURY_RE_EXAM_2_SUBJECTIVE: "60-day re-exam. Neck pain 3/10, headaches rare, overall much improved.",
  PERSONAL_INJURY_RE_EXAM_2_OBJECTIVE: "Cervical ROM near normal. Flexion 45°, Extension 55°. Minimal hypertonicity.",
  PERSONAL_INJURY_RE_EXAM_2_ASSESSMENT: "Excellent progress. Approaching MMI.",
  PERSONAL_INJURY_RE_EXAM_2_PLAN: "Reduce to 1x/week for 4 weeks. Target discharge.",
  PERSONAL_INJURY_RE_EXAM_2_DATE: "03/23/2026",
  PERSONAL_INJURY_OFFICE_VISIT_1_SUBJECTIVE: "Neck pain 6/10, headaches 5/10. Slight improvement since initial visit.",
  PERSONAL_INJURY_OFFICE_VISIT_1_OBJECTIVE: "Cervical ROM slightly improved. Flexion 38°, Extension 42°.",
  PERSONAL_INJURY_OFFICE_VISIT_1_ASSESSMENT: "Responding to care. Continue current treatment plan.",
  PERSONAL_INJURY_OFFICE_VISIT_1_PLAN: "Continue 3x/week adjustments and therapeutic exercises.",
  PERSONAL_INJURY_OFFICE_VISIT_1_DATE: "01/22/2026",
};
// Fill in remaining numbered encounters with defaults
for (let i = 1; i <= 20; i++) {
  for (const suffix of ["SUBJECTIVE", "OBJECTIVE", "ASSESSMENT", "PLAN", "DATE", "TYPE"]) {
    const key = `ENCOUNTER_${i}_${suffix}`;
    if (!examplePreviewContext[key]) {
      examplePreviewContext[key] = "-";
    }
  }
}

const tokenLabelMap = Object.fromEntries(
  narrativeReportAutoFields.map((f) => [f.token, f.label]),
);

export function ReportTemplateSettingsPanel() {
  const {
    reportTemplates,
    addTemplate,
    updateTemplate,
    removeTemplate,
    addPrompt,
    updatePrompt,
    removePrompt,
    resetToDefaults,
  } = useReportTemplates();

  const bodyEditorRef = useRef<RichTextTemplateEditorHandle | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    reportTemplates.templates[0]?.id ?? null,
  );
  const [templateNameDraft, setTemplateNameDraft] = useState("Insurance Narrative");
  const [autoFieldSearch, setAutoFieldSearch] = useState("");
  const [error, setError] = useState("");

  const [promptLabelDraft, setPromptLabelDraft] = useState("");
  const [promptNewOptions, setPromptNewOptions] = useState<string[]>([]);
  const [promptNewChoiceDraft, setPromptNewChoiceDraft] = useState("");
  const [promptRequiredDraft, setPromptRequiredDraft] = useState(false);
  const [promptChoiceDrafts, setPromptChoiceDrafts] = useState<Record<string, string>>({});
  const [encounterPickerNumber, setEncounterPickerNumber] = useState("1");
  const [encounterPickerSection, setEncounterPickerSection] = useState("SUBJECTIVE");
  const [encounterPickerType, setEncounterPickerType] = useState(() => {
    const types = loadAppointmentTypes();
    return types.length ? types[0].name : "";
  });
  const [showLivePreview, setShowLivePreview] = useState(true);

  const appointmentTypes = useMemo(() => loadAppointmentTypes(), []);

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId) {
      const matched = reportTemplates.templates.find((entry) => entry.id === selectedTemplateId);
      if (matched) {
        return matched;
      }
    }
    return reportTemplates.templates[0] ?? null;
  }, [reportTemplates.templates, selectedTemplateId]);

  const usedFieldTokens = useMemo(() => {
    if (!selectedTemplate) {
      return [];
    }
    const allowed = new Set(
      [...narrativeReportAutoFields.map((field) => field.token), ...selectedTemplate.prompts.map((prompt) => prompt.token)],
    );
    const used = new Set<string>();
    const matches = selectedTemplate.body.matchAll(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g);
    for (const match of matches) {
      const token = (match[1] ?? "").toUpperCase();
      if (allowed.has(token)) {
        used.add(token);
      }
    }
    return Array.from(used);
  }, [selectedTemplate]);

  const handleAddTemplate = () => {
    const createdId = addTemplate(
      templateNameDraft,
      `Narrative Report\n\nPatient: {{PATIENT_FULL_NAME}}\nDate Of Injury: {{DATE_OF_INJURY}}\n\nHistory:\n{{FIRST_OBJECTIVE}}`,
    );
    if (!createdId) {
      setError("Could not add template. Name may be missing or already in use.");
      return;
    }
    setError("");
    setTemplateNameDraft("");
    setSelectedTemplateId(createdId);
  };

  const handleAddPrompt = () => {
    if (!selectedTemplate) {
      return;
    }
    const wasAdded = addPrompt(selectedTemplate.id, promptLabelDraft, promptNewOptions, promptRequiredDraft);
    if (!wasAdded) {
      setError("Prompt label is required.");
      return;
    }
    setError("");
    setPromptLabelDraft("");
    setPromptNewOptions([]);
    setPromptNewChoiceDraft("");
    setPromptRequiredDraft(false);
  };

  // ── Live preview: render template body with example data ───────────────
  const livePreviewHtml = useMemo(() => {
    if (!selectedTemplate || !showLivePreview) return "";
    // Build context that includes prompt example values
    const ctx: Record<string, string> = { ...examplePreviewContext };
    for (const prompt of selectedTemplate.prompts) {
      ctx[prompt.token] = prompt.options.length
        ? prompt.options[0]
        : `[${prompt.label}]`;
    }
    return renderDocumentTemplate(selectedTemplate.body, ctx);
  }, [selectedTemplate, showLivePreview]);

  const [insertFlash, setInsertFlash] = useState<string | null>(null);

  const insertTextAtCursor = (text: string) => {
    if (!selectedTemplate) {
      return;
    }
    if (bodyEditorRef.current) {
      bodyEditorRef.current.insertText(text);
    } else {
      updateTemplate(selectedTemplate.id, { body: `${selectedTemplate.body}${text}` });
    }
    // Flash feedback
    setInsertFlash(text);
    setTimeout(() => setInsertFlash(null), 1200);
  };

  const getPromptDraftKey = (templateId: string, promptId: string) => `${templateId}::${promptId}`;

  if (!selectedTemplate) {
    return null;
  }

  return (
    <div className="relative space-y-4">
      {insertFlash && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-50 -translate-x-1/2 animate-[fadeInOut_1.2s_ease-in-out] rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg">
          Inserted: {insertFlash}
        </div>
      )}
      <style>{`@keyframes fadeInOut { 0% { opacity: 0; transform: translateX(-50%) translateY(-8px); } 15% { opacity: 1; transform: translateX(-50%) translateY(0); } 80% { opacity: 1; } 100% { opacity: 0; } }`}</style>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
          onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetToDefaults(); }}
          type="button"
        >
          Reset Report Template Defaults
        </button>
      </div>

      {error && <p className="text-sm font-semibold text-[#b43b34]">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <h4 className="text-lg font-semibold">Narrative Templates</h4>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Build long-form reports from patient data + encounter notes + runtime prompts.
          </p>

          <div className="mt-3 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Template Name</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setTemplateNameDraft(event.target.value)}
                placeholder="Example: Full PI Narrative"
                value={templateNameDraft}
              />
            </label>
            <button
              className="mt-2 w-full rounded-xl bg-[var(--brand-primary)] px-4 py-2 font-semibold text-white transition-all active:scale-[0.97] active:brightness-90"
              onClick={handleAddTemplate}
              type="button"
            >
              Add Template
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {reportTemplates.templates.map((template) => (
              <button
                className={`w-full rounded-xl border px-3 py-2 text-left ${
                  template.id === selectedTemplate.id
                    ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.08)]"
                    : "border-[var(--line-soft)] bg-[var(--bg-soft)]"
                }`}
                key={template.id}
                onClick={() => {
                  setSelectedTemplateId(template.id);
                  setError("");
                }}
                type="button"
              >
                <p className="font-semibold">{template.name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Prompts: {template.prompts.length} • {template.active ? "Active" : "Inactive"}
                </p>
              </button>
            ))}
          </div>
        </article>

        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xl font-semibold">Edit Narrative Template</h4>
            <button
              className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold transition-all active:scale-[0.97] active:shadow-inner"
              disabled={reportTemplates.templates.length <= 1}
              onClick={() => {
                if (!window.confirm(`Delete template "${selectedTemplate.name}"? This cannot be undone.`)) return;
                removeTemplate(selectedTemplate.id);
                if (selectedTemplateId === selectedTemplate.id) {
                  const fallback = reportTemplates.templates.find((entry) => entry.id !== selectedTemplate.id);
                  setSelectedTemplateId(fallback?.id ?? null);
                }
              }}
              type="button"
            >
              Delete Template
            </button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_260px_auto]">
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Template Name</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => updateTemplate(selectedTemplate.id, { name: event.target.value })}
                value={selectedTemplate.name}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Font</span>
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => updateTemplate(selectedTemplate.id, { fontFamily: event.target.value })}
                value={selectedTemplate.fontFamily}
              >
                {documentFontOptions.map((fontOption) => (
                  <option key={fontOption.value} value={fontOption.value}>
                    {fontOption.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-end gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 font-semibold">
              <input
                checked={selectedTemplate.active}
                onChange={(event) => updateTemplate(selectedTemplate.id, { active: event.target.checked })}
                type="checkbox"
              />
              Active
            </label>
          </div>

          <div className="mt-3 grid gap-1">
            <span className="text-sm font-semibold text-[var(--text-muted)]">Template Body</span>
            <RichTextTemplateEditor
              ref={bodyEditorRef}
              fontFamily={selectedTemplate.fontFamily}
              minHeightClassName="min-h-[340px]"
              onChange={(nextValue) => updateTemplate(selectedTemplate.id, { body: nextValue })}
              placeholder="Build your narrative template..."
              value={selectedTemplate.body}
            />
          </div>

          {/* ── Live Preview ─────────────────────────────────────────── */}
          <article className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <button
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setShowLivePreview((prev) => !prev)}
              type="button"
            >
              <div>
                <h5 className="text-lg font-semibold">Live Preview</h5>
                <p className="text-sm text-[var(--text-muted)]">
                  See how your template looks with example patient data
                </p>
              </div>
              <span
                aria-hidden
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--line-soft)] text-sm transition-transform ${
                  showLivePreview ? "rotate-180" : ""
                }`}
              >
                ⌄
              </span>
            </button>

            {showLivePreview && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2 rounded-lg bg-[rgba(13,121,191,0.08)] px-3 py-2 text-xs text-[var(--brand-primary)]">
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                  </svg>
                  <span>
                    This preview uses example data (Maria Garcia, MVA case). In a real report, your actual patient data fills these fields.
                  </span>
                </div>

                <div
                  className="max-h-[600px] overflow-auto rounded-xl border border-[var(--line-soft)] bg-white p-6 text-sm leading-7"
                  style={{ fontFamily: selectedTemplate.fontFamily }}
                >
                  {livePreviewHtml ? (
                    <div
                      className="whitespace-pre-wrap break-words"
                      dangerouslySetInnerHTML={{ __html: livePreviewHtml }}
                    />
                  ) : (
                    <p className="text-center text-[var(--text-muted)]">
                      Your template is empty. Start building it above and the preview will update in real time.
                    </p>
                  )}
                </div>

                {/* Token legend — show which tokens are in the template */}
                {usedFieldTokens.length > 0 && (
                  <details className="rounded-lg border border-[var(--line-soft)] bg-white">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                      {usedFieldTokens.length} token{usedFieldTokens.length !== 1 ? "s" : ""} used in this template
                    </summary>
                    <div className="flex flex-wrap gap-1.5 border-t border-[var(--line-soft)] px-3 py-2">
                      {usedFieldTokens.map((token) => (
                        <span
                          className="rounded-full border border-[var(--brand-primary)] bg-[rgba(13,121,191,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-primary)]"
                          key={token}
                        >
                          {token}
                        </span>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </article>

          <article className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h5 className="text-lg font-semibold">Insert Auto Fields</h5>
              <span className="text-sm font-semibold text-[var(--text-muted)]">
                Selected: {usedFieldTokens.length}
              </span>
            </div>

            <input
              className="mb-3 w-full rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              onChange={(event) => setAutoFieldSearch(event.target.value)}
              placeholder="Search fields... (e.g. objective, patient, billing)"
              value={autoFieldSearch}
            />

            {(() => {
              const q = autoFieldSearch.trim().toLowerCase();

              const filteredCategories = autoFieldCategories
                .map((cat) => {
                  const matchingTokens = cat.tokens.filter((token) => {
                    if (!q) return true;
                    const label = (tokenLabelMap[token] ?? token).toLowerCase();
                    return token.toLowerCase().includes(q) || label.includes(q) || cat.label.toLowerCase().includes(q);
                  });
                  return { ...cat, tokens: matchingTokens };
                })
                .filter((cat) => cat.tokens.length > 0);

              const filteredPrompts = selectedTemplate.prompts.filter((prompt) => {
                if (!q) return true;
                return (
                  prompt.token.toLowerCase().includes(q) ||
                  prompt.label.toLowerCase().includes(q)
                );
              });

              if (filteredCategories.length === 0 && filteredPrompts.length === 0) {
                return (
                  <p className="py-4 text-center text-sm text-[var(--text-muted)]">
                    No fields match &ldquo;{autoFieldSearch.trim()}&rdquo;
                  </p>
                );
              }

              return (
                <div className="space-y-3">
                  {filteredCategories.map((cat) => (
                    <div key={cat.label}>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                        {cat.label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {cat.tokens.map((token) => {
                          const used = usedFieldTokens.includes(token);
                          const label = tokenLabelMap[token] ?? token;
                          return (
                            <button
                              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                used
                                  ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)] text-[var(--brand-primary)]"
                                  : "border-[var(--line-soft)] bg-white hover:border-[var(--brand-primary)] hover:bg-[rgba(13,121,191,0.04)]"
                              }`}
                              key={token}
                              onClick={() => insertTextAtCursor(insertionTokenForField(token))}
                              title={label}
                              type="button"
                            >
                              {used ? "✓ " : ""}
                              {token}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {filteredPrompts.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                        Custom Prompts
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {filteredPrompts.map((prompt) => {
                          const used = usedFieldTokens.includes(prompt.token);
                          return (
                            <button
                              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                used
                                  ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)] text-[var(--brand-primary)]"
                                  : "border-[var(--line-soft)] bg-white hover:border-[var(--brand-primary)] hover:bg-[rgba(13,121,191,0.04)]"
                              }`}
                              key={prompt.id}
                              onClick={() => insertTextAtCursor(insertionTokenForField(prompt.token))}
                              title={prompt.label}
                              type="button"
                            >
                              {used ? "✓ " : ""}
                              {prompt.token}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </article>

          {/* ── Encounter Section Picker ──────────────────────────────── */}
          <article className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <div className="mb-2">
              <h5 className="text-lg font-semibold">Encounter Section Picker</h5>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Pick encounters by appointment type. #1 = first of that type, #2 = second, etc.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">Appointment Type</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setEncounterPickerType(event.target.value)}
                  value={encounterPickerType}
                >
                  {appointmentTypes.map((type) => (
                    <option key={type.id} value={type.name}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">#</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setEncounterPickerNumber(event.target.value)}
                  value={encounterPickerNumber}
                >
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i + 1} value={`${i + 1}`}>
                      #{i + 1}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1">
                <span className="text-xs font-semibold text-[var(--text-muted)]">Section</span>
                <select
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
                  onChange={(event) => setEncounterPickerSection(event.target.value)}
                  value={encounterPickerSection}
                >
                  {encounterPickerSections.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white"
                onClick={() => {
                  const prefix = appointmentTypeToTokenPrefix(encounterPickerType);
                  if (!prefix) return;
                  const token = `${prefix}_${encounterPickerNumber}_${encounterPickerSection}`;
                  insertTextAtCursor(insertionTokenForField(token));
                }}
                type="button"
              >
                Insert
              </button>
            </div>

            {encounterPickerType && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Will insert:{" "}
                <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[var(--brand-primary)]">
                  {`{{${appointmentTypeToTokenPrefix(encounterPickerType)}_${encounterPickerNumber}_${encounterPickerSection}}}`}
                </code>
              </p>
            )}

            {/* Show already-used encounter tokens */}
            {(() => {
              const usedEncTokens = usedFieldTokens.filter((t) =>
                /^(ENCOUNTER_\d+_|PERSONAL_|CASH_|SPINAL_)/.test(t) && /_(?:SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN|DATE|TYPE)$/.test(t)
              );
              if (!usedEncTokens.length) return null;
              return (
                <div className="mt-3 border-t border-[var(--line-soft)] pt-2">
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                    Encounter Tokens In Template
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {usedEncTokens.map((token) => (
                      <span
                        className="rounded-full border border-[var(--brand-primary)] bg-[rgba(13,121,191,0.12)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]"
                        key={token}
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </article>

          <article className="mt-4 rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
            <h5 className="text-lg font-semibold">Question Prompts</h5>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              These prompts appear when generating the narrative so users can input custom details.
            </p>

            <div className="mt-3 grid gap-2 rounded-xl border border-[var(--line-soft)] bg-white p-2 md:grid-cols-[1fr_1fr_auto_auto]">
              <input
                className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                onChange={(event) => setPromptLabelDraft(event.target.value)}
                placeholder="Prompt label (e.g. Current symptoms)"
                value={promptLabelDraft}
              />
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1">
                  {promptNewOptions.map((opt, i) => (
                    <span
                      key={`new-opt-${i}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-0.5 text-xs"
                    >
                      {opt}
                      <button
                        className="ml-0.5 text-[var(--text-muted)] hover:text-[#b43b34]"
                        onClick={() => setPromptNewOptions((c) => c.filter((_, idx) => idx !== i))}
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    className="flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2"
                    onChange={(event) => setPromptNewChoiceDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const v = promptNewChoiceDraft.trim();
                        if (v) {
                          setPromptNewOptions((c) => [...c, v]);
                          setPromptNewChoiceDraft("");
                        }
                      }
                    }}
                    placeholder="Add choice (optional)"
                    value={promptNewChoiceDraft}
                  />
                  <button
                    className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-2 text-xs font-semibold"
                    onClick={() => {
                      const v = promptNewChoiceDraft.trim();
                      if (v) {
                        setPromptNewOptions((c) => [...c, v]);
                        setPromptNewChoiceDraft("");
                      }
                    }}
                    type="button"
                  >
                    + Add
                  </button>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold">
                <input
                  checked={promptRequiredDraft}
                  onChange={(event) => setPromptRequiredDraft(event.target.checked)}
                  type="checkbox"
                />
                Required
              </label>
              <button
                className="rounded-lg bg-[var(--brand-primary)] px-3 py-2 font-semibold text-white"
                onClick={handleAddPrompt}
                type="button"
              >
                Add
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {selectedTemplate.prompts.map((prompt) => (
                <div
                  className="rounded-xl border border-[var(--line-soft)] bg-white p-2"
                  key={prompt.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="flex-1 min-w-[140px] rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1.5"
                      onChange={(event) =>
                        updatePrompt(selectedTemplate.id, prompt.id, { label: event.target.value })
                      }
                      value={prompt.label}
                    />
                    <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-1.5 text-sm font-semibold">
                      <input
                        checked={prompt.required}
                        onChange={(event) =>
                          updatePrompt(selectedTemplate.id, prompt.id, { required: event.target.checked })
                        }
                        type="checkbox"
                      />
                      Required
                    </label>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 font-semibold"
                      onClick={() => insertTextAtCursor(insertionTokenForField(prompt.token))}
                      type="button"
                    >
                      Insert Token
                    </button>
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-3 py-1.5 font-semibold"
                      onClick={() => { if (window.confirm(`Remove prompt "${prompt.label}"?`)) removePrompt(selectedTemplate.id, prompt.id); }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Chip-based options */}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {prompt.options.map((opt, optIdx) => (
                      <span
                        key={`${prompt.id}-opt-${optIdx}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--line-soft)] bg-[var(--bg-soft)] px-2 py-0.5 text-xs"
                      >
                        {opt}
                        <button
                          className="ml-0.5 text-[var(--text-muted)] hover:text-[#b43b34]"
                          onClick={() =>
                            updatePrompt(selectedTemplate.id, prompt.id, {
                              options: prompt.options.filter((_, i) => i !== optIdx),
                            })
                          }
                          type="button"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      className="flex-1 rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs"
                      onChange={(event) =>
                        setPromptChoiceDrafts((c) => ({
                          ...c,
                          [getPromptDraftKey(selectedTemplate.id, prompt.id)]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          const key = getPromptDraftKey(selectedTemplate.id, prompt.id);
                          const v = (promptChoiceDrafts[key] ?? "").trim();
                          if (v) {
                            updatePrompt(selectedTemplate.id, prompt.id, {
                              options: [...prompt.options, v],
                            });
                            setPromptChoiceDrafts((c) => ({ ...c, [key]: "" }));
                          }
                        }
                      }}
                      placeholder="Add choice..."
                      value={promptChoiceDrafts[getPromptDraftKey(selectedTemplate.id, prompt.id)] ?? ""}
                    />
                    <button
                      className="rounded-lg border border-[var(--line-soft)] bg-white px-2 py-1 text-xs font-semibold"
                      onClick={() => {
                        const key = getPromptDraftKey(selectedTemplate.id, prompt.id);
                        const v = (promptChoiceDrafts[key] ?? "").trim();
                        if (v) {
                          updatePrompt(selectedTemplate.id, prompt.id, {
                            options: [...prompt.options, v],
                          });
                          setPromptChoiceDrafts((c) => ({ ...c, [key]: "" }));
                        }
                      }}
                      type="button"
                    >
                      + Add
                    </button>
                  </div>

                  <p className="mt-1 text-xs text-[var(--text-muted)]">Token: {insertionTokenForField(prompt.token)}</p>
                </div>
              ))}
              {selectedTemplate.prompts.length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No prompts added yet.</p>
              )}
            </div>
          </article>
        </article>
      </div>
    </div>
  );
}
