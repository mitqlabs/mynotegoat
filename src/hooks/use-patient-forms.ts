"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PATIENT_FORMS_STORAGE_KEY, type FormTemplate } from "@/lib/patient-forms";
import { loadPatientForms, savePatientForms } from "@/lib/patient-forms-store";
import { markLocalWrite, notifyChange, onLocalChange } from "@/lib/local-sync";

/** Settings → Forms templates (cloud-backed, merge-safe). */
export function usePatientForms() {
  const [forms, setForms] = useState<FormTemplate[]>(() => loadPatientForms());
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(PATIENT_FORMS_STORAGE_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setForms(loadPatientForms());
    });
  }, []);

  const updateForms = useCallback((updater: (current: FormTemplate[]) => FormTemplate[]) => {
    setForms((current) => {
      const next = updater(current);
      markLocalWrite(PATIENT_FORMS_STORAGE_KEY);
      savePatientForms(next);
      selfWriteCountRef.current++;
      notifyChange(PATIENT_FORMS_STORAGE_KEY);
      return next;
    });
  }, []);

  return { forms, updateForms };
}
