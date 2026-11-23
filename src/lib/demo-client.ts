"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getActiveWorkspaceIdSync } from "@/lib/workspace-storage";
import { clearLocalWorkspaceData } from "@/lib/cloud-state";
import { clearBigCache } from "@/lib/big-cache";
import { DEMO_GENERATION_KEY, DEMO_NOT_SENT, isDemoWorkspaceId } from "@/lib/demo-office";
import { demoOutboundDecision, isBlockedDemoRequest, type OutboundAction } from "@/lib/demo-outbound";

const TOAST_EVENT = "demo-office-toast";

export function showDemoToast(message = DEMO_NOT_SENT) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function onDemoToast(listener: (message: string) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    listener(typeof detail === "string" && detail ? detail : DEMO_NOT_SENT);
  };
  window.addEventListener(TOAST_EVENT, handler);
  return () => window.removeEventListener(TOAST_EVENT, handler);
}

export function demoOfficeActive(): boolean {
  return isDemoWorkspaceId(getActiveWorkspaceIdSync());
}

/** After a nightly reseed, drop this browser's copy so the fresh office wins. */
export async function adoptDemoGeneration(workspaceId: string) {
  if (!isDemoWorkspaceId(workspaceId) || typeof window === "undefined") return;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  const { data, error } = await supabase
    .from("workspace_kv")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("key", DEMO_GENERATION_KEY)
    .maybeSingle();
  if (error || data?.value == null) return;
  const remote = typeof data.value === "string" ? data.value : "";
  if (!remote) return;
  const local = window.localStorage.getItem(DEMO_GENERATION_KEY) ?? "";
  if (local === remote) return;
  clearLocalWorkspaceData();
  await clearBigCache();
  window.localStorage.removeItem(`notegoat.boot-delta.v1.${workspaceId}`);
  window.localStorage.setItem(DEMO_GENERATION_KEY, remote);
}

/** True when the send was blocked. Callers should stop. */
export function blockDemoSend(action: OutboundAction): boolean {
  const decision = demoOutboundDecision(getActiveWorkspaceIdSync(), action);
  if (!decision.blocked) return false;
  showDemoToast(decision.message);
  return true;
}

let guardInstalled = false;
const originalFetch = typeof window !== "undefined" ? window.fetch.bind(window) : null;

function onOutboundClick(event: MouseEvent) {
  if (!demoOfficeActive()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest("a");
  const href = link?.getAttribute("href") ?? "";
  if (href.startsWith("sms:") || href.startsWith("mailto:") || href.includes("/api/goat-mail")) {
    event.preventDefault();
    event.stopPropagation();
    showDemoToast();
  }
}

/** Blocks texts, email, mailbox connect, outside AI, and device registration. In-office saves stay open. */
export function installDemoOutboundGuard() {
  if (guardInstalled || typeof window === "undefined" || !originalFetch) return;
  guardInstalled = true;
  document.addEventListener("click", onOutboundClick, true);
  const share = navigator.share?.bind(navigator);
  if (share) {
    navigator.share = async () => {
      if (demoOfficeActive()) {
        showDemoToast();
        return;
      }
      return share();
    };
  }
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (demoOfficeActive() && isBlockedDemoRequest(url, method)) {
      showDemoToast();
      return new Response(JSON.stringify({ error: DEMO_NOT_SENT, message: DEMO_NOT_SENT, demo: true, send: "no" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
}

export async function startDemoSession(): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("/api/demo/login", { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { error?: string; access_token?: string; refresh_token?: string };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    return { ok: false, error: body.error || "Demo login is not ready." };
  }
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured." };
  const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
