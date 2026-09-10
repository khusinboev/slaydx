import "server-only";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { query, queryOne } from "./db";
import { ApiError } from "./api";
import { toPdf } from "./pdf";
import {
  parsePptxTemplate,
  TemplateError,
  type CustomTemplate,
  type TemplatePreview,
  type TemplateProfile,
  type TemplateRole,
} from "../generation/pptx-template";
import { renderLayoutSheet } from "../generation/render-pptx-template";

const run = promisify(execFile);

/**
 * «O'z shablonim» — PPTX namunasini yuklash (Shablonlar 2, Sprint B, B1).
 *
 * `logo.ts` naqshi: bu fayl shartnomaning SERVER yarmi — hajm chegarasi
 * (20 MB), sniff (zip + `ppt/presentation.xml`, `content-type` ga
 * ishonilmaydi), tahlil (`parsePptxTemplate`), fon rasterlash va saqlash.
 * Autentifikatsiya route'da.
 *
 * Rasterlash NEGA yuklashda: LibreOffice 20–40 s oladi; generatsiya
 * paytida qilinsa har deka shuncha kutardi, worker konteynerida esa
 * LibreOffice yo'q. Yuklash bir marta — profil va fonlar bazada,
 * keyin har deka ularni tayyor oladi.
 */

export const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;
/** Fon rasteri kengligi (px) — ko'ruvchi 960 px gacha kattalashtiradi; 72 dpi × 13.33" ≈ 960. */
const RASTER_DPI = 72;

function assetIdFor(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

/** Zip imzosi + `ppt/presentation.xml` nomi bayt ichida — PPTX ekanining tez tekshiruvi. */
export function looksLikePptx(bytes: Buffer): boolean {
  if (bytes.length < 22) return false;
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return false;
  return bytes.includes("ppt/presentation.xml", 0, "latin1");
}

export function pdftoppmBinary(): string | null {
  const explicit = process.env.PDFTOPPM_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  return ["/usr/bin/pdftoppm", "/usr/local/bin/pdftoppm"].find((p) => existsSync(p)) ?? null;
}

/** PGM (P5) o'rtacha yorqinligi — fon qora-oqligini aniqlash uchun. */
export function pgmIsDark(pgm: Buffer): boolean {
  // P5\n<w> <h>\n<max>\n<bytes>
  const head = pgm.subarray(0, 64).toString("latin1");
  const m = head.match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!m) return false;
  const n = Number(m[1]) * Number(m[2]);
  const start = m[0].length;
  const px = pgm.subarray(start, start + n);
  if (!px.length) return false;
  let sum = 0;
  for (let i = 0; i < px.length; i++) sum += px[i];
  return sum / px.length < 128;
}

/**
 * Layout fonlari: bo'sh slaydli varaq → PDF → PNG (rol bo'yicha) + qorong'ilik.
 * `pdftoppm`/LibreOffice bo'lmasa `{}` — ko'ruvchi tema ranglari bilan chizadi,
 * yuklash yiqilmaydi.
 */
export async function rasterizeTemplate(
  bytes: Uint8Array,
  profile: TemplateProfile,
  deps: { toPdf?: typeof toPdf; pdftoppm?: string | null } = {},
): Promise<Partial<Record<TemplateRole, TemplatePreview>>> {
  const bin = deps.pdftoppm === undefined ? pdftoppmBinary() : deps.pdftoppm;
  if (!bin) return {};
  const { bytes: sheet, pages } = await renderLayoutSheet(bytes, profile);
  const pdf = await (deps.toPdf ?? toPdf)(sheet, "layoutlar.pptx");
  if (!pdf) return {};

  const dir = await mkdtemp(join(tmpdir(), "slaydx-tpl-"));
  try {
    const src = join(dir, "l.pdf");
    await writeFile(src, pdf);
    await run(bin, ["-r", String(RASTER_DPI), "-png", src, join(dir, "pg")], { timeout: 60_000 });
    await run(bin, ["-r", "4", "-gray", src, join(dir, "gray")], { timeout: 30_000 });
    const files = await readdir(dir);
    const pngs = files.filter((f) => /^pg-?\d+\.png$/.test(f)).sort(pageOrder);
    const pgms = files.filter((f) => /^gray-?\d+\.pgm$/.test(f)).sort(pageOrder);
    const out: Partial<Record<TemplateRole, TemplatePreview>> = {};
    for (let i = 0; i < pages.length && i < pngs.length; i++) {
      const png = await readFile(join(dir, pngs[i]));
      const dark = pgms[i] ? pgmIsDark(await readFile(join(dir, pgms[i]))) : false;
      const preview: TemplatePreview = { png: `data:image/png;base64,${png.toString("base64")}`, dark };
      for (const role of pages[i].roles) out[role] = preview;
    }
    return out;
  } catch (e) {
    console.warn("[template] rasterlash", e instanceof Error ? e.message : e);
    return {};
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function pageOrder(a: string, b: string): number {
  return Number(a.match(/(\d+)\./)?.[1] ?? 0) - Number(b.match(/(\d+)\./)?.[1] ?? 0);
}

export type TemplateUploadResult = {
  assetId: string;
  name: string;
  size: number;
  /** Ko'ruvchi/galereya uchun yengil nusxa (baytsiz). */
  template: CustomTemplate;
};

export async function putTemplate(
  userId: string,
  bytes: Buffer,
  name: string,
  profile: TemplateProfile,
  previews: CustomTemplate["previews"],
): Promise<TemplateUploadResult> {
  const assetId = assetIdFor(bytes);
  await query(
    `INSERT INTO template_uploads (user_id, asset_id, name, size_bytes, bytes, profile, previews)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     ON CONFLICT (user_id, asset_id) DO UPDATE SET profile = EXCLUDED.profile, previews = EXCLUDED.previews, name = EXCLUDED.name`,
    [userId, assetId, name, bytes.byteLength, bytes, JSON.stringify(profile), JSON.stringify(previews)],
  );
  return { assetId, name, size: bytes.byteLength, template: { assetId, name, profile, previews } };
}

/** Egalik SQL da — begona namunani ololmaydi. */
export async function getTemplate(
  userId: string,
  assetId: string,
): Promise<{ bytes: Buffer; template: CustomTemplate } | null> {
  if (!/^[0-9a-f]{24}$/i.test(assetId)) return null;
  const row = await queryOne<{ bytes: Buffer; name: string; profile: TemplateProfile; previews: CustomTemplate["previews"] }>(
    `SELECT bytes, name, profile, previews FROM template_uploads WHERE user_id = $1 AND asset_id = $2`,
    [userId, assetId],
  );
  if (!row) return null;
  return { bytes: row.bytes, template: { assetId: assetId.toLowerCase(), name: row.name, profile: row.profile, previews: row.previews ?? {} } };
}

/**
 * Worker uchun: `templateAssetId` → bayt + yengil nusxa. Topilmasa
 * `undefined` — XATO EMAS: deka oddiy shablon bilan chiqadi (logotip naqshi).
 */
export async function templateForJob(
  userId: string,
  assetId: string,
): Promise<{ bytes: Buffer; template: CustomTemplate } | undefined> {
  if (!userId || !assetId) return undefined;
  return (await getTemplate(userId, assetId).catch(() => null)) ?? undefined;
}

/** Foydalanuvchining namunalari (galereya «O'z shablonim» ro'yxati) — baytsiz. */
export async function listTemplates(userId: string): Promise<CustomTemplate[]> {
  const rows = await query<{ asset_id: string; name: string; profile: TemplateProfile; previews: CustomTemplate["previews"] }>(
    `SELECT asset_id, name, profile, previews FROM template_uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 12`,
    [userId],
  );
  return rows.map((r) => ({ assetId: r.asset_id, name: r.name, profile: r.profile, previews: r.previews ?? {} }));
}

export async function deleteTemplate(userId: string, assetId: string): Promise<boolean> {
  if (!/^[0-9a-f]{24}$/i.test(assetId)) return false;
  const rows = await query(`DELETE FROM template_uploads WHERE user_id = $1 AND asset_id = $2 RETURNING asset_id`, [userId, assetId]);
  return rows.length > 0;
}

export type UploadDeps = {
  put?: typeof putTemplate;
  rasterize?: typeof rasterizeTemplate;
};

/**
 * So'rovdan namunani o'qib, tahlil qilib, rasterlab saqlaydi.
 * `logo.ts` `uploadLogo` kabi oddiy Web `Request` bilan — test Next
 * kontekstisiz chaqiradi.
 */
export async function uploadTemplate(req: Request, userId: string, deps: UploadDeps = {}): Promise<TemplateUploadResult> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > TEMPLATE_MAX_BYTES + 64 * 1024) {
    throw new ApiError("Fayl 20 MB dan katta", 413);
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  if (file.size > TEMPLATE_MAX_BYTES) throw new ApiError("Fayl 20 MB dan katta", 413);
  if (file.size === 0) throw new ApiError("Fayl bo'sh", 400);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!looksLikePptx(bytes)) throw new ApiError("Faqat PPTX (PowerPoint) fayl qabul qilinadi", 415);

  let profile: TemplateProfile;
  try {
    profile = await parsePptxTemplate(bytes);
  } catch (e) {
    if (e instanceof TemplateError) {
      const msg =
        e.code === "no-content"
          ? "Namunada sarlavha va matn joyli maket topilmadi — boshqa faylni sinab ko'ring"
          : e.code === "no-layouts"
            ? "Namunada slayd maketlari (layout) topilmadi"
            : "Fayl PPTX sifatida o'qilmadi";
      throw new ApiError(msg, 422, { code: e.code });
    }
    throw e;
  }

  const previews = await (deps.rasterize ?? rasterizeTemplate)(bytes, profile);
  const name = String(file.name || "namuna.pptx").replace(/[\r\n\t]/g, " ").trim().slice(0, 120) || "namuna.pptx";
  return (deps.put ?? putTemplate)(userId, bytes, name, profile, previews);
}
