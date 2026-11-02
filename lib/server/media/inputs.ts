import "server-only";
import { normalize, type CatalogEntry, type ImageParam } from "../../studio-core";
import { MEDIA_CATALOG, STUDIO_INPUT_MAX_BYTES, STUDIO_INPUT_MIMES, UPSCALE_MAX_INPUT_SIDE, studioPurposeOf } from "../../media/catalog";
import { studioModelOf } from "../../media/studio-pricing";
import { imageDims } from "../../generation/slide-images";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { getPhoto, putPhoto } from "../photo";
import { readUploadForm } from "../upload-body";

/**
 * Studio P2b input pictures (docs/studio/P2B-SPEC.md): what an edit / upscale / background-removal job reads.
 *
 * An input is ALWAYS a `photo_uploads` row (kind `studio`) of the user: a fresh upload («Rasm yuklash»,
 * `POST /api/media/inputs`) or a copy of one of the user's OWN finished Studio pictures («Tahrirlash» / «Sifatini
 * oshirish» / «Fonni olib tashlash» on a result, `POST /api/media/inputs/from-result`). Ownership is in the SQL of every
 * read (`user_id = $1`); a job carries only asset ids, so another user's picture can never be named, priced or drawn:
 *
 *   submit   `studioInputsError` — every id exists for THIS user, type and size fit the param, upscale inputs fit the
 *            factor's side limit — a 400 BEFORE anything is priced or charged;
 *   worker   `studioInputsForJob` — the same rows to bytes (a row gone meanwhile = the engine fails → full refund).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Longest side an uploaded input may have (a sanity bound; edit models re-frame anyway). */
export const STUDIO_INPUT_MAX_SIDE = 4096;
/**
 * All input pictures of ONE job together (review MINOR-5): they travel to the provider inline (base64, +33 %), so three
 * 5 MB pictures would make a ~20 MB request body. 8 MB of pictures ≈ 11 MB of JSON.
 */
export const STUDIO_INPUTS_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export type StudioInputInfo = { assetId: string; mime: string; size: number; w: number | null; h: number | null };

const imageParamsOf = (entry: CatalogEntry): ImageParam[] => entry.params.filter((p): p is ImageParam => p.type === "image");

/** The asset ids of `values` per image param of the chosen Studio model (normalized: valid ids, ≤ max). */
export function studioInputIds(values: Readonly<Record<string, unknown>>): { entry: CatalogEntry; byParam: Record<string, string[]> } | null {
  const modelId = studioModelOf(values);
  const entry = studioPurposeOf(modelId) ? MEDIA_CATALOG.byId(modelId) : null;
  if (!entry) return null;
  const p = normalize(entry.params, values);
  const byParam: Record<string, string[]> = {};
  for (const param of imageParamsOf(entry)) byParam[param.name] = [...((p[param.name] as readonly string[] | undefined) ?? [])];
  return { entry, byParam };
}

type Row = { asset_id: string; mime: string; size_bytes: string; head: Buffer };

/**
 * Why the inputs of a Studio request must be refused (Uzbek, for a 400 before charging), `null` when they are fine or
 * the model takes none. ONE query, ownership in its WHERE.
 */
export async function studioInputsError(userId: string, values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const found = studioInputIds(values);
  if (!found) return null;
  return inputsError(userId, found, values);
}

/**
 * The same checks for a Studio VIDEO job's photos (P4 review N2): the start image, the end frame, the second photo of
 * a two-photo effect — `names` are the image params the job actually sends (`studioVideoImageParams`). Type (sniffed at
 * upload), per-photo size and the job's total (the frames travel inline as base64 too) are refused BEFORE charging.
 */
export async function studioVideoInputsError(userId: string, entry: CatalogEntry, values: Readonly<Record<string, unknown>>, names: readonly string[]): Promise<string | null> {
  const p = normalize(entry.params, values);
  const byParam: Record<string, string[]> = {};
  for (const name of names) byParam[name] = [...((p[name] as readonly string[] | undefined) ?? [])];
  const sent = entry.params.filter((x) => names.includes(x.name));
  return inputsError(userId, { entry: { ...entry, params: sent }, byParam }, values);
}

async function inputsError(userId: string, found: { entry: CatalogEntry; byParam: Record<string, string[]> }, values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const all = Object.values(found.byParam).flat();
  if (all.length === 0) return null;
  // The first 256 KB hold the PNG / JPEG size header (EXIF before SOF included).
  const rows = await query<Row>(
    `SELECT asset_id, mime, size_bytes, substring(bytes from 1 for 262144) AS head
       FROM photo_uploads WHERE user_id = $1 AND asset_id = ANY($2::text[])`,
    [userId, all],
  );
  const byId = new Map(rows.map((r) => [r.asset_id, r]));
  for (const param of imageParamsOf(found.entry)) {
    for (const id of found.byParam[param.name] ?? []) {
      const row = byId.get(id);
      if (!row) return "Rasm topilmadi — rasmni qayta yuklang.";
      if (!param.mimes.includes(row.mime)) return `${param.label}: faqat PNG yoki JPEG`;
      if (Number(row.size_bytes) > param.maxBytes) return `${param.label}: fayl ${Math.round(param.maxBytes / (1024 * 1024))} MB dan katta`;
    }
  }
  const total = all.reduce((sum, id) => sum + Number(byId.get(id)?.size_bytes ?? 0), 0);
  if (total > STUDIO_INPUTS_MAX_TOTAL_BYTES) return `Rasmlar jami ${STUDIO_INPUTS_MAX_TOTAL_BYTES / (1024 * 1024)} MB dan oshmasin — kamroq yoki kichikroq rasm tanlang.`;
  // Upscale: the input's longest side must fit the factor (the price is the ≤ 16.8 MP output's upper bound).
  const factor = String(normalize(found.entry.params, values).factor ?? "");
  const side = found.entry.capabilities.includes("upscale") ? UPSCALE_MAX_INPUT_SIDE[factor] : undefined;
  if (side) {
    for (const id of all) {
      const dims = imageDims(byId.get(id)!.head);
      if (!dims) return "Rasm o‘lchamini aniqlab bo‘lmadi — boshqa rasm tanlang.";
      if (Math.max(dims.w, dims.h) > side) {
        return factor === "4" ? `×4 uchun rasm ${side} pikseldan katta bo‘lmasin — ×2 ni tanlang.` : `Rasm ${side} pikseldan katta — u allaqachon yetarlicha katta.`;
      }
    }
  }
  return null;
}

/** The worker's view: the job's inputs as bytes, in the given order; a row that is gone is simply missing. */
export async function studioInputsForJob(userId: string, values: Readonly<Record<string, unknown>>): Promise<Record<string, { mime: string; base64: string }[]> | undefined> {
  const found = studioInputIds(values);
  if (!found) return undefined;
  const out: Record<string, { mime: string; base64: string }[]> = {};
  for (const [name, ids] of Object.entries(found.byParam)) {
    const list: { mime: string; base64: string }[] = [];
    for (const id of ids) {
      const row = await getPhoto(userId, id).catch(() => null);
      if (row) list.push({ mime: row.mime, base64: row.bytes.toString("base64") });
    }
    out[name] = list;
  }
  return out;
}

/** PNG / JPEG by magic bytes, length-guarded (a 1–3 byte file is simply «not an image», never a RangeError). */
export function sniffInput(bytes: Buffer): (typeof STUDIO_INPUT_MIMES)[number] | null {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Stores one input picture (type sniffed from the bytes, size and side checked) under the user's upload quota. */
async function storeInput(userId: string, bytes: Buffer): Promise<StudioInputInfo> {
  if (bytes.byteLength === 0) throw new ApiError("Fayl bo'sh", 400);
  if (bytes.byteLength > STUDIO_INPUT_MAX_BYTES) throw new ApiError("Rasm 5 MB dan katta", 413);
  const mime = sniffInput(bytes);
  if (!mime) throw new ApiError("Faqat PNG yoki JPEG qabul qilinadi", 415);
  const dims = imageDims(bytes);
  if (dims && (dims.w > STUDIO_INPUT_MAX_SIDE || dims.h > STUDIO_INPUT_MAX_SIDE)) throw new ApiError(`Rasm ${STUDIO_INPUT_MAX_SIDE} pikseldan katta bo'lmasin`, 422);
  const assetId = await putPhoto(userId, bytes, mime, { kind: "studio" });
  return { assetId, mime, size: bytes.byteLength, w: dims?.w ?? null, h: dims?.h ?? null };
}

/** `POST /api/media/inputs` (multipart `file`). */
export async function uploadStudioInput(req: Request, userId: string): Promise<StudioInputInfo> {
  const form = await readUploadForm(req, STUDIO_INPUT_MAX_BYTES + 64 * 1024, "Rasm 5 MB dan katta");
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  return storeInput(userId, Buffer.from(await file.arrayBuffer()));
}

/**
 * `POST /api/media/inputs/from-result` `{generationId, assetId}`: copies a picture of the user's OWN finished Studio job
 * into their inputs. Ownership, tool and status are in the SQL; another user's job (or a non-Studio one) is a 404, the
 * same answer as a missing one — nothing tells the caller it exists.
 */
export async function importStudioResult(userId: string, body: Record<string, unknown>): Promise<StudioInputInfo> {
  const generationId = typeof body.generationId === "string" ? body.generationId.trim() : "";
  const assetId = typeof body.assetId === "string" ? body.assetId.trim().toLowerCase() : "";
  if (!UUID_RE.test(generationId) || !/^[0-9a-f]{8,64}$/.test(assetId)) throw new ApiError("Noto'g'ri so'rov", 400);
  // The size is checked in SQL BEFORE the bytes are read (review MINOR-4): an oversized result never leaves the table.
  const row = await queryOne<{ size_bytes: string; bytes: Buffer | null }>(
    `SELECT a.size_bytes, CASE WHEN a.size_bytes <= $4 THEN a.bytes END AS bytes
       FROM generation_assets a
       JOIN generations g ON g.id = a.generation_id
      WHERE a.generation_id = $1 AND a.asset_id = $2 AND g.user_id = $3
        AND g.tool_id = 'studio-image' AND g.status = 'COMPLETED' AND g.files_purged_at IS NULL`,
    [generationId, assetId, userId, STUDIO_INPUT_MAX_BYTES],
  );
  if (!row) throw new ApiError("Rasm topilmadi", 404, { code: "not_found" });
  if (!row.bytes) throw new ApiError("Natija juda katta (5 MB dan ortiq) — avval kichikroq variantni tanlang yoki yuklab olib, kichraytirib yuklang.", 413, { code: "too_large" });
  return storeInput(userId, Buffer.from(row.bytes));
}
