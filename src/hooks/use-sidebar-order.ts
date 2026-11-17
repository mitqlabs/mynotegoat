"use client";

import { useSyncExternalStore } from "react";
import { onLocalChange } from "@/lib/local-sync";
import { SIDEBAR_ORDER_KEY, sidebarOrderFrom } from "@/lib/sidebar-order";

function readOrder(): string[] | null {
  try {
    return sidebarOrderFrom(window.localStorage.getItem(SIDEBAR_ORDER_KEY));
  } catch {
    return null;
  }
}

/** This person's saved sidebar order, or null until they have chosen one. */
export function useSidebarOrder(): string[] | null {
  return useSyncExternalStore(
    (onChange) => onLocalChange(SIDEBAR_ORDER_KEY, onChange),
    readOrder,
    () => null,
  );
}
