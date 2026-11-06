import "server-only";
import { query } from "./db";
import { normalizeMessage } from "./error-sink";
import { log, redact } from "./log";
import { getProviderKey } from "./providers/resolve";
import { isProviderId } from "./providers/registry";
import { missingPermissionOf } from "../generation/tts/elevenlabs";
import { stripUrls } from "../generation/video/types";

/**
 * «Which provider broke this job, and how» for the owner alert (`server-alerts.ts provider_fail`) and the admin card.
 *
 * The user-facing error of a job says nothing about the provider, so `generations.error` cannot be counted. The real error
 * rides along as `cause` (LLM: `errorWithCause` → `cause.llmFailure`; media and speech: `UserFacingError(text, { cause })`);
 * this module walks to it and stores one short, scrubbed row per failed job. Recording never fails a job.
 */

export type ProviderFailure = { provider: string; status?: number; message: string };

export const FAILURE_RETENTION_DAYS = 30;
const MESSAGE_MAX = 120;
const CAUSE_DEPTH = 6;

type Shape = {
  cause?: unknown;
  llmFailure?: { provider: string; status?: number; message: string; kind: string };
  provider?: unknown;
  status?: unknown;
  safety?: unknown;
  message?: unknown;
};

/**
 * The provider failure behind `e`, `null` when there is none. A content refusal is the user's text, not a provider fault.
 * Never throws (a hostile getter on a library error): the worker calls it before the refund.
 */
export function providerFailureOf(e: unknown): ProviderFailure | null {
  try {
    let cur = e as Shape | null | undefined;
    for (let depth = 0; cur && typeof cur === "object" && depth < CAUSE_DEPTH; depth++) {
      const llm = cur.llmFailure;
      if (llm) return llm.kind === "safety" ? null : { provider: llm.provider, ...(llm.status !== undefined ? { status: llm.status } : {}), message: llm.message };
      if (typeof cur.provider === "string" && cur.provider) {
        if (cur.safety === true) return null;
        return { provider: cur.provider, ...(typeof cur.status === "number" ? { status: cur.status } : {}), message: String(cur.message ?? "") };
      }
      cur = cur.cause as Shape | null | undefined;
    }
  } catch {
    // Unknown: the job still fails and refunds normally.
  }
  return null;
}

/** `text` without any URL, the provider's key (the whole key and, for `<id>:<secret>`, each half) or the usual key shapes. */
export function scrubFailureText(text: string, key: string): string {
  let out = stripUrls(text);
  for (const secret of [key, ...key.split(":").filter((p) => p.length >= 8)]) if (secret) out = out.split(secret).join("…");
  return redact(out).replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX);
}

/** Groups repeats of one error: the same text with other numbers and ids, or the same refused permission. */
export function failureSignature(f: ProviderFailure, scrubbed: string): string {
  const permission = missingPermissionOf(f.message);
  return permission ? `missing_permission:${permission}` : `${f.status ?? "-"}|${normalizeMessage(scrubbed)}`;
}

/** Stores one failed job's provider error. Never throws: this runs on the failure path of a paid job. */
export async function recordProviderFailure(jobId: string, f: ProviderFailure | null): Promise<void> {
  if (!f) return;
  try {
    const key = isProviderId(f.provider) ? getProviderKey(f.provider) : "";
    const message = scrubFailureText(f.message, key);
    const signature = failureSignature(f, message);
    if (signature.startsWith("missing_permission:")) {
      log("error", "[providers] API kalitida ruxsat yetishmaydi — kalit sozlamasini o'zgartiring", { provider: f.provider, permission: signature.slice("missing_permission:".length), jobId });
    }
    await query("INSERT INTO provider_failures (provider, signature, message, job_id) VALUES ($1, $2, $3, $4)", [f.provider, signature, message, jobId]);
  } catch (e) {
    log("warn", "[providers] provayder xatosi yozilmadi", { jobId, provider: f.provider, err: e });
  }
}

/** Permissions each provider's key was refused in 30 days, since its settings last changed in the admin page: `provider → names`. */
export async function refusedPermissions(): Promise<Map<string, string[]>> {
  const rows = await query<{ provider: string; signature: string }>(
    `SELECT DISTINCT f.provider, f.signature
       FROM provider_failures f
       LEFT JOIN provider_settings p ON p.provider = f.provider
      WHERE f.signature LIKE 'missing_permission:%'
        AND f.at > now() - interval '30 days'
        AND f.at > COALESCE(p.updated_at, '-infinity'::timestamptz)
      ORDER BY f.provider, f.signature`,
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.provider, [...(out.get(r.provider) ?? []), r.signature.slice("missing_permission:".length)]);
  return out;
}

export async function purgeProviderFailures(days: number = FAILURE_RETENTION_DAYS): Promise<number> {
  const rows = await query("DELETE FROM provider_failures WHERE at < now() - make_interval(days => $1) RETURNING id", [days]);
  return rows.length;
}
