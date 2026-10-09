import "server-only";
import { query, queryOne, transaction } from "./db";
import { env } from "./env";
import { topUpInTx } from "./credits";
import { log } from "./log";
import { referralSummary } from "./referrals";
import { botConfigured, botUsername, callBot } from "./telegram";
import { langOf } from "./bot/i18n";
import { joinPaidNotice, stayPaidNotice } from "./bot/bonus";
import { getPaymentBonusPercent, paymentBonusEarned } from "./payment-bonus";

/**
 * Bonus tasks — the user side (docs/bonus/PLAN.md, K1; owner decisions B-Q1..Q4).
 *
 * A channel row (`bonus_channels`, managed in the admin panel) pays
 * `join_bonus` once when the bot sees the user as a member — automatically on
 * the `chat_member` join update (B2-Q2, `recordChannelJoin`), or on «🔄 Yangilash»
 * (`checkChannel` → `getChatMember`), both through `payJoin` — and `stay_bonus`
 * once more after `stay_days` days if the user is still a member (worker
 * sweep). One `bonus_channel_claims` row per (user, channel) — PRIMARY KEY —
 * so a channel pays a user at most once, leaving and re-joining included.
 * Leaving never claws back a paid bonus (B-Q3); leaving before day N only
 * forfeits the unpaid stay bonus: a `chat_member` update marks `left_at` the
 * moment the user leaves (`recordChannelLeave`), and the sweep's own
 * `getChatMember` at day N is the second line.
 *
 * Money: only `credits.topUpInTx` (kind `bonus`) with the unique ledger
 * references `channel:<channel_id>:<user_id>:join` / `:stay`, in the same
 * transaction as the claim row — three independent guards against a double
 * payment: the claim PK (`ON CONFLICT DO NOTHING`), the user row lock inside
 * `topUpInTx`, and `transactions_ref_idx` (kind + reference UNIQUE).
 *
 * Never pays on doubt: a Bot API error is `unknown` (no money, no claim);
 * a blocked account (`users.is_blocked`) is never paid.
 */

/* ───────────────────────── Membership ───────────────────────── */

export type MemberStatus = "member" | "not_member" | "unknown";

/** Statuses of `ChatMember` that count as subscribed. */
const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);

/** Bot API timeout of one `getChatMember` (the default 15 s would stall a sweep). */
const MEMBER_TIMEOUT_MS = 8_000;

/**
 * Is `telegramId` a member of `chatId`? member / administrator / creator →
 * `member`; `restricted` → its `is_member`; left / kicked → `not_member`.
 * Any Bot API failure (bot not an admin there, chat not found, network,
 * 429, 5xx) or an unexpected answer → `unknown`: callers never pay on it.
 */
export async function chatMemberStatus(chatId: number | string, telegramId: number | string): Promise<MemberStatus> {
  const r = await callBot<{ status?: unknown; is_member?: unknown }>(
    "getChatMember",
    { chat_id: String(chatId), user_id: Number(telegramId) },
    { timeoutMs: MEMBER_TIMEOUT_MS },
  );
  if (!r.ok) return "unknown";
  const status = String(r.result?.status ?? "");
  if (MEMBER_STATUSES.has(status)) return "member";
  if (status === "restricted") {
    if (r.result?.is_member === true) return "member";
    if (r.result?.is_member === false) return "not_member";
    return "unknown";
  }
  if (status === "left" || status === "kicked") return "not_member";
  return "unknown";
}

/* ───────────────────────── Tasks (bot screen data) ───────────────────────── */

export type ChannelClaim = { joinedAt: string; joinPaid: number; stayPaid: number | null; leftAt: string | null };

export type ChannelTask = {
  id: string;
  title: string;
  /** Public @username without «@» (a t.me link), or `null`. */
  username: string | null;
  /** Join URL for the «Obuna bo‘lish» button: t.me/<username>, else the admin-set invite link (private channels), else `null`. */
  joinUrl: string | null;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  /** Must be joined before creating new work (C-Q2): listed first, with a 🔒 mark. */
  mandatory: boolean;
  claim: ChannelClaim | null;
};

export type BonusTasks = {
  channels: ChannelTask[];
  referral: { link: string; rewardPoints: number; invitedCount: number; earnedPoints: number };
  /** The sign-up bonus actually booked (`signup:<user>` ledger row), 0 when there is none. */
  signupPoints: number;
  /**
   * The payment bonus (C-Q4, `lib/server/payment-bonus.ts`): the current percent (0 = off) and the
   * points the user earned from payments so far (payment bonuses + the legacy first top-up bonus).
   */
  paymentBonus: { percent: number; earnedPoints: number };
  /** Bonus earned so far: sign-up + channel tasks + invites + payment bonuses (the screen's summary). */
  earnedTotal: number;
  /**
   * Fixed channel bonuses still open: join + stay of channels not joined yet, plus owed stay
   * bonuses of joined channels the user did not leave. Invites (unbounded) and the payment bonus
   * (a share of an amount) are not counted.
   */
  availableTotal: number;
};

/** What the active channels still offer this user (see `BonusTasks.availableTotal`). */
export function channelsAvailable(channels: Pick<ChannelTask, "joinBonus" | "stayBonus" | "claim">[]): number {
  let sum = 0;
  for (const c of channels) {
    if (!c.claim) sum += Math.max(0, c.joinBonus) + Math.max(0, c.stayBonus);
    else if (c.claim.stayPaid === null && !c.claim.leftAt) sum += Math.max(0, c.stayBonus);
  }
  return sum;
}

/** A Telegram public username (5–32; a few legacy ones are 4), or `null`. */
export function channelUsername(raw: string | null | undefined): string | null {
  const u = String(raw ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(u) ? u : null;
}

/** An invite link as the admin panel stores it (`https://t.me/+<hash>`), or `null` — never any other URL. */
export function channelInviteLink(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  return /^https:\/\/t\.me\/\+[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

type TaskRow = {
  id: string;
  title: string;
  username: string | null;
  invite_link: string | null;
  join_bonus: number;
  stay_bonus: number;
  stay_days: number;
  mandatory: boolean;
  joined_at: Date | null;
  join_paid: number | null;
  stay_paid: number | null;
  left_at: Date | null;
};

/**
 * Active channels (mandatory first, then by `sort`, then id) with the user's claim state, plus the
 * referral summary. Owner-scoped: claims are read by `user_id = $1` only.
 */
export async function bonusTasks(
  userId: string,
  links?: { botUsername: string | null; appUrl: string },
): Promise<BonusTasks> {
  const rows = await query<TaskRow>(
    `SELECT ch.id::text AS id, ch.title, ch.username, ch.invite_link, ch.join_bonus, ch.stay_bonus, ch.stay_days, ch.mandatory,
            c.joined_at, c.join_paid, c.stay_paid, c.left_at
       FROM bonus_channels ch
       LEFT JOIN bonus_channel_claims c ON c.channel_id = ch.id AND c.user_id = $1
      WHERE ch.active
      ORDER BY ch.mandatory DESC, ch.sort, ch.id`,
    [userId],
  );
  const earnedRow = await queryOne<{ n: string }>(
    "SELECT COALESCE(sum(join_paid + COALESCE(stay_paid, 0)), 0)::text AS n FROM bonus_channel_claims WHERE user_id = $1",
    [userId],
  );
  const signupRow = await queryOne<{ p: string }>(
    "SELECT points_delta::text AS p FROM transactions WHERE user_id = $1 AND kind = 'bonus' AND reference = $2",
    [userId, `signup:${userId}`],
  );
  const signupPoints = Math.max(0, Number(signupRow?.p ?? 0));
  const paymentBonus = { percent: await getPaymentBonusPercent(), earnedPoints: await paymentBonusEarned(userId) };
  const s = await referralSummary(userId, links ?? { botUsername: await botUsername(), appUrl: env.appUrl });
  const referral = { link: s.botLink ?? s.webLink, rewardPoints: s.rewardPoints, invitedCount: s.invitedCount, earnedPoints: s.earnedPoints };
  const channels: ChannelTask[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    username: channelUsername(r.username),
    joinUrl: channelUsername(r.username) ? `https://t.me/${channelUsername(r.username)}` : channelInviteLink(r.invite_link),
    joinBonus: Number(r.join_bonus),
    stayBonus: Number(r.stay_bonus),
    stayDays: Number(r.stay_days),
    mandatory: r.mandatory === true,
    claim: r.joined_at
      ? {
          joinedAt: new Date(r.joined_at).toISOString(),
          joinPaid: Number(r.join_paid ?? 0),
          stayPaid: r.stay_paid === null ? null : Number(r.stay_paid),
          leftAt: r.left_at ? new Date(r.left_at).toISOString() : null,
        }
      : null,
  }));
  return {
    channels,
    referral,
    signupPoints,
    paymentBonus,
    earnedTotal: Number(earnedRow?.n ?? 0) + referral.earnedPoints + signupPoints + paymentBonus.earnedPoints,
    availableTotal: channelsAvailable(channels),
  };
}

/* ───────────────────────── Join bonus ───────────────────────── */

export function joinRef(channelId: string, userId: string): string {
  return `channel:${channelId}:${userId}:join`;
}
export function stayRef(channelId: string, userId: string): string {
  return `channel:${channelId}:${userId}:stay`;
}

/** Ledger notes (`bot/screens.ts ledgerTitle` reads them back, in the user's language). */
export const JOIN_NOTE_PREFIX = "Kanal obunasi: ";
export const STAY_NOTE_PREFIX = "Kanalda qolish bonusi: ";
const noteTitle = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, 60) || "kanal";

export type CheckResult =
  | { status: "paid"; points: number; title: string; stayBonus: number; stayDays: number }
  | { status: "already" }
  | { status: "not_member" }
  | { status: "inactive" }
  | { status: "unknown" }
  | { status: "blocked" };

type ChannelRow = { id: string; chat_id: string; title: string; join_bonus: number; stay_bonus: number; stay_days: number; active: boolean };

const CHANNEL_COLUMNS = "id::text AS id, chat_id::text AS chat_id, title, join_bonus, stay_bonus, stay_days, active";

/** A channel id from a callback: a positive BIGINT in decimal, else `null`. */
function channelKey(channelId: string | number): string | null {
  const s = String(channelId);
  return /^[1-9]\d{0,17}$/.test(s) ? s : null;
}

/**
 * «🔄 Yangilash» (one channel): is the user a member of the channel → claim row + join
 * bonus, once. Idempotent and race-safe: a second tap, a replayed callback or
 * two concurrent taps pay exactly once (claim PK + ledger reference, in ONE
 * transaction). `telegramId` must be the account's own Telegram id (checked
 * under the user row lock).
 */
export async function checkChannel(userId: string, telegramId: number | string, channelId: string | number): Promise<CheckResult> {
  const key = channelKey(channelId);
  if (!key) return { status: "inactive" };
  const channel = await queryOne<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM bonus_channels WHERE id = $1`, [key]);
  if (!channel || !channel.active) return { status: "inactive" };
  const pre = await queryOne<{ is_blocked: boolean; claimed: boolean }>(
    `SELECT u.is_blocked,
            EXISTS (SELECT 1 FROM bonus_channel_claims c WHERE c.user_id = u.id AND c.channel_id = $2) AS claimed
       FROM users u WHERE u.id = $1`,
    [userId, key],
  );
  if (!pre) return { status: "unknown" };
  if (pre.is_blocked) return { status: "blocked" };
  // Already claimed: no Bot API call at all.
  if (pre.claimed) return { status: "already" };

  const member = await chatMemberStatus(channel.chat_id, telegramId);
  if (member === "not_member") return { status: "not_member" };
  if (member !== "member") return { status: "unknown" };
  return payJoin(userId, telegramId, key);
}

/**
 * The join payment — ONE path for «Yangilash» / `checkChannel` (after `getChatMember`) and for
 * a `chat_member` join update (`recordChannelJoin`). Idempotent and race-safe: concurrent or
 * replayed calls pay exactly once (the user row lock, the claim PK and the unique ledger
 * reference, all in ONE transaction). `telegramId` must be the account's own Telegram id
 * (checked under the user row lock); a blocked account or an inactive channel is never paid.
 */
async function payJoin(userId: string, telegramId: number | string, key: string): Promise<CheckResult> {
  return transaction(async (client): Promise<CheckResult> => {
    // The user row lock first (the same order as `topUpInTx`): concurrent taps queue here.
    const u = await client.query<{ is_blocked: boolean; telegram_id: string | null }>(
      "SELECT is_blocked, telegram_id::text AS telegram_id FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const user = u.rows[0];
    if (!user || user.telegram_id !== String(telegramId)) return { status: "unknown" };
    if (user.is_blocked) return { status: "blocked" };
    // Re-read the channel under a share lock: an admin deactivating / editing it waits or wins cleanly.
    const ch = (await client.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM bonus_channels WHERE id = $1 FOR SHARE`, [key])).rows[0];
    if (!ch || !ch.active) return { status: "inactive" };
    const points = Number(ch.join_bonus);
    // No stay bonus on this channel: the claim is settled at once (`stay_paid = 0`), so it never
    // enters the sweep's partial index (`stay_paid IS NULL AND left_at IS NULL`).
    const stayPaid = Number(ch.stay_bonus) > 0 ? null : 0;
    const inserted = await client.query(
      `INSERT INTO bonus_channel_claims (user_id, channel_id, join_paid, stay_paid)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, channel_id) DO NOTHING
       RETURNING 1`,
      [userId, key, points, stayPaid],
    );
    if (!inserted.rowCount) return { status: "already" };
    if (points > 0) {
      const paid = await topUpInTx(client, userId, { points }, joinRef(key, userId), "bonus", `${JOIN_NOTE_PREFIX}${noteTitle(ch.title)}`);
      // The claim row is new, so the ledger reference must be too: anything else is a broken invariant.
      if (!paid) throw new Error(`bonus ledger row already exists: ${joinRef(key, userId)}`);
    }
    log("info", "[bonus] channel join", { userId, channelId: key, points });
    return { status: "paid", points, title: ch.title, stayBonus: Number(ch.stay_bonus), stayDays: Number(ch.stay_days) };
  });
}

/* ───────────────────────── Joining (chat_member updates) ───────────────────────── */

export type JoinPaid = Extract<CheckResult, { status: "paid" }>;

/** member / administrator / creator, or `restricted` with `is_member: true` — the user is in the chat. */
export function isJoinStatus(m: ChatMemberUpdate["new_chat_member"]): boolean {
  const status = String(m?.status ?? "");
  if (MEMBER_STATUSES.has(status)) return true;
  return status === "restricted" && m?.is_member === true;
}

export type JoinDeps = {
  /** The «+N so‘m bonus» message (default: `sendMessage` to the user's private chat). */
  notify?: (telegramId: string, lang: string, paid: JoinPaid) => Promise<void>;
};

async function notifyJoin(telegramId: string, lang: string, paid: JoinPaid): Promise<void> {
  const screen = joinPaidNotice(langOf(lang), paid);
  // No `message_effect_id`: the Bot API documents the parameter but publishes no effect ids to rely on.
  const r = await callBot("sendMessage", {
    chat_id: telegramId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(screen.reply_markup ? { reply_markup: screen.reply_markup } : {}),
  });
  // Best effort: the money is already in the wallet; a user who blocked the bot just gets no message.
  if (!r.ok) log("warn", "[bonus] join notice not sent", { code: r.code });
}

/**
 * B2-Q2: a Telegram `chat_member` update in which a user JOINS an active bonus channel
 * (matched by `chat_id`) pays the join bonus automatically — the same `payJoin` path as
 * «Yangilash» (one claim row, unique ledger reference), so a replayed update, a second join
 * or a concurrent «Yangilash» pays nothing more. The update itself is the membership proof
 * (it reaches us only through the secret-checked webhook), so there is no `getChatMember`.
 * Paid now (and > 0) → one message to the user. Bots, unknown / blocked users, unknown or
 * inactive chats and unsafe ids → `null`, nothing happens. Never throws: a failure is logged
 * («🔄 Yangilash» is the fallback), so the webhook always answers.
 */
export async function recordChannelJoin(u: ChatMemberUpdate, deps: JoinDeps = {}): Promise<CheckResult | null> {
  try {
    const m = u.new_chat_member;
    if (!isJoinStatus(m)) return null;
    const chatId = u.chat?.id;
    const tgId = m?.user?.id;
    // A JSON number above 2^53 is already rounded to a different id: never act on it.
    if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(tgId) || m?.user?.is_bot) return null;
    const channel = await queryOne<{ id: string }>("SELECT id::text AS id FROM bonus_channels WHERE chat_id = $1 AND active", [String(chatId)]);
    if (!channel) return null;
    const user = await queryOne<{ id: string; is_blocked: boolean; language: string | null }>(
      "SELECT id::text AS id, is_blocked, language FROM users WHERE telegram_id = $1",
      [String(tgId)],
    );
    if (!user || user.is_blocked) return null;
    const r = await payJoin(user.id, String(tgId), channel.id);
    if (r.status === "paid" && r.points > 0) {
      try {
        await (deps.notify ?? notifyJoin)(String(tgId), user.language ?? "uz", r);
      } catch (e) {
        log("warn", "[bonus] join notice failed", { err: e });
      }
    }
    return r;
  } catch (e) {
    log("error", "[bonus] chat_member join failed", { err: e });
    return null;
  }
}

/* ───────────────────────── Leaving (chat_member updates) ───────────────────────── */

/** The parts of a Bot API `ChatMemberUpdated` this module reads. */
export type ChatMemberUpdate = {
  chat: { id: number; type?: string };
  new_chat_member?: { status?: string; is_member?: boolean; user?: { id: number; is_bot?: boolean } };
};

/** `left` / `kicked`, or `restricted` with `is_member: false` — the user is no longer in the chat. */
export function isLeaveStatus(m: ChatMemberUpdate["new_chat_member"]): boolean {
  const status = String(m?.status ?? "");
  if (status === "left" || status === "kicked") return true;
  return status === "restricted" && m?.is_member === false;
}

/**
 * A Telegram `chat_member` update (the webhook's `allowed_updates` must include it; the bot
 * must be an admin of the chat): when a user leaves a bonus channel (active or not, matched by
 * `chat_id`), their claim gets `left_at = now()` while the stay bonus is unpaid — leaving
 * before day N forfeits it (B-Q3), even if they re-join before the sweep looks. Re-joining
 * never clears `left_at`. Unknown users / chats and joins change nothing; a replay keeps the
 * first `left_at`. Returns the number of claims marked (0 or 1). No reply to anyone.
 */
export async function recordChannelLeave(u: ChatMemberUpdate): Promise<number> {
  const m = u.new_chat_member;
  if (!isLeaveStatus(m)) return 0;
  const chatId = u.chat?.id;
  const userId = m?.user?.id;
  // A JSON number above 2^53 is already rounded to a different id: never act on it.
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId) || m?.user?.is_bot) return 0;
  const rows = await query<{ channel_id: string }>(
    `UPDATE bonus_channel_claims c
        SET left_at = now()
       FROM bonus_channels ch, users u
      WHERE ch.chat_id = $1 AND c.channel_id = ch.id
        AND u.telegram_id = $2 AND c.user_id = u.id
        AND c.stay_paid IS NULL AND c.left_at IS NULL
      RETURNING c.channel_id::text AS channel_id`,
    [String(chatId), String(userId)],
  );
  if (rows.length) log("info", "[bonus] channel left before the stay bonus", { channelId: rows[0]!.channel_id });
  return rows.length;
}

/* ───────────────────────── Stay bonus sweep ───────────────────────── */

/** An `unknown` membership answer is retried after this long (bot removed from the channel, Telegram down). */
export const STAY_RETRY_HOURS = 6;
/** Bot API calls per second of one sweep — well below Telegram's ~30/s. */
export const STAY_PER_SECOND = 20;
/** Due claims read per sweep run (the worker runs one every 10 min). */
export const STAY_BATCH = 200;
/**
 * One sweep stops starting new checks after this long (housekeeping must not stall); the
 * claims it did not reach stay due and are picked up by the next run.
 */
export const STAY_BUDGET_MS = 15_000;

export type StaySweepDeps = {
  member?: (chatId: string, telegramId: string) => Promise<MemberStatus>;
  notify?: (telegramId: string, lang: string, points: number, title: string, stayDays: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  perSecond?: number;
  budgetMs?: number;
  /** Default `botConfigured()`: without a bot nothing can be checked. */
  configured?: () => boolean;
};

export type StaySweepResult = { rows: number; paid: number; left: number; unknown: number };

/** Unsettled claims of zero-stay channels settled per sweep (no Bot API call). */
export const STAY_ZERO_SETTLE_BATCH = 1_000;

/**
 * Claims of channels whose `stay_bonus` is 0 (created before claims were settled at join time,
 * or the admin set the stay bonus to 0 later) get `stay_paid = 0`: nothing is owed, and they
 * leave the sweep's partial index. No Telegram call, no money. Returns the number settled.
 */
async function settleZeroStay(limit: number): Promise<number> {
  const rows = await query<{ user_id: string }>(
    `UPDATE bonus_channel_claims c
        SET stay_paid = 0, stay_checked_at = now()
       FROM (SELECT z.user_id, z.channel_id
               FROM bonus_channel_claims z
               JOIN bonus_channels ch ON ch.id = z.channel_id
              WHERE ch.stay_bonus = 0 AND z.stay_paid IS NULL AND z.left_at IS NULL
              LIMIT $1
                FOR UPDATE OF z SKIP LOCKED) d
      WHERE c.user_id = d.user_id AND c.channel_id = d.channel_id AND c.stay_paid IS NULL
      RETURNING c.user_id::text AS user_id`,
    [limit],
  );
  if (rows.length) log("info", "[bonus] zero-stay claims settled", { rows: rows.length });
  return rows.length;
}

type DueRow = {
  user_id: string;
  channel_id: string;
  chat_id: string;
  title: string;
  stay_days: number;
  telegram_id: string;
  language: string | null;
};

async function notifyStay(telegramId: string, lang: string, points: number, title: string, stayDays: number): Promise<void> {
  const screen = stayPaidNotice(langOf(lang), { points, title, stayDays });
  const r = await callBot("sendMessage", {
    chat_id: telegramId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(screen.reply_markup ? { reply_markup: screen.reply_markup } : {}),
  });
  // Best effort: the money is already in the wallet; a user who blocked the bot just gets no message.
  if (!r.ok) log("warn", "[bonus] stay notice not sent", { code: r.code });
}

/**
 * Settles zero-stay claims first (`settleZeroStay`, no Bot API call), then
 * pays the stay bonus of due claims (worker housekeeping, every ~10 min):
 * joined_at + stay_days ≤ now, stay unpaid, not left, channel active with
 * stay_bonus > 0, account not blocked. Per claim one `getChatMember`:
 *   member      → stay bonus (ledger `…:stay`) + a message in the user's language;
 *   not member  → `left_at = now()`, nothing paid (B-Q3);
 *   unknown     → `stay_checked_at = now()`, retried after STAY_RETRY_HOURS.
 * Bounded (`limit`, default STAY_BATCH = 200; time budget STAY_BUDGET_MS = 15 s — the rest
 * continue next run) and paced (≤ STAY_PER_SECOND = 20 Bot API calls/s).
 * Each claim is settled in its own transaction under row locks, re-checking
 * every condition, so a concurrent sweep or admin edit cannot double-pay.
 */
export async function staySweep(limit = STAY_BATCH, deps: StaySweepDeps = {}): Promise<StaySweepResult> {
  const out: StaySweepResult = { rows: 0, paid: 0, left: 0, unknown: 0 };
  if (!(deps.configured ?? botConfigured)()) return out;
  const member = deps.member ?? chatMemberStatus;
  const notify = deps.notify ?? notifyStay;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const gap = Math.ceil(1000 / Math.max(1, deps.perSecond ?? STAY_PER_SECOND));
  const budget = deps.budgetMs ?? STAY_BUDGET_MS;
  const started = now();
  const n = Math.max(1, Math.min(500, Math.trunc(limit)));
  await settleZeroStay(STAY_ZERO_SETTLE_BATCH);

  const due = await query<DueRow>(
    `SELECT c.user_id::text AS user_id, c.channel_id::text AS channel_id, ch.chat_id::text AS chat_id,
            ch.title, ch.stay_days, u.telegram_id::text AS telegram_id, u.language
       FROM bonus_channel_claims c
       JOIN bonus_channels ch ON ch.id = c.channel_id
       JOIN users u ON u.id = c.user_id
      WHERE c.stay_paid IS NULL AND c.left_at IS NULL
        AND ch.active AND ch.stay_bonus > 0
        AND c.joined_at + make_interval(days => ch.stay_days) <= now()
        AND NOT u.is_blocked AND u.telegram_id IS NOT NULL
        AND (c.stay_checked_at IS NULL OR c.stay_checked_at <= now() - make_interval(hours => $2))
      ORDER BY c.stay_checked_at NULLS FIRST, c.joined_at
      LIMIT $1`,
    [n, STAY_RETRY_HOURS],
  );

  for (let i = 0; i < due.length; i++) {
    if (i > 0) {
      if (now() - started >= budget) break;
      await sleep(gap);
    }
    const d = due[i]!;
    out.rows += 1;
    const status = await member(d.chat_id, d.telegram_id);
    const settled = await transaction(async (client) => {
      // Re-check everything under locks: the user row (topUpInTx order), then the claim.
      const u = await client.query<{ is_blocked: boolean }>("SELECT is_blocked FROM users WHERE id = $1 FOR UPDATE", [d.user_id]);
      const claim = await client.query<{ ok: boolean; stay_bonus: number; title: string; stay_days: number }>(
        `SELECT (ch.active AND ch.stay_bonus > 0 AND c.joined_at + make_interval(days => ch.stay_days) <= now()) AS ok,
                ch.stay_bonus, ch.title, ch.stay_days
           FROM bonus_channel_claims c
           JOIN bonus_channels ch ON ch.id = c.channel_id
          WHERE c.user_id = $1 AND c.channel_id = $2 AND c.stay_paid IS NULL AND c.left_at IS NULL
          FOR UPDATE OF c`,
        [d.user_id, d.channel_id],
      );
      const row = claim.rows[0];
      if (!row || !row.ok || u.rows[0]?.is_blocked !== false) return null;
      if (status === "member") {
        const points = Number(row.stay_bonus);
        const paid = await topUpInTx(client, d.user_id, { points }, stayRef(d.channel_id, d.user_id), "bonus", `${STAY_NOTE_PREFIX}${noteTitle(row.title)}`);
        await client.query(
          "UPDATE bonus_channel_claims SET stay_paid = $3, stay_checked_at = now() WHERE user_id = $1 AND channel_id = $2",
          [d.user_id, d.channel_id, points],
        );
        // `paid` false = the ledger row already existed (paid before): settle the claim, no second notice.
        return paid ? { kind: "paid" as const, points, title: row.title, stayDays: Number(row.stay_days) } : null;
      }
      if (status === "not_member") {
        await client.query(
          "UPDATE bonus_channel_claims SET left_at = now(), stay_checked_at = now() WHERE user_id = $1 AND channel_id = $2",
          [d.user_id, d.channel_id],
        );
        return { kind: "left" as const };
      }
      await client.query("UPDATE bonus_channel_claims SET stay_checked_at = now() WHERE user_id = $1 AND channel_id = $2", [d.user_id, d.channel_id]);
      return { kind: "unknown" as const };
    });
    if (!settled) continue;
    if (settled.kind === "paid") {
      out.paid += 1;
      log("info", "[bonus] channel stay", { userId: d.user_id, channelId: d.channel_id, points: settled.points });
      await sleep(gap);
      try {
        await notify(d.telegram_id, d.language ?? "uz", settled.points, settled.title, settled.stayDays);
      } catch (e) {
        log("warn", "[bonus] stay notice failed", { err: e });
      }
    } else if (settled.kind === "left") {
      out.left += 1;
    } else {
      out.unknown += 1;
    }
  }
  return out;
}
