"use client";

import { useSyncExternalStore } from "react";
import { onLocalChange } from "@/lib/local-sync";
import { SIDEBAR_ORDER_KEY, sidebarOrderFrom } from "@/lib/sidebar-order";

// useSyncExternalStore needs the same snapshot object back while the stored
// value is unchanged. A fresh array on every read makes React re-render
// forever and crash the page, so cache the parsed order by its raw text.
let cachedRaw: string | null | undefined;
let cachedOrder: string[] | null = null;

function readOrder(): string[] | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_ORDER_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedOrder;
  cachedRaw = raw;
  try {
    cachedOrder = sidebarOrderFrom(raw);
  } catch {
    cachedOrder = null;
  }
  return cachedOrder;
}

/** This person's saved sidebar order, or null until they have chosen one. */
export function useSidebarOrder(): string[] | null {
  return useSyncExternalStore(
    (onChange) => onLocalChange(SIDEBAR_ORDER_KEY, onChange),
    readOrder,
    () => null,
  );
}
