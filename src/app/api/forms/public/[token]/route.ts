import { NextRequest, NextResponse } from "next/server";
import { FORM_LIMITS, sanitizeAnswers, validateSnapshot } from "@/lib/patient-forms";
import { adminClient, FORM_TABLE, hashFormToken, ipBucket, isTokenShape, NO_STORE, rateOk, serverConfig } from "@/lib/patient-forms-server";

export const runtime = "nodejs";

/**
 * The patient's questionnaire page talks only to this route. No login: the
 * unguessable token in the path IS the key, and it opens exactly one row.
 * Every failure (bad, expired, revoked, unknown) gets the same answer so the
 * route can't be used to probe for links.
 */
type Ctx = { params: Promise<{ token: string }> };

const INACTIVE = { status: "inactive", message: "This link is no longer active. Please contact the office for a new one." };

function load(): { admin: ReturnType<typeof adminClient>; error?: undefined } | { error: NextResponse; admin?: undefined } {
  const cfg = serverConfig();
  if (!cfg) return { error: NextResponse.json({ error: "Unavailable." }, { status: 503, headers: NO_STORE }) };
  return { admin: adminClient(cfg) };
}

async function findRow(admin: ReturnType<typeof adminClient>, token: string) {
  const { data } = await admin
    .from(FORM_TABLE)
    .select("id, status, snapshot, answers, step, expires_at, revoked_at, office_name, form_name, save_count")
    .eq("token_hash", hashFormToken(token))
    .maybeSingle();
  return data;
}

const active = (row: { status: string; expires_at: string; revoked_at: string | null }) =>
  !row.revoked_at && row.status !== "revoked" && row.status !== "submitted" && Date.parse(row.expires_at) > Date.now();

export async function GET(request: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!isTokenShape(token)) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  const env = load();
  if (env.error) return env.error;
  const { admin } = env;
  // Rate check and lookup run in parallel; the rate verdict is still enforced
  // before anything about the row is returned.
  const [ok, row] = await Promise.all([rateOk(admin, `ip:${ipBucket(request)}`, 300, 600), findRow(admin, token)]);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes." }, { status: 429, headers: NO_STORE });
  }
  if (!row) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  if (row.status === "submitted") {
    return NextResponse.json({ status: "submitted", officeName: row.office_name }, { headers: NO_STORE });
  }
  if (!active(row)) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    {
      status: row.status,
      officeName: row.office_name,
      formName: row.form_name,
      snapshot: row.snapshot,
      answers: row.answers ?? {},
      step: row.step ?? 0,
      expiresAt: row.expires_at,
    },
    { headers: NO_STORE },
  );
}

/** Save-as-you-go (and the final submit). Body: { answers, step, submit? } */
export async function PUT(request: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!isTokenShape(token)) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  const env = load();
  if (env.error) return env.error;
  const { admin } = env;
  const raw = await request.text();
  if (raw.length > FORM_LIMITS.answersBytes) return NextResponse.json({ error: "Too long." }, { status: 413, headers: NO_STORE });
  if (!(await rateOk(admin, `ip:${ipBucket(request)}`, 300, 600)) || !(await rateOk(admin, `tok:${hashFormToken(token).slice(0, 24)}`, 240, 600))) {
    return NextResponse.json({ error: "Too many saves. Please wait a minute." }, { status: 429, headers: NO_STORE });
  }
  const row = await findRow(admin, token);
  if (!row || !active(row)) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  const snapshot = validateSnapshot(row.snapshot);
  if (!snapshot) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  }
  const answers = sanitizeAnswers(snapshot, body.answers);
  const stepRaw = Number(body.step);
  const step = Number.isFinite(stepRaw) ? Math.max(0, Math.min(snapshot.sections.length + 1, Math.round(stepRaw))) : 0;
  const now = new Date().toISOString();
  const submit = body.submit === true;
  const patch: Record<string, unknown> = {
    answers,
    step,
    last_saved_at: now,
    updated_at: now,
    save_count: (Number(row.save_count) || 0) + 1,
    status: submit ? "submitted" : "started",
  };
  if (submit) {
    patch.submitted_at = now;
    patch.review_status = "new";
    patch.raw_submission = { answers, snapshot, submittedAt: now };
  }
  // Only this token's row, and only while it's still open (no write after submit / revoke).
  const { data, error } = await admin
    .from(FORM_TABLE)
    .update(patch)
    .eq("id", row.id)
    .in("status", ["sent", "started"])
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500, headers: NO_STORE });
  if (!data?.length) return NextResponse.json(INACTIVE, { status: 404, headers: NO_STORE });
  return NextResponse.json({ ok: true, savedAt: now, status: patch.status }, { headers: NO_STORE });
}
