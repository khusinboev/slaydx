import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import { ApiError } from "./api";
import { extOf } from "../extract-text";
import { extractSegments, stripTokens, type Extracted } from "../generation/translate/index";
import { TRANSLATION_MAX_CHARS, TRANSLATION_MIN_CHARS } from "../tools";
import {
  SOURCE_MIME,
  SOURCE_PREVIEW_CHARS,
  type SourceKind,
  type SourceUploadResult,
  type TranslationSource,
} from "../generation/source-types";

/**
 * Tarjima manbasini yuklash (Tarjimon 2, WP1).
 *
 * `logo.ts` / `template-upload.ts` naqshi: bu fayl shartnomaning SERVER
 * yarmi — hajm chegarasi, sniff (baytdan, `content-type` dan EMAS),
 * o'lchash, saqlash. Autentifikatsiya (`requireUser`, `limit`) route'da
 * qoladi, chunki Next `cookies()` faqat so'rov konteksti ichida ishlaydi
 * va test uni chaqira olmaydi.
 *
 * NEGA `/api/extract` dan alohida: `/api/extract` faqat MATN qaytaradi va
 * baytlarni tashlab yuboradi. Tarjimon 2 ning butun ma'nosi esa — asl
 * faylni SAQLAB, uning ichidagi matn tugunlarini almashtirish. Boshqa
 * vositalar («fayl asosida» rejim) `/api/extract` da qoladi.
 *
 * ⚠️ WP3 UCHUN: `chars` shu yerda, `DEFAULT_COUNTER` da o'lchanadi va u
 * VAQTINCHA — u butun matnni oladi, tarjima esa faqat TARJIMA QILINADIGAN
 * segmentlarni yuboradi. WP3 da `DEFAULT_COUNTER` ni segment ekstraktori
 * (`lib/generation/translate/index.ts` `extractSegments`) bilan almashtirish
 * kifoya: `uploadSource` ning qolgan mantiqi (chegara, `scanned`, saqlash)
 * o'zgarmaydi. Almashtirish nuqtasi — SHU FAYLDAGI YAGONA joy.
 */

/**
 * 20 MB — rasmli DOCX 5–15 MB, PPTX 10–25 MB oralig'ida bo'ladi.
 * Chiqish ≈ kirish (media tegilmaydi, JSZip qayta deflate qiladi), ya'ni
 * natija `MAX_FILE_BYTES` (25 MB) ga sig'adi. nginx `client_max_body_size`
 * 32m — bu chegaradan yuqori, ya'ni xato bizning aniq xabarimiz bo'ladi.
 */
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** Bazaga yoziladigan matnning chegarasi (`TRANSLATION_MAX_CHARS` bilan bir juftlik). */
const SOURCE_TEXT_LIMIT = 200_000;

/** ZIP ichidagi yo'l satrlarini qidirish oynasi — markaziy katalog boshida turmaydi. */
const ZIP_SNIFF_WINDOW = 64 * 1024;

/** Bir xil fayl ikki marta yuklansa — bitta qator (`002_assets.sql` naqshi). */
function assetIdFor(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

const TEXT_KINDS = new Set<SourceKind>(["txt", "md", "csv"]);
const ZIP_KINDS = new Set<SourceKind>(["docx", "pptx", "xlsx"]);

/** OOXML turini ZIP ichidagi papka nomidan aniqlash uchun imzo. */
const ZIP_MARKER: Record<"docx" | "pptx" | "xlsx", string> = {
  docx: "word/",
  pptx: "ppt/",
  xlsx: "xl/",
};

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isPdf(bytes: Uint8Array): boolean {
  // `%PDF-`
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Kengaytma + MAGIC BAYT bo'yicha tur.
 *
 * Ikkalasi ham kerak: kengaytmasiz OOXML ning uch turini ajratib
 * bo'lmaydi (uchalasi ham ZIP), magic baytsiz esa `.docx` deb nomlangan
 * PNG o'tib ketardi — `looksLikePptx` dagi bir xil qoida. `content-type`
 * ga hech qachon ishonilmaydi: uni brauzer ham, klient ham yozadi.
 *
 * Mos kelmasa `null` → route 415 beradi. `null` — «biz bu faylni
 * tarjima qila olmaymiz» degani, «fayl buzuq» degani emas.
 */
export function sniffSourceKind(name: string, bytes: Uint8Array): SourceKind | null {
  const ext = extOf(name) as SourceKind;
  if (ZIP_KINDS.has(ext)) {
    if (!isZip(bytes)) return null;
    /*
     * Yo'l satrlari («word/document.xml») ZIP ning lokal sarlavhalarida
     * XOM holida turadi, ya'ni deflate qilinmagan. Faqat birinchi 64 KB
     * qaraladi: undan keyingisi media bo'lishi mumkin va butun faylni
     * `latin1` ga o'girish 20 MB da behuda xotira.
     */
    const head = Buffer.from(bytes.subarray(0, ZIP_SNIFF_WINDOW)).toString("latin1");
    return head.includes(ZIP_MARKER[ext as "docx" | "pptx" | "xlsx"]) ? ext : null;
  }
  if (ext === "pdf") return isPdf(bytes) ? "pdf" : null;
  if (TEXT_KINDS.has(ext)) {
    /*
     * Matn fayllarida magic bayt yo'q. Yagona ishonchli salbiy belgi —
     * NOL BAYT: u har qanday binar faylda uchraydi, matnda esa hech
     * qachon. Aks holda `.txt` deb nomlangan EXE yuklanar va
     * `TextDecoder` undan U+FFFD to'plamini yasab, foydalanuvchi 200 000
     * belgilik axlatga pul to'lardi.
     */
    const head = bytes.subarray(0, ZIP_SNIFF_WINDOW);
    for (let i = 0; i < head.length; i++) if (head[i] === 0) return null;
    return ext;
  }
  return null;
}

/**
 * Manbadan hajm o'lchagich — ALMASHTIRILADIGAN SEAM.
 *
 * `chars` narxni belgilaydi, shuning uchun u modelga haqiqatan
 * yuboriladigan hajmga TENG bo'lishi kerak. Hozircha (WP1) bu butun
 * matn; WP3 da segment yig'indisiga o'tadi. Tip shu paytdan segment
 * hisobini ham ko'taradi (`segments`), shunda almashtirishda imzo
 * o'zgarmaydi.
 */
export type SourceCounter = (
  kind: SourceKind,
  bytes: Uint8Array,
) => Promise<{ chars: number; text: string; pages?: number; segments?: number }>;

/** `unpdf` sahifa soni — skaner PDF ni aniqlash uchun (`chars < 20 × pages`). */
async function pdfPages(bytes: Uint8Array): Promise<number> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(bytes);
    return doc.numPages ?? 0;
  } catch {
    // Sahifa sonini bilmasak `scanned` qoidasi ishlamaydi — bu XATO emas,
    // shunchaki qo'shimcha tekshiruv o'tkazib yuboriladi.
    return 0;
  }
}

/**
 * Hisoblagich (WP3): `chars` — TARJIMA QILINADIGAN segmentlar yig'indisi
 * (`extractSegments`), ya'ni narx aynan modelga yuboriladigan hajmga
 * bog'lanadi: raqamli yacheykalar, URL, kod satrlari, sahifa raqami
 * maydonlari sanalmaydi. `text` — ko'rish uchun oddiy matn (tokenlarsiz).
 * `uploadSource` uni `deps.count` orqali chaqiradi (test seam).
 */
export const DEFAULT_COUNTER: SourceCounter = async (kind, bytes) => {
  let extracted: Extracted;
  try {
    extracted = await extractSegments(kind, bytes);
  } catch (e) {
    throw new ApiError(e instanceof Error && e.message ? `Fayl o'qilmadi: ${e.message}` : "Fayl o'qilmadi", 422, { code: "unreadable" });
  }
  const text = extracted.segments.map((s) => stripTokens(s.text)).join("\n");
  const pages = kind === "pdf" ? (extracted.pdf?.pages ?? (await pdfPages(bytes))) : undefined;
  return { chars: extracted.chars, text, pages, segments: extracted.segments.length };
};

export async function putSource(
  userId: string,
  bytes: Buffer,
  row: { name: string; kind: SourceKind; mime: string; chars: number; text: string },
): Promise<SourceUploadResult> {
  const assetId = assetIdFor(bytes);
  const text = row.text.slice(0, SOURCE_TEXT_LIMIT);
  await query(
    `INSERT INTO source_uploads (user_id, asset_id, name, kind, mime, size_bytes, bytes, chars, text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, asset_id) DO UPDATE
       SET chars = EXCLUDED.chars, text = EXCLUDED.text, name = EXCLUDED.name`,
    [userId, assetId, row.name, row.kind, row.mime, bytes.byteLength, bytes, row.chars, text],
  );
  return {
    assetId,
    name: row.name,
    kind: row.kind,
    size: bytes.byteLength,
    chars: row.chars,
    text: text.slice(0, SOURCE_PREVIEW_CHARS),
    truncatedPreview: text.length > SOURCE_PREVIEW_CHARS,
  };
}

/** Egalik SQL da — begona foydalanuvchining hujjatini ololmaydi. */
export async function getSource(
  userId: string,
  assetId: string,
): Promise<{ bytes: Buffer; name: string; kind: SourceKind; mime: string; chars: number; text: string } | null> {
  if (!/^[0-9a-f]{24}$/i.test(assetId)) return null;
  const row = await queryOne<{
    bytes: Buffer;
    name: string;
    kind: string;
    mime: string;
    chars: number;
    text: string;
  }>(`SELECT bytes, name, kind, mime, chars, text FROM source_uploads WHERE user_id = $1 AND asset_id = $2`, [
    userId,
    assetId,
  ]);
  if (!row) return null;
  return { ...row, kind: row.kind as SourceKind, chars: Number(row.chars) || 0 };
}

/**
 * Worker uchun: `sourceAssetId` → baytlar + meta.
 *
 * Topilmasa `undefined` va XATO EMAS — `logoDataUrl`/`templateForJob`
 * naqshi. Farqi shundaki, tarjimada manbasiz ish ma'nosiz: dvigatel
 * (WP3) `source` yo'q bo'lsa `sourceText` bilan matn rejimida ishlaydi,
 * u ham bo'lmasa aniq xato beradi va kredit qaytadi.
 */
export async function sourceForJob(userId: string, assetId: string): Promise<TranslationSource | undefined> {
  if (!userId || !assetId) return undefined;
  const row = await getSource(userId, assetId).catch(() => null);
  if (!row) return undefined;
  return { bytes: row.bytes, name: row.name, kind: row.kind, mime: row.mime, chars: row.chars };
}

/**
 * `/api/generations` uchun ISHONCHLI hajm.
 *
 * Narx aynan shu funksiyaning javobidan hisoblanadi — klientning
 * `sourceChars` i e'tiborsiz qoldiriladi. Aks holda 200 000 belgilik
 * hujjat «1 000 belgi» deb yuborilib, 3 000 tangaga tarjima qilinardi.
 * Baytlar o'qilmaydi: faqat uchta ustun.
 */
export async function sourceCharsForRequest(
  userId: string,
  assetId: string,
): Promise<{ chars: number; name: string; kind: SourceKind } | null> {
  if (!userId || !/^[0-9a-f]{24}$/i.test(assetId)) return null;
  const row = await queryOne<{ chars: number; name: string; kind: string }>(
    `SELECT chars, name, kind FROM source_uploads WHERE user_id = $1 AND asset_id = $2`,
    [userId, assetId],
  );
  if (!row) return null;
  return { chars: Number(row.chars) || 0, name: row.name, kind: row.kind as SourceKind };
}

export async function deleteSource(userId: string, assetId: string): Promise<boolean> {
  if (!/^[0-9a-f]{24}$/i.test(assetId)) return false;
  const rows = await query(`DELETE FROM source_uploads WHERE user_id = $1 AND asset_id = $2 RETURNING asset_id`, [
    userId,
    assetId,
  ]);
  return rows.length > 0;
}

/**
 * 30 kundan eski manbalarni tozalaydi (worker `housekeeping`).
 *
 * Manba — BIR MARTALIK ish fayli: tarjima tayyor bo'lgach u faqat joy
 * egallaydi (20 MB gacha har biri) va maxfiylik yuki bo'lib qoladi.
 * Namuna (`template_uploads`) esa muddatsiz — u qayta ishlatiladigan
 * sozlama.
 */
export async function purgeOldSources(days = 30): Promise<number> {
  const rows = await query(
    `DELETE FROM source_uploads WHERE created_at < now() - ($1 || ' days')::interval RETURNING asset_id`,
    [String(Math.max(1, Math.floor(days)))],
  );
  return rows.length;
}

export type SourceUploadDeps = {
  put?: typeof putSource;
  count?: SourceCounter;
};

/**
 * PDF SKANER ekanini aniqlash chegarasi.
 *
 * Skaner nusxada matn qatlami umuman yo'q yoki faqat kolontitul qoldig'i
 * bo'ladi. Sahifasiga 20 belgidan kam — bu «rasmga olingan hujjat».
 * Nega bu MUHIM: aks holda foydalanuvchi 3 000 tanga to'lar, dvigatel
 * bo'sh hujjat qaytarar va u pulini qaytarish uchun murojaat qilardi.
 * OCR bizda yo'q, shuning uchun halol javob — pul yechilmasdan aniq xato.
 */
const PDF_CHARS_PER_PAGE = 20;

/**
 * So'rovdan manbani o'qib, o'lchab, saqlaydi.
 *
 * Chegara tartibi ATAYLAB shunday: eng arzon tekshiruv birinchi.
 * `content-length` → tana o'qilmasdan; `sniff` → ekstraksiyadan oldin;
 * `count` (eng qimmat, PDF da soniyalar) → oxirida.
 */
export async function uploadSource(
  req: Request,
  userId: string,
  deps: SourceUploadDeps = {},
): Promise<SourceUploadResult> {
  // MUHIM: `req.formData()` butun tanani xotiraga o'qiydi — hajm shundan
  // OLDIN, sarlavhadan tekshiriladi (`logo.ts` dagi izohga qarang).
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > SOURCE_MAX_BYTES + 64 * 1024) {
    throw new ApiError("Fayl 20 MB dan katta", 413);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  if (file.size > SOURCE_MAX_BYTES) throw new ApiError("Fayl 20 MB dan katta", 413);
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);

  const bytes = Buffer.from(await file.arrayBuffer());
  /*
   * Nom TOZALANIB, keyin sniff qilinadi. Tartib muhim: `\r\n` bo'lsa
   * `Content-Disposition` sarlavhasini buzardi, oxiridagi bo'sh joy esa
   * kengaytmani «docx » ga aylantirib, haqiqiy DOCX ni 415 bilan rad
   * ettirardi.
   */
  const clean = String(file.name || "hujjat").replace(/[\r\n\t]/g, " ").trim();
  // Sniff TO'LIQ nom bo'yicha, saqlash esa kesilgani bilan: 200 belgilik
  // nomni avval kesib qo'ysak, kengaytma yo'qolib, haqiqiy DOCX 415 olardi.
  const kind = sniffSourceKind(clean, bytes);
  if (!kind) throw new ApiError("Format qo'llanmaydi: DOCX, PPTX, XLSX, PDF, TXT, MD, CSV", 415);

  const counted = await (deps.count ?? DEFAULT_COUNTER)(kind, bytes);
  const chars = Math.max(0, Math.floor(counted.chars));

  /*
   * Skaner PDF — matn chegaralaridan OLDIN tekshiriladi: aks holda
   * foydalanuvchi «matn topilmadi» degan umumiy xabarni olar va
   * nimaga fayli yaroqsizligini tushunmasdi.
   */
  if (kind === "pdf" && (counted.pages ?? 0) > 0 && chars < PDF_CHARS_PER_PAGE * (counted.pages ?? 0)) {
    throw new ApiError(
      "Bu PDF skaner nusxa — matn qatlami yo'q. DOCX yoki matn rejimidan foydalaning.",
      422,
      { code: "scanned" },
    );
  }
  if (chars < TRANSLATION_MIN_CHARS) {
    throw new ApiError("Fayldan tarjima qilinadigan matn topilmadi", 422, { code: "empty", chars });
  }
  if (chars > TRANSLATION_MAX_CHARS) {
    throw new ApiError(
      `Fayl ${chars.toLocaleString("uz-UZ")} belgi — chegara ${TRANSLATION_MAX_CHARS.toLocaleString("uz-UZ")}. Hujjatni bo'lib yuboring.`,
      422,
      { code: "too-long", chars },
    );
  }

  return (deps.put ?? putSource)(userId, bytes, {
    name: clean.slice(0, 120) || `hujjat.${kind}`,
    kind,
    mime: SOURCE_MIME[kind],
    chars,
    text: counted.text ?? "",
  });
}
