import "server-only";
import { ApiError } from "./api";
import { query, queryOne } from "./db";
import { log } from "./log";
import { channelInviteLink, channelUsername, chatMemberStatus, type MemberStatus } from "./bonus-channels";

/**
 * Mandatory channels (docs/bonus/BONUS3.md C-Q2, C-Q3; package D2).
 *
 * An ACTIVE `bonus_channels` row with `mandatory = true` must be joined before the user creates
 * new work. The ONE gate is `assertCanCreate`, called by `POST /api/generations` (the only path
 * that charges and enqueues work; the bot creates no work itself — its tool buttons open the web
 * app) before anything is priced, charged or queued. Files, profile and wallet stay available.
 *
 *   - no active mandatory channel           → nothing to check;
 *   - the user has an admin account (any status but `disabled`) → exempt: admins must be able
 *     to test the product without joining (owner decision, D2 brief);
 *   - the user has no `telegram_id` (phone login) → `needsTelegram` (C-Q3): log in with Telegram
 *     first, then the subscription is checked;
 *   - else one `getChatMember` per mandatory channel, cached in THIS process per
 *     (Telegram user, chat): a member for POSITIVE_TTL_MS (10 min), a non-member for
 *     NEGATIVE_TTL_MS (1 min). A `chat_member` update for the pair (join or leave) drops the
 *     entry (`forgetMembership`, webhook), and «✅ Tekshirish» re-checks without the negative
 *     entries (`fresh`).
 *
 * FAIL OPEN: a Bot API error / no answer (`unknown` — the bot is not an admin of the channel,
 * Telegram is down, 429) never blocks the user; it is not cached and is logged once per channel
 * until that channel answers again. A broken channel setup must not stop all paid work.
 */

export const POSITIVE_TTL_MS = 10 * 60_000;
export const NEGATIVE_TTL_MS = 60_000;
/** Upper bound of the per-process cache (oldest entries are dropped first). */
export const CACHE_MAX = 50_000;

export type MandatoryChannel = {
  id: string;
  title: string;
  /** t.me/<username>, else the admin-set invite link, else `null` (the UI then shows the title only). */
  joinUrl: string | null;
};

export type MandatoryCheck = {
  /** The user has an admin account: never blocked. */
  exempt: boolean;
  /** No Telegram on the account while mandatory channels exist (C-Q3). */
  needsTelegram: boolean;
  /** Mandatory channels the user still has to join (every active one when `needsTelegram`). */
  channels: MandatoryChannel[];
};

export type MandatoryDeps = {
  member?: (chatId: string, telegramId: string) => Promise<MemberStatus>;
  now?: () => number;
  /** Ignore cached NON-member answers («✅ Tekshirish»). */
  fresh?: boolean;
};

type Entry = { member: boolean; until: number };
const cache = new Map<string, Entry>();
/** Channels whose `unknown` answer was already logged (cleared once the channel answers again). */
const loggedUnknown = new Set<string>();

const keyOf = (telegramId: string, chatId: string) => `${telegramId}:${chatId}`;

function remember(key: string, member: boolean, now: number): void {
  cache.delete(key);
  cache.set(key, { member, until: now + (member ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** A `chat_member` update (join or leave) for this pair: the next check asks Telegram again. */
export function forgetMembership(telegramId: number | string, chatId: number | string): void {
  cache.delete(keyOf(String(telegramId), String(chatId)));
}

/** Tests only: an empty cache and log memory. */
export function resetMandatoryCache(): void {
  cache.clear();
  loggedUnknown.clear();
}

type ChannelRow = { id: string; chat_id: string; title: string; username: string | null; invite_link: string | null };

function publicChannel(r: ChannelRow): MandatoryChannel {
  const u = channelUsername(r.username);
  return { id: r.id, title: r.title, joinUrl: u ? `https://t.me/${u}` : channelInviteLink(r.invite_link) };
}

/** Active mandatory channels, in the admin's order. */
export async function activeMandatoryChannels(): Promise<(MandatoryChannel & { chatId: string })[]> {
  const rows = await query<ChannelRow>(
    `SELECT id::text AS id, chat_id::text AS chat_id, title, username, invite_link
       FROM bonus_channels WHERE active AND mandatory ORDER BY sort, id`,
  );
  return rows.map((r) => ({ ...publicChannel(r), chatId: r.chat_id }));
}

async function isMember(chatId: string, telegramId: string, deps: MandatoryDeps): Promise<boolean> {
  const now = (deps.now ?? Date.now)();
  const key = keyOf(telegramId, chatId);
  const hit = cache.get(key);
  if (hit && hit.until > now && (hit.member || !deps.fresh)) return hit.member;
  const status = await (deps.member ?? chatMemberStatus)(chatId, telegramId);
  if (status === "unknown") {
    if (!loggedUnknown.has(chatId)) {
      loggedUnknown.add(chatId);
      log("warn", "[mandatory] membership unknown — not blocking (fail open)", { chatId });
    }
    return true;
  }
  loggedUnknown.delete(chatId);
  remember(key, status === "member", now);
  return status === "member";
}

/**
 * What still stands between the user and new work (see the module comment). Never throws on a
 * Bot API failure (fail open); a database error propagates.
 */
export async function missingMandatory(userId: string, deps: MandatoryDeps = {}): Promise<MandatoryCheck> {
  const channels = await activeMandatoryChannels();
  if (!channels.length) return { exempt: false, needsTelegram: false, channels: [] };
  const user = await queryOne<{ telegram_id: string | null; admin: boolean }>(
    `SELECT u.telegram_id::text AS telegram_id,
            EXISTS (SELECT 1 FROM admin_accounts a WHERE a.user_id = u.id AND a.status <> 'disabled') AS admin
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!user) return { exempt: false, needsTelegram: true, channels: channels.map(strip) };
  if (user.admin) return { exempt: true, needsTelegram: false, channels: [] };
  if (!user.telegram_id) return { exempt: false, needsTelegram: true, channels: channels.map(strip) };
  const tg = user.telegram_id;
  const member = await Promise.all(channels.map((c) => isMember(c.chatId, tg, deps)));
  return { exempt: false, needsTelegram: false, channels: channels.filter((_, i) => !member[i]).map(strip) };
}

function strip(c: MandatoryChannel & { chatId: string }): MandatoryChannel {
  return { id: c.id, title: c.title, joinUrl: c.joinUrl };
}

/** Whether the check lets the user create new work. */
export function canCreate(c: MandatoryCheck): boolean {
  return c.exempt || (!c.needsTelegram && c.channels.length === 0);
}

export const CHANNEL_REQUIRED_MESSAGE = "Avval kanalga obuna bo‘ling";
export const TELEGRAM_REQUIRED_MESSAGE = "Yangi ish yaratish uchun Telegram orqali kiring";

/**
 * THE gate (POST /api/generations, before pricing / charging / enqueueing): 403
 * `telegram_required` or `channel_required` with the channels to join.
 */
export async function assertCanCreate(userId: string, deps: MandatoryDeps = {}): Promise<void> {
  const c = await missingMandatory(userId, deps);
  if (canCreate(c)) return;
  if (c.needsTelegram) throw new ApiError(TELEGRAM_REQUIRED_MESSAGE, 403, { code: "telegram_required", channels: c.channels });
  throw new ApiError(CHANNEL_REQUIRED_MESSAGE, 403, { code: "channel_required", channels: c.channels });
}
