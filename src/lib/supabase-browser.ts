"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabase: SupabaseClient | null = null;

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    return null;
  }
  return { url, anonKey };
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseConfig());
}

export function getSupabaseBrowserClient() {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }

  if (!supabase) {
    supabase = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: { fetch: fetchWithTimeout },
    });
  }

  return supabase;
}

/**
 * Every request gets a deadline. supabase-js holds its auth lock while a
 * token refresh / getUser() call is on the wire, and every database call
 * queues behind that lock. A request that silently stalls (phone waking up,
 * dead Wi-Fi connection) used to freeze "Checking account access…" until
 * the browser gave up — often a minute or more. Auth calls get 10s, data
 * calls 30s; file uploads/downloads (storage) are left alone.
 */
const AUTH_TIMEOUT_MS = 10_000;
const REST_TIMEOUT_MS = 30_000;
export function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const ms = url.includes("/auth/v1/") ? AUTH_TIMEOUT_MS : url.includes("/rest/v1/") ? REST_TIMEOUT_MS : 0;
  if (!ms || typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return fetch(input, init);
  }
  const timeoutSignal = AbortSignal.timeout(ms);
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, timeoutSignal])
      : init?.signal ?? timeoutSignal;
  return fetch(input, { ...init, signal });
}

/**
 * The signed-in user from the locally restored session — no network call.
 * Use this instead of auth.getUser() when you only need the user's id:
 * getUser() makes a round trip while HOLDING the auth lock, so every other
 * database request waits behind it (the live site was making ~7,300
 * /auth/v1/user calls a day). The database still enforces access with RLS.
 */
export async function getSessionUser(client: SupabaseClient | null = getSupabaseBrowserClient()) {
  if (!client) return { data: { user: null }, error: null };
  const { data, error } = await client.auth.getSession();
  return { data: { user: data.session?.user ?? null }, error };
}
