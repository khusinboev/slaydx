/**
 * Biznes va navbat metrikalari hisoboti (AUDIT prod-readiness C31: OBS-13, OBS-11).
 *
 * Oxirgi N kun (standart 7) uchun, FAQAT o'qib (READ ONLY tranzaksiya):
 *   • ishlar — vosita × holat;
 *   • yiqilish ulushi — FAILED / (COMPLETED + FAILED);
 *   • qaytarish ulushi — qaytarilgan yechimlar / yechimlar (`transactions`);
 *   • o'rtacha davomiylik — tugagan ishlar, `finished_at - started_at`;
 *   • pul — to'langan buyurtmalar (so'm, provayder × maqsad), balansga
 *     yozilgan to'ldirishlar, obunalar, yechimlar (jami va haqiqiy balansdan),
 *     qaytarishlar, sof yechim;
 *   • buyurtmalar holati (paid / cancelled / created / pending);
 *   • navbat kutishi p50/p95 — `started_at - created_at`;
 *   • eng ko'p uchragan xato matnlari (FAILED).
 *
 * `cost-report.mts` (tannarx/marja) bilan birga ishlatiladi. Bazaga hech
 * narsa yozmaydi — prod bazasida xavfsiz.
 *
 * Foydalanish (og'ir buyruq — FAQAT `scripts/heavy.sh` orqali):
 *   scripts/heavy.sh npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/metrics-report.mts [kun]
 *   ... scripts/metrics-report.mts 30 --json      # mashina uchun JSON
 */
import { pathToFileURL } from "node:url";
import { pool, transaction } from "../lib/server/db.ts";

export type Metrics = {
  days: number;
  jobs: Array<{ tool: string; status: string; count: number }>;
  failureRate: number | null;
  refundRate: number | null;
  duration: Array<{ tool: string; completed: number; avgSec: number }>;
  queueWait: { started: number; p50Sec: number | null; p95Sec: number | null };
  money: {
    paidSoum: number;
    paidByProvider: Array<{ provider: string; purpose: string; orders: number; soum: number }>;
    topupCredited: number;
    subscriptions: number;
    charged: number;
    chargedBalance: number;
    refunded: number;
    netCharged: number;
  };
  orders: Array<{ state: string; count: number }>;
  topErrors: Array<{ error: string; count: number }>;
};

const num = (v: unknown): number => Number(v ?? 0) || 0;
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Kun sonini 1..365 oralig'iga keltiradi. */
export function clampDays(raw: unknown, fallback = 7): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(365, n) : fallback;
}

export async function collectMetrics(daysRaw: number = 7): Promise<Metrics> {
  const days = clampDays(daysRaw);
  const since = [String(days)];
  const win = "now() - ($1 || ' days')::interval";

  return transaction(async (client) => {
    // Hisobot hech narsa yozmasligi baza darajasida kafolatlanadi.
    await client.query("SET TRANSACTION READ ONLY");
    const q = async <T extends Record<string, unknown>>(sql: string) => (await client.query<T>(sql, since)).rows;

    const jobs = await q<{ tool_id: string; status: string; n: string }>(
      `SELECT tool_id, status, count(*) AS n FROM generations
        WHERE created_at >= ${win} GROUP BY tool_id, status ORDER BY tool_id, status`,
    );

    const [rates] = await q<{ completed: string; failed: string }>(
      `SELECT count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
              count(*) FILTER (WHERE status = 'FAILED') AS failed
         FROM generations WHERE created_at >= ${win}`,
    );
    const done = num(rates.completed) + num(rates.failed);

    const [refunds] = await q<{ charges: string; refunded: string }>(
      `SELECT count(*) AS charges,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM transactions r WHERE r.kind = 'refund' AND r.reference = c.reference)) AS refunded
         FROM transactions c
        WHERE c.kind = 'charge' AND c.created_at >= ${win}`,
    );

    const duration = await q<{ tool_id: string; n: string; avg_sec: string }>(
      `SELECT tool_id, count(*) AS n, avg(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_sec
         FROM generations
        WHERE status = 'COMPLETED' AND created_at >= ${win}
          AND started_at IS NOT NULL AND finished_at IS NOT NULL
        GROUP BY tool_id ORDER BY tool_id`,
    );

    const [wait] = await q<{ n: string; p50: string | null; p95: string | null }>(
      `SELECT count(*) AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (started_at - created_at))) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (started_at - created_at))) AS p95
         FROM generations
        WHERE created_at >= ${win} AND started_at IS NOT NULL`,
    );

    const paid = await q<{ provider: string; purpose: string; n: string; soum: string }>(
      `SELECT provider, purpose, count(*) AS n, COALESCE(sum(amount_soum), 0) AS soum
         FROM payment_orders
        WHERE state = 'paid' AND updated_at >= ${win}
        GROUP BY provider, purpose ORDER BY provider, purpose`,
    );

    const [ledger] = await q<{
      topup: string;
      subs: string;
      charged: string;
      charged_balance: string;
      refunded: string;
    }>(
      `SELECT COALESCE(sum(balance_delta) FILTER (WHERE kind = 'topup'), 0) AS topup,
              count(*) FILTER (WHERE kind = 'subscription') AS subs,
              COALESCE(-sum(points_delta + quota_delta + balance_delta) FILTER (WHERE kind = 'charge'), 0) AS charged,
              COALESCE(-sum(balance_delta) FILTER (WHERE kind = 'charge'), 0) AS charged_balance,
              COALESCE(sum(points_delta + quota_delta + balance_delta) FILTER (WHERE kind = 'refund'), 0) AS refunded
         FROM transactions WHERE created_at >= ${win}`,
    );

    const orders = await q<{ state: string; n: string }>(
      `SELECT state, count(*) AS n FROM payment_orders WHERE created_at >= ${win} GROUP BY state ORDER BY state`,
    );

    const errors = await q<{ error: string; n: string }>(
      `SELECT left(error, 200) AS error, count(*) AS n FROM generations
        WHERE status = 'FAILED' AND created_at >= ${win} AND error IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
    );

    const charged = num(ledger.charged);
    const refunded = num(ledger.refunded);
    return {
      days,
      jobs: jobs.map((r) => ({ tool: r.tool_id, status: r.status, count: num(r.n) })),
      failureRate: done > 0 ? num(rates.failed) / done : null,
      refundRate: num(refunds.charges) > 0 ? num(refunds.refunded) / num(refunds.charges) : null,
      duration: duration.map((r) => ({ tool: r.tool_id, completed: num(r.n), avgSec: num(r.avg_sec) })),
      queueWait: { started: num(wait.n), p50Sec: numOrNull(wait.p50), p95Sec: numOrNull(wait.p95) },
      money: {
        paidSoum: paid.reduce((a, r) => a + num(r.soum), 0),
        paidByProvider: paid.map((r) => ({ provider: r.provider, purpose: r.purpose, orders: num(r.n), soum: num(r.soum) })),
        topupCredited: num(ledger.topup),
        subscriptions: num(ledger.subs),
        charged,
        chargedBalance: num(ledger.charged_balance),
        refunded,
        netCharged: charged - refunded,
      },
      orders: orders.map((r) => ({ state: r.state, count: num(r.n) })),
      topErrors: errors.map((r) => ({ error: r.error, count: num(r.n) })),
    };
  });
}

// ─────────────────────────────── matn ko'rinishi

const fmt = (n: number) => Math.round(n).toLocaleString("uz-UZ").replace(/[, ]/g, " ");
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)} %`);
const sec = (s: number | null) => (s === null ? "—" : `${Math.round(s)} s`);

function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const w = header.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i])).join("  ");
  return [line(header), w.map((x) => "-".repeat(x)).join("  "), ...rows.map(line)].join("\n");
}

export function renderMetrics(m: Metrics): string {
  const out: string[] = [];
  out.push(`SlaydX metrikalari — oxirgi ${m.days} kun\n`);
  out.push(
    m.jobs.length
      ? table(["vosita", "holat", "ishlar"], m.jobs.map((r) => [r.tool, r.status, String(r.count)]))
      : "Ishlar yo'q.",
  );
  out.push("");
  out.push(`Yiqilish ulushi:   ${pct(m.failureRate)}`);
  out.push(`Qaytarish ulushi:  ${pct(m.refundRate)}`);
  out.push(`Navbat kutishi:    p50 ${sec(m.queueWait.p50Sec)}, p95 ${sec(m.queueWait.p95Sec)} (${m.queueWait.started} ta boshlangan ish)`);
  out.push("");
  if (m.duration.length) {
    out.push(table(["vosita", "tugagan", "o'rtacha davomiylik"], m.duration.map((r) => [r.tool, String(r.completed), sec(r.avgSec)])));
    out.push("");
  }
  out.push("Pul:");
  out.push(`  to'langan buyurtmalar:  ${fmt(m.money.paidSoum)} so'm`);
  for (const r of m.money.paidByProvider) out.push(`    ${r.provider}/${r.purpose}: ${r.orders} ta, ${fmt(r.soum)} so'm`);
  out.push(`  balansga to'ldirish:    ${fmt(m.money.topupCredited)} tanga`);
  out.push(`  Pro obunalar:           ${m.money.subscriptions} ta`);
  out.push(`  yechildi (jami):        ${fmt(m.money.charged)} tanga (haqiqiy balansdan ${fmt(m.money.chargedBalance)})`);
  out.push(`  qaytarildi:             ${fmt(m.money.refunded)} tanga`);
  out.push(`  sof yechim:             ${fmt(m.money.netCharged)} tanga`);
  out.push("");
  out.push(`Buyurtmalar: ${m.orders.map((r) => `${r.state} ${r.count}`).join(", ") || "yo'q"}`);
  if (m.topErrors.length) {
    out.push("");
    out.push(table(["soni", "xato (FAILED)"], m.topErrors.map((r) => [String(r.count), r.error])));
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const days = clampDays(args.find((a) => /^\d+$/.test(a)) ?? process.env.METRICS_DAYS);
  try {
    const m = await collectMetrics(days);
    console.log(args.includes("--json") ? JSON.stringify(m, null, 2) : renderMetrics(m));
  } finally {
    await pool().end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
