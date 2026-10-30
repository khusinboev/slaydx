import "server-only";
import { env } from "./env";
import { log } from "./log";

/**
 * Bandlik.uz (vakant3) shares SlaydX's Click service, so Click sends ALL Prepare / Complete callbacks to SlaydX's URL
 * (`app/api/payments/click/route.ts`). vakant3 creates its Click orders with `merchant_trans_id` = `vk-<id>`; SlaydX order ids are
 * UUIDs (`payments.ts createOrder` -> `randomUUID()`, column `payment_orders.id uuid`), so the prefix can never collide.
 *
 * A `vk-` callback is POSTed to vakant3 UNCHANGED (same text, same Content-Type) and its JSON reply goes back to Click as is.
 * vakant3 verifies the signature and owns the order, the amount and the credit: SlaydX looks nothing up, settles nothing,
 * decides nothing about the signature and writes nothing to its payment tables. Any failure is a Click `-7` so Click does not
 * complete a payment nobody confirmed. The route decides "is it vk-?" from the SAME parsed params its own handler would use, so
 * the two can never disagree about which order a body names.
 *
 * Contract with the vakant3 side: POST <VAKANT_CLICK_FORWARD_URL>, body + Content-Type exactly as received, header
 * `X-Forwarded-By: slaydx`; answer HTTP 200 + Click JSON ({click_trans_id, merchant_trans_id, merchant_prepare_id |
 * merchant_confirm_id, error, error_note}). vakant3 must be idempotent (a reply slower than our timeout makes Click see -7).
 */

export const VAKANT_PREFIX = "vk-";
/** Below Click's own callback timeout (to be confirmed with Click; see docs/payments/CLICK-FORWARD.md). */
export const FORWARD_TIMEOUT_MS = 8_000;
/** Click bodies are a few hundred bytes; anything bigger is not a callback. */
export const MAX_BODY_BYTES = 64 * 1024;
/** vakant3's reply is a small JSON object. */
export const MAX_REPLY_BYTES = 16 * 1024;
/** Forwards in flight at once; beyond it the callback gets -7 instead of piling connections up. */
export const MAX_IN_FLIGHT = 20;

export const isVakantOrder = (merchantTransId: unknown): boolean => typeof merchantTransId === "string" && merchantTransId.startsWith(VAKANT_PREFIX);

/** Reads a body stream as UTF-8 text, giving up (`null`) as soon as it exceeds `maxBytes` — enforced while reading, not by a header. */
export async function readTextCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type ForwardResult =
  | { ok: true; text: string }
  | { ok: false; reason: "no_url" | "busy" | "timeout" | "network" | "status" | "not_json" | "too_large"; status?: number };

/** POSTs the raw callback to vakant3. Never throws. `raw` and `contentType` are passed through untouched. */
export async function forwardToVakant(raw: string, contentType: string, meta: { action: string | null; merchantTransId: string }): Promise<ForwardResult> {
  // No sign_string / secret / body in the log line; the id is attacker-controlled, so it is clipped.
  return forwardRaw({
    channel: "click",
    url: env.click.vakantForwardUrl,
    raw,
    headers: { "content-type": contentType },
    logFields: { action: meta.action, merchantTransId: meta.merchantTransId.slice(0, 64) },
  });
}

/**
 * Forwards per channel in flight; each channel has its own MAX_IN_FLIGHT budget, so a burst on one provider's
 * endpoint cannot starve the other's.
 */
const inFlightBy = new Map<string, number>();

/**
 * The hardened forward shared by every provider endpoint Bandlik.uz shares with SlaydX (Click, Paynet). Never throws.
 * `raw` and `headers` are sent untouched, plus `X-Forwarded-By: slaydx`; 8 s timeout, redirects not followed, at most
 * MAX_IN_FLIGHT per channel, reply read up to MAX_REPLY_BYTES and accepted only as HTTP 200 + a JSON object (returned as
 * the exact text). One log line `[<channel>] forwarded to vakant` with `logFields`, the upstream status and ms: callers pass
 * only safe, clipped fields (never a signature, password or Authorization).
 */
export async function forwardRaw(r: {
  channel: string;
  url: string;
  raw: string;
  headers: Record<string, string>;
  logFields: Record<string, unknown>;
  /** Reply cap in bytes (default `MAX_REPLY_BYTES`); a reconciliation list needs more than a one-payment reply. */
  maxReplyBytes?: number;
}): Promise<ForwardResult> {
  const started = Date.now();
  const done = (result: ForwardResult, upstreamStatus: number | null): ForwardResult => {
    log(result.ok ? "info" : "warn", `[${r.channel}] forwarded to vakant`, {
      ...r.logFields,
      upstreamStatus,
      ms: Date.now() - started,
      ...(result.ok ? {} : { reason: result.reason }),
    });
    return result;
  };
  if (!r.url) return done({ ok: false, reason: "no_url" }, null);
  const inFlight = inFlightBy.get(r.channel) ?? 0;
  if (inFlight >= MAX_IN_FLIGHT) return done({ ok: false, reason: "busy" }, null);

  inFlightBy.set(r.channel, inFlight + 1);
  try {
    let res: Response;
    try {
      res = await fetch(r.url, {
        method: "POST",
        headers: { ...r.headers, "x-forwarded-by": "slaydx" },
        body: r.raw,
        redirect: "manual",
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return done({ ok: false, reason: timedOut ? "timeout" : "network" }, null);
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return done({ ok: false, reason: "status", status: res.status }, res.status);
    }
    const text = await readTextCapped(res.body, r.maxReplyBytes ?? MAX_REPLY_BYTES);
    if (text === null) return done({ ok: false, reason: "too_large" }, res.status);
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    } catch {
      return done({ ok: false, reason: "not_json" }, res.status);
    }
    return done({ ok: true, text }, res.status);
  } finally {
    inFlightBy.set(r.channel, (inFlightBy.get(r.channel) ?? 1) - 1);
  }
}
