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
 *     writes `bonus_channel.create` in the same transaction; a known chat id is 409 `duplicate`;
 *   - update: title override, amounts, stay days, active, sort; only changed fields go into
 *     the `bonus_channel.update` audit row (before/after); no change is 409 `state`;
 *   - invite link (migration 042): optional `https://t.me/+…` / `…/joinchat/…`, stored normalized
 *     as `https://t.me/+<hash>`; the bot uses it for private channels (no `username`).
 *     `createInviteLink` asks Telegram for a new one (audited, not stored);
 *   - delete: only without claims (409 `has_claims` otherwise — deactivate instead). The row
 *     is locked `FOR UPDATE` before the claims count: a concurrent claim insert needs a
 *     `FOR KEY SHARE` lock on the channel row (FK), so it waits for this transaction and then
 *     fails on the FK, and the claims FK's `ON DELETE CASCADE` can never drop a paid claim.
 *
 * Validation: amounts are JSON integers 0..20 000 per channel (`MAX_BONUS`, review cap; the DB CHECK allows
 * 1 000 000) with at least one > 0, `stayDays` 1..365,
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
  /** Joined, not left, stay bonus not settled yet (the worker sweep's queue). */
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
  /** Id of the channel row that already has this chat id (`null` when new). */
  existingId: string | null;
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

function assertSomeBonus(joinBonus: number, stayBonus: number): void {
  if (joinBonus === 0 && stayBonus === 0) throw bad("Kamida bitta bonus 0 dan katta bo'lishi kerak");
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

/** `getChat` + type check + bot admin status. Throws 503 / 400 with a code the UI can show. */
export async function resolveChannel(ref: ChannelRef): Promise<ResolvedChannel> {
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
  const chatId = String(chat.id);
  const username = typeof chat.username === "string" && chat.username ? chat.username : null;
  const title = (typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : username ?? chatId).slice(0, MAX_TITLE);
  const botAdmin = await botAdminStatus(chatId);
  const existing = await queryOne<{ id: string }>("SELECT id::text AS id FROM bonus_channels WHERE chat_id = $1", [chatId]);
  return { chatId, title, username, type: chat.type, botAdmin, warning: botWarning(botAdmin), existingId: existing?.id ?? null };
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

const SELECT = `
  SELECT c.id::text AS id, c.chat_id::text AS chat_id, c.username, c.invite_link, c.title, c.join_bonus, c.stay_bonus,
         c.stay_days, c.active, c.sort, c.created_at, c.updated_at,
         COALESCE(s.joined, 0)::int AS joined,
         COALESCE(s.join_paid_count, 0)::int AS join_paid_count,
         COALESCE(s.join_paid_sum, 0)::text AS join_paid_sum,
         COALESCE(s.stay_paid_count, 0)::int AS stay_paid_count,
         COALESCE(s.stay_paid_sum, 0)::text AS stay_paid_sum,
         COALESCE(s.left_count, 0)::int AS left_count,
         COALESCE(s.stay_pending, 0)::int AS stay_pending
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
    ) s ON s.channel_id = c.id`;

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
  const row = await queryOne<Row>(`${SELECT} WHERE c.id = $1`, [id]);
  if (!row) throw notFound();
  return toItem(row);
}

/** Bot admin status of a stored channel (the table's «Qayta tekshirish»). */
export async function channelBotStatus(rawId: unknown): Promise<{ id: string; botAdmin: BotAdminStatus; warning: string | null }> {
  const id = parseChannelId(rawId);
  const row = await queryOne<{ chat_id: string }>("SELECT chat_id::text AS chat_id FROM bonus_channels WHERE id = $1", [id]);
  if (!row) throw notFound();
  requireBot();
  const botAdmin = await botAdminStatus(row.chat_id);
  return { id, botAdmin, warning: botWarning(botAdmin) };
}

/* ───────────────────────────── mutations ───────────────────────────── */

type Snapshot = {
  title: string;
  inviteLink: string | null;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  active: boolean;
  sort: number;
};

type LockedRow = Snapshot & { chatId: string; username: string | null };

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
    sort: number;
  }>(
    `SELECT chat_id::text AS chat_id, username, invite_link, title, join_bonus, stay_bonus, stay_days, active, sort
       FROM bonus_channels WHERE id = $1 FOR UPDATE`,
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
    sort: row.sort,
  };
}

export type CreateResult = { item: BonusChannelItem; botAdmin: BotAdminStatus; warning: string | null };

/**
 * POST `{input, title?, inviteLink?, joinBonus, stayBonus?, stayDays?, active?, sort?, reason?}`. Every field
 * is validated before Telegram is called; the chat is then resolved on the server, inserted
 * (`sort` defaults to the end of the list) and audited in one transaction.
 */
export async function createBonusChannel(admin: AuditActor, body: Record<string, unknown>): Promise<CreateResult> {
  const ref = parseChannelRef(body.input);
  const override = body.title === undefined || body.title === null || body.title === "" ? null : parseTitle(body.title);
  const inviteLink = parseInviteLink(body.inviteLink);
  const joinBonus = parseAmount(body.joinBonus, "Obuna bonusi");
  const stayBonus = body.stayBonus === undefined ? 0 : parseAmount(body.stayBonus, "Qolish bonusi");
  const stayDays = body.stayDays === undefined ? 7 : parseStayDays(body.stayDays);
  const active = body.active === undefined ? true : parseActive(body.active);
  const sort = body.sort === undefined ? null : parseSort(body.sort);
  const reason = parseReason(body.reason, { optional: true });
  assertSomeBonus(joinBonus, stayBonus);

  const resolved = await resolveChannel(ref);
  const title = override ?? resolved.title;

  const id = await adminTx(admin, async (client, audit) => {
    const ins = await client.query<{ id: string; sort: number }>(
      `INSERT INTO bonus_channels (chat_id, username, title, join_bonus, stay_bonus, stay_days, active, sort, invite_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::int, (SELECT COALESCE(max(sort), 0) + 1 FROM bonus_channels)), $9)
       ON CONFLICT (chat_id) DO NOTHING
       RETURNING id::text AS id, sort`,
      [resolved.chatId, resolved.username, title, joinBonus, stayBonus, stayDays, active, sort, inviteLink],
    );
    const row = ins.rows[0];
    if (!row) throw new ApiError("Bu kanal allaqachon qo'shilgan", 409, { code: "duplicate" });
    await audit({
      action: "bonus_channel.create",
      targetType: "bonus_channel",
      targetId: row.id,
      reason,
      after: {
        chatId: resolved.chatId,
        username: resolved.username,
        inviteLink,
        title,
        joinBonus,
        stayBonus,
        stayDays,
        active,
        sort: row.sort,
      },
      meta: { telegramTitle: resolved.title, type: resolved.type, botAdmin: resolved.botAdmin },
    });
    return row.id;
  });
  return { item: await itemOf(id), botAdmin: resolved.botAdmin, warning: resolved.warning };
}

const EDITABLE = ["title", "inviteLink", "joinBonus", "stayBonus", "stayDays", "active", "sort"] as const;

/**
 * PATCH `{title?, inviteLink? (null / "" clears it), joinBonus?, stayBonus?, stayDays?, active?, sort?, reason?}`: only the given
 * fields change; before/after of the audit row hold only the fields that really changed.
 */
export async function updateBonusChannel(admin: AuditActor, rawId: unknown, body: Record<string, unknown>): Promise<{ item: BonusChannelItem }> {
  const id = parseChannelId(rawId);
  const patch: Partial<Snapshot> = {};
  if (body.title !== undefined) patch.title = parseTitle(body.title);
  if (body.inviteLink !== undefined) patch.inviteLink = parseInviteLink(body.inviteLink);
  if (body.joinBonus !== undefined) patch.joinBonus = parseAmount(body.joinBonus, "Obuna bonusi");
  if (body.stayBonus !== undefined) patch.stayBonus = parseAmount(body.stayBonus, "Qolish bonusi");
  if (body.stayDays !== undefined) patch.stayDays = parseStayDays(body.stayDays);
  if (body.active !== undefined) patch.active = parseActive(body.active);
  if (body.sort !== undefined) patch.sort = parseSort(body.sort);
  const reason = parseReason(body.reason, { optional: true });
  if (Object.keys(patch).length === 0) throw bad("O'zgartiriladigan maydon yo'q");

  await adminTx(admin, async (client, audit) => {
    const prev = await lockChannel(client, id);
    const next: Snapshot = {
      title: patch.title ?? prev.title,
      inviteLink: patch.inviteLink !== undefined ? patch.inviteLink : prev.inviteLink,
      joinBonus: patch.joinBonus ?? prev.joinBonus,
      stayBonus: patch.stayBonus ?? prev.stayBonus,
      stayDays: patch.stayDays ?? prev.stayDays,
      active: patch.active ?? prev.active,
      sort: patch.sort ?? prev.sort,
    };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (prev[k] !== next[k]) {
        before[k] = prev[k];
        after[k] = next[k];
      }
    }
    if (Object.keys(after).length === 0) throw new ApiError("O'zgarish yo'q — qiymatlar allaqachon shunday", 409, { code: "state" });
    assertSomeBonus(next.joinBonus, next.stayBonus);
    await client.query(
      `UPDATE bonus_channels
          SET title = $2, join_bonus = $3, stay_bonus = $4, stay_days = $5, active = $6, sort = $7, invite_link = $8, updated_at = now()
        WHERE id = $1`,
      [id, next.title, next.joinBonus, next.stayBonus, next.stayDays, next.active, next.sort, next.inviteLink],
    );
    await audit({ action: "bonus_channel.update", targetType: "bonus_channel", targetId: id, reason, before, after });
  });
  return { item: await itemOf(id) };
}

/** DELETE `{reason?}`: allowed only while the channel has no claims (else 409 `has_claims`). */
export async function deleteBonusChannel(admin: AuditActor, rawId: unknown, body: Record<string, unknown>): Promise<{ id: string; deleted: true }> {
  const id = parseChannelId(rawId);
  const reason = parseReason(body.reason, { optional: true });
  await adminTx(admin, async (client, audit) => {
    const prev = await lockChannel(client, id);
    const claims = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM bonus_channel_claims WHERE channel_id = $1", [id]);
    const n = claims.rows[0]?.n ?? 0;
    if (n > 0) {
      throw new ApiError(
        `Bu kanal bo'yicha ${n} ta foydalanuvchi bonus olgan — o'chirib bo'lmaydi. Uning o'rniga faolsizlantiring.`,
        409,
        { code: "has_claims", claims: n },
      );
    }
    await client.query("DELETE FROM bonus_channels WHERE id = $1", [id]);
    await audit({ action: "bonus_channel.delete", targetType: "bonus_channel", targetId: id, reason, before: prev });
  });
  return { id, deleted: true };
}

/**
 * POST `{input}` («Havola yaratish»): asks Telegram for a NEW invite link of the chat
 * (`createChatInviteLink`; the bot must be an admin with the «invite users via link» right).
 * Nothing is stored — the dialog puts the link into its field and the admin saves it — but the
 * Telegram-side effect is audited (`bonus_channel.invite_create`, meta = the link).
 */
export async function createInviteLink(admin: AuditActor, body: Record<string, unknown>): Promise<{ inviteLink: string }> {
  const ref = parseChannelRef(body.input);
  requireBot();
  const chatId = ref.kind === "username" ? `@${ref.username}` : ref.chatId;
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
