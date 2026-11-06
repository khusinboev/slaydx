"use client";

import type { EnhanceKind } from "@/lib/media/enhance";
import { useCallback, useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import { parseMediaPricing, setClientMediaPricing } from "@/lib/media/studio-pricing";
import type { ClientEntry } from "@/lib/studio-core";
import type { LibraryItem, StudioTemplate } from "@/lib/media/library";
import type { GalleryItem, GalleryPage, LibraryData, MediaCatalog, StudioPricing } from "./studio-types";

/** The catalog purpose Studio's Rasm tab reads (docs/studio/P1-SPEC.md). */
export const STUDIO_IMAGE_PURPOSE = "studio.image";
/** The catalog purpose of the Video tab (docs/studio/P3-SPEC.md). */
export const STUDIO_VIDEO_PURPOSE = "studio.video";
/** The catalog purpose of the «Ovoz» tab (docs/studio/P5-SPEC.md). */
export const STUDIO_SPEECH_PURPOSE = "studio.speech";
/** The «Audio» tab's listing (docs/studio/P6-SPEC.md): its four modes' models at once. */
export const STUDIO_AUDIO_LISTING = "studio.audio";
const KINDS = new Set(["image", "video", "speech", "music", "sfx"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/* ───────────────────────── catalog ───────────────────────── */

/** One model of the response, or `null` when it is not a usable image / video model (it is then simply not offered). */
function parseEntry(raw: unknown): ClientEntry | null {
  if (!isObj(raw) || !str(raw.id) || !KINDS.has(String(raw.kind)) || !str(raw.label)) return null;
  if (!Array.isArray(raw.params) || !isObj(raw.cost) || typeof raw.cost.per !== "string") return null;
  if (!raw.params.every((p) => isObj(p) && str(p.name) && typeof p.type === "string")) return null;
  const badges = Array.isArray(raw.badges) ? raw.badges.filter((b): b is string => typeof b === "string") : [];
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.filter((c): c is string => typeof c === "string") : [];
  return { ...raw, badges, capabilities, maker: typeof raw.maker === "string" ? raw.maker : "" } as unknown as ClientEntry;
}

/** The server's own validator (`parseMediaPricing`): an invalid block is no block — no honest price preview without it. */
const parsePricing = (raw: unknown): StudioPricing | null => parseMediaPricing(raw);

/** `null` when the answer is not a catalog at all (no pricing context = no honest price preview). */
export function parseCatalog(raw: unknown): MediaCatalog | null {
  if (!isObj(raw)) return null;
  const pricing = parsePricing(raw.pricing);
  if (!pricing || !Array.isArray(raw.models)) return null;
  // A purpose serves one kind: an entry of another kind is not offered (a picture model never lands in the Video tab).
  // P6: the «Audio» listing serves music, sound-effect and speech-kind (voice changer / isolator) models.
  const purpose = str(raw.purpose);
  const kinds: readonly string[] = purpose === STUDIO_VIDEO_PURPOSE ? ["video"] : purpose === STUDIO_SPEECH_PURPOSE ? ["speech"] : purpose === STUDIO_AUDIO_LISTING ? ["music", "sfx", "speech"] : ["image"];
  const models = raw.models.map(parseEntry).filter((m): m is ClientEntry => m !== null && kinds.includes(m.kind));
  const wanted = str(raw.defaultModelId);
  // `null` from the server = nothing available now; the picker then shows «Hozircha modellar mavjud emas».
  const defaultModelId = wanted && models.some((m) => m.id === wanted) ? wanted : (models[0]?.id ?? null);
  return { purpose: str(raw.purpose) ?? "", defaultModelId, models, pricing };
}

export async function fetchMediaCatalog(purpose: string, signal?: AbortSignal): Promise<MediaCatalog> {
  const catalog = parseCatalog(await request<unknown>(`/api/media/catalog?purpose=${encodeURIComponent(purpose)}`, signal ? { signal } : {}));
  if (!catalog) throw new Error("Modellar ro‘yxati noto‘g‘ri keldi. Birozdan keyin qayta urinib ko‘ring.");
  // `priceFor(studio-image, …)` anywhere in the app now shows what the server charges.
  setClientMediaPricing(catalog.pricing);
  return catalog;
}

/** The server caches the catalog for 30 s; so does the page, per purpose. */
export const CATALOG_TTL_MS = 30_000;
const cache = new Map<string, { at: number; catalog: MediaCatalog }>();
const inflight = new Map<string, Promise<MediaCatalog>>();

/** Forget the cached catalog (all purposes, or one): after a refused model, and between tests. */
export function dropMediaCatalog(purpose?: string): void {
  if (purpose === undefined) {
    cache.clear();
    inflight.clear();
  } else {
    cache.delete(purpose);
    inflight.delete(purpose);
  }
}

export function loadMediaCatalog(purpose: string, opts: { fresh?: boolean } = {}): Promise<MediaCatalog> {
  const hit = cache.get(purpose);
  if (!opts.fresh && hit && Date.now() - hit.at < CATALOG_TTL_MS) return Promise.resolve(hit.catalog);
  const running = inflight.get(purpose);
  if (!opts.fresh && running) return running;
  const p = fetchMediaCatalog(purpose)
    .then((catalog) => {
      cache.set(purpose, { at: Date.now(), catalog });
      return catalog;
    })
    .finally(() => {
      if (inflight.get(purpose) === p) inflight.delete(purpose);
    });
  inflight.set(purpose, p);
  return p;
}

export type CatalogLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; catalog: MediaCatalog };

/**
 * The model catalog of a purpose. `enabled: false` skips the request (an embedding host that already holds the
 * catalog passes it down instead). `reload` asks the server again, past the cache.
 */
export function useMediaCatalog(purpose: string, enabled = true): { state: CatalogLoad; reload: (silent?: boolean) => void } {
  const [state, setState] = useState<CatalogLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // `attempt > 0` is a deliberate reload: past the cache.
    loadMediaCatalog(purpose, { fresh: attempt > 0 }).then(
      (catalog) => live && setState({ status: "ready", catalog }),
      (e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : "Modellar yuklanmadi" }),
    );
    return () => {
      live = false;
    };
  }, [purpose, enabled, attempt]);
  // `silent`: ask again without blanking the screen (a refused model → the list may have changed).
  const reload = useCallback((silent = false) => {
    if (!silent) setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, reload };
}

/* ───────────────────────── gallery ───────────────────────── */


/**
 * One item of `GET /api/media/gallery` (`lib/server/media/public.ts`): `{ id, createdAt, modelId, modelLabel, prompt,
 * images: [{ url, w, h }], fileUrl }`. The pictures ARE the thumbnails (stored asset URLs; the `/thumb` endpoint does
 * not render images); a job whose pictures are gone keeps its card with a placeholder.
 */
function parseItem(raw: unknown): GalleryItem | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const images = Array.isArray(raw.images) ? raw.images : [];
  const thumbs = images.map((im) => (isObj(im) ? str(im.url) : null)).filter((u): u is string => u !== null);
  const v = raw.kind === "video" && isObj(raw.video) ? raw.video : null;
  const pos = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
  // Only the job's own file URL is played (never a provider URL from the wire).
  const video = v
    ? {
        src: `/api/generations/${id}/file?inline=1`,
        seconds: pos(v.seconds),
        requestedSeconds: pos(v.requestedSeconds),
        aspect: str(v.aspect),
        sound: typeof v.sound === "boolean" ? v.sound : null,
        effect: str(v.effect),
        effectLabel: str(v.effectLabel),
      }
    : null;
  const a = raw.kind === "audio" && isObj(raw.audio) ? raw.audio : null;
  const audio = a
    ? {
        src: `/api/generations/${id}/file?inline=1`,
        seconds: pos(a.seconds),
        voices: Array.isArray(a.voices) ? a.voices.filter((x): x is string => typeof x === "string").slice(0, 4) : [],
        clone: a.clone === true,
      }
    : null;
  return {
    id,
    kind: audio ? "audio" : video ? "video" : "image",
    audio,
    video,
    createdAt: str(raw.createdAt) ?? "",
    modelId: str(raw.modelId),
    modelLabel: str(raw.modelLabel) ?? "",
    prompt: str(raw.prompt) ?? "",
    count: Math.max(1, thumbs.length),
    thumbs,
    fileUrl: str(raw.fileUrl) ?? `/api/generations/${id}/file`,
    favorite: raw.favorite === true,
  };
}

export function parseGalleryPage(raw: unknown): GalleryPage {
  const list = isObj(raw) ? raw.items : null;
  const items = Array.isArray(list) ? list.map(parseItem).filter((i): i is GalleryItem => i !== null) : [];
  return { items, nextCursor: isObj(raw) ? str(raw.nextCursor) : null };
}

/** One gallery page; `favorites` (P7b «Sevimlilar») lists only the starred items. */
export async function fetchGallery(cursor: string | null, opts: { favorites?: boolean; signal?: AbortSignal } = {}): Promise<GalleryPage> {
  const q = new URLSearchParams();
  if (cursor) q.set("cursor", cursor);
  if (opts.favorites) q.set("favorites", "1");
  const qs = q.toString();
  return parseGalleryPage(await request<unknown>(`/api/media/gallery${qs ? `?${qs}` : ""}`, opts.signal ? { signal: opts.signal } : {}));
}

/* ───────────────────────── P2b: library, templates, inputs, enhance ───────────────────────── */

/** `GET /api/media/library` → categories with items (docs/studio/P2B-SPEC.md). Untrusted JSON → typed, bad rows dropped. */
export function parseLibrary(raw: unknown): LibraryData {
  const r = isObj(raw) ? raw : {};
  const categories = (Array.isArray(r.categories) ? r.categories : [])
    .map((c) => (isObj(c) && str(c.id) && str(c.label) ? { id: c.id as string, label: c.label as string, count: typeof c.count === "number" ? c.count : 0 } : null))
    .filter((c): c is LibraryData["categories"][number] => c !== null);
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((i) =>
      isObj(i) && str(i.id) && str(i.category) && str(i.title) && str(i.prompt)
        ? { id: i.id as string, category: i.category as string, title: i.title as string, prompt: i.prompt as string, previewUrl: str(i.previewUrl) }
        : null,
    )
    .filter((i): i is LibraryItem => i !== null);
  return { categories, items };
}

export async function fetchLibrary(signal?: AbortSignal): Promise<LibraryData> {
  return parseLibrary(await request<unknown>("/api/media/library", signal ? { signal } : {}));
}

/** `GET /api/media/templates` → templates (a row without a usable shape is dropped). */
export function parseTemplates(raw: unknown): StudioTemplate[] {
  const list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [];
  return list
    .map((t): StudioTemplate | null => {
      if (!isObj(t) || !str(t.id) || !str(t.title) || !str(t.modelId) || !str(t.skeleton) || !isObj(t.params) || !Array.isArray(t.slots)) return null;
      const slots = t.slots
        .map((s) =>
          isObj(s) && str(s.name) && str(s.label) && typeof s.max === "number"
            ? { name: s.name as string, label: s.label as string, max: s.max, ...(str(s.placeholder) ? { placeholder: s.placeholder as string } : {}) }
            : null,
        )
        .filter((s): s is StudioTemplate["slots"][number] => s !== null);
      return {
        id: t.id as string,
        category: str(t.category) ?? "",
        title: t.title as string,
        modelId: t.modelId as string,
        params: { ...t.params },
        skeleton: t.skeleton as string,
        slots,
        previewUrl: str(t.previewUrl),
      };
    })
    .filter((t): t is StudioTemplate => t !== null);
}

export async function fetchTemplates(signal?: AbortSignal): Promise<StudioTemplate[]> {
  return parseTemplates(await request<unknown>("/api/media/templates", signal ? { signal } : {}));
}

export type StudioInput = { assetId: string; mime: string; w: number | null; h: number | null };

function parseInput(raw: unknown): StudioInput {
  if (!isObj(raw) || !str(raw.assetId)) throw new Error("Rasm yuklanmadi");
  return { assetId: raw.assetId as string, mime: str(raw.mime) ?? "image/png", w: typeof raw.w === "number" ? raw.w : null, h: typeof raw.h === "number" ? raw.h : null };
}

/** «Rasm yuklash»: `POST /api/media/inputs` (PNG / JPEG ≤ 5 MB). */
export async function uploadStudioInput(file: Blob, name = "rasm"): Promise<StudioInput> {
  const form = new FormData();
  form.append("file", file, name);
  return parseInput(await request<unknown>("/api/media/inputs", { method: "POST", body: form, timeoutMs: 60_000 }));
}

/** «Tahrirlash» / «Sifatini oshirish» / «Fonni olib tashlash» on a result: copies the user's own picture into the inputs. */
export async function inputFromResult(generationId: string, assetId: string): Promise<StudioInput> {
  return parseInput(await request<unknown>("/api/media/inputs/from-result", { method: "POST", body: JSON.stringify({ generationId, assetId }) }));
}

/** `{generationId, assetId}` of a stored result picture URL (`/api/generations/<id>/assets/<asset>`), else `null`. */
export function resultAssetOf(url: string): { generationId: string; assetId: string } | null {
  const m = /^\/api\/generations\/([0-9a-f-]{36})\/assets\/([0-9a-f]+)$/.exec(url);
  return m ? { generationId: m[1]!, assetId: m[2]! } : null;
}

/** «Yaxshilash (AI)»: `POST /api/media/enhance` — free, rate-limited; the answer goes back into the prompt box. */
export async function enhancePrompt(prompt: string, kind: EnhanceKind = "image"): Promise<string> {
  const r = await request<unknown>("/api/media/enhance", { method: "POST", body: JSON.stringify({ prompt, kind }), timeoutMs: 30_000 });
  const out = isObj(r) ? str(r.prompt) : null;
  if (!out) throw new Error("Tavsif yaxshilanmadi");
  return out;
}

/* ───────────────────────── unfinished jobs ───────────────────────── */

/** One unfinished job of `GET /api/media/active-jobs`, as the tabs follow it. */
export type ActiveJob = { id: string; tool: string; modelId: string; modelLabel: string; prompt: string; price: number; purpose: string | null; sent: Record<string, unknown> };

/** Untrusted JSON → typed: a row without an id or a model cannot be followed, it stays in «Ishlarim». */
export function parseActiveJobs(raw: unknown): ActiveJob[] {
  const list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [];
  return list.flatMap((j): ActiveJob[] => {
    const id = isObj(j) ? str(j.id) : null;
    const tool = isObj(j) ? str(j.tool) : null;
    const modelId = isObj(j) ? str(j.modelId) : null;
    if (!isObj(j) || !id || !tool || !modelId) return [];
    return [{ id, tool, modelId, modelLabel: str(j.modelLabel) ?? "", prompt: str(j.prompt) ?? "", price: typeof j.price === "number" ? j.price : 0, purpose: str(j.purpose), sent: isObj(j.sent) ? j.sent : {} }];
  });
}

export async function fetchActiveJobs(): Promise<ActiveJob[]> {
  return parseActiveJobs(await request<unknown>("/api/media/active-jobs"));
}
