import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, queryOne } from "./db";
import { env } from "./env";
import { botConfigured, callBot, getMe, isTransientBotFailure } from "./telegram";
import { adminTx, type AuditActor } from "./admin-audit";
import { parseBigintId, parseReason } from "./admin-accounts";

/**
 * Admin side of the bonus channels (docs/bonus/PLAN.md, package K2; table `bonus_channels`,
 * migration 041). The user/bot side (claims, payouts, stay sweep) lives in `bonus-channels.ts`;
 * this module only manages the channel list and reads claim statistics.
 *
 *   - list: every channel, ordered by `sort, id`, with claim stats (joined, join paid
 *     count/sum, stay paid count/sum, left, stay pending);
 *   - resolve: `@username`, a public `t.me/<name>` link or a numeric chat id → Bot API
 *     `getChat` (only `channel` / `supergroup`), plus the bot's own admin status from
 *     `getChatMember(chat, botId)`. The status is never stored: a missing admin right is
 *     returned as a warning the UI shows, and the table re-checks it on demand;
 *   - create: re-resolves on the server (the client's preview is never trusted), inserts and
 *     writes `bonus_channel.create` in the same transaction; a live channel with the same chat id
 *     is 409 `duplicate`; a SOFT-DELETED one is restored instead (same row, same claims, so nobody
 *     who already claimed is paid again; `bonus_channel.restore` audit row, `restored: true`);
 *   - update: title override, username, amounts, stay days, active, sort; only changed fields go
 *     into the `bonus_channel.update` audit row (before/after); no change is 409 `state`. A new
 *     `username` (the channel owner renamed the channel) is resolved through `getChat` and must
 *     be the SAME chat id (409 `chat_mismatch` otherwise) — the chat id is the identity;
 *   - refresh («Telegramdan yangilash»): `getChat(chat_id)` → the stored username follows
 *     Telegram's current one (`bonus_channel.refresh` audit row only when it changed);
 *   - mandatory (migration 045, docs/bonus/BONUS3.md C-Q2): an active mandatory channel must be
 *     joined before the user creates new work (`mandatory-channels.ts`); it may pay a bonus too,
 *     or none (the «at least one bonus > 0» rule applies to optional channels only);
 *   - invite link (migration 042): optional `https://t.me/+…` / `…/joinchat/…`, stored normalized
 *     as `https://t.me/+<hash>`; the bot uses it for private channels (no `username`).
 *     `createInviteLink` asks Telegram for a new one (audited, not stored);
 *   - delete (migration 051): a SOFT delete, always allowed — `deleted_at = now()`, `active = false`
 *     under the row lock; claims and the ledger stay untouched (they are the «never pay twice»
 *     guard). A deleted row is invisible to every admin read and write (404, as if gone) and to
 *     the user side (bonus tasks, payouts, stay sweep, mandatory gate).
 *
 * Validation: amounts are JSON integers 0..20 000 per channel (`MAX_BONUS`, review cap; the DB CHECK allows
 * 1 000 000) with at least one > 0 for an optional channel, `stayDays` 1..365,
 * `sort` −1 000 000..1 000 000, `title` 1..128 characters. The reason is optional (audited
 * when given). Every refusal is a 4xx before any write, so nothing partial is ever audited.
 */

/** Per-channel cap of `join_bonus` and of `stay_bonus` (money review): a typo cannot pay out a fortune. */
export const MAX_BONUS = 20_000;
export const MAX_STAY_DAYS = 365;
export const MAX_SORT = 1_000_000;
export const MAX_TITLE = 128;

export const BOT_NOT_ADMIN_WARNING = "Bot kanalda admin emas — obunani tekshira olmaydi";
export const BOT_UNKNOWN_WARNING = "Bot admin ekanini tekshirib bo'lmadi (Telegram javob bermadi) — keyinroq qayta tekshiring";

export type BotAdminStatus = "admin" | "not_admin" | "unknown";

export type BonusChannelStats = {
  joined: number;
  joinPaidCount: number;
  joinPaidSum: number;
  stayPaidCount: number;
  stayPaidSum: number;
  left: number;
  /** Joined, not left, stay bonus not settled yet (the worker sweep's queue); 0 when the channel's stay_bonus is 0. */
  stayPending: number;
};

export type BonusChannelItem = {
  id: string;
  chatId: string;
  username: string | null;
  /** Normalized `https://t.me/+…` (the bot's subscribe link when there is no `username`). */
  inviteLink: string | null;
  title: string;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  active: boolean;
  /** Must be joined before creating new work (C-Q2). */
  mandatory: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
  stats: BonusChannelStats;
};

export type ResolvedChannel = {
  chatId: string;
  title: string;
  username: string | null;
  type: "channel" | "supergroup";
  botAdmin: BotAdminStatus;
  /** Uzbek warning for the UI; `null` when the bot is an admin. */
  warning: string | null;
  /** Id of the LIVE channel row that already has this chat id (`null` when new or soft-deleted). */
  existingId: string | null;
  /** Its title (the duplicate hint names it). */
  existingTitle: string | null;
  /** Id of a SOFT-DELETED row with this chat id: saving restores it instead of inserting. */
  deletedId: string | null;
  /** Claims of that deleted row: these users will not get the bonus again after the restore. */
  deletedClaims: number;
};

export type ChannelRef = { kind: "username"; username: string } | { kind: "id"; chatId: string };

/* ───────────────────────────── errors ───────────────────────────── */

const notFound = (): ApiError => new ApiError("Kanal topilmadi", 404, { code: "not_found" });
const bad = (message: string, code = "invalid"): ApiError => new ApiError(message, 400, { code });

/* ───────────────────────────── input parsing ───────────────────────────── */

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const CHAT_ID = /^-?[1-9]\d{0,18}$/;
const LINK_HOSTS = /^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)$/i;
const MIN_BIGINT = BigInt("-9223372036854775808");
const MAX_BIGINT = BigInt("9223372036854775807");

const REF_HELP = "Kanalni @username, t.me/<nom> havolasi yoki -100… ID raqami bilan kiriting";

/**
 * `@name`, `name`, `https://t.me/name`, `t.me/s/name`, `t.me/name/123` (a post link),
 * `tg://resolve?domain=name` or a numeric chat id (`-1001234567890`). Private invite links
 * (`t.me/+…`, `t.me/joinchat/…`) cannot be resolved by the Bot API: 400 `invite_link`.
 */
export function parseChannelRef(raw: unknown): ChannelRef {
  if (typeof raw !== "string" || !raw.trim()) throw bad(REF_HELP, "input");
  const s = raw.trim();
  if (s.length > 300) throw bad(REF_HELP, "input");

  if (CHAT_ID.test(s)) {
    const n = BigInt(s);
    if (n < MIN_BIGINT || n > MAX_BIGINT) throw bad(REF_HELP, "input");
    return { kind: "id", chatId: s };
  }

  const tg = /^tg:\/\/resolve\?(?:.*&)?domain=([^&#]+)/i.exec(s);
  if (tg) return usernameRef(tg[1]!);

  if (s.startsWith("@")) return usernameRef(s.slice(1));

  if (/[/.]/.test(s)) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      throw bad(REF_HELP, "input");
    }
    if (!/^https?:$/.test(url.protocol) || !LINK_HOSTS.test(url.hostname)) throw bad(REF_HELP, "input");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "s") parts.shift();
    const first = parts[0] ?? "";
    if (first.startsWith("+") || first === "joinchat") {
      throw bad("Yopiq taklif havolasi bo'yicha kanalni aniqlab bo'lmaydi — kanal ID raqamini (-100…) kiriting", "invite_link");
    }
    return usernameRef(first);
  }

  return usernameRef(s);
}

function usernameRef(name: string): ChannelRef {
  if (!USERNAME.test(name)) throw bad(REF_HELP, "input");
  return { kind: "username", username: name };
}

function intIn(raw: unknown, min: number, max: number, message: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) throw bad(message);
  return raw;
}

const amountMessage = (label: string) => `${label}: 0 dan 20 000 gacha butun son bo'lishi kerak (bitta kanal uchun eng ko'pi 20 000 ball)`;

export function parseAmount(raw: unknown, label: string): number {
  return intIn(raw, 0, MAX_BONUS, amountMessage(label));
}

export function parseStayDays(raw: unknown): number {
  return intIn(raw, 1, MAX_STAY_DAYS, "Kunlar soni 1 dan 365 gacha butun son bo'lishi kerak");
}

export function parseSort(raw: unknown): number {
  return intIn(raw, -MAX_SORT, MAX_SORT, "Tartib raqami −1 000 000 dan 1 000 000 gacha butun son bo'lishi kerak");
}

export function parseActive(raw: unknown): boolean {
  if (typeof raw !== "boolean") throw bad("Faollik true yoki false bo'lishi kerak");
  return raw;
}

export function parseMandatory(raw: unknown): boolean {
  if (typeof raw !== "boolean") throw bad("Majburiylik true yoki false bo'lishi kerak");
  return raw;
}

/** Trimmed, inner whitespace collapsed, no control characters, 1..128 characters. */
export function parseTitle(raw: unknown): string {
  if (typeof raw !== "string") throw bad("Sarlavha matn bo'lishi kerak");
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || [...s].length > MAX_TITLE) throw bad(`Sarlavha 1 dan ${MAX_TITLE} belgigacha bo'lishi kerak`);
  return s;
}

const INVITE_HOSTS = /^(?:www\.)?(?:t\.me|telegram\.me)$/i;
const INVITE_PATH = /^\/(?:\+|joinchat\/)([A-Za-z0-9_-]{8,64})\/?$/;
const INVITE_ERROR = "Taklif havolasi https://t.me/+… yoki https://t.me/joinchat/… ko'rinishida bo'lishi kerak";

/**
 * Private channel invite link: `https://t.me/+<hash>` or `https://t.me/joinchat/<hash>` (also
 * `http`, no scheme, `telegram.me`, a trailing slash) → normalized `https://t.me/+<hash>`.
 * No query, fragment, credentials or port. `null` / `""` → `null` (no link / clear it).
 */
export function parseInviteLink(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw bad(INVITE_ERROR, "invite_link");
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 200 || /\s/.test(s)) throw bad(INVITE_ERROR, "invite_link");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw bad(INVITE_ERROR, "invite_link");
  }
  const m = INVITE_PATH.exec(url.pathname);
  if (
    !/^https?:$/.test(url.protocol) ||
    !INVITE_HOSTS.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !m
  ) {
    throw bad(INVITE_ERROR, "invite_link");
  }
  return `https://t.me/+${m[1]}`;
}

/** An optional channel exists only for its bonus; a mandatory one may pay nothing (C-Q2). */
export function assertSomeBonus(joinBonus: number, stayBonus: number, mandatory: boolean): void {
  if (!mandatory && joinBonus === 0 && stayBonus === 0) throw bad("Kamida bitta bonus 0 dan katta bo'lishi kerak");
}

/** `[id]` route segment: a positive bigint, anything else is the coded 404. */
export function parseChannelId(raw: unknown): string {
  const id = parseBigintId(raw);
  if (id === null) throw notFound();
  return id;
}

/* ───────────────────────────── Bot API ───────────────────────────── */

type TgChat = { id: number; type: string; title?: string; username?: string };
type TgMember = { status: string };

/** The bot's own user id: the numeric prefix of the token (`<id>:<secret>`), else `getMe`. */
async function botUserId(): Promise<number | null> {
  const prefix = env.telegramBotToken.split(":")[0] ?? "";
  if (/^[1-9]\d{0,15}$/.test(prefix)) return Number(prefix);
  const me = await getMe();
  return me?.id ?? null;
}

function requireBot(): void {
  if (!botConfigured()) throw new ApiError("Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN)", 503, { code: "bot_unconfigured" });
}

/**
 * `getChatMember(chat, bot)`: administrator / creator → `admin`; a Telegram refusal (the bot is
 * not a member, "member list is inaccessible") or any other status → `not_admin`; no answer,
 * a rate limit or a 5xx → `unknown`. Never throws.
 */
export async function botAdminStatus(chatId: string): Promise<BotAdminStatus> {
  if (!botConfigured()) return "unknown";
  const botId = await botUserId();
  if (botId === null) return "unknown";
  const r = await callBot<TgMember>("getChatMember", { chat_id: chatId, user_id: botId });
  if (!r.ok) return isTransientBotFailure(r) ? "unknown" : "not_admin";
  return r.result.status === "administrator" || r.result.status === "creator" ? "admin" : "not_admin";
}

export function botWarning(status: BotAdminStatus): string | null {
  if (status === "admin") return null;
  return status === "not_admin" ? BOT_NOT_ADMIN_WARNING : BOT_UNKNOWN_WARNING;
}

/**
 * `getChat` + type check: the chat must be a `channel` or a `supergroup` with a safe integer id.
 * Throws 503 `telegram_unavailable` / 400 `chat_not_found` / 400 `chat_type`.
 */
async function channelChat(ref: ChannelRef): Promise<TgChat & { type: ResolvedChannel["type"] }> {
  requireBot();
  const r = await callBot<TgChat>("getChat", { chat_id: ref.kind === "username" ? `@${ref.username}` : ref.chatId });
  if (!r.ok) {
    if (isTransientBotFailure(r)) {
      throw new ApiError("Telegram javob bermadi — birozdan keyin qayta urinib ko'ring", 503, { code: "telegram_unavailable" });
    }
    throw new ApiError(
      "Kanal topilmadi. Manzilni tekshiring; yopiq kanal bo'lsa, avval botni unga admin qilib qo'shing va ID raqamini kiriting.",
      400,
      { code: "chat_not_found" },
    );
  }
  const chat = r.result;
  if (chat.type !== "channel" && chat.type !== "supergroup") {
    throw bad("Bu kanal emas. Faqat kanal yoki superguruh qo'shiladi.", "chat_type");
  }
  if (!Number.isSafeInteger(chat.id)) throw bad("Telegram noto'g'ri chat ID qaytardi", "chat_not_found");
  return { ...chat, type: chat.type };
}

/** `getChat` + type check + bot admin status. Throws 503 / 400 with a code the UI can show. */
export async function resolveChannel(ref: ChannelRef): Promise<ResolvedChannel> {
  const chat = await channelChat(ref);
  const type = chat.type;
  const chatId = String(chat.id);
  const username = typeof chat.username === "string" && chat.username ? chat.username : null;
  const title = (typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : username ?? chatId).slice(0, MAX_TITLE);
  const botAdmin = await botAdminStatus(chatId);
  const known = await queryOne<{ id: string; title: string; deleted: boolean; claims: number }>(
    `SELECT c.id::text AS id, c.title, c.deleted_at IS NOT NULL AS deleted,
            (SELECT count(*) FROM bonus_channel_claims cl WHERE cl.channel_id = c.id)::int AS claims
       FROM bonus_channels c WHERE c.chat_id = $1`,
    [chatId],
  );
  const live = known && !known.deleted ? known : null;
  const gone = known && known.deleted ? known : null;
  return {
    chatId,
    title,
    username,
    type,
    botAdmin,
    warning: botWarning(botAdmin),
    existingId: live?.id ?? null,
    existingTitle: live?.title ?? null,
    deletedId: gone?.id ?? null,
    deletedClaims: gone?.claims ?? 0,
  };
}

/* ───────────────────────────── reads ───────────────────────────── */

type Row = {
  id: string;
  chat_id: string;
  username: string | null;
  invite_link: string | null;
  title: string;
  join_bonus: number;
  stay_bonus: number;
  stay_days: number;
  active: boolean;
  mandatory: boolean;
  sort: number;
  created_at: Date;
  updated_at: Date;
  joined: number;
  join_paid_count: number;
  join_paid_sum: string;
  stay_paid_count: number;
  stay_paid_sum: string;
  left_count: number;
  stay_pending: number;
};

/** `stay_pending` is 0 for a channel without a stay bonus: it owes nothing, so no claim is «pending». */
const SELECT = `
  SELECT c.id::text AS id, c.chat_id::text AS chat_id, c.username, c.invite_link, c.title, c.join_bonus, c.stay_bonus,
         c.stay_days, c.active, c.mandatory, c.sort, c.created_at, c.updated_at,
         COALESCE(s.joined, 0)::int AS joined,
         COALESCE(s.join_paid_count, 0)::int AS join_paid_count,
         COALESCE(s.join_paid_sum, 0)::text AS join_paid_sum,
         COALESCE(s.stay_paid_count, 0)::int AS stay_paid_count,
         COALESCE(s.stay_paid_sum, 0)::text AS stay_paid_sum,
         COALESCE(s.left_count, 0)::int AS left_count,
         (CASE WHEN c.stay_bonus > 0 THEN COALESCE(s.stay_pending, 0) ELSE 0 END)::int AS stay_pending
    FROM bonus_channels c
    LEFT JOIN (
      SELECT channel_id,
             count(*) AS joined,
             count(*) FILTER (WHERE join_paid > 0) AS join_paid_count,
             sum(join_paid) FILTER (WHERE join_paid > 0) AS join_paid_sum,
             count(*) FILTER (WHERE stay_paid > 0) AS stay_paid_count,
             sum(stay_paid) FILTER (WHERE stay_paid > 0) AS stay_paid_sum,
             count(*) FILTER (WHERE left_at IS NOT NULL) AS left_count,
             count(*) FILTER (WHERE stay_paid IS NULL AND left_at IS NULL) AS stay_pending
        FROM bonus_channel_claims
       GROUP BY channel_id
    ) s ON s.channel_id = c.id
   WHERE c.deleted_at IS NULL`;

function toItem(r: Row): BonusChannelItem {
  return {
    id: r.id,
    chatId: r.chat_id,
    username: r.username,
    inviteLink: r.invite_link,
    title: r.title,
    joinBonus: r.join_bonus,
    stayBonus: r.stay_bonus,
    stayDays: r.stay_days,
    active: r.active,
    mandatory: r.mandatory,
    sort: r.sort,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    stats: {
      joined: r.joined,
      joinPaidCount: r.join_paid_count,
      joinPaidSum: Number(r.join_paid_sum),
      stayPaidCount: r.stay_paid_count,
      stayPaidSum: Number(r.stay_paid_sum),
      left: r.left_count,
      stayPending: r.stay_pending,
    },
  };
}

export async function listBonusChannels(): Promise<{ items: BonusChannelItem[] }> {
  const rows = await query<Row>(`${SELECT} ORDER BY c.sort, c.id`);
  return { items: rows.map(toItem) };
}

async function itemOf(id: string): Promise<BonusChannelItem> {
  const row = await queryOne<Row>(`${SELECT} AND c.id = $1`, [id]);
  if (!row) throw notFound();
  return toItem(row);
}

/** Bot admin status of a stored channel (the table's «Qayta tekshirish»). */
export async function channelBotStatus(rawId: unknown): Promise<{ id: string; botAdmin: BotAdminStatus; warning: string | null }> {
  const id = parseChannelId(rawId);
  const row = await queryOne<{ chat_id: string }>("SELECT chat_id::text AS chat_id FROM bonus_channels WHERE id = $1 AND deleted_at IS NULL", [id]);
  if (!row) throw notFound();
  requireBot();
  const botAdmin = await botAdminStatus(row.chat_id);
  return { id, botAdmin, warning: botWarning(botAdmin) };
}

/* ───────────────────────────── mutations ───────────────────────────── */

type Snapshot = {
  title: string;
  username: string | null;
  inviteLink: string | null;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  active: boolean;
  mandatory: boolean;
  sort: number;
};

type LockedRow = Snapshot & { chatId: string };

/** The live (not soft-deleted) row, locked `FOR UPDATE`; a missing or deleted row is the coded 404. */
async function lockChannel(client: PoolClient, id: string): Promise<LockedRow> {
  const r = await client.query<{
    chat_id: string;
    username: string | null;
    invite_link: string | null;
    title: string;
    join_bonus: number;
    stay_bonus: number;
    stay_days: number;
    active: boolean;
    mandatory: boolean;
    sort: number;
  }>(
    `SELECT chat_id::text AS chat_id, username, invite_link, title, join_bonus, stay_bonus, stay_days, active, mandatory, sort
       FROM bonus_channels WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  return {
    chatId: row.chat_id,
    username: row.username,
    inviteLink: row.invite_link,
    title: row.title,
    joinBonus: row.join_bonus,
    stayBonus: row.stay_bonus,
    stayDays: row.stay_days,
    active: row.active,
    mandatory: row.mandatory,
    sort: row.sort,
  };
}

export type CreateResult = { item: BonusChannelItem; botAdmin: BotAdminStatus; warning: string | null; restored: boolean };

/** Uzbek warning: a channel without a username AND without an invite link cannot be joined from the bot. */
export const PRIVATE_NO_LINK_WARNING =
  "Kanalning ommaviy username'i yo'q va taklif havolasi kiritilmagan — foydalanuvchilar botdan obuna bo'la olmaydi. Taklif havolasini qo'shing.";

const duplicate = (title: string): ApiError => new ApiError(`«${title}» kanali allaqachon qo'shilgan`, 409, { code: "duplicate" });

/**
 * POST `{input, title?, inviteLink?, joinBonus, stayBonus?, stayDays?, active?, mandatory?, sort?, reason?}`. Every field
 * is validated before Telegram is called; the chat is then resolved on the server, inserted
 * (`sort` defaults to the end of the list) and audited in one transaction. A soft-deleted row with
 * the same chat id is RESTORED with the request's values (same id, its claims kept — nobody who
 * already claimed is paid again), audited as `bonus_channel.restore`, `restored: true`.
 */
export async function createBonusChannel(admin: AuditActor, body: Record<string, unknown>): Promise<CreateResult> {
  const ref = parseChannelRef(body.input);
  const override = body.title === undefined || body.title === null || body.title === "" ? null : parseTitle(body.title);
  const inviteLink = parseInviteLink(body.inviteLink);
  const joinBonus = parseAmount(body.joinBonus, "Obuna bonusi");
  const stayBonus = body.stayBonus === undefined ? 0 : parseAmount(body.stayBonus, "Qolish bonusi");
  const stayDays = body.stayDays === undefined ? 7 : parseStayDays(body.stayDays);
  const active = body.active === undefined ? true : parseActive(body.active);
  const mandatory = body.mandatory === undefined ? false : parseMandatory(body.mandatory);
  const sort = body.sort === undefined ? null : parseSort(body.sort);
  const reason = parseReason(body.reason, { optional: true });
  assertSomeBonus(joinBonus, stayBonus, mandatory);

  const resolved = await resolveChannel(ref);
  const title = override ?? resolved.title;
  const values = { username: resolved.username, inviteLink, title, joinBonus, stayBonus, stayDays, active, mandatory };
  const meta = { telegramTitle: resolved.title, type: resolved.type, botAdmin: resolved.botAdmin };
  // The end of the list counts live channels only.
  const nextSort = "(SELECT COALESCE(max(sort), 0) + 1 FROM bonus_channels WHERE deleted_at IS NULL)";

  const { id, restored } = await adminTx(admin, async (client, audit) => {
    const ins = await client.query<{ id: string; sort: number }>(
      `INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, active, sort, invite_link, mandatory)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::int, ${nextSort}), $9, $10)
       ON CONFLICT (chat_id) DO NOTHING
       RETURNING id::text AS id, sort`,
      [resolved.chatId, resolved.username, title, joinBonus, stayBonus, stayDays, active, sort, inviteLink, mandatory],
    );
    const row = ins.rows[0];
    if (row) {
      await audit({
        action: "bonus_channel.create",
        targetType: "bonus_channel",
        targetId: row.id,
        reason,
        after: { chatId: resolved.chatId, ...values, sort: row.sort },
        meta,
      });
      return { id: row.id, restored: false };
    }
    // The chat id is taken: a live channel is a duplicate, a soft-deleted one comes back (locked first).
    const old = await client.query<{
      id: string;
      deleted_at: Date | null;
      username: string | null;
      invite_link: string | null;
      title: string;
      join_bonus: number;
      stay_bonus: number;
      stay_days: number;
      active: boolean;
      mandatory: boolean;
      sort: number;
    }>(
      `SELECT id::text AS id, deleted_at, username, invite_link, title, join_bonus, stay_bonus, stay_days, active, mandatory, sort
         FROM bonus_channels WHERE chat_id = $1 FOR UPDATE`,
      [resolved.chatId],
    );
    const p = old.rows[0];
    // Gone between the INSERT and this read (a concurrent hard delete cannot happen any more): retry-able 409.
    if (!p) throw duplicate(title);
    if (p.deleted_at === null) throw duplicate(p.title);
    const upd = await client.query<{ sort: number }>(
      `UPDATE bonus_channels
          SET deleted_at = NULL, username = $2, title = $3, join_bonus = $4, stay_bonus = $5, stay_days = $6, active = $7,
              sort = COALESCE($8::int, ${nextSort}), invite_link = $9, mandatory = $10, updated_at = now()
        WHERE id = $1
        RETURNING sort`,
      [p.id, resolved.username, title, joinBonus, stayBonus, stayDays, active, sort, inviteLink, mandatory],
    );
    const claims = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM bonus_channel_claims WHERE channel_id = $1", [p.id]);
    await audit({
      action: "bonus_channel.restore",
      targetType: "bonus_channel",
      targetId: p.id,
      reason,
      before: {
        username: p.username,
        inviteLink: p.invite_link,
        title: p.title,
        joinBonus: p.join_bonus,
        stayBonus: p.stay_bonus,
        stayDays: p.stay_days,
        active: p.active,
        mandatory: p.mandatory,
        sort: p.sort,
        deletedAt: p.deleted_at.toISOString(),
      },
      after: { chatId: resolved.chatId, ...values, sort: upd.rows[0]!.sort },
      meta: { ...meta, claims: claims.rows[0]?.n ?? 0 },
    });
    return { id: p.id, restored: true };
  });
  return { item: await itemOf(id), botAdmin: resolved.botAdmin, warning: resolved.warning, restored };
}

const EDITABLE = ["title", "username", "inviteLink", "joinBonus", "stayBonus", "stayDays", "active", "mandatory", "sort"] as const;

const USERNAME_HELP = "Username @nom yoki t.me/nom ko'rinishida bo'lishi kerak (5–32 belgi: lotin harflari, raqam, _)";

/**
 * The `username` of a PATCH: `@name`, `name` or a `t.me/name` link → the bare name; `null` / `""` → `null`
 * (a private channel). A numeric id, an invite link or junk is 400 `username`.
 */
export function parseUsernameInput(raw: unknown): string | null {
  if (raw === null || (typeof raw === "string" && !raw.trim())) return null;
  let ref: ChannelRef;
  try {
    ref = parseChannelRef(raw);
  } catch {
    throw bad(USERNAME_HELP, "username");
  }
  if (ref.kind !== "username") throw bad(USERNAME_HELP, "username");
  return ref.username;
}

/**
 * A typed username → Telegram's spelling of it, checked to be the SAME chat as the stored row (the chat id is
 * the channel's identity: a username only names it). The name as stored (any case) needs no Bot API call.
 * Throws 404 (unknown / deleted row), 400 `chat_not_found` / `chat_type`, 503, 409 `chat_mismatch`.
 */
async function verifiedUsername(id: string, username: string): Promise<string> {
  const row = await queryOne<{ chat_id: string; username: string | null }>(
    "SELECT chat_id::text AS chat_id, username FROM bonus_channels WHERE id = $1 AND deleted_at IS NULL",
    [id],
  );
  if (!row) throw notFound();
  if (row.username && row.username.toLowerCase() === username.toLowerCase()) return row.username;
  const chat = await channelChat({ kind: "username", username });
  if (String(chat.id) !== row.chat_id) {
    const name = typeof chat.title === "string" && chat.title.trim() ? chat.title.trim().slice(0, MAX_TITLE) : `@${username}`;
    throw new ApiError(`Bu boshqa kanal: «${name}» (@${username}). Bu yerga faqat shu kanalning yangi username'ini kiriting.`, 409, {
      code: "chat_mismatch",
    });
  }
  return typeof chat.username === "string" && chat.username ? chat.username : username;
}

/**
 * PATCH `{title?, username?, inviteLink? (null / "" clears it), joinBonus?, stayBonus?, stayDays?, active?, mandatory?, sort?, reason?}`:
 * only the given fields change; before/after of the audit row hold only the fields that really changed.
 *
 * `username`: a new name is verified through Telegram BEFORE the transaction (same chat id, else 409
 * `chat_mismatch`, nothing written). `null` / `""` makes the channel private: allowed only when the row (after
 * this patch) has an invite link — the bot's only way to send users there — else 400 `invite_needed`. That rule
 * needs no Bot API call; «Telegramdan yangilash» is the way to take Telegram's own answer.
 */
export async function updateBonusChannel(admin: AuditActor, rawId: unknown, body: Record<string, unknown>): Promise<{ item: BonusChannelItem }> {
  const id = parseChannelId(rawId);
  const patch: Partial<Snapshot> = {};
  if (body.title !== undefined) patch.title = parseTitle(body.title);
  const username = body.username !== undefined ? parseUsernameInput(body.username) : undefined;
  if (body.inviteLink !== undefined) patch.inviteLink = parseInviteLink(body.inviteLink);
  if (body.joinBonus !== undefined) patch.joinBonus = parseAmount(body.joinBonus, "Obuna bonusi");
  if (body.stayBonus !== undefined) patch.stayBonus = parseAmount(body.stayBonus, "Qolish bonusi");
  if (body.stayDays !== undefined) patch.stayDays = parseStayDays(body.stayDays);
  if (body.active !== undefined) patch.active = parseActive(body.active);
  if (body.mandatory !== undefined) patch.mandatory = parseMandatory(body.mandatory);
  if (body.sort !== undefined) patch.sort = parseSort(body.sort);
  const reason = parseReason(body.reason, { optional: true });
  if (Object.keys(patch).length === 0 && username === undefined) throw bad("O'zgartiriladigan maydon yo'q");
  // Telegram is asked outside the transaction: no row lock is held over a network call.
  if (username !== undefined) patch.username = username === null ? null : await verifiedUsername(id, username);

  await adminTx(admin, async (client, audit) => {
    const prev = await lockChannel(client, id);
    const next: Snapshot = {
      title: patch.title ?? prev.title,
      username: patch.username !== undefined ? patch.username : prev.username,
      inviteLink: patch.inviteLink !== undefined ? patch.inviteLink : prev.inviteLink,
      joinBonus: patch.joinBonus ?? prev.joinBonus,
      stayBonus: patch.stayBonus ?? prev.stayBonus,
      stayDays: patch.stayDays ?? prev.stayDays,
      active: patch.active ?? prev.active,
      mandatory: patch.mandatory ?? prev.mandatory,
      sort: patch.sort ?? prev.sort,
    };
    if (patch.username === null && prev.username !== null && next.inviteLink === null) {
      throw bad("Yopiq kanal (username'siz) uchun avval taklif havolasini kiriting — aks holda foydalanuvchilar obuna bo'la olmaydi", "invite_needed");
    }
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (prev[k] !== next[k]) {
        before[k] = prev[k];
        after[k] = next[k];
      }
    }
    if (Object.keys(after).length === 0) throw new ApiError("O'zgarish yo'q — qiymatlar allaqachon shunday", 409, { code: "state" });
    assertSomeBonus(next.joinBonus, next.stayBonus, next.mandatory);
    await client.query(
      `UPDATE bonus_channels
          SET title = $2, join_bonus = $3, stay_bonus = $4, stay_days = $5, active = $6, sort = $7, invite_link = $8,
              mandatory = $9, username = $10, updated_at = now()
        WHERE id = $1`,
      [id, next.title, next.joinBonus, next.stayBonus, next.stayDays, next.active, next.sort, next.inviteLink, next.mandatory, next.username],
    );
    await audit({ action: "bonus_channel.update", targetType: "bonus_channel", targetId: id, reason, before, after });
  });
  return { item: await itemOf(id) };
}

export type RefreshResult = {
  item: BonusChannelItem;
  /** Whether the stored username changed (an audit row was written). */
  changed: boolean;
  /** Telegram's current title — shown, never stored (the admin's title stays). */
  telegramTitle: string;
  /** Set when the channel is private now and has no invite link (`PRIVATE_NO_LINK_WARNING`). */
  warning: string | null;
};

/**
 * POST «Telegramdan yangilash»: `getChat(chat_id)` → the stored `username` becomes Telegram's current one (`null`
 * for a channel without a public username). The admin-editable title is left alone; Telegram's title is returned
 * for the UI. No change → the item as it is, no audit row; a change → `bonus_channel.refresh` (before/after).
 */
export async function refreshBonusChannel(admin: AuditActor, rawId: unknown): Promise<RefreshResult> {
  const id = parseChannelId(rawId);
  const row = await queryOne<{ chat_id: string }>("SELECT chat_id::text AS chat_id FROM bonus_channels WHERE id = $1 AND deleted_at IS NULL", [id]);
  if (!row) throw notFound();
  const chat = await channelChat({ kind: "id", chatId: row.chat_id });
  if (String(chat.id) !== row.chat_id) throw new ApiError("Telegram boshqa chatni qaytardi", 409, { code: "chat_mismatch" });
  const username = typeof chat.username === "string" && chat.username ? chat.username : null;
  const telegramTitle = (typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : (username ?? row.chat_id)).slice(0, MAX_TITLE);

  const changed = await adminTx(admin, async (client, audit) => {
    const prev = await lockChannel(client, id);
    if (prev.username === username) return false;
    await client.query("UPDATE bonus_channels SET username = $2, updated_at = now() WHERE id = $1", [id, username]);
    await audit({
      action: "bonus_channel.refresh",
      targetType: "bonus_channel",
      targetId: id,
      before: { username: prev.username },
      after: { username },
      meta: { telegramTitle },
    });
    return true;
  });
  const item = await itemOf(id);
  return { item, changed, telegramTitle, warning: item.username === null && item.inviteLink === null ? PRIVATE_NO_LINK_WARNING : null };
}

/**
 * DELETE `{reason?}`: a soft delete (migration 051), always allowed. Under the row lock: `deleted_at = now()`,
 * `active = false`. Claims and the ledger stay — they are the «never pay twice» guard, and re-adding the same chat
 * restores this row. A concurrent claim (its FK takes `FOR KEY SHARE` on the row) either commits first and is kept,
 * or runs after and finds the channel inactive (`payJoin` re-reads it). A deleted / unknown channel is the coded 404.
 */
export async function deleteBonusChannel(admin: AuditActor, rawId: unknown, body: Record<string, unknown>): Promise<{ id: string; deleted: true }> {
  const id = parseChannelId(rawId);
  const reason = parseReason(body.reason, { optional: true });
  await adminTx(admin, async (client, audit) => {
    const prev = await lockChannel(client, id);
    await client.query("UPDATE bonus_channels SET deleted_at = now(), active = false, updated_at = now() WHERE id = $1", [id]);
    await audit({ action: "bonus_channel.delete", targetType: "bonus_channel", targetId: id, reason, before: prev });
  });
  return { id, deleted: true };
}

/**
 * POST `{input}` («Havola yaratish»): `getChat` first — only a channel / supergroup (400 `chat_type`
 * otherwise, nothing created) — then asks Telegram for a NEW invite link of that chat id
 * (`createChatInviteLink`; the bot must be an admin with the «invite users via link» right).
 * Nothing is stored — the dialog puts the link into its field and the admin saves it — but the
 * Telegram-side effect is audited (`bonus_channel.invite_create`, meta = the link).
 */
export async function createInviteLink(admin: AuditActor, body: Record<string, unknown>): Promise<{ inviteLink: string }> {
  const ref = parseChannelRef(body.input);
  const chatId = String((await channelChat(ref)).id);
  const r = await callBot<{ invite_link?: string }>("createChatInviteLink", { chat_id: chatId, name: "SlaydX bonus" });
  if (!r.ok) {
    if (isTransientBotFailure(r)) {
      throw new ApiError("Telegram javob bermadi — birozdan keyin qayta urinib ko'ring", 503, { code: "telegram_unavailable" });
    }
    throw new ApiError(
      "Bot havola yarata olmadi: botni kanalga admin qiling va unga «Taklif havolalari orqali qo'shish» huquqini bering.",
      400,
      { code: "invite_rights" },
    );
  }
  let inviteLink: string | null = null;
  try {
    inviteLink = parseInviteLink(r.result.invite_link);
  } catch {
    inviteLink = null;
  }
  if (!inviteLink) throw new ApiError("Telegram noto'g'ri havola qaytardi", 502, { code: "telegram_unavailable" });
  const link = inviteLink;
  await adminTx(admin, async (_client, audit) => {
    await audit({ action: "bonus_channel.invite_create", targetType: "bonus_channel_chat", targetId: chatId, meta: { inviteLink: link } });
  });
  return { inviteLink: link };
}
