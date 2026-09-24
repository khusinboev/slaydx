/**
 * Tannarx hisoboti (Maqola 2 / AUDIT-17, WP4).
 *
 * Vosita bo'yicha: ishlar soni, o'rtacha LLM tannarxi (so'mda,
 * `SOUM_PER_USD` — standart 12 700) va o'rtacha narx (`price`), shulardan
 * marja (narx / tannarx). `generations.cost_json` ni `buildArtifact`
 * (`lib/generation/job-cost.ts`, audit EXT-11) HAR vositada to'ldiradi:
 * LLM tokenlari, Gemini rasmlari, grounding, TTS — manbada yozilgan.
 * Eski yozuvlar (va hech qanday pullik chaqiruvsiz ishlar) `NULL` —
 * ular alohida «telemetriyasiz» ustunda hisoblanadi (aks holda 0 tannarx
 * bilan cheksiz marja chiqardi).
 *
 * Ikkinchi jadval — xizmat bo'yicha tafsilot (`cost_json.parts`: llm /
 * image / grounding / tts), faqat `parts` bor yozuvlar bo'yicha.
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

  await parts();
}

type PartRow = { tool_id: string; kind: string; jobs: string; units: string; calls: string; avg_usd: string };

/** Xizmat bo'yicha: vosita × tur (llm/image/grounding/tts) — ish boshiga o'rtacha so'm. */
async function parts(): Promise<void> {
  const rows = await query<PartRow>(
    `SELECT g.tool_id,
            p->>'kind' AS kind,
            count(DISTINCT g.id)::text AS jobs,
            sum(COALESCE((p->>'units')::numeric, 0))::text AS units,
            sum(COALESCE((p->>'calls')::numeric, 0))::text AS calls,
            (sum(COALESCE((p->>'usd')::numeric, 0)) / NULLIF(count(DISTINCT g.id), 0))::text AS avg_usd
       FROM generations g
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(g.cost_json->'parts') = 'array' THEN g.cost_json->'parts' ELSE '[]'::jsonb END
       ) AS p
      WHERE g.status = 'COMPLETED' AND g.created_at >= now() - interval '30 days'
      GROUP BY g.tool_id, p->>'kind'
      ORDER BY g.tool_id, p->>'kind'`,
  );
  if (!rows.length) return;
  const header = ["vosita", "xizmat", "ishlar", "chaqiruv", "birlik", "ish boshiga (so'm)"];
  const body = rows.map((r) => [r.tool_id, r.kind, r.jobs, r.calls, r.units, fmtSoum(Number(r.avg_usd) * SOUM_PER_USD)]);
  const table = [header, ...body];
  const widths = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  console.log("");
  console.log(padRow(header, widths));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of body) console.log(padRow(r, widths));
}

await run();
await pool().end();
