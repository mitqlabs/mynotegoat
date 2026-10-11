/// <reference lib="webworker" />
/**
 * G.O.A.T. Smart mode (beta) — the in-browser model runs here, off the main
 * thread, so the page never freezes while it thinks. Inference uses the
 * computer's own GPU through WebGPU; nothing is sent to any server.
 */
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
