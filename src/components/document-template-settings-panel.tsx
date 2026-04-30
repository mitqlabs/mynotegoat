"use client";

import { useMemo, useRef, useState } from "react";
import {
  RichTextTemplateEditor,
  type RichTextTemplateEditorHandle,
} from "@/components/rich-text-template-editor";
import { useDocumentTemplates } from "@/hooks/use-document-templates";
import {
  documentFontOptions,
  documentTemplateFields,
  documentTemplateFieldGroups,
  renderDocumentTemplate,
  type DocumentTemplate,
  type DocumentTemplateScope,
} from "@/lib/document-templates";
import {
  applyLabelValueHangingIndent,
  stripHtmlIndentation,
} from "@/lib/document-html-layout";
import type { OfficeSettings } from "@/lib/office-settings";

const demoPatientContext: Record<string, string> = {
  TODAY_DATE: "03/16/2026",
  PATIENT_FULL_NAME: "John Doe",
  PATIENT_FIRST_NAME: "John",
  PATIENT_LAST_NAME: "Doe",
  PATIENT_DOB: "05/12/1990",
  DATE_OF_INJURY: "03/01/2026",
  PATIENT_PHONE: "818-555-0144",
  PATIENT_EMAIL: "john.doe@example.com",
  CASE_NUMBER: "030126DOJO",
  ATTORNEY_NAME: "Doe & Associates",
  ATTORNEY_PHONE: "818-405-0048",
  ATTORNEY_FAX: "818-405-1122",
  ATTORNEY_EMAIL: "pi@doelaw.com",
  ATTORNEY_ADDRESS: "123 Main St, Glendale, CA 91205",
  SPECIALIST_NAME: "Dr. Raymond Tatevossian",
  SPECIALIST_PHONE: "818-325-2088",
  SPECIALIST_FAX: "818-325-2096",
  SPECIALIST_EMAIL: "new.patient@csppdoctors.com",
  SPECIALIST_ADDRESS: "456 Clinic Rd, Glendale, CA 91203",
  REFERRAL_SENT_DATE: "03/16/2026",
  REFERRAL_SCHEDULED_DATE: "03/23/2026",
  IMAGING_TYPE: "MRI",
  IMAGING_CENTER: "Diagnostic Imaging Network",
  IMAGING_PHONE: "818-555-0199",
  IMAGING_FAX: "818-555-0188",
  IMAGING_EMAIL: "referrals@diagnosticimaging.example",
  IMAGING_ADDRESS: "789 Scan Blvd, Glendale, CA 91204",
  IMAGING_REGIONS: "Cervical, Lumbar",
  IMAGING_SENT_DATE: "03/16/2026",
  IMAGING_DONE_DATE: "03/23/2026",
  IMAGING_REPORT_RECEIVED_DATE: "03/27/2026",
  IMAGING_REPORT_REVIEWED_DATE: "03/29/2026",
};

const templateTokenPattern = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

function insertionTokenForField(fieldToken: string) {
  return `{{${fieldToken}}}`;
}

function getTemplateTypeLabel(scope: DocumentTemplateScope) {
  if (scope === "specialistReferral") {
    return "Specialist Template";
  }
  if (scope === "imagingRequest") {
    return "Imaging Template";
  }
  return "Letter Template";
}

function findTemplateByScope(
  templates: DocumentTemplate[],
  scope: "specialistReferral" | "imagingRequest",
) {
  const byScope = templates.filter((entry) => entry.scope === scope);
  return byScope.find((entry) => entry.active) ?? byScope[0] ?? null;
}

type DocumentTemplateSettingsPanelProps = {
  officeSettings: OfficeSettings;
  preferredScope?: DocumentTemplateScope | null;
};

export function DocumentTemplateSettingsPanel({
  officeSettings,
  preferredScope = null,
}: DocumentTemplateSettingsPanelProps) {
  const {
    documentTemplates,
    addLetterTemplate,
    ensureScopeTemplate,
    updateTemplate,
    updateHeader,
    removeTemplate,
    resetToDefaults,
  } = useDocumentTemplates();

  const headerEditorRef = useRef<RichTextTemplateEditorHandle | null>(null);
  const bodyEditorRef = useRef<RichTextTemplateEditorHandle | null>(null);

  const specialistTemplate = useMemo(
    () => findTemplateByScope(documentTemplates.templates, "specialistReferral"),
    [documentTemplates.templates],
  );
  const imagingTemplate = useMemo(
    () => findTemplateByScope(documentTemplates.templates, "imagingRequest"),
    [documentTemplates.templates],
  );
  const letterTemplates = useMemo(
    () => documentTemplates.templates.filter((entry) => entry.scope === "generalLetter"),
    [documentTemplates.templates],
  );

  const editorTemplateList = useMemo(() => {
    const list: DocumentTemplate[] = [];
    if (specialistTemplate) {
      list.push(specialistTemplate);
    }
    if (imagingTemplate) {
      list.push(imagingTemplate);
    }
    return [...list, ...letterTemplates];
  }, [imagingTemplate, letterTemplates, specialistTemplate]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(() => {
    if (preferredScope) {
      const preferred = documentTemplates.templates.find((entry) => entry.scope === preferredScope);
      if (preferred) {
        return preferred.id;
      }
    }
    return documentTemplates.templates[0]?.id ?? null;
  });
  const [templateNameDraft, setTemplateNameDraft] = useState("School Note");
  const [error, setError] = useState("");

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId) {
      const matched = editorTemplateList.find((entry) => entry.id === selectedTemplateId);
      if (matched) {
        return matched;
      }
    }
    if (preferredScope) {
      const preferred = editorTemplateList.find((entry) => entry.scope === preferredScope);
      if (preferred) {
        return preferred;
      }
    }
    return editorTemplateList[0] ?? null;
  }, [editorTemplateList, preferredScope, selectedTemplateId]);

  const previewContext = useMemo(
    () => ({
      TODAY_DATE: demoPatientContext.TODAY_DATE,
      OFFICE_NAME: officeSettings.officeName,
      OFFICE_ADDRESS: officeSettings.address,
      OFFICE_PHONE: officeSettings.phone,
      OFFICE_FAX: officeSettings.fax,
      OFFICE_EMAIL: officeSettings.email,
      DOCTOR_NAME: officeSettings.doctorName,
      ...demoPatientContext,
    }),
    [
      officeSettings.address,
      officeSettings.doctorName,
      officeSettings.email,
      officeSettings.fax,
      officeSettings.officeName,
      officeSettings.phone,
    ],
  );

  const previewBody = useMemo(() => {
    if (!selectedTemplate) {
      return "";
    }
    const rendered = renderDocumentTemplate(selectedTemplate.body, previewContext);
    return applyLabelValueHangingIndent(stripHtmlIndentation(rendered));
  }, [previewContext, selectedTemplate]);

  const previewHeader = useMemo(() => {
    if (!documentTemplates.header.active) {
      return "";
    }
    return renderDocumentTemplate(documentTemplates.header.body, previewContext);
  }, [documentTemplates.header.active, documentTemplates.header.body, previewContext]);

  const usedFieldTokens = useMemo(() => {
    if (!selectedTemplate) {
      return [];
    }
    const allowed = new Set(documentTemplateFields.map((field) => field.token));
    const used = new Set<string>();
    const matches = selectedTemplate.body.matchAll(templateTokenPattern);
    for (const match of matches) {
      const token = (match[1] ?? "").toUpperCase();
      if (allowed.has(token)) {
        used.add(token);
      }
    }
    return Array.from(used);
  }, [selectedTemplate]);

  const selectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setError("");
  };

  const handleAddLetterTemplate = () => {
    const createdId = addLetterTemplate(templateNameDraft);
    if (!createdId) {
      setError("Could not add template. Name may be missing or already in use.");
      return;
    }
    setError("");
    setSelectedTemplateId(createdId);
    setTemplateNameDraft("");
  };

  const handleEnsureSpecialistTemplate = () => {
    const templateId = specialistTemplate?.id ?? ensureScopeTemplate("specialistReferral");
    if (!templateId) {
      setError("Could not create Specialist Template.");
      return;
    }
    selectTemplate(templateId);
  };

  const handleEnsureImagingTemplate = () => {
    const templateId = imagingTemplate?.id ?? ensureScopeTemplate("imagingRequest");
    if (!templateId) {
      setError("Could not create Imaging Template.");
      return;
    }
    selectTemplate(templateId);
  };

  const canRemoveSelectedTemplate = selectedTemplate?.scope === "generalLetter";

  const insertTemplateFieldToken = (fieldToken: string) => {
    const token = insertionTokenForField(fieldToken);
    if (bodyEditorRef.current) {
      bodyEditorRef.current.insertText(token);
      return;
    }
    if (!selectedTemplate) {
      return;
    }
    updateTemplate(selectedTemplate.id, { body: `${selectedTemplate.body}${token}` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-xl border border-[var(--line-soft)] bg-white px-4 py-2 font-semibold"
          onClick={() => { if (window.confirm("Are you sure you want to reset to defaults? This will overwrite your current settings.")) resetToDefaults(); }}
          type="button"
        >
          Reset Document Template Defaults
        </button>
      </div>

      {error && <p className="text-sm font-semibold text-[#b43b34]">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <article className="rounded-xl border border-[var(--line-soft)] bg-white p-3">
          <h4 className="text-lg font-semibold">Templates</h4>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Imaging + Specialist each use one fixed template. Add as many Letter/Note templates as you want.
          </p>

          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-sm font-semibold">Fixed Templates</p>
              <div className="mt-2 grid gap-2">
                <button
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                    selectedTemplate?.id === specialistTemplate?.id
                      ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                      : "border-[var(--line-soft)] bg-white"
                  }`}
                  onClick={handleEnsureSpecialistTemplate}
                  type="button"
                >
                  {specialistTemplate ? "Specialist Template" : "+ Create Specialist Template"}
                </button>
                <button
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                    selectedTemplate?.id === imagingTemplate?.id
                      ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                      : "border-[var(--line-soft)] bg-white"
                  }`}
                  onClick={handleEnsureImagingTemplate}
                  type="button"
                >
                  {imagingTemplate ? "Imaging Template" : "+ Create Imaging Template"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
              <p className="text-sm font-semibold">Letters / Notes</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                For school notes, work notes, gym notes, and any custom letters.
              </p>
              <div className="mt-2 grid gap-2">
                <input
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                  onChange={(event) => setTemplateNameDraft(event.target.value)}
                  placeholder="Template name (ex: School Note)"
                  value={templateNameDraft}
                />
                <button
                  className="rounded-xl bg-[var(--brand-primary)] px-3 py-2 font-semibold text-white"
                  onClick={handleAddLetterTemplate}
                  type="button"
                >
                  Add Letter Template
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {editorTemplateList.map((template) => (
                <button
                  key={template.id}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${
                    selectedTemplate?.id === template.id
                      ? "border-[var(--brand-primary)] bg-[rgba(13,121,191,0.1)]"
                      : "border-[var(--line-soft)] bg-white"
                  }`}
                  onClick={() => selectTemplate(template.id)}
                  type="button"
                >
                  <p className="font-semibold">{template.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{getTemplateTypeLabel(template.scope)}</p>
                </button>
              ))}
              {editorTemplateList.length === 0 ? (
                <p className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm text-[var(--text-muted)]">
                  No templates available.
                </p>
              ) : null}
            </div>
          </div>
        </article>

        <article className="min-w-0 rounded-xl border border-[var(--line-soft)] bg-white p-4">
          {!selectedTemplate ? (
            <p className="text-sm text-[var(--text-muted)]">No templates available.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-base font-semibold">Shared Document Header</h5>
                  <span className="text-xs text-[var(--text-muted)]">Applied to all generated PDFs</span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Keep office name/contact/logo here so every template starts with the same header.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-[220px_auto_auto]">
                  <label className="grid gap-1">
                    <span className="text-sm font-semibold text-[var(--text-muted)]">Header Font</span>
                    <select
                      className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                      onChange={(event) => updateHeader({ fontFamily: event.target.value })}
                      value={documentTemplates.header.fontFamily}
                    >
                      {documentFontOptions.map((option) => (
                        <option key={`header-font-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2 self-end rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold">
                    <input
                      checked={documentTemplates.header.active}
                      onChange={(event) => updateHeader({ active: event.target.checked })}
                      type="checkbox"
                    />
                    Header Enabled
                  </label>
                  <label className="inline-flex items-center gap-2 self-end rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold">
                    <input
                      checked={documentTemplates.header.showOfficeLogo}
                      onChange={(event) => updateHeader({ showOfficeLogo: event.target.checked })}
                      type="checkbox"
                    />
                    Include Office Logo
                  </label>
                </div>
                <div className="mt-3 grid gap-1">
                  <span className="text-sm font-semibold text-[var(--text-muted)]">Header Body</span>
                  <RichTextTemplateEditor
                    ref={headerEditorRef}
                    fontFamily={documentTemplates.header.fontFamily}
                    minHeightClassName="min-h-28"
                    onChange={(nextValue) => updateHeader({ body: nextValue })}
                    placeholder="Office name, address, phone, fax, email..."
                    value={documentTemplates.header.body}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
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
                    {documentFontOptions.map((option) => (
                      <option key={`document-font-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 self-end rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] px-3 py-2 text-sm font-semibold">
                  <input
                    checked={selectedTemplate.active}
                    onChange={(event) => updateTemplate(selectedTemplate.id, { active: event.target.checked })}
                    type="checkbox"
                  />
                  Active
                </label>
              </div>

              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {getTemplateTypeLabel(selectedTemplate.scope)}
              </p>

              <div className="grid gap-1">
                <span className="text-sm font-semibold text-[var(--text-muted)]">Template Body</span>
                <RichTextTemplateEditor
                  ref={bodyEditorRef}
                  fontFamily={selectedTemplate.fontFamily}
                  minHeightClassName="min-h-[320px]"
                  onChange={(nextValue) => updateTemplate(selectedTemplate.id, { body: nextValue })}
                  placeholder="Build your reusable template..."
                  value={selectedTemplate.body}
                />
              </div>

              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Insert Auto Fields</p>
                  <p className="text-xs text-[var(--text-muted)]">Used in this template: {usedFieldTokens.length}</p>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Click any field to insert it at the current cursor position.
                </p>
                <div className="mt-3 space-y-3">
                  {documentTemplateFieldGroups.map((group) => (
                    <div key={`template-auto-group-${group.label}`}>
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.fields.map((field) => {
                          const selected = usedFieldTokens.includes(field.token);
                          return (
                            <button
                              key={`template-auto-field-${field.token}`}
                              className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                                selected
                                  ? "border-[var(--brand-primary)] bg-[#e9f4fb] text-[var(--brand-primary)]"
                                  : "border-[var(--line-soft)] bg-white text-[var(--text-main)]"
                              }`}
                              onClick={() => insertTemplateFieldToken(field.token)}
                              title={field.label}
                              type="button"
                            >
                              {selected ? "✓ " : ""}
                              {field.token}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--line-soft)] bg-[var(--bg-soft)] p-3">
                <h5 className="text-base font-semibold">Preview (John Doe)</h5>
                <div className="mt-2 rounded-xl border border-[var(--line-soft)] bg-white p-3">
                  <div className="mx-auto max-w-[820px]">
                    {documentTemplates.header.active &&
                    documentTemplates.header.showOfficeLogo &&
                    officeSettings.logoDataUrl ? (
                      <img
                        alt="Office logo"
                        className="mb-3 ml-auto max-h-20"
                        src={officeSettings.logoDataUrl}
                      />
                    ) : null}
                    {previewHeader ? (
                      <div
                        className="preview-doc-content mb-4 whitespace-pre-wrap break-words text-sm leading-6"
                        dangerouslySetInnerHTML={{ __html: previewHeader }}
                        style={{ fontFamily: documentTemplates.header.fontFamily }}
                      />
                    ) : null}
                    <div
                      className="preview-doc-content whitespace-pre-wrap break-words text-sm leading-6"
                      dangerouslySetInnerHTML={{ __html: previewBody }}
                      style={{ fontFamily: selectedTemplate.fontFamily }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-muted)]">
                  Specialist and Imaging templates are fixed; only Letter templates can be removed.
                </p>
                <button
                  className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!canRemoveSelectedTemplate}
                  onClick={() => {
                    if (!selectedTemplate || !canRemoveSelectedTemplate) {
                      return;
                    }
                    if (!window.confirm(`Delete template "${selectedTemplate.name}"? This cannot be undone.`)) return;
                    removeTemplate(selectedTemplate.id);
                    setSelectedTemplateId(null);
                  }}
                  type="button"
                >
                  Remove Template
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
