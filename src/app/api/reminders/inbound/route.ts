import { NextRequest, NextResponse } from "next/server";
import { adminClient, applyInboundReplies, authenticateDevice, type InboundReply } from "@/lib/reminder-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/reminders/inbound — a sending device forwards patients' replies.
 * Body: { from, text } or { messages: [{ from, text }] }  (max 200).
 * Only whole-message keywords count: STOP / STOPALL / UNSUBSCRIBE /
 * END / QUIT turn the patient's text reminders off; START / UNSTOP turn them
 * back on. Anything else is ignored and never stored. Never sends a reply.
 */
export async function POST(request: NextRequest) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const device = await authenticateDevice(admin, request.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Invalid or revoked device token." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { from?: unknown; text?: unknown; messages?: unknown };
  const raw: unknown[] = Array.isArray(body.messages) ? body.messages.slice(0, 200) : [body];
  const replies: InboundReply[] = raw.flatMap((m) => {
    const r = (m ?? {}) as { from?: unknown; text?: unknown };
    return typeof r.from === "string" && typeof r.text === "string" ? [{ from: r.from.slice(0, 80), text: r.text.slice(0, 160) }] : [];
  });
  if (!replies.length) return NextResponse.json({ error: "Expected { from, text }." }, { status: 400 });
  try {
    const result = await applyInboundReplies(admin, device, replies, device.kind === "iphone" ? "iphone" : "mac");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
