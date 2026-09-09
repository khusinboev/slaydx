/**
 * Jonli kanal tekshiruvi (AUDIT-10 L3): HAQIQIY navbat + inline worker →
 * `generations.live_json` yozuvlarini soniya-ma-soniya kuzatish.
 *
 *   npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/live-worker.mts [username]
 *
 * Kredit yechiladi (lokal baza), LLM/rasm API chaqiriladi — namunaviy
 * kontent admin hisobiga tushadi (CLAUDE.md qoidasi).
 */
import { enqueueGeneration } from "../lib/server/jobs.ts";
import { startInlineWorker } from "../lib/server/worker.ts";
import { pool } from "../lib/server/db.ts";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { DEFAULT_JOB_TIMEOUT_MS } from "../lib/server/env.ts";

const tool = TOOL_BY_ID.slide;
const values = { topic: "Kasr sonlarni qo‘shish", quality: "standard", language: "uz", slideAudience: "school_5_7", quizCount: 3, speakerNotes: true, planItems: 3 };
const username = process.argv[2] || "adkhambek_4";
const { rows: u } = await pool().query(`SELECT id FROM users WHERE username = $1 OR phone = $1`, [username]);
if (!u.length) { console.error("foydalanuvchi topilmadi:", username); process.exit(1); }
const userId = String(u[0].id);
const r = await enqueueGeneration({ userId, toolId: tool.id, topic: String(values.topic), price: priceFor(tool, values), format: "pptx", values, budgetMs: budgetFor(tool, values, DEFAULT_JOB_TIMEOUT_MS) });
if (!("id" in r)) { console.log("navbatga qo'yilmadi:", JSON.stringify(r)); process.exit(1); }
console.log("ish:", r.id);
startInlineWorker();
const t0 = Date.now();
let lastSeq = -1;
for (;;) {
  const { rows } = await pool().query(
    `SELECT status, progress, step, live_seq, length(live_json::text) AS bytes,
            jsonb_array_length(coalesce(live_json->'written','[]'::jsonb)) AS written,
            (live_json->'images'->>'got') AS got, (live_json->'images'->>'want') AS want,
            (SELECT count(*) FROM generation_assets a WHERE a.generation_id = g.id) AS assets
       FROM generations g WHERE id = $1`, [r.id]);
  const g = rows[0];
  if (g.live_seq !== lastSeq || g.status !== "IN_PROGRESS") {
    console.log(`+${((Date.now()-t0)/1000).toFixed(1)}s ${g.status} ${g.progress}% seq=${g.live_seq} bytes=${g.bytes ?? 0} written=${g.written ?? 0} img=${g.got ?? "-"}/${g.want ?? "-"} assets=${g.assets} · ${g.step}`);
    lastSeq = g.live_seq;
  }
  if (g.status !== "QUEUED" && g.status !== "IN_PROGRESS") break;
  await new Promise((res) => setTimeout(res, 1000));
}
const { rows: fin } = await pool().query(`SELECT live_json IS NULL AS live_null, doc_json IS NOT NULL AS doc, doc_version, file_version FROM generations WHERE id=$1`, [r.id]);
console.log("yakun:", JSON.stringify(fin[0]));
await pool().end(); process.exit(0);
