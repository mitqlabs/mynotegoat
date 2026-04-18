"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SMS_TEMPLATES_STORAGE_KEY,
  loadSmsTemplates,
  saveSmsTemplates,
  type SmsTemplate,
} from "@/lib/sms-templates";
import { notifyChange, onLocalChange } from "@/lib/local-sync";

export function useSmsTemplates() {
  const [smsTemplates, setSmsTemplates] = useState<SmsTemplate[]>(() => loadSmsTemplates());
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(SMS_TEMPLATES_STORAGE_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      setSmsTemplates(loadSmsTemplates());
    });
  }, []);

  const updateSmsTemplates = useCallback(
    (updater: (current: SmsTemplate[]) => SmsTemplate[]) => {
      setSmsTemplates((current) => {
        const next = updater(current);
        saveSmsTemplates(next);
        selfWriteCountRef.current++;
        notifyChange(SMS_TEMPLATES_STORAGE_KEY);
        return next;
      });
    },
    [],
  );

  return { smsTemplates, updateSmsTemplates };
}
