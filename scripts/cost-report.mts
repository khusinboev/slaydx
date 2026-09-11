/**
 * Tannarx hisoboti (Maqola 2 / AUDIT-17, WP4).
 *
 * Vosita bo'yicha: ishlar soni, o'rtacha LLM tannarxi (so'mda,
 * `SOUM_PER_USD` — standart 12 700) va o'rtacha narx (`price`), shulardan
 * marja (narx / tannarx). `generations.cost_json` faqat telemetriya
 * yuritadigan vositalarda to'ladi (hozircha maqola, `worker.ts setCost`)
 * — qolganlarida `NULL`, shuning uchun ular alohida «telemetriyasiz»
 * ustunda hisoblanadi (aks holda 0 tannarx bilan cheksiz marja chiqardi).
 *
 * Oxirgi 30 kun, faqat `COMPLETED` ishlar (yiqilgan/bekor qilingan
 * ishning narxi/tannarxi yo'q).
 *
 * Foydalanish (og'ir buyruq — FAQAT `scripts/heavy.sh` orqali):
 *   scripts/heavy.sh npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/cost-report.mts
 *   SOUM_PER_USD=13000 scripts/heavy.sh npx tsx ... scripts/cost-report.mts
 */
import { pool, query } from "../lib/server/db.ts";

const SOUM_PER_USD = Number(process.env.SOUM_PER_USD) || 12_700;

type Row = {
  tool_id: string;
  jobs: string;
  with_cost: string;
  avg_usd: string | null;
  avg_price: string | null;
};

function fmtSoum(n: number): string {
  return Math.round(n).toLocaleString("uz-UZ").replace(/,/g, " ");
}

function padRow(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i])).join("  ");
}

async function run(): Promise<void> {
  const rows = await query<Row>(
    `SELECT
       tool_id,
       count(*)::text AS jobs,
       count(cost_json)::text AS with_cost,
       avg((cost_json->>'usd')::numeric)::text AS avg_usd,
       avg(price)::text AS avg_price
     FROM generations
     WHERE status = 'COMPLETED' AND created_at >= now() - interval '30 days'
     GROUP BY tool_id
     ORDER BY tool_id`,
  );

  const header = ["vosita", "ishlar", "telemetriyasiz", "o'rtacha tannarx (so'm)", "o'rtacha narx", "marja"];
  const body = rows.map((r) => {
    const jobs = Number(r.jobs);
    const withCost = Number(r.with_cost);
    const withoutCost = jobs - withCost;
    const avgUsd = r.avg_usd !== null ? Number(r.avg_usd) : null;
    const avgPrice = r.avg_price !== null ? Number(r.avg_price) : null;
    const avgCostSoum = avgUsd !== null ? avgUsd * SOUM_PER_USD : null;
    const margin = avgCostSoum && avgCostSoum > 0 && avgPrice !== null ? avgPrice / avgCostSoum : null;
    return [
      r.tool_id,
      String(jobs),
      String(withoutCost),
      avgCostSoum !== null ? fmtSoum(avgCostSoum) : "—",
      avgPrice !== null ? fmtSoum(avgPrice) : "—",
      margin !== null ? `${margin.toFixed(1)}×` : "—",
    ];
  });

  if (!body.length) {
    console.log("Oxirgi 30 kunda `COMPLETED` ish topilmadi.");
    return;
  }

  const table = [header, ...body];
  const widths = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  console.log(padRow(header, widths));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of body) console.log(padRow(r, widths));
}

await run();
await pool().end();
