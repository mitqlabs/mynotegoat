"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SMS_TEMPLATES_STORAGE_KEY,
  loadAllSmsTemplates,
  saveSmsTemplates,
  type SmsTemplate,
} from "@/lib/sms-templates";
import { applyLiveEdit, liveMessages } from "@/lib/message-library";
import { markLocalWrite, notifyChange, onLocalChange } from "@/lib/local-sync";

/**
 * The Messages library. `smsTemplates` is only the messages people can see;
 * deleted ones stay saved as markers (so the delete reaches every computer)
 * but are never handed out.
 */
export function useSmsTemplates() {
  const [all, setAll] = useState<SmsTemplate[]>(() => loadAllSmsTemplates());
  const allRef = useRef(all);
  const selfWriteCountRef = useRef(0);

  useEffect(() => {
    return onLocalChange(SMS_TEMPLATES_STORAGE_KEY, () => {
      if (selfWriteCountRef.current > 0) {
        selfWriteCountRef.current--;
        return;
      }
      const fresh = loadAllSmsTemplates();
      allRef.current = fresh;
      setAll(fresh);
    });
  }, []);

  const updateSmsTemplates = useCallback((updater: (current: SmsTemplate[]) => SmsTemplate[]) => {
    const next = applyLiveEdit(allRef.current, updater(liveMessages(allRef.current)), new Date().toISOString());
    allRef.current = next;
    setAll(next);
    // Keep cloud echoes of our own saves from overwriting newer typing.
    markLocalWrite(SMS_TEMPLATES_STORAGE_KEY);
    saveSmsTemplates(next);
    selfWriteCountRef.current++;
    notifyChange(SMS_TEMPLATES_STORAGE_KEY);
  }, []);

  const smsTemplates = useMemo(() => liveMessages(all), [all]);
  return { smsTemplates, updateSmsTemplates };
}
