"use client";

/**
 * Global React Query provider.
 *
 * This is the foundation of the cloud-first data layer that's
 * replacing the localStorage-as-primary-store architecture. Every
 * entity hook built on top of this fetches FROM cloud, caches the
 * response in-memory, and writes BACK to cloud directly — no
 * localStorage snapshot to go stale, no "bootstrap" that pulls the
 * whole database down and overwrites local caches, no cross-device
 * sync race that loses chart notes.
 *
 * Caching defaults:
 *   - staleTime: 30 seconds. The UI feels instant on navigation
 *     because cached data displays immediately, but it refetches in
 *     the background to stay fresh. Adjustable per query if a given
 *     entity needs different freshness.
 *   - refetchOnWindowFocus: true. When you come back to the tab
 *     (alt-tab, lock screen, etc.), every visible query revalidates.
 *     This is what makes "I edited this on the laptop, switch to the
 *     tablet, see the update" feel automatic without explicit polling.
 *   - retry: 2. Network blips don't blow up a query — three attempts
 *     before surfacing the error.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function AppQueryClientProvider({ children }: { children: React.ReactNode }) {
  // Lazy instantiate so Next.js SSR/RSC doesn't share a client across
  // requests. Per the official React Query Next.js guide.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: 2,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
