/**
 * A new shortcut code must not wipe the one already on the phone.
 * The old hash stays valid until the new hash is used once.
 */

/** Shown on the phone when the shortcut's code is no longer accepted. */
export const DEVICE_SETUP_AGAIN =
  "This Device needs to be set up again: open NoteGoat > Text Reminders > Add to this Device";

export interface DeviceTokenRow {
  token_hash: string;
  pending_token_hash?: string | null;
  retired_token_hash?: string | null;
  revoked_at?: string | null;
}

export type DeviceTokenDecision =
  | { ok: true; promote: boolean }
  | { ok: false; reject: string };

/**
 * Which stored hash this request used.
 * Pending is the new shortcut that has not run yet.
 * Retired is the previous code, after the new one has already run once.
 */
export function decideDeviceToken(hash: string, row: DeviceTokenRow): DeviceTokenDecision {
  if (!hash) return { ok: false, reject: DEVICE_SETUP_AGAIN };
  if (row.revoked_at) return { ok: false, reject: `This device was removed. ${DEVICE_SETUP_AGAIN}` };
  if (row.pending_token_hash && row.pending_token_hash === hash) return { ok: true, promote: true };
  if (row.token_hash === hash) return { ok: true, promote: false };
  if (row.retired_token_hash && row.retired_token_hash === hash) return { ok: false, reject: DEVICE_SETUP_AGAIN };
  return { ok: false, reject: DEVICE_SETUP_AGAIN };
}

/** Fields written when the new code is used successfully once. The old hash is kept only so a later run can be reported as rejected. */
export function promotedTokenFields(row: DeviceTokenRow): {
  token_hash: string;
  pending_token_hash: null;
  retired_token_hash: string;
  last_rejected_at: null;
  last_rejected_reason: null;
} {
  return {
    token_hash: row.pending_token_hash ?? row.token_hash,
    pending_token_hash: null,
    retired_token_hash: row.token_hash,
    last_rejected_at: null,
    last_rejected_reason: null,
  };
}

/** Set up shows this when the last run was turned away and a later run has not succeeded. */
export function lastRunRejectedText(device: {
  last_rejected_at?: string | null;
  last_run_at?: string | null;
  last_rejected_reason?: string | null;
}): string {
  if (!device.last_rejected_at) return "";
  if (device.last_run_at && device.last_run_at > device.last_rejected_at) return "";
  const why = device.last_rejected_reason?.trim() || DEVICE_SETUP_AGAIN;
  return `Last run was rejected. ${why}`;
}
