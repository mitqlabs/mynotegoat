"use client";

/**
 * Local screenshot page for Narrative Inputs. Not linked from the app.
 * Demo template text only. Does not read or write an office's saved reports.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NarrativeInputsModal } from "@/components/narrative-inputs-modal";
import { ReportTemplateSettingsPanel } from "@/components/report-template-settings-panel";
import { BRAND_STORAGE_KEY, TONE_STORAGE_KEY } from "@/lib/brand";
import { mergeNarrativeInputDefaults } from "@/lib/narrative-inputs";
import type { NarrativeReportLibrary } from "@/lib/report-templates";

const STORAGE_KEY = "casemate.report-templates.v1";

const SAVED_AMOUNTS = [
  "$2,000.00 to $2,5000.00",
  "$3,000.00 to $3,5000.00",
  "$4,250.00 to $5,5000.00",
  "$4,000.00 to $5,0000.00 ($2,000.00 to $2,500.00 per region)",
  "$6,000.00 to $7,0000.00 ($3,000.00 to $3,500.00 per region)",
  "$8,500.00 to $11,0000.00 ($4,250.00 to $5,500.00 per region)",
];

const FIXTURE: NarrativeReportLibrary = {
  templates: [
    {
      id: "preview-pi-discharge",
      name: "Personal Injury Discharge",
      fontFamily: "Georgia, 'Times New Roman', serif",
      active: true,
      body: "<div><b><u>Future Non-Surgical Spinal Decompression</u></b></div><div>{{MR_MRS_MS_LAST_NAME}} would benefit from future non-surgical spinal decompression treatments. A consideration should be made for {{PROMPT_HOW_MANY_TREATMENTS}} treatments of the {{PROMPT_WHICH_REGION_OF_THE_SPINE}} region. This treatment plan of non-surgical spinal decompression therapy will require an additional {{PROMPT_FUTURE_CARE_AMOUNT}}. This amount is inclusive of two examinations.</div>",
      prompts: [
        { id: "t", label: "How many treatments?", token: "PROMPT_HOW_MANY_TREATMENTS", options: ["six to eight", "ten to twelve", "fifteen to twenty"], required: false },
        { id: "r", label: "Which region of the spine?", token: "PROMPT_WHICH_REGION_OF_THE_SPINE", options: ["cervical", "lumbar", "cervical and lumbar"], required: false },
        { id: "f", label: "Future Care Amount", token: "PROMPT_FUTURE_CARE_AMOUNT", options: SAVED_AMOUNTS, required: false },
      ],
    },
  ],
};

function paintTheme() {
  window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({ theme: "blue" }));
  window.localStorage.setItem(TONE_STORAGE_KEY, "dark");
  const root = document.documentElement;
  root.setAttribute("data-brand", "blue");
  root.setAttribute("data-tone", "dark");
  root.setAttribute("data-theme-lock", "1");
}

function Preview() {
  const params = useSearchParams();
  const view = params.get("view") ?? "yes";
  const [ready, setReady] = useState(false);
  const merged = mergeNarrativeInputDefaults(FIXTURE).templates[0];
  const [values, setValues] = useState<Record<string, string>>(() =>
    view === "no"
      ? { PROMPT_HOW_MANY_TREATMENTS: "ten to twelve", PROMPT_WHICH_REGION_OF_THE_SPINE: "lumbar", PROMPT_RECOMMEND_DECOMPRESSION: "No" }
      : { PROMPT_HOW_MANY_TREATMENTS: "ten to twelve", PROMPT_WHICH_REGION_OF_THE_SPINE: "cervical and lumbar", PROMPT_RECOMMEND_DECOMPRESSION: "Yes" },
  );

  if (typeof window !== "undefined" && !ready) {
    paintTheme();
    if (view === "settings") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(FIXTURE));
    setReady(true);
  }

  useEffect(() => {
    if (view !== "settings") return;
    document.getElementById("narrative-question-prompts")?.scrollIntoView({ block: "start" });
  }, [view, ready]);

  if (!ready) return null;

  return (
    <>
      <style>{`nextjs-portal { display: none !important; }`}</style>
      {view === "settings" ? (
        <div className="min-h-screen bg-[var(--bg-canvas)] px-4 py-6 text-[var(--text-main)]">
          <div className="mx-auto w-full max-w-5xl">
            <ReportTemplateSettingsPanel />
          </div>
        </div>
      ) : (
        <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)]">
          <NarrativeInputsModal
            error=""
            onChange={setValues}
            onClose={() => undefined}
            onContinue={() => undefined}
            prompts={merged.prompts}
            templateName={merged.name}
            values={values}
          />
        </div>
      )}
    </>
  );
}

export default function NarrativeInputsPreviewPage() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
