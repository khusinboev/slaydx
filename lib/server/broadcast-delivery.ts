import "server-only";
import { query, transaction } from "./db";
import { log } from "./log";
import { botConfigured, sendMessage } from "./telegram";

/**
 * Telegram broadcast delivery (docs/admin/02-plan.md §6.9). The admin API
 * snapshots recipients and sets a broadcast `queued`; the worker housekeeping
 * leader calls `deliverBroadcasts()` every tick.
 *
 * Per tick: at most `maxPerTick` (600) messages, at most `perSecond` (25) per
 * second — below Telegram's ~30 msg/s bot limit. Each recipient is claimed,
 * sent and marked in its own short transaction (`FOR UPDATE SKIP LOCKED`), so
 *   • two concurrent leaders never send to the same recipient;
 *   • a crash or deploy can repeat at most the one message in flight;
 *   • a cancel is honoured before the very next message (status re-read).
 * A permanent Telegram refusal (403 bot blocked, 400 chat not found:
 * `sendMessage` returns false) marks the recipient `failed`; a transient error
 * (network, 5xx, 429) leaves it `pending` and ends the tick — it is retried on
 * the next tick. When no pending recipient remains the broadcast becomes `done`.
 *
 * The stored text is plain text; it is HTML-escaped here because
 * `sendMessage` uses `parse_mode: "HTML"`.
 */

export type DeliveryDeps = {
  /** Default: `sendMessage` (lib/server/telegram.ts). */
  send?: (chatId: string, html: string) => Promise<boolean>;
  /** Default: `botConfigured()`. */
  configured?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  perSecond?: number;
  maxPerTick?: number;
};

export type DeliveryResult = {
  /** Messages handled this tick (sent + failed), for housekeeping status. */
  rows: number;
  sent: number;
  failed: number;
  /** Transient errors left pending for the next tick. */
  retried: number;
  /** Broadcasts that became `done` this tick. */
  finished: number;
};

export const BROADCAST_PER_SECOND = 25;
export const BROADCAST_MAX_PER_TICK = 600;
/** Broadcasts looked at per tick (oldest first). */
const MAX_BROADCASTS = 20;

/** Stored on a recipient Telegram refused for good (shown to the admin). */
export const REJECTED_TEXT = "Telegram xabarni qabul qilmadi (bot bloklangan yoki chat topilmadi)";

/** Escapes plain text for Telegram `parse_mode: "HTML"`. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type Step = "sent" | "failed" | "transient" | "empty" | "stop";

/**
 * Claims one pending recipient of `id`, sends to it and marks it, in one
 * transaction. "stop" = the broadcast is no longer queued/sending (cancelled).
 */
async function deliverOne(id: string, html: string, send: NonNullable<DeliveryDeps["send"]>): Promise<{ step: Step; err?: unknown }> {
  return transaction(async (c) => {
    const b = await c.query<{ status: string }>("SELECT status FROM broadcasts WHERE id = $1", [id]);
    const status = b.rows[0]?.status;
    if (status !== "queued" && status !== "sending") return { step: "stop" as const };
    const r = await c.query<{ user_id: string; telegram_id: string }>(
      `SELECT user_id, telegram_id FROM broadcast_recipients
        WHERE broadcast_id = $1 AND status = 'pending'
        ORDER BY user_id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [id],
    );
    const rec = r.rows[0];
    if (!rec) return { step: "empty" as const };
    let ok: boolean;
    try {
      ok = await send(String(rec.telegram_id), html);
    } catch (err) {
      // Transient (TelegramTransientError, or anything unexpected): stays pending.
      return { step: "transient" as const, err };
    }
    if (ok) {
      await c.query(
        "UPDATE broadcast_recipients SET status = 'sent', sent_at = now(), error = NULL WHERE broadcast_id = $1 AND user_id = $2",
        [id, rec.user_id],
      );
      await c.query("UPDATE broadcasts SET sent = sent + 1 WHERE id = $1", [id]);
      return { step: "sent" as const };
    }
    await c.query(
      "UPDATE broadcast_recipients SET status = 'failed', error = $3 WHERE broadcast_id = $1 AND user_id = $2",
      [id, rec.user_id, REJECTED_TEXT],
    );
    await c.query("UPDATE broadcasts SET failed = failed + 1 WHERE id = $1", [id]);
    return { step: "failed" as const };
  });
}

/** Marks `id` done when nothing is pending any more. Returns whether it changed. */
async function finishIfDrained(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE broadcasts SET status = 'done', finished_at = now()
      WHERE id = $1 AND status IN ('queued', 'sending')
        AND NOT EXISTS (SELECT 1 FROM broadcast_recipients WHERE broadcast_id = $1 AND status = 'pending')
      RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/**
 * One delivery tick (leader only). Throws only on database errors (the
 * housekeeping wrapper logs and records them); Telegram errors never throw.
 */
export async function deliverBroadcasts(deps: DeliveryDeps = {}): Promise<DeliveryResult> {
  const out: DeliveryResult = { rows: 0, sent: 0, failed: 0, retried: 0, finished: 0 };
  if (!(deps.configured ?? botConfigured)()) return out;
  const send = deps.send ?? ((chatId: string, html: string) => sendMessage(chatId, html));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const perSecond = Math.max(1, Math.floor(deps.perSecond ?? BROADCAST_PER_SECOND));
  let budget = Math.max(0, Math.floor(deps.maxPerTick ?? BROADCAST_MAX_PER_TICK));

  const active = await query<{ id: string; text: string }>(
    `SELECT id, text FROM broadcasts
      WHERE status IN ('queued', 'sending')
      ORDER BY queued_at NULLS LAST, id
      LIMIT ${MAX_BROADCASTS}`,
  );

  let windowStart = now();
  let inWindow = 0;
  for (const b of active) {
    await query("UPDATE broadcasts SET status = 'sending' WHERE id = $1 AND status = 'queued'", [b.id]);
    const html = escapeTelegramHtml(b.text);
    let step: Step = "empty";
    while (budget > 0) {
      if (inWindow >= perSecond) {
        const wait = 1_000 - (now() - windowStart);
        if (wait > 0) await sleep(wait);
        windowStart = now();
        inWindow = 0;
      }
      const res = await deliverOne(b.id, html, send);
      step = res.step;
      if (step === "stop" || step === "empty") break;
      inWindow++;
      if (step === "transient") {
        out.retried++;
        log("warn", "[broadcast] Telegram vaqtincha javob bermadi — keyingi tickda davom etadi", { broadcastId: b.id, err: res.err });
        return out;
      }
      budget--;
      out.rows++;
      if (step === "sent") out.sent++;
      else out.failed++;
    }
    if (step === "empty" && (await finishIfDrained(b.id))) {
      out.finished++;
      log("info", "[broadcast] yuborish tugadi", { broadcastId: b.id });
    }
    if (budget <= 0) break;
  }
  return out;
}
