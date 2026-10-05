import "server-only";
import { createHash } from "node:crypto";
import { query, queryOne } from "./db";
import type { AcademicDoc } from "../generation/types";
import type { ImageBytes } from "../generation/slide-images";
import type { Figure } from "../generation/article/types";

/**
 * `data:` URL larni saqlanadigan aktivga aylantiradi.
 *
 * PPTX/DOCX allaqachon rasmni ichiga olgan bo'ladi — bu yerda faqat
 * ko'ruvchi (viewer) uchun kerak bo'lgan nusxa qoladi.
 */

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;

export type PendingAsset = { assetId: string; mime: string; bytes: Buffer };

/** Bir xil rasm ikki slaydda bo'lsa — bitta aktiv. */
function assetIdFor(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

export function assetUrl(generationId: string, assetId: string): string {
  return `/api/generations/${generationId}/assets/${assetId}`;
}

/**
 * `data:` URL ni parslaydi va aktivga aylanadigan bayt/`assetId`ni
 * qaytaradi. Bo'sh baytli yoki formati mos kelmagan URL uchun `null`.
 *
 * `extractAssets` ichidagi `swap` bilan BIR XIL SHA-256 hisoblanadi —
 * shu tufayli bir xil rasm ikki joyda alohida yuklansa ham bitta
 * aktivga tushadi (`putAssetBytes` ham shundan foydalanadi).
 */
export function assetFromDataUrl(url: string): { assetId: string; mime: string; bytes: Buffer } | null {
  const m = DATA_URL.exec(url);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.byteLength) return null;
  return { assetId: assetIdFor(bytes), mime: m[1], bytes };
}

/**
 * Hujjatdagi barcha `data:` URL larni havolaga almashtiradi va
 * saqlanishi kerak bo'lgan baytlarni qaytaradi.
 */
export function extractAssets(
  generationId: string,
  doc: AcademicDoc | null,
  html: string,
): { doc: AcademicDoc | null; html: string; assets: PendingAsset[] } {
  const assets = new Map<string, PendingAsset>();

  const swap = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const found = assetFromDataUrl(url);
    if (!found) return url;
    if (!assets.has(found.assetId)) assets.set(found.assetId, found);
    return assetUrl(generationId, found.assetId);
  };

  /** Rezyume surati: URL bilan birga `assetId` ham yangilanadi. */
  const swapPhoto = <T extends { url: string; assetId: string }>(photo: T): T => {
    const found = assetFromDataUrl(photo.url);
    if (!found) return photo;
    if (!assets.has(found.assetId)) assets.set(found.assetId, found);
    return { ...photo, url: assetUrl(generationId, found.assetId), assetId: found.assetId };
  };

  /**
   * Maqola sxemasi/diagrammasi (Maqola 2 / AUDIT-17, WP4): `Figure.url`
   * generatsiyada `data:image/png;base64,…` (`figures/png.ts`) — rezyume
   * surati kabi URL BILAN BIRGA `assetId` ham to'ldiriladi, chunki
   * `assetImageResolver` (DOCX qayta render) faqat shu maydondan o'qiydi.
   * `url` bo'lmagan (fallback ro'yxatga tushgan) sxema o'zgarishsiz qoladi.
   */
  const swapFigure = (fig: Figure): Figure => {
    if (!fig.url) return fig;
    const found = assetFromDataUrl(fig.url);
    if (!found) return fig;
    if (!assets.has(found.assetId)) assets.set(found.assetId, found);
    return { ...fig, url: assetUrl(generationId, found.assetId), assetId: found.assetId };
  };

  let nextDoc = doc;
  if (doc) {
    nextDoc = {
      ...doc,
      slides: doc.slides?.map((s) =>
        s.image?.url ? { ...s, image: { ...s.image, url: swap(s.image.url) ?? s.image.url } } : s,
      ),
      images: doc.images?.map((im) => ({ ...im, url: swap(im.url) ?? im.url })),
      // Logotip `logo_uploads`dan `data:` URL sifatida keladi
      // (`lib/server/logo.ts` `logoDataUrl`). PPTX uni build vaqtida
      // shu `data:` dan o'qigan bo'ladi, ko'ruvchi esa — hamma boshqa
      // rasm kabi — aktivdan (`slides[].image.url` naqshi).
      slideLogo: doc.slideLogo?.url
        ? { ...doc.slideLogo, url: swap(doc.slideLogo.url) ?? doc.slideLogo.url }
        : doc.slideLogo,
      /*
       * Rezyume surati (B-2).
       *
       * U ham `data:` URL bo'lib keladi (`lib/server/photo.ts` kesilgan
       * PNG/JPEG beradi). DOCX suratni ichiga olgan bo'ladi, lekin
       * ko'ruvchi va tahrirdan keyingi QAYTA render (`resolveImage`)
       * uchun aktiv SHART: usiz saqlangan `doc_json` da megabaytlik
       * `data:` qolib ketardi va rebuild suratni yo'qotardi.
       */
      resume: doc.resume?.photo?.url ? { ...doc.resume, photo: swapPhoto(doc.resume.photo) } : doc.resume,
      // Maqola sxemalari — har `figure.url` mustaqil ravishda aktivga chiqadi.
      article: doc.article ? { ...doc.article, figures: doc.article.figures.map(swapFigure) } : doc.article,
      // Talaba ishi sxemalari (AUDIT-19) — maqola bilan bir xil yo'l.
      work: doc.work ? { ...doc.work, figures: doc.work.figures.map(swapFigure) } : doc.work,
      /*
       * O'qituvchi hujjati rasmlari (AUDIT-20 WP-D) — hozircha OMR
       * javoblar varag'i PNG i (`teacher/test/omr.ts`).
       *
       * `figures` IXTIYORIY (`TestModel` siz vositalarda umuman yo'q),
       * shuning uchun maqola/talaba ishidan farqli ravishda mavjudligi
       * tekshiriladi. Aktivsiz saqlash mumkin emas edi: DOCX PNG ni
       * ichiga olgan bo'lsa ham, ko'ruvchi (`teacherFlow` →
       * `b.figure?.url`) va TAHRIRDAN KEYINGI qayta render
       * (`assetImageResolver`) aynan shu URL dan o'qiydi — usiz
       * saqlangan `doc_json` da o'nlab kilobaytlik `data:` qolib
       * ketardi va rebuild blankani yo'qotardi.
       */
      teacher: doc.teacher?.figures?.length
        ? { ...doc.teacher, figures: doc.teacher.figures.map(swapFigure) }
        : doc.teacher,
      /*
       * BOSMA O'YIN rasmlari (AUDIT-21 WP-D): krossvord to'ri va javob
       * varag'i PNG i (`games/crossword/svg.ts` → `figurePng`).
       *
       * O'qituvchi hujjatidagi bilan ayni sabab, lekin bu yerda ikkita:
       * (1) aktivsiz ikkita 300 dpi PNG ning base64 i `doc_json` da
       * qolib ketardi — har ochilishda yuzlab kilobayt JSON tarmoqdan
       * o'tardi; (2) sayqal/«Tuzatish» dan keyingi QAYTA render
       * (`doc-polish.ts renderGameFile` → `assetImageResolver`) faqat
       * `assetId` dan o'qiydi, ya'ni usiz tuzatilgan krossvordning DOCX i
       * to'rsiz chiqardi (`figures` IXTIYORIY — kartalarda umuman yo'q).
       */
      game: doc.game?.figures?.length ? { ...doc.game, figures: doc.game.figures.map(swapFigure) } : doc.game,
      // «O'z shablonim» fonlari — har rol PNG si aktivga (bir xil rasm bir marta).
      customTemplate: doc.customTemplate
        ? {
            ...doc.customTemplate,
            previews: Object.fromEntries(
              Object.entries(doc.customTemplate.previews).map(([role, p]) => [role, p ? { ...p, png: swap(p.png) ?? p.png } : p]),
            ),
          }
        : doc.customTemplate,
    };
  }

  // HTML dagi qolgan data: URL lar (masalan `<img src="data:...">`).
  const nextHtml = html.replace(
    /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]{64,})/g,
    (full) => swap(full) ?? full,
  );

  return { doc: nextDoc, html: nextHtml, assets: [...assets.values()] };
}

/** Muddatsiz saqlanadi (`011_no_expiry.sql`) — generatsiya o'chsa CASCADE bilan ketadi. */
export async function putAssets(generationId: string, assets: PendingAsset[]): Promise<void> {
  if (!assets.length) return;
  for (const a of assets) {
    await query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       ON CONFLICT (generation_id, asset_id) DO NOTHING`,
      [generationId, a.assetId, a.mime, a.bytes.byteLength, a.bytes],
    );
  }
}

/**
 * Bitta rasm baytini to'g'ridan-to'g'ri aktivga yozadi (masalan qayta
 * chizilgan/yuklangan slayd rasmi) va `assetId` qaytaradi.
 *
 * `assetIdFor` bilan bir xil SHA-256 — bir xil bayt ikki marta
 * yuklansa `ON CONFLICT DO NOTHING` tufayli bitta qator qoladi.
 */
export async function putAssetBytes(generationId: string, mime: string, bytes: Buffer): Promise<string> {
  const assetId = assetIdFor(bytes);
  await putAssets(generationId, [{ assetId, mime, bytes }]);
  return assetId;
}

/*
 * Screen copies of slide images (ops sprint D5, `docs/ops/PLAN.md`; O4 WP-F).
 *
 * A slide image is stored as the provider gave it (~0.6–1.3 MB JPEG,
 * 1024 px) and shown at 140–360 CSS px on a phone. The worker keeps a light
 * copy next to it: max 1024 px wide, JPEG q80 (mozjpeg tables, progressive,
 * no trellis). JPEG and not WebP: measured on 13 real Gemini images the
 * copy is −86 % at ~170 ms CPU per image; WebP q80 is only −89 % at ~2× the
 * CPU (effort 4: ~4×), and JPEG decodes in every WKWebView/Android WebView
 * Telegram still supports (WebP needs iOS 14+).
 *
 * The copy is its own `generation_assets` row under a derived id (no
 * migration): `<assetId>d1` is 26 hex, while content ids are 24 hex, so it
 * never collides with a content asset or a thumbnail (`thumb.ts`). Cleanup
 * paths delete by `generation_id` and take it along. The original row is
 * untouched — PPTX rebuild (`assetImageResolver`) and downloads read it.
 */

/** Screen copy bounds (D5). */
export const VIEW_MAX_WIDTH = 1024;
export const VIEW_JPEG_QUALITY = 80;
/** A copy is kept only when it is at most this share of the original — else the original is served. */
export const VIEW_MAX_RATIO = 0.8;
/** Time the worker may spend on copies per deck; slides left over fall back to the original. */
export const VIEW_BUDGET_MS = 20_000;
const VIEW_SUFFIX = "d1";
const VIEW_SOURCES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Decode guard: a slide image is ~1 Mpx; anything near this is not a photo we made. */
const VIEW_MAX_INPUT_PIXELS = 40_000_000;

/** Id of the screen copy of `assetId` (`generation_assets` row). */
export function viewAssetId(assetId: string): string {
  return `${assetId}${VIEW_SUFFIX}`;
}

/**
 * Screen copy bytes (JPEG) or `null` when the original should be served:
 * not a raster photo type, real transparency (JPEG would paint it black),
 * or the copy would not save at least `1 − VIEW_MAX_RATIO`. Throws on
 * undecodable bytes — the caller logs and skips.
 */
export async function makeViewCopy(bytes: Buffer, mime: string): Promise<Buffer | null> {
  if (!VIEW_SOURCES.has(mime)) return null;
  const sharp = (await import("sharp")).default;
  const opts = { failOn: "error" as const, limitInputPixels: VIEW_MAX_INPUT_PIXELS };
  const meta = await sharp(bytes, opts).metadata();
  if (meta.hasAlpha && !(await sharp(bytes, opts).stats()).isOpaque) return null;
  const out = await sharp(bytes, opts)
    .rotate()
    .resize({ width: VIEW_MAX_WIDTH, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({
      quality: VIEW_JPEG_QUALITY,
      mozjpeg: true,
      trellisQuantisation: false,
      overshootDeringing: false,
      optimiseScans: false,
    })
    .toBuffer();
  return out.byteLength <= bytes.byteLength * VIEW_MAX_RATIO ? out : null;
}

/**
 * Screen copies for the slide images of a finished deck (worker step,
 * before `commitJobResult` — the copies are written in the same
 * transaction as the result, so a lost lease leaves none behind).
 *
 * Only `doc.slides[].image` gets a copy (logos, template backgrounds,
 * figures are small or need exact pixels). One image at a time: the box is
 * shared, and a 30-slide deck is ~5 s of CPU this way. Never throws — a
 * failed copy only means the viewer gets the original.
 */
export async function slideViewCopies(
  generationId: string,
  doc: AcademicDoc | null,
  assets: PendingAsset[],
  budgetMs = VIEW_BUDGET_MS,
): Promise<PendingAsset[]> {
  if (!doc?.slides?.length || !assets.length) return [];
  const re = ownAssetUrlRe(generationId);
  const byId = new Map(assets.map((a) => [a.assetId, a]));
  const wanted = new Set<string>();
  for (const s of doc.slides) {
    const m = s.image?.url ? re.exec(s.image.url) : null;
    if (m && byId.has(m[1])) wanted.add(m[1]);
  }
  const deadline = Date.now() + budgetMs;
  const out: PendingAsset[] = [];
  for (const id of wanted) {
    if (Date.now() >= deadline) {
      console.warn(`[assets] ${generationId}: ekran nusxalari vaqti tugadi — qolgan rasmlar asl holida beriladi`);
      break;
    }
    const a = byId.get(id)!;
    try {
      const bytes = await makeViewCopy(a.bytes, a.mime);
      if (bytes) out.push({ assetId: viewAssetId(id), mime: "image/jpeg", bytes });
    } catch (e) {
      console.warn(`[assets] ${generationId}: ekran nusxasi yasalmadi (${id}):`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/**
 * The viewer's read (`?view=1`): the screen copy when it exists, else the
 * original. Ownership is checked in the same SQL as `getAsset`.
 *
 * `final` — the deck is COMPLETED: a missing copy will never appear (old
 * deck, user upload, logo), so the original may be cached as long as a
 * copy. While a deck is still building the copy does not exist YET (live
 * view) — the route must not pin the original under the `?view=1` URL.
 */
export async function getViewAsset(
  generationId: string,
  assetId: string,
  userId: string,
): Promise<{ bytes: Buffer; mime: string; variant: "view" | "original"; final: boolean } | null> {
  const viewId = viewAssetId(assetId);
  const row = await queryOne<{ bytes: Buffer; mime: string; is_view: boolean; final: boolean }>(
    `SELECT a.bytes, a.mime, a.asset_id = $4 AS is_view, g.status = 'COMPLETED' AS final
       FROM generation_assets a
       JOIN generations g ON g.id = a.generation_id
      WHERE a.generation_id = $1 AND a.asset_id IN ($2, $4) AND g.user_id = $3
      ORDER BY (a.asset_id = $4) DESC
      LIMIT 1`,
    [generationId, assetId, userId, viewId],
  );
  if (!row) return null;
  return { bytes: row.bytes, mime: row.mime, variant: row.is_view ? "view" : "original", final: row.final };
}

/** O'z generatsiyasining aktiv URL naqshi — boshqa `id` bilan mos kelmaydi. */
export const ASSET_URL_RE = /^\/api\/generations\/([^/]+)\/assets\/([0-9a-f]+)$/;

/** Faqat SHU `generationId`ga tegishli aktiv URL bilan mos keladigan regex. */
export function ownAssetUrlRe(generationId: string): RegExp {
  return new RegExp(`^/api/generations/${generationId}/assets/([0-9a-f]+)$`);
}

/**
 * Tahrirdan keyingi PPTX qayta render uchun rasm hal qiluvchi.
 *
 * Faqat `/api/generations/{SHU genId}/assets/{hex}` naqshiga mos URL
 * `getAsset` (egalik SQL) bilan o'qiladi — boshqa URL (begona generatsiya,
 * `https:`, ...) `null` qaytaradi va `getAsset` UMUMAN chaqirilmaydi
 * (SSRF/IDOR himoyasi — `render-pptx.ts` `opts.resolveImage`).
 */
export function assetImageResolver(
  generationId: string,
  userId: string,
): (url: string) => Promise<ImageBytes | null> {
  const re = ownAssetUrlRe(generationId);
  return async (url: string): Promise<ImageBytes | null> => {
    const m = re.exec(url);
    if (!m) return null;
    const assetId = m[1];
    const asset = await getAsset(generationId, assetId, userId);
    if (!asset) return null;
    const type: "jpg" | "png" = asset.mime === "image/png" ? "png" : "jpg";
    const mime = type === "png" ? "image/png" : "image/jpeg";
    return { data: `${mime};base64,${asset.bytes.toString("base64")}`, type };
  };
}

/** Egalik SQL da tekshiriladi — begona hujjat rasmini ololmaydi. */
export async function getAsset(
  generationId: string,
  assetId: string,
  userId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await queryOne<{ bytes: Buffer; mime: string }>(
    `SELECT a.bytes, a.mime
       FROM generation_assets a
       JOIN generations g ON g.id = a.generation_id
      WHERE a.generation_id = $1 AND a.asset_id = $2 AND g.user_id = $3`,
    [generationId, assetId, userId],
  );
  return row ?? null;
}

/** Bitta generatsiyaning barcha aktivlarini o'chiradi. */
export async function deleteAssets(generationId: string): Promise<void> {
  await query("DELETE FROM generation_assets WHERE generation_id = $1", [generationId]);
}

/**
 * BITTA aktivni o'chiradi (B-5 — tahrirdan keyin eskiz keshi).
 *
 * `client` beriladigan bo'lsa o'chirish CHAQIRUVCHINING tranzaksiyasida
 * bajariladi: `rebuildFile` yangi faylni va eskiz keshining o'chishini
 * bitta yozuvda ushlab turadi, aks holda render yiqilib rollback bo'lsa
 * kesh behuda o'chgan bo'lardi.
 */
export async function deleteAssetById(
  generationId: string,
  assetId: string,
  client?: { query: (text: string, values?: unknown[]) => Promise<unknown> },
): Promise<void> {
  const sql = "DELETE FROM generation_assets WHERE generation_id = $1 AND asset_id = $2";
  if (client) await client.query(sql, [generationId, assetId]);
  else await query(sql, [generationId, assetId]);
}
