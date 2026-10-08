import { readOnlyMetricsTx } from "../admin-metrics";
import { callBot } from "../telegram";

/**
 * Numbers of the bot «📊 Statistika» card (docs/bot-admin/PLAN.md A-Q4), in
 * one read-only transaction (`admin-metrics.ts readOnlyMetricsTx`: READ ONLY,
 * 10 s statement timeout). Definitions follow the web dashboard:
 *   - days are Asia/Tashkent calendar days; «7 kun» / «30 kun» include today;
 *   - active = created a generation, or a session created / last seen, in the window
 *     (the dashboard's `activeUsers`);
 *   - revenue = `payment_orders` in state `paid` by `perform_time` (gross, so‘m);
 *   - bonuses = `transactions` of kind `bonus` by ledger reference (all time):
 *     `channel:<c>:<u>:join|stay`, `referral:<u>`, `signup:<u>`, `first-topup:<u>`;
 *   - channel members = Telegram `getChatMemberCount` (best effort, `null` when it
 *     fails) and the users who got its join bonus and did not leave.
 */

export type BonusKind = "join" | "stay" | "invite" | "signup" | "first" | "other";

export type BotStats = {
  at: Date;
  users: { total: number; today: number; week: number; active30: number };
  docs: { today: number; week: number; top: Array<{ toolId: string; count: number }> };
  money: { today: number; todayN: number; week: number; weekN: number; month: number; monthN: number };
  bonuses: Array<{ kind: BonusKind; sum: number; count: number }>;
  channels: Array<{ id: string; chatId: string; title: string; joined: number; members: number | null }>;
};

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const STATS_SQL = `
WITH b AS (SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent' AS today),
w AS (SELECT today, today - interval '6 days' AS week, today - interval '29 days' AS month FROM b),
ms AS (SELECT (extract(epoch FROM today) * 1000)::bigint AS today_ms, (extract(epoch FROM week) * 1000)::bigint AS week_ms,
              (extract(epoch FROM month) * 1000)::bigint AS month_ms FROM w)
SELECT
  (SELECT count(*) FROM users) AS users_total,
  (SELECT count(*) FROM users, w WHERE users.created_at >= w.today) AS users_today,
  (SELECT count(*) FROM users, w WHERE users.created_at >= w.week) AS users_week,
  (SELECT count(*) FROM (
      SELECT g.user_id FROM generations g, w WHERE g.created_at >= w.month
      UNION
      SELECT s.user_id FROM sessions s, w WHERE s.created_at >= w.month OR s.last_seen_at >= w.month
   ) a) AS active30,
  (SELECT count(*) FROM generations g, w WHERE g.created_at >= w.today) AS docs_today,
  (SELECT count(*) FROM generations g, w WHERE g.created_at >= w.week) AS docs_week,
  p.today_sum, p.today_n, p.week_sum, p.week_n, p.month_sum, p.month_n
FROM w, (
  SELECT COALESCE(sum(amount_soum) FILTER (WHERE perform_time >= ms.today_ms), 0) AS today_sum,
         count(*) FILTER (WHERE perform_time >= ms.today_ms) AS today_n,
         COALESCE(sum(amount_soum) FILTER (WHERE perform_time >= ms.week_ms), 0) AS week_sum,
         count(*) FILTER (WHERE perform_time >= ms.week_ms) AS week_n,
         COALESCE(sum(amount_soum), 0) AS month_sum,
         count(*) AS month_n
    FROM payment_orders, ms
   WHERE state = 'paid' AND perform_time >= ms.month_ms
) p`;

const TOP_SQL = `
SELECT g.tool_id, count(*) AS n
  FROM generations g
 WHERE g.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') - interval '6 days'
 GROUP BY g.tool_id
 ORDER BY count(*) DESC, g.tool_id
 LIMIT 5`;

const BONUS_SQL = `
SELECT CASE
         WHEN reference LIKE 'channel:%:join' THEN 'join'
         WHEN reference LIKE 'channel:%:stay' THEN 'stay'
         WHEN reference LIKE 'referral:%' THEN 'invite'
         WHEN reference LIKE 'signup:%' THEN 'signup'
         WHEN reference LIKE 'first-topup:%' THEN 'first'
         ELSE 'other'
       END AS kind,
       COALESCE(sum(points_delta), 0) AS sum, count(*) AS n
  FROM transactions
 WHERE kind = 'bonus'
 GROUP BY 1`;

const CHANNELS_SQL = `
SELECT c.id::text AS id, c.chat_id::text AS chat_id, c.title,
       count(cl.user_id) FILTER (WHERE cl.left_at IS NULL) AS joined
  FROM bonus_channels c
  LEFT JOIN bonus_channel_claims cl ON cl.channel_id = c.id
 WHERE c.active
 GROUP BY c.id
 ORDER BY c.sort, c.id
 LIMIT 10`;

const BONUS_ORDER: BonusKind[] = ["join", "stay", "invite", "signup", "first", "other"];

export async function botStats(opts: { channelMembers?: boolean } = {}): Promise<BotStats> {
  const data = await readOnlyMetricsTx(async (c) => {
    const s = (await c.query<Record<string, string>>(STATS_SQL)).rows[0] ?? {};
    const top = (await c.query<{ tool_id: string; n: string }>(TOP_SQL)).rows;
    const bonus = (await c.query<{ kind: BonusKind; sum: string; n: string }>(BONUS_SQL)).rows;
    const channels = (await c.query<{ id: string; chat_id: string; title: string; joined: string }>(CHANNELS_SQL)).rows;
    return { s, top, bonus, channels };
  });
  const { s } = data;
  const bonuses = data.bonus
    .map((r) => ({ kind: r.kind, sum: n(r.sum), count: n(r.n) }))
    .sort((a, b) => BONUS_ORDER.indexOf(a.kind) - BONUS_ORDER.indexOf(b.kind));
  const channels = await Promise.all(
    data.channels.map(async (r) => {
      let members: number | null = null;
      if (opts.channelMembers !== false) {
        const res = await callBot<number>("getChatMemberCount", { chat_id: r.chat_id }, { timeoutMs: 5_000 });
        members = res.ok && Number.isFinite(Number(res.result)) ? Number(res.result) : null;
      }
      return { id: r.id, chatId: r.chat_id, title: r.title, joined: n(r.joined), members };
    }),
  );
  return {
    at: new Date(),
    users: { total: n(s.users_total), today: n(s.users_today), week: n(s.users_week), active30: n(s.active30) },
    docs: { today: n(s.docs_today), week: n(s.docs_week), top: data.top.map((r) => ({ toolId: r.tool_id, count: n(r.n) })) },
    money: {
      today: n(s.today_sum),
      todayN: n(s.today_n),
      week: n(s.week_sum),
      weekN: n(s.week_n),
      month: n(s.month_sum),
      monthN: n(s.month_n),
    },
    bonuses,
    channels,
  };
}
