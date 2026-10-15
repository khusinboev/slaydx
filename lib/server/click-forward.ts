import "server-only";
import { env } from "./env";
import { log } from "./log";

/**
 * Bandlik.uz (vakant3) shares SlaydX's Click service, so Click sends ALL Prepare / Complete callbacks to SlaydX's URL
 * (`app/api/payments/click/route.ts`). vakant3 creates its Click orders with `merchant_trans_id` = `vk-<id>`; SlaydX order ids are
 * UUIDs (`payments.ts createOrder` -> `randomUUID()`, column `payment_orders.id uuid`), so the prefix can never collide.
 *
 * A `vk-` callback is POSTed to vakant3 UNCHANGED (same bytes, same Content-Type) and its JSON reply goes back to Click as is.
 * vakant3 verifies the signature and owns the order, the amount and the credit: SlaydX looks nothing up, settles nothing,
 * decides nothing about the signature and writes nothing to its payment tables. Any failure is a Click `-7` so Click does not
 * complete a payment nobody confirmed.
 *
 * Contract with the vakant3 side: POST <VAKANT_CLICK_FORWARD_URL>, body + Content-Type exactly as received, header
 * `X-Forwarded-By: slaydx`; answer HTTP 200 + Click JSON ({click_trans_id, merchant_trans_id, merchant_prepare_id |
 * merchant_confirm_id, error, error_note}).
 */

export const VAKANT_PREFIX = "vk-";
/** Below Click's own callback timeout. */
export const FORWARD_TIMEOUT_MS = 8_000;
/** Click bodies are a few hundred bytes; anything bigger is not a callback. */
export const MAX_BODY_BYTES = 64 * 1024;

/** `merchant_trans_id` of a raw Click body (urlencoded or JSON — the two formats the route accepts), or `null`. */
export function merchantTransIdOf(raw: string, contentType: string): string | null {
  return fieldOf(raw, contentType, "merchant_trans_id");
}

function fieldOf(raw: string, contentType: string, name: string): string | null {
  try {
    if (contentType.includes("application/json")) {
      const v = (JSON.parse(raw) as Record<string, unknown> | null)?.[name];
      return v === undefined || v === null || typeof v === "object" ? null : String(v);
    }
    const v = new URLSearchParams(raw).get(name);
    return v === null ? null : v;
  } catch {
    return null;
  }
}

export const isVakantOrder = (merchantTransId: string | null): boolean => merchantTransId !== null && merchantTransId.startsWith(VAKANT_PREFIX);

export type ForwardResult =
  | { ok: true; text: string }
  | { ok: false; reason: "no_url" | "timeout" | "network" | "status" | "not_json"; status?: number };

/** POSTs the raw callback to vakant3. Never throws. `raw` and `contentType` are passed through untouched. */
export async function forwardToVakant(raw: string, contentType: string, meta: { action: string | null; merchantTransId: string }): Promise<ForwardResult> {
  const url = env.click.vakantForwardUrl;
  const started = Date.now();
  const done = (result: ForwardResult, upstreamStatus: number | null): ForwardResult => {
    // No sign_string / secret / body in the log line.
    log(result.ok ? "info" : "warn", "[click] forwarded to vakant", {
      action: meta.action,
      merchantTransId: meta.merchantTransId,
      upstreamStatus,
      ms: Date.now() - started,
      ...(result.ok ? {} : { reason: result.reason }),
    });
    return result;
  };
  if (!url) return done({ ok: false, reason: "no_url" }, null);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType, "x-forwarded-by": "slaydx" },
      body: raw,
      redirect: "manual",
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return done({ ok: false, reason: timedOut ? "timeout" : "network" }, null);
  }
  if (res.status !== 200) return done({ ok: false, reason: "status", status: res.status }, res.status);
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  } catch {
    return done({ ok: false, reason: "not_json" }, res.status);
  }
  return done({ ok: true, text }, res.status);
}

/** The action field of the raw body, for the log line only. */
export const actionOf = (raw: string, contentType: string): string | null => fieldOf(raw, contentType, "action");
export const clickTransIdOf = (raw: string, contentType: string): string | null => fieldOf(raw, contentType, "click_trans_id");
