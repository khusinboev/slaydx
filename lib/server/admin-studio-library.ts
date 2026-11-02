import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { adminTx } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { query } from "./db";
import { readUploadForm } from "./upload-body";
import { availableModels } from "./media/availability";
import { invalidateLibrary, previewUrl } from "./media/library";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } from "../media/catalog";
import { LIBRARY_CATEGORIES, LIBRARY_LIMITS, cleanSlots, isLibraryCategory, templateError, type TemplateSlot } from "../media/library";
import { imageDims } from "../generation/slide-images";

/**
 * Admin «Studio kutubxonasi» (docs/studio/P2B-SPEC.md): the prompt library and the image templates — list, add, edit,
 * enable / disable, reorder, delete, preview pictures.
 *
 * Rules (CLAUDE.md admin rules): permission on the server only (`settings.view` to read, `settings.edit` — step-up — to
 * write, `app/api/admin/studio-library/**`); every write has a reason and writes its audit row (before / after) in the
 * SAME transaction; an optional `expectedUpdatedAt` turns a concurrent edit into 409 `stale`. A template is validated
 * against the live catalog ParamSchema (`templateError`): an invalid one is a 400 and is never stored.
 */

export type AdminPrompt = {
  id: string;
  category: string;
  title: string;
  prompt: string;
  previewId: string | null;
  previewUrl: string | null;
  sort: number;
  enabled: boolean;
  updatedAt: string;
};

export type AdminTemplate = {
  id: string;
  category: string;
  title: string;
  modelId: string;
  modelLabel: string | null;
  params: Record<string, unknown>;
  skeleton: string;
  slots: TemplateSlot[];
  previewId: string | null;
  previewUrl: string | null;
  sort: number;
  enabled: boolean;
  updatedAt: string;
  /** Why the template does not validate against the catalog now (hidden from users), `null` = valid. */
  error: string | null;
  /** Its model can be sold right now (provider on + keyed + not switched off). */
  modelAvailable: boolean;
};

export type LibraryOverview = {
  categories: { id: string; label: string }[];
  /** Models a template may use (the Studio picture models) with their ParamSchema for the editor. */
  models: { id: string; label: string; available: boolean; params: unknown }[];
  prompts: AdminPrompt[];
  templates: AdminTemplate[];
};

type PromptRow = { id: string; category: string; title: string; prompt: string; preview_id: string | null; sort: number; enabled: boolean; updated_at: Date };
type TemplateRow = PromptRow & { model_id: string; params: Record<string, unknown>; skeleton: string; slots: unknown };

const iso = (d: Date) => new Date(d).toISOString();

function promptOf(r: PromptRow): AdminPrompt {
  return { id: r.id, category: r.category, title: r.title, prompt: r.prompt, previewId: r.preview_id, previewUrl: previewUrl(r.preview_id), sort: r.sort, enabled: r.enabled, updatedAt: iso(r.updated_at) };
}

const studioModel = (id: string) => (MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed.includes(id) ? MEDIA_CATALOG.byId(id) : null);

function templateOf(r: TemplateRow, available: ReadonlySet<string>): AdminTemplate {
  const error = templateError({ modelId: r.model_id, params: r.params, skeleton: r.skeleton, slots: r.slots }, studioModel(r.model_id));
  const slots = Array.isArray(r.slots) ? cleanSlots(r.slots.filter((s): s is Record<string, unknown> => !!s && typeof s === "object")) : [];
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    modelId: r.model_id,
    modelLabel: MEDIA_CATALOG.byId(r.model_id)?.label ?? null,
    params: r.params,
    skeleton: r.skeleton,
    slots,
    previewId: r.preview_id,
    previewUrl: previewUrl(r.preview_id),
    sort: r.sort,
    enabled: r.enabled,
    updatedAt: iso(r.updated_at),
    error,
    modelAvailable: available.has(r.model_id),
  };
}

const PROMPT_COLS = "id::text AS id, category, title, prompt, preview_id, sort, enabled, updated_at";
const TEMPLATE_COLS = `${PROMPT_COLS.replace(", prompt", "")}, model_id, params, skeleton, slots`;

export async function libraryOverview(): Promise<LibraryOverview> {
  const [prompts, templates, available] = await Promise.all([
    query<PromptRow>(`SELECT ${PROMPT_COLS} FROM studio_prompts ORDER BY category, sort, id`),
    query<TemplateRow>(`SELECT ${TEMPLATE_COLS} FROM studio_templates ORDER BY sort, id`),
    availableModels(STUDIO_IMAGE_PURPOSE),
  ]);
  const ok = new Set(available);
  return {
    categories: LIBRARY_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    models: MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed.map((id) => {
      const e = MEDIA_CATALOG.byId(id)!;
      return { id, label: e.label, available: ok.has(id), params: e.params };
    }),
    prompts: prompts.map(promptOf),
    templates: templates.map((t) => templateOf(t, ok)),
  };
}

/* ───────────────────────── parsing ───────────────────────── */

const text = (raw: unknown, label: string, min: number, max: number): string => {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (s.length < min || s.length > max) throw new ApiError(`${label}: ${min}–${max} belgi bo'lsin`, 400);
  return s;
};

function category(raw: unknown): string {
  if (!isLibraryCategory(raw)) throw new ApiError("Toifa noma'lum", 400);
  return raw;
}

function bool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") throw new ApiError("enabled true yoki false bo'lishi kerak", 400);
  return raw;
}

function sortOf(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 1_000_000) throw new ApiError("Tartib 0–1 000 000 butun son bo'lsin", 400);
  return raw as number;
}

async function previewOf(client: PoolClient, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^[0-9a-f]{24}$/.test(raw)) throw new ApiError("Rasm identifikatori noto'g'ri", 400);
  const hit = await client.query("SELECT 1 FROM studio_library_previews WHERE id = $1", [raw]);
  if (!hit.rowCount) throw new ApiError("Ko'rinish rasmi topilmadi — qayta yuklang", 400);
  return raw;
}

type PromptInput = { category: string; title: string; prompt: string; sort: number; enabled: boolean; previewId: unknown };

function parsePrompt(body: Record<string, unknown>, prev?: AdminPrompt): PromptInput {
  return {
    category: category(body.category ?? prev?.category),
    title: text(body.title ?? prev?.title, "Sarlavha", 1, LIBRARY_LIMITS.title),
    prompt: text(body.prompt ?? prev?.prompt, "Prompt", 3, LIBRARY_LIMITS.prompt),
    sort: sortOf(body.sort, prev?.sort ?? 1000),
    enabled: bool(body.enabled, prev?.enabled ?? true),
    previewId: body.previewId === undefined ? (prev?.previewId ?? null) : body.previewId,
  };
}

type TemplateInput = { category: string; title: string; modelId: string; params: Record<string, unknown>; skeleton: string; slots: TemplateSlot[]; sort: number; enabled: boolean; previewId: unknown };

function parseTemplate(body: Record<string, unknown>, prev?: AdminTemplate): TemplateInput {
  const modelId = typeof (body.modelId ?? prev?.modelId) === "string" ? String(body.modelId ?? prev?.modelId) : "";
  const params = body.params ?? prev?.params ?? {};
  const skeleton = text(body.skeleton ?? prev?.skeleton, "Prompt skeleti", 3, LIBRARY_LIMITS.prompt);
  const slots = body.slots ?? prev?.slots ?? [];
  // The catalog decides: an unknown model, a value its ParamSchema refuses, or a slot mismatch never reaches the table.
  const err = templateError({ modelId, params, skeleton, slots }, studioModel(modelId));
  if (err) throw new ApiError(err, 400, { code: "template_invalid" });
  return {
    category: category(body.category ?? prev?.category),
    title: text(body.title ?? prev?.title, "Sarlavha", 1, LIBRARY_LIMITS.title),
    modelId,
    params: { ...(params as Record<string, unknown>) },
    skeleton,
    slots: cleanSlots(slots as Record<string, unknown>[]),
    sort: sortOf(body.sort, prev?.sort ?? 1000),
    enabled: bool(body.enabled, prev?.enabled ?? true),
    previewId: body.previewId === undefined ? (prev?.previewId ?? null) : body.previewId,
  };
}

function parseId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,17}$/.test(raw)) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return raw;
}

function checkExpected(body: Record<string, unknown>, current: { updatedAt: string }): void {
  const e = body.expectedUpdatedAt;
  if (e === undefined) return;
  if (typeof e !== "string" || e !== current.updatedAt) {
    throw new ApiError("Bu yozuv boshqa admin tomonidan o'zgartirilgan. Sahifani yangilab, qayta ko'rib chiqing.", 409, { code: "stale" });
  }
}

/* ───────────────────────── prompts ───────────────────────── */

async function lockPrompt(client: PoolClient, id: string): Promise<AdminPrompt> {
  const r = await client.query<PromptRow>(`SELECT ${PROMPT_COLS} FROM studio_prompts WHERE id = $1 FOR UPDATE`, [id]);
  if (!r.rows[0]) throw new ApiError("Prompt topilmadi", 404, { code: "not_found" });
  return promptOf(r.rows[0]);
}

export async function createPrompt(admin: AdminActor, body: Record<string, unknown>): Promise<AdminPrompt> {
  const input = parsePrompt(body);
  const reason = parseReason(body.reason)!;
  const out = await adminTx(admin, async (client, audit) => {
    const previewId = await previewOf(client, input.previewId);
    const r = await client.query<PromptRow>(
      `INSERT INTO studio_prompts (category, title, prompt, preview_id, sort, enabled, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PROMPT_COLS}`,
      [input.category, input.title, input.prompt, previewId, input.sort, input.enabled, admin.id],
    );
    const after = promptOf(r.rows[0]!);
    await audit({ action: "studio_prompt.create", targetType: "studio_prompt", targetId: after.id, reason, before: null, after });
    return after;
  });
  invalidateLibrary();
  return out;
}

export async function updatePrompt(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminPrompt> {
  const id = parseId(rawId);
  const reason = parseReason(body.reason)!;
  const out = await adminTx(admin, async (client, audit) => {
    const before = await lockPrompt(client, id);
    checkExpected(body, before);
    const input = parsePrompt(body, before);
    const previewId = await previewOf(client, input.previewId);
    const r = await client.query<PromptRow>(
      `UPDATE studio_prompts SET category = $2, title = $3, prompt = $4, preview_id = $5, sort = $6, enabled = $7, updated_by = $8, updated_at = now()
        WHERE id = $1 RETURNING ${PROMPT_COLS}`,
      [id, input.category, input.title, input.prompt, previewId, input.sort, input.enabled, admin.id],
    );
    const after = promptOf(r.rows[0]!);
    const same = (["category", "title", "prompt", "previewId", "sort", "enabled"] as const).every((k) => before[k] === after[k]);
    if (same) throw new ApiError("O'zgarish yo'q", 409, { code: "state" });
    await audit({ action: "studio_prompt.update", targetType: "studio_prompt", targetId: id, reason, before, after });
    return after;
  });
  invalidateLibrary();
  return out;
}

export async function deletePrompt(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<{ id: string }> {
  const id = parseId(rawId);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const before = await lockPrompt(client, id);
    checkExpected(body, before);
    await client.query("DELETE FROM studio_prompts WHERE id = $1", [id]);
    await audit({ action: "studio_prompt.delete", targetType: "studio_prompt", targetId: id, reason, before, after: null });
  });
  invalidateLibrary();
  return { id };
}

/* ───────────────────────── templates ───────────────────────── */

async function lockTemplate(client: PoolClient, id: string): Promise<AdminTemplate> {
  const r = await client.query<TemplateRow>(`SELECT ${TEMPLATE_COLS} FROM studio_templates WHERE id = $1 FOR UPDATE`, [id]);
  if (!r.rows[0]) throw new ApiError("Shablon topilmadi", 404, { code: "not_found" });
  return templateOf(r.rows[0], new Set());
}

/** What the audit stores of a template (no derived fields). */
const auditTemplate = (t: AdminTemplate) => ({
  category: t.category,
  title: t.title,
  modelId: t.modelId,
  params: t.params,
  skeleton: t.skeleton,
  slots: t.slots,
  previewId: t.previewId,
  sort: t.sort,
  enabled: t.enabled,
});

async function withAvailability(t: AdminTemplate): Promise<AdminTemplate> {
  return { ...t, modelAvailable: (await availableModels(STUDIO_IMAGE_PURPOSE)).includes(t.modelId) };
}

export async function createTemplate(admin: AdminActor, body: Record<string, unknown>): Promise<AdminTemplate> {
  const input = parseTemplate(body);
  const reason = parseReason(body.reason)!;
  const out = await adminTx(admin, async (client, audit) => {
    const previewId = await previewOf(client, input.previewId);
    const r = await client.query<TemplateRow>(
      `INSERT INTO studio_templates (category, title, model_id, params, skeleton, slots, preview_id, sort, enabled, updated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $10) RETURNING ${TEMPLATE_COLS}`,
      [input.category, input.title, input.modelId, JSON.stringify(input.params), input.skeleton, JSON.stringify(input.slots), previewId, input.sort, input.enabled, admin.id],
    );
    const after = templateOf(r.rows[0]!, new Set());
    await audit({ action: "studio_template.create", targetType: "studio_template", targetId: after.id, reason, before: null, after: auditTemplate(after) });
    return after;
  });
  invalidateLibrary();
  return withAvailability(out);
}

export async function updateTemplate(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<AdminTemplate> {
  const id = parseId(rawId);
  const reason = parseReason(body.reason)!;
  const out = await adminTx(admin, async (client, audit) => {
    const before = await lockTemplate(client, id);
    checkExpected(body, before);
    const input = parseTemplate(body, before);
    const previewId = await previewOf(client, input.previewId);
    const r = await client.query<TemplateRow>(
      `UPDATE studio_templates SET category = $2, title = $3, model_id = $4, params = $5::jsonb, skeleton = $6, slots = $7::jsonb,
              preview_id = $8, sort = $9, enabled = $10, updated_by = $11, updated_at = now()
        WHERE id = $1 RETURNING ${TEMPLATE_COLS}`,
      [id, input.category, input.title, input.modelId, JSON.stringify(input.params), input.skeleton, JSON.stringify(input.slots), previewId, input.sort, input.enabled, admin.id],
    );
    const after = templateOf(r.rows[0]!, new Set());
    if (JSON.stringify(auditTemplate(before)) === JSON.stringify(auditTemplate(after))) throw new ApiError("O'zgarish yo'q", 409, { code: "state" });
    await audit({ action: "studio_template.update", targetType: "studio_template", targetId: id, reason, before: auditTemplate(before), after: auditTemplate(after) });
    return after;
  });
  invalidateLibrary();
  return withAvailability(out);
}

export async function deleteTemplate(admin: AdminActor, rawId: unknown, body: Record<string, unknown>): Promise<{ id: string }> {
  const id = parseId(rawId);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const before = await lockTemplate(client, id);
    checkExpected(body, before);
    await client.query("DELETE FROM studio_templates WHERE id = $1", [id]);
    await audit({ action: "studio_template.delete", targetType: "studio_template", targetId: id, reason, before: auditTemplate(before), after: null });
  });
  invalidateLibrary();
  return { id };
}

/* ───────────────────────── reorder ───────────────────────── */

/**
 * `{kind: "prompts" | "templates", ids, reason}`: the given rows get `sort` 10, 20, 30… in that order (prompts: ids of
 * ONE category). Every id must exist (else 404, nothing changes); one audit row with the old and new order.
 */
export async function reorderLibrary(admin: AdminActor, body: Record<string, unknown>): Promise<{ ids: string[] }> {
  const kind = body.kind;
  if (kind !== "prompts" && kind !== "templates") throw new ApiError("kind: prompts yoki templates", 400);
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 500) throw new ApiError("ids: 1–500 ta identifikator", 400);
  const ids = body.ids.map((x) => (typeof x === "string" ? x : String(x)));
  if (ids.some((x) => !/^[1-9][0-9]{0,17}$/.test(x)) || new Set(ids).size !== ids.length) throw new ApiError("ids noto'g'ri yoki takrorlangan", 400);
  const reason = parseReason(body.reason)!;
  const table = kind === "prompts" ? "studio_prompts" : "studio_templates";
  await adminTx(admin, async (client, audit) => {
    const cur = await client.query<{ id: string; sort: number; category: string }>(
      `SELECT id::text AS id, sort, category FROM ${table} WHERE id = ANY($1::bigint[]) ORDER BY sort, id FOR UPDATE`,
      [ids],
    );
    if (cur.rows.length !== ids.length) throw new ApiError("Ba'zi yozuvlar topilmadi — sahifani yangilang", 404, { code: "not_found" });
    if (kind === "prompts" && new Set(cur.rows.map((r) => r.category)).size > 1) throw new ApiError("Bir toifa ichida tartiblang", 400);
    for (const [i, id] of ids.entries()) {
      await client.query(`UPDATE ${table} SET sort = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [id, (i + 1) * 10, admin.id]);
    }
    await audit({
      action: "studio_library.reorder",
      targetType: kind === "prompts" ? "studio_prompt" : "studio_template",
      targetId: null,
      reason,
      before: cur.rows.map((r) => ({ id: r.id, sort: r.sort })),
      after: ids.map((id, i) => ({ id, sort: (i + 1) * 10 })),
    });
  });
  invalidateLibrary();
  return { ids };
}

/* ───────────────────────── previews ───────────────────────── */

export const PREVIEW_MAX_BYTES = 512 * 1024;
export const PREVIEW_MAX_SIDE = 1600;

/** `POST …/previews` (multipart `file` + `reason`): one PNG / JPEG ≤ 512 KB, ≤ 1600 px; id = sha256 prefix (dedup). */
export async function uploadPreview(admin: AdminActor, req: Request): Promise<{ id: string; url: string }> {
  const form = await readUploadForm(req, PREVIEW_MAX_BYTES + 16 * 1024, "Rasm 512 KB dan katta");
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  const reason = parseReason(form?.get("reason"))!;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new ApiError("Fayl bo'sh", 400);
  if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new ApiError("Rasm 512 KB dan katta", 413);
  const mime = bytes.readUInt32BE(0) === 0x89504e47 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg" : null;
  if (!mime) throw new ApiError("Faqat PNG yoki JPEG", 415);
  const dims = imageDims(bytes);
  if (!dims || dims.w > PREVIEW_MAX_SIDE || dims.h > PREVIEW_MAX_SIDE) throw new ApiError(`Rasm ${PREVIEW_MAX_SIDE} pikseldan katta bo'lmasin`, 422);
  const id = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  await adminTx(admin, async (client, audit) => {
    await client.query(
      `INSERT INTO studio_library_previews (id, mime, size_bytes, bytes, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, mime, bytes.byteLength, bytes, admin.id],
    );
    await audit({ action: "studio_library.preview_upload", targetType: "studio_preview", targetId: id, reason, before: null, after: { id, mime, size: bytes.byteLength, w: dims.w, h: dims.h } });
  });
  return { id, url: previewUrl(id)! };
}
