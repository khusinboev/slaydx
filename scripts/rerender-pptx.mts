/**
 * Eski slayd/pro-slayd fayllarini JORIY renderer bilan qayta yasaydi.
 *
 * Nega kerak (AUDIT-14 §5): bazadagi PPTX baytlar YARATILGAN paytdagi kod
 * bilan yasalgan. Ikki tuzatish faqat yangi fayllarga ta'sir qilardi:
 *   - logotip/rasm nisbati (`render-pptx` `contain/cover` baytlardan o'lcham);
 *   - qadalgan vizual (`doc_json.slideVisual`, 018) — ko'ruvchi bilan bir xil dizayn.
 * Eski faylni yuklab olgan foydalanuvchi hali cho'zilgan logotipni ko'rardi.
 *
 * Skript `doc_json` dan (tahrirlar bilan, `customTemplate` bo'lsa namuna
 * yo'li bilan) PPTX ni qayta yasab `generation_files` ga yozadi; `doc_json`,
 * versiyalar, aktivlar o'zgarmaydi. Rasmlar faqat o'z aktivlaridan
 * (`assetImageResolver`) — tashqi URL yuklanmaydi.
 *
 * Foydalanish (worker konteynerida, DATABASE_URL `.env` orqali):
 *   npx tsx --conditions=react-server scripts/rerender-pptx.mts            # yozadi
 *   npx tsx --conditions=react-server scripts/rerender-pptx.mts --dry      # faqat hisoblaydi
 *   npx tsx --conditions=react-server scripts/rerender-pptx.mts --only <id>
 */
import { pool, query } from "../lib/server/db.ts";
import { assetImageResolver } from "../lib/server/assets.ts";
import { putGenerationFile } from "../lib/server/storage.ts";
import { getTemplate } from "../lib/server/template-upload.ts";
import { renderPptx } from "../lib/generation/render-pptx.ts";
import { renderPptxWithTemplate } from "../lib/generation/render-pptx-template.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import JSZip from "jszip";

/** Faylda nechta media (rasm) bor — qayta yasashda kamaymasligi kerak (aktiv yo'qolgan bo'lsa eski fayl qoladi). */
async function mediaCount(bytes: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n)).length;
}

const dry = process.argv.includes("--dry");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

type Row = { id: string; user_id: string; doc_json: AcademicDoc; file_name: string; size_bytes: number; bytes: Buffer };

async function run() {
  const rows = await query<Row>(
    `SELECT g.id, g.user_id::text AS user_id, g.doc_json, f.file_name, f.size_bytes, f.bytes
       FROM generations g
       JOIN generation_files f ON f.generation_id = g.id
      WHERE g.tool_id IN ('slide', 'pro-slide')
        AND g.status = 'COMPLETED'
        AND g.doc_json ? 'slides'
        ${only ? "AND g.id = $1" : ""}
      ORDER BY g.created_at ASC`,
    only ? [only] : [],
  );
  console.log(`${rows.length} ta deka${dry ? " (dry)" : ""}`);
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const t0 = Date.now();
    try {
      const doc = row.doc_json;
      const resolveImage = assetImageResolver(row.id, row.user_id);
      const custom = doc.customTemplate ? await getTemplate(row.user_id, doc.customTemplate.assetId) : null;
      const built = custom
        ? await renderPptxWithTemplate(doc, row.file_name, custom.bytes, custom.template.profile, { resolveImage })
        : await renderPptx(doc, row.file_name, { resolveImage });
      const [before, after] = await Promise.all([mediaCount(new Uint8Array(row.bytes)), mediaCount(built.bytes)]);
      if (after < before) {
        // Rasm aktivi topilmagan — eski faylni buzmaymiz.
        failed += 1;
        console.error(`  ✗ ${row.id}: media ${before} → ${after} (kamaydi) — o'tkazib yuborildi`);
        continue;
      }
      if (!dry) await putGenerationFile(row.id, { bytes: built.bytes, mime: built.mime, fileName: built.fileName });
      ok += 1;
      console.log(`  ✔ ${row.id} ${doc.slideVisual ?? "(vizual yo'q)"} media ${before}→${after}, ${row.size_bytes} → ${built.bytes.byteLength} bayt, ${Date.now() - t0} ms`);
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`tayyor: ${ok} qayta yasaldi, ${failed} xato`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void pool().end());
