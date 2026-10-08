import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { queryOne, transaction } from "./db";
import { adminTx } from "./admin-audit";
import { parseBigintId, parseReason } from "./admin-accounts";
import type { AuditActor } from "./admin-audit";
import { buildKeyset, countCapped, keysetSelect, pageResult, parseListParams, type CursorColumns, type ListSpec, type ParsedList } from "./admin-list";
import { escapeTelegramHtml } from "./broadcast-delivery";
import { contentOf, parseBroadcastContent, sendBroadcastContent, type BroadcastContent } from "./broadcast-content";
import { toJsonb } from "./jsonb";
import { botConfigured, sendMessage, TelegramTransientError } from "./telegram";
import { parseIntParam } from "./validate";

/**
 * Telegram broadcasts: the admin side (docs/admin/02-plan.md §6.9, §7.1 S13).
 *
 * This module creates, snapshots, queues, cancels and reads broadcasts. It
 * NEVER sends in bulk: delivery is the worker housekeeping step
 * `deliverBroadcasts` (lib/server/broadcast-delivery.ts), which reads the
 * `broadcast_recipients` snapshot written here and honours `cancelled`.
 *
 * Audience semantics (one SQL fragment, `audienceWhere`, used for the live
 * count AND for the recipient snapshot, so the two cannot drift):
 *   - base, for every kind: `telegram_id IS NOT NULL AND NOT is_blocked`
 *     (a user without a Telegram chat cannot be reached; a blocked user is
 *     deliberately not messaged) — the same rows delivery can actually send to;
 *   - `paid`: the user has at least one `payment_orders` row in state `paid`
 *     (a real cash payment; free quota / admin credits do not count);
 *   - `active_days` (`days` 1..365): the user created a generation or has a
 *     session created or last seen within the last `days` days (the same
 *     definition of "active" as the dashboard's `activeUsers`);
 *   - `new_days` (`days` 1..365): the account was created within the last
 *     `days` days (the bot panel's «Yangilar (7 kun)», docs/bot-admin/PLAN.md A-Q3).
 *
 * Text is stored as plain text and HTML-escaped at send time (T8): the test
 * send below uses the very same `escapeTelegramHtml` as delivery.
 *
 * Rich content (bot panel, A-Q2): a broadcast created in the bot carries
 * `content` (migration 044) — the admin's own message as Telegram gave it:
 * text with its formatting entities, or a photo / video `file_id` with its
 * caption, plus an optional single link button. Such a broadcast is sent
 * with `sendBroadcastContent` (entities, never `parse_mode`), by the test
 * send AND by delivery. Web broadcasts have `content = NULL` and keep the
 * plain-text path unchanged.
 */

/* -------------------------------------------------------------------------- */
/* Limits and types                                                           */
/* -------------------------------------------------------------------------- */

/** Message length cap in characters (code points), after trim (§6.9). Telegram's own cap is 4096. */
export const BROADCAST_TEXT_MAX = 3500;
export const AUDIENCE_DAYS_MAX = 365;
/** Characters of the text shown in the list. */
export const PREVIEW_CHARS = 160;

export const BROADCAST_STATUSES = ["draft", "queued", "sending", "done", "cancelled"] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];
export const AUDIENCE_KINDS = ["all", "paid", "active_days", "new_days"] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];
export type Audience = { kind: "all" } | { kind: "paid" } | { kind: "active_days"; days: number } | { kind: "new_days"; days: number };

/** Audience kinds that carry `days`. */
const hasDays = (kind: AudienceKind): kind is "active_days" | "new_days" => kind === "active_days" || kind === "new_days";

/**
 * Who acts. The web passes its `AdminActor` (`adminHandler`); the bot panel passes an
 * actor built from the linked admin account (`bot/admin.ts`). Only these fields are used.
 */
export type BroadcastActor = AuditActor & { id: string; userId: string };

const notFound = (): ApiError => new ApiError("Topilmadi", 404, { code: "not_found" });
const stateError = (): ApiError => new ApiError("Xabar holati o'zgargan — sahifani yangilang", 409, { code: "state" });

/** Strict id parse: anything that is not a positive bigint is a plain 404, never a 500. */
export function parseBroadcastId(raw: string): string {
  const id = parseBigintId(raw);
  if (id === null) throw notFound();
  return id;
}

/* -------------------------------------------------------------------------- */
/* Input validation                                                           */
/* -------------------------------------------------------------------------- */

const bad = (name: string): ApiError => new ApiError(`Noto'g'ri parametr: ${name}`, 400);

function parseKind(raw: unknown): AudienceKind {
  if (typeof raw !== "string" || !(AUDIENCE_KINDS as readonly string[]).includes(raw)) throw bad("kind");
  return raw as AudienceKind;
}

function parseDays(raw: unknown): number {
  // A JSON body must carry a number ("7" is refused); the query string only has strings.
  const n = parseIntParam(raw, { min: 1, max: AUDIENCE_DAYS_MAX });
  if (n === null) throw new ApiError(`days 1 dan ${AUDIENCE_DAYS_MAX} gacha bo'lgan butun son bo'lishi kerak`, 400);
  return n;
}

/** Builds the normalised audience; `days` is required for `active_days` / `new_days` and refused otherwise. */
function makeAudience(kind: AudienceKind, days: unknown, fromBody: boolean): Audience {
  if (hasDays(kind)) {
    if (days === undefined || days === null) throw new ApiError(`${kind} uchun days kerak`, 400);
    if (fromBody && typeof days !== "number") throw new ApiError(`days 1 dan ${AUDIENCE_DAYS_MAX} gacha bo'lgan butun son bo'lishi kerak`, 400);
    return { kind, days: parseDays(days) };
  }
  if (days !== undefined && days !== null) throw bad("days");
  return { kind };
}

/** `{kind, days?}` of a request body: only these keys, nothing else (T9). */
export function parseAudience(raw: unknown): Audience {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("audience");
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "kind" && k !== "days") throw bad("audience");
  return makeAudience(parseKind(o.kind), o.days, true);
}

/** `kind` / `days` of the audience count query; a repeated parameter is a 400. */
export function parseAudienceQuery(url: URL): Audience {
  const one = (name: string): string | undefined => {
    const all = url.searchParams.getAll(name);
    if (all.length > 1) throw bad(name);
    return all[0] === "" ? undefined : all[0];
  };
  return makeAudience(parseKind(one("kind")), one("days"), false);
}

/** Message text: a string, 1..3500 characters after trim, no NUL (Postgres text rejects it). */
export function parseText(raw: unknown): string {
  if (typeof raw !== "string") throw new ApiError("Matn kerak", 400);
  const s = raw.trim();
  if (s === "") throw new ApiError("Matn bo'sh bo'lmasligi kerak", 400);
  if (s.includes("\0")) throw new ApiError("Matnda yaroqsiz belgi bor", 400);
  if (Array.from(s).length > BROADCAST_TEXT_MAX) throw new ApiError(`Matn ${BROADCAST_TEXT_MAX} belgidan oshmasligi kerak`, 400);
  return s;
}

/* -------------------------------------------------------------------------- */
/* Audience                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The audience as a constant `WHERE` for `FROM users u` (user values only as
 * `$n`; `params` receives them). Used by the count and by the snapshot.
 */
function audienceWhere(a: Audience, params: unknown[]): string {
  const conds = ["u.telegram_id IS NOT NULL", "NOT u.is_blocked"];
  if (a.kind === "paid") {
    conds.push("EXISTS (SELECT 1 FROM payment_orders o WHERE o.user_id = u.id AND o.state = 'paid')");
  } else if (a.kind === "active_days") {
    params.push(a.days);
    const n = params.length;
    conds.push(
      `(EXISTS (SELECT 1 FROM generations g WHERE g.user_id = u.id AND g.created_at >= now() - $${n}::int * interval '1 day')
        OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id
                    AND (s.created_at >= now() - $${n}::int * interval '1 day' OR s.last_seen_at >= now() - $${n}::int * interval '1 day')))`,
    );
  } else if (a.kind === "new_days") {
    params.push(a.days);
    conds.push(`u.created_at >= now() - $${params.length}::int * interval '1 day'`);
  }
  return conds.join(" AND ");
}

async function readOnly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    return fn(client);
  });
}

/** Live recipient count of an audience (what `send` would snapshot right now). */
export async function audienceCount(a: Audience): Promise<{ count: number }> {
  return readOnly(async (client) => {
    const params: unknown[] = [];
    const where = audienceWhere(a, params);
    const res = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM users u WHERE ${where}`, params);
    return { count: Number(res.rows[0]?.n ?? 0) };
  });
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type AdminBroadcast = {
  id: string;
  status: BroadcastStatus;
  /** The full plain text (list items carry `preview` instead). */
  text: string;
  audience: Audience;
  total: number;
  sent: number;
  failed: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  queuedAt: string | null;
  finishedAt: string | null;
};

export type BroadcastListItem = Omit<AdminBroadcast, "text"> & {
  /** First 160 characters of the text. */
  preview: string;
  textLength: number;
};

type Row = {
  id: string;
  status: string;
  text: string;
  audience: unknown;
  total: number;
  sent: number;
  failed: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  queued_at: Date | null;
  finished_at: Date | null;
};

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** Reads the stored audience defensively: the column is JSONB written only by this module, but never trust it blindly. */
function audienceOf(raw: unknown): Audience {
  try {
    return parseAudience(raw);
  } catch {
    return { kind: "all" };
  }
}

const COLUMNS = `b.id::text AS id, b.status, b.audience, b.total, b.sent, b.failed, b.created_by::text AS created_by,
       cu.name AS created_by_name, b.created_at, b.queued_at, b.finished_at`;
const FROM = `FROM broadcasts b
  LEFT JOIN admin_accounts ca ON ca.id = b.created_by
  LEFT JOIN users cu ON cu.id = ca.user_id`;

function base(r: Row): Omit<AdminBroadcast, "text"> {
  return {
    id: r.id,
    status: r.status as BroadcastStatus,
    audience: audienceOf(r.audience),
    total: Number(r.total),
    sent: Number(r.sent),
    failed: Number(r.failed),
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: new Date(r.created_at).toISOString(),
    queuedAt: iso(r.queued_at),
    finishedAt: iso(r.finished_at),
  };
}

const toBroadcast = (r: Row): AdminBroadcast => ({ ...base(r), text: r.text });

type Queryable = Pick<PoolClient, "query">;

async function fetchBroadcast(client: Queryable, id: string): Promise<AdminBroadcast | null> {
  const res = await client.query<Row>(`SELECT ${COLUMNS}, b.text ${FROM} WHERE b.id = $1`, [id]);
  return res.rows[0] ? toBroadcast(res.rows[0]) : null;
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */

export const BROADCASTS_LIST_SPEC = {
  sorts: {
    created_desc: { column: "b.created_at", dir: "DESC", type: "timestamptz" },
  },
  id: { column: "b.id", type: "bigint" },
  filters: {
    status: { kind: "enumList", values: BROADCAST_STATUSES },
  },
} as const satisfies ListSpec;

export type BroadcastsListParams = ParsedList<typeof BROADCASTS_LIST_SPEC>;

export function parseBroadcastsQuery(url: URL): BroadcastsListParams {
  return parseListParams(url, BROADCASTS_LIST_SPEC);
}

export type BroadcastsListResult = {
  items: BroadcastListItem[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

function whereFor(p: BroadcastsListParams, params: unknown[]): string[] {
  const conds: string[] = [];
  if (p.filters.status && p.filters.status.length > 0) {
    params.push(p.filters.status);
    conds.push(`b.status = ANY($${params.length}::text[])`);
  }
  return conds;
}

export async function listBroadcasts(p: BroadcastsListParams): Promise<BroadcastsListResult> {
  return readOnly(async (client) => {
    const params: unknown[] = [];
    const conds = whereFor(p, params);
    const ks = buildKeyset({ sort: p.sort, cursor: p.cursor, id: BROADCASTS_LIST_SPEC.id, paramOffset: params.length });
    const all = [...params, ...ks.params, p.limit + 1];
    // Only a short slice of the text travels in a list; the detail endpoint returns the whole of it.
    const res = await client.query<Row & { preview: string; text_length: string } & CursorColumns>(
      `SELECT ${COLUMNS}, left(b.text, ${PREVIEW_CHARS}) AS preview, char_length(b.text)::text AS text_length,
              ${keysetSelect(p.sort, BROADCASTS_LIST_SPEC.id)}
         ${FROM}
        WHERE ${[...conds, ks.where].join(" AND ")}
        ORDER BY ${ks.orderBy}
        LIMIT $${all.length}`,
      all,
    );
    const page = pageResult(res.rows, p.limit, p.sort);
    const cparams: unknown[] = [];
    const cconds = whereFor(p, cparams);
    const count = await countCapped(client, `FROM broadcasts b WHERE ${cconds.length ? cconds.join(" AND ") : "TRUE"}`, cparams);
    return {
      items: page.items.map((r) => ({ ...base(r as Row), preview: String((r as { preview: string }).preview), textLength: Number((r as { text_length: string }).text_length) })),
      nextCursor: page.nextCursor,
      ...count,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */

export type BroadcastStats = {
  total: number;
  sent: number;
  failed: number;
  /** Recipients not yet handled. After a cancel they stay pending and are never sent. */
  pending: number;
  /** Why recipients failed, most frequent first (at most 5). */
  failedReasons: Array<{ error: string; count: number }>;
};

export async function getBroadcast(id: string): Promise<{ broadcast: AdminBroadcast; stats: BroadcastStats }> {
  return readOnly(async (client) => {
    const broadcast = await fetchBroadcast(client, id);
    if (!broadcast) throw notFound();
    const c = await client.query<{ total: string; sent: string; failed: string; pending: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'sent')::text AS sent,
              count(*) FILTER (WHERE status = 'failed')::text AS failed,
              count(*) FILTER (WHERE status = 'pending')::text AS pending
         FROM broadcast_recipients WHERE broadcast_id = $1`,
      [id],
    );
    const reasons = await client.query<{ error: string | null; n: string }>(
      `SELECT error, count(*)::text AS n FROM broadcast_recipients
        WHERE broadcast_id = $1 AND status = 'failed'
        GROUP BY error ORDER BY count(*) DESC, error NULLS LAST LIMIT 5`,
      [id],
    );
    const r = c.rows[0]!;
    return {
      broadcast,
      stats: {
        total: Number(r.total),
        sent: Number(r.sent),
        failed: Number(r.failed),
        pending: Number(r.pending),
        failedReasons: reasons.rows.map((x) => ({ error: x.error ?? "Noma'lum xato", count: Number(x.n) })),
      },
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Create (draft)                                                             */
/* -------------------------------------------------------------------------- */

export async function createBroadcast(
  actor: BroadcastActor,
  body: Record<string, unknown>,
  opts: { content?: BroadcastContent; via?: "bot" } = {},
): Promise<{ broadcast: AdminBroadcast }> {
  // `content` comes only from server code (the bot panel), never from a request body.
  let text: string;
  let content: BroadcastContent | null = null;
  if (opts.content) {
    const parsed = parseBroadcastContent(opts.content, body.text, BROADCAST_TEXT_MAX);
    text = parsed.text;
    content = parsed.content;
  } else {
    text = parseText(body.text);
  }
  const audience = parseAudience(body.audience);
  return adminTx(actor, async (client, audit) => {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO broadcasts (status, text, audience, created_by, content) VALUES ('draft', $1, $2::jsonb, $3, $4::jsonb) RETURNING id::text AS id`,
      [text, toJsonb(audience), actor.id, content ? toJsonb(content) : null],
    );
    const id = ins.rows[0]!.id;
    await audit({
      action: "broadcasts.create",
      targetType: "broadcast",
      targetId: id,
      before: null,
      after: {
        status: "draft",
        audience,
        text,
        ...(content ? { content: { kind: content.kind, fileId: content.fileId ?? null, button: content.button ?? null } } : {}),
      },
      ...(opts.via ? { meta: { via: opts.via } } : {}),
    });
    return { broadcast: (await fetchBroadcast(client, id))! };
  });
}

/* -------------------------------------------------------------------------- */
/* Test send (to the actor only)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Sends the broadcast text to the ACTOR's own Telegram chat, escaped exactly
 * as delivery escapes it. The recipient is read from the database for the
 * actor's user id, never from the request.
 *
 *   - no `telegram_id` on the admin's user → 409 `{code:"no_telegram"}`;
 *   - the bot token is not configured → 503 `{code:"bot_not_configured"}`;
 *   - Telegram refused for good (bot blocked by the admin, chat gone) →
 *     `{sent:false}` (200), a transient failure → 502 `{code:"telegram_unavailable"}`.
 * One audit row per attempt that reached Telegram, with the outcome in `meta`.
 */
export async function sendTest(actor: BroadcastActor, id: string, opts: { via?: "bot" } = {}): Promise<{ sent: boolean }> {
  const b = await queryOne<{ text: string; content: unknown }>("SELECT text, content FROM broadcasts WHERE id = $1", [id]);
  if (!b) throw notFound();
  const u = await queryOne<{ telegram_id: string | null }>("SELECT telegram_id::text AS telegram_id FROM users WHERE id = $1", [actor.userId]);
  if (!u?.telegram_id) throw new ApiError("Sizning hisobingizga Telegram ulanmagan — sinov xabarini yuborib bo'lmaydi", 409, { code: "no_telegram" });
  if (!botConfigured()) throw new ApiError("Telegram bot sozlanmagan — sinov xabarini yuborib bo'lmaydi", 503, { code: "bot_not_configured" });

  let sent = false;
  let transient = false;
  try {
    const content = contentOf(b.content, b.text);
    sent = content ? await sendBroadcastContent(u.telegram_id, b.text, content) : await sendMessage(u.telegram_id, escapeTelegramHtml(b.text));
  } catch (e) {
    if (!(e instanceof TelegramTransientError)) throw e;
    transient = true;
  }
  await adminTx(actor, async (_client, audit) => {
    await audit({ action: "broadcasts.test", targetType: "broadcast", targetId: id, meta: { sent, ...(transient ? { transient: true } : {}), ...(opts.via ? { via: opts.via } : {}) } });
  });
  if (transient) throw new ApiError("Telegram vaqtincha javob bermadi — keyinroq urinib ko'ring", 502, { code: "telegram_unavailable" });
  return { sent };
}

/* -------------------------------------------------------------------------- */
/* Send (snapshot + queue)                                                    */
/* -------------------------------------------------------------------------- */

/** `confirmCount`: a non-negative integer. */
function parseConfirmCount(raw: unknown): number {
  const n = typeof raw === "number" ? parseIntParam(raw, { min: 0 }) : null;
  if (n === null) throw new ApiError("confirmCount butun son bo'lishi kerak", 400);
  return n;
}

/**
 * Snapshots the recipients and queues the broadcast, in ONE transaction:
 * lock the row, require a draft (409 `state`), insert the recipients from the
 * audience query, then compare the number of rows actually inserted with the
 * admin's `confirmCount`. A mismatch throws (409 `count_changed` with the real
 * count) and rolls the snapshot back, so what the admin confirmed is exactly
 * what is queued. An empty audience is refused (409 `empty_audience`).
 */
export async function sendBroadcast(actor: BroadcastActor, id: string, body: Record<string, unknown>, opts: { via?: "bot" } = {}): Promise<{ broadcast: AdminBroadcast }> {
  const reason = parseReason(body.reason)!;
  const confirmCount = parseConfirmCount(body.confirmCount);
  return adminTx(actor, async (client, audit) => {
    const cur = await client.query<{ status: string; audience: unknown }>("SELECT status, audience FROM broadcasts WHERE id = $1 FOR UPDATE", [id]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    if (row.status !== "draft") throw stateError();
    const audience = audienceOf(row.audience);
    const params: unknown[] = [id];
    const where = audienceWhere(audience, params);
    const snap = await client.query(
      `INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_id)
       SELECT $1::bigint, u.id, u.telegram_id FROM users u WHERE ${where}`,
      params,
    );
    const total = snap.rowCount ?? 0;
    if (total !== confirmCount) {
      throw new ApiError(`Auditoriya soni o'zgardi: hozir ${total} ta`, 409, { code: "count_changed", count: total });
    }
    if (total === 0) throw new ApiError("Auditoriya bo'sh — yuboriladigan foydalanuvchi yo'q", 409, { code: "empty_audience", count: 0 });
    await client.query("UPDATE broadcasts SET status = 'queued', total = $2, queued_at = now() WHERE id = $1", [id, total]);
    await audit({
      action: "broadcasts.send",
      targetType: "broadcast",
      targetId: id,
      reason,
      before: { status: "draft", total: 0 },
      after: { status: "queued", total },
      meta: { audience, confirmCount, ...(opts.via ? { via: opts.via } : {}) },
    });
    return { broadcast: (await fetchBroadcast(client, id))! };
  });
}

/* -------------------------------------------------------------------------- */
/* Cancel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Draft / queued / sending → cancelled. Pending recipients stay `pending` and
 * are never sent: delivery re-reads the broadcast status before every message
 * and only looks at `queued` / `sending`. A message already in flight when the
 * cancel lands may still arrive (at most one per delivering process).
 */
export async function cancelBroadcast(actor: BroadcastActor, id: string, body: Record<string, unknown>, opts: { via?: "bot" } = {}): Promise<{ broadcast: AdminBroadcast }> {
  const reason = parseReason(body.reason)!;
  return adminTx(actor, async (client, audit) => {
    const cur = await client.query<{ status: string; total: number; sent: number; failed: number }>(
      "SELECT status, total, sent, failed FROM broadcasts WHERE id = $1 FOR UPDATE",
      [id],
    );
    const row = cur.rows[0];
    if (!row) throw notFound();
    if (row.status !== "draft" && row.status !== "queued" && row.status !== "sending") throw stateError();
    await client.query("UPDATE broadcasts SET status = 'cancelled', finished_at = now() WHERE id = $1", [id]);
    const total = Number(row.total);
    const sent = Number(row.sent);
    const failed = Number(row.failed);
    await audit({
      action: "broadcasts.cancel",
      targetType: "broadcast",
      targetId: id,
      reason,
      before: { status: row.status },
      after: { status: "cancelled" },
      meta: { total, sent, failed, unsent: Math.max(0, total - sent - failed), ...(opts.via ? { via: opts.via } : {}) },
    });
    return { broadcast: (await fetchBroadcast(client, id))! };
  });
}
