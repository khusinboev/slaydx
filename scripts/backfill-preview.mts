/**
 * Eski slayd/pro-slayd dekalarining `preview` ustunini qayta hisoblaydi.
 *
 * Nega kerak: P1 ("Mening fayllarim" kartochkasida BIRINCHI SLAYD
 * ko'ruvchidagidek ko'rinsin) `buildPreview` ga `preview.slide`
 * maydonini qo'shdi (`lib/server/preview.ts`). Yangi generatsiyalar
 * buni avtomatik oladi (worker va `commitDocOps` har ikkisi
 * `buildPreview`ni chaqiradi), lekin OLDIN yaratilgan qatorlarning
 * `preview` ustuni hali eski shaklda (`url`/`lines`) — kartochkasi
 * bosh sahifada yangi renderni ko'rsatmaydi. Bu skript ularni bir
 * martalik qayta hisoblaydi.
 *
 * `doc_json`dan qayta hisoblaydi, boshqa hech narsani o'zgartirmaydi —
 * `buildPreview` sof funksiya, faqat `preview` ustuni yoziladi.
 *
 * Foydalanish (worker konteynerida, DATABASE_URL `.env` orqali):
 *   npx tsx --conditions=react-server scripts/backfill-preview.mts        # yozadi
 *   npx tsx --conditions=react-server scripts/backfill-preview.mts --dry  # faqat hisoblaydi, yozmaydi
 */
import { pool, query } from "../lib/server/db.ts";
import { buildPreview } from "../lib/server/preview.ts";
import type { GenerationPreview } from "../lib/server/jobs.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

const dry = process.argv.includes("--dry");
const BATCH = 200;

type Row = { id: string; doc_json: AcademicDoc; preview: GenerationPreview | null };

async function run() {
  let cursor: string | null = null;
  let scanned = 0;
  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (;;) {
    const rows: Row[] = await query<Row>(
      `SELECT id, doc_json, preview FROM generations
       WHERE tool_id IN ('slide', 'pro-slide')
         AND status = 'COMPLETED'
         AND doc_json IS NOT NULL
         ${cursor ? "AND id > $2" : ""}
       ORDER BY id ASC
       LIMIT $1`,
      cursor ? [BATCH, cursor] : [BATCH],
    );
    if (!rows.length) break;

    for (const row of rows) {
      scanned += 1;
      let next: GenerationPreview | null;
      try {
        next = buildPreview(row.doc_json);
      } catch (e) {
        failed += 1;
        console.error(`  ✗ ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      const same = JSON.stringify(next) === JSON.stringify(row.preview ?? null);
      if (same) {
        unchanged += 1;
        continue;
      }
      changed += 1;
      if (!dry) {
        await query(`UPDATE generations SET preview = $1 WHERE id = $2`, [
          next ? JSON.stringify(next) : null,
          row.id,
        ]);
      }
    }
    cursor = rows[rows.length - 1].id;
  }

  console.log(
    `${dry ? "[DRY] " : ""}skanerlandi: ${scanned}, ${dry ? "o'zgartirilardi" : "yozildi"}: ${changed}, o'zgarishsiz: ${unchanged}, xato: ${failed}`,
  );
}

await run();
await pool().end();
