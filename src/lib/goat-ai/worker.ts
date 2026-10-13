/// <reference lib="webworker" />
/**
 * G.O.A.T. + mode — the in-browser model runs here, off the main thread, so
 * the page never freezes while it thinks. Inference uses the computer's own
 * GPU through WebGPU; nothing is sent to any server.
 *
 * Model downloads go through fetch() here (IndexedDB cache backend), wrapped
 * with retries: one failed file is retried 3 times with backoff instead of the
 * whole download failing, and files already saved are skipped on the next try.
 */
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const RETRY_DELAYS_MS = [2000, 6000, 15000];
const nativeFetch = self.fetch.bind(self);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

self.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await nativeFetch(input, init);
      // Retry server hiccups / rate limits; anything else is returned as is.
      if ((res.status >= 500 || res.status === 429) && attempt < RETRY_DELAYS_MS.length) {
        console.warn(`[goat+] ${res.status} from ${hostOf(res.url || url)} for ${url} — retry ${attempt + 1}/${RETRY_DELAYS_MS.length}`);
      } else {
        if (!res.ok) console.error(`[goat+] download failed: HTTP ${res.status} from ${hostOf(res.url || url)} for ${url}`);
        return res;
      }
    } catch (err) {
      if (init?.signal?.aborted || attempt >= RETRY_DELAYS_MS.length) {
        console.error(`[goat+] download blocked: ${hostOf(url)} (${url})`, err);
        throw new Error(`Download blocked at ${hostOf(url)}: ${err instanceof Error ? err.message : String(err)} [${url}]`);
      }
      console.warn(`[goat+] network error from ${hostOf(url)} for ${url} — retry ${attempt + 1}/${RETRY_DELAYS_MS.length}`, err);
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
};

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
