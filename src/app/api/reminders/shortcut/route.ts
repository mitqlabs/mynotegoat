import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { shortcutWithToken } from "@/lib/shortcut-file";
import { isDeviceToken, openDeviceToken, sealDeviceToken } from "@/lib/shortcut-ticket";

export const dynamic = "force-dynamic";

function serverKeys(): { url: string; anon: string; service: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return url && anon && service ? { url, anon, service } : null;
}

/** The signed-in office downloads a shortcut that already has its code. */
export async function POST(request: NextRequest) {
  const keys = serverKeys();
  if (!keys) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const access = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!access) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const authClient = createClient(keys.url, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(access);
  if (error || !data.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!isDeviceToken(token)) return NextResponse.json({ error: "Bad device code." }, { status: 400 });
  const ticket = sealDeviceToken(token, keys.service);
  const fileUrl = `${request.nextUrl.origin}/api/reminders/shortcut?t=${encodeURIComponent(ticket)}`;
  const importUrl = `shortcuts://import-shortcut?url=${encodeURIComponent(fileUrl)}&name=NoteGoat`;
  return NextResponse.json({ importUrl, fileUrl });
}

/** The Shortcuts app fetches this. The link lasts 24 hours. */
export async function GET(request: NextRequest) {
  const keys = serverKeys();
  if (!keys) return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  const ticket = request.nextUrl.searchParams.get("t") ?? "";
  const token = openDeviceToken(ticket, keys.service);
  if (!token) return NextResponse.json({ error: "This link has expired. Use Add to this Device again." }, { status: 404 });
  try {
    const file = shortcutWithToken(token);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Disposition": "inline; filename=\"NoteGoat.shortcut\"",
      },
    });
  } catch {
    return NextResponse.json({ error: "Shortcut file is missing." }, { status: 500 });
  }
}
