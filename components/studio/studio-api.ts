"use client";

import { useCallback, useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import { parseMediaPricing, setClientMediaPricing } from "@/lib/media/studio-pricing";
import type { ClientEntry } from "@/lib/studio-core";
import type { GalleryItem, GalleryPage, MediaCatalog, StudioPricing } from "./studio-types";

/** The catalog purpose Studio's Rasm tab reads (docs/studio/P1-SPEC.md). */
export const STUDIO_IMAGE_PURPOSE = "studio.image";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/* ───────────────────────── catalog ───────────────────────── */

/** One model of the response, or `null` when it is not a usable image model (it is then simply not offered). */
function parseEntry(raw: unknown): ClientEntry | null {
  if (!isObj(raw) || !str(raw.id) || raw.kind !== "image" || !str(raw.label)) return null;
  if (!Array.isArray(raw.params) || !isObj(raw.cost) || typeof raw.cost.per !== "string") return null;
  if (!raw.params.every((p) => isObj(p) && str(p.name) && typeof p.type === "string")) return null;
  const badges = Array.isArray(raw.badges) ? raw.badges.filter((b): b is string => typeof b === "string") : [];
  return { ...raw, badges, maker: typeof raw.maker === "string" ? raw.maker : "" } as unknown as ClientEntry;
}

/** The server's own validator (`parseMediaPricing`): an invalid block is no block — no honest price preview without it. */
const parsePricing = (raw: unknown): StudioPricing | null => parseMediaPricing(raw);

/** `null` when the answer is not a catalog at all (no pricing context = no honest price preview). */
export function parseCatalog(raw: unknown): MediaCatalog | null {
  if (!isObj(raw)) return null;
  const pricing = parsePricing(raw.pricing);
  if (!pricing || !Array.isArray(raw.models)) return null;
  const models = raw.models.map(parseEntry).filter((m): m is ClientEntry => m !== null);
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

export type CatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; catalog: MediaCatalog };

/**
 * The model catalog of a purpose. `enabled: false` skips the request (an embedding host that already holds the
 * catalog passes it down instead). `reload` asks the server again, past the cache.
 */
export function useMediaCatalog(purpose: string, enabled = true): { state: CatalogState; reload: (silent?: boolean) => void } {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
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
  return {
    id,
    createdAt: str(raw.createdAt) ?? "",
    modelId: str(raw.modelId),
    modelLabel: str(raw.modelLabel) ?? "",
    prompt: str(raw.prompt) ?? "",
    count: Math.max(1, thumbs.length),
    thumbs,
    fileUrl: str(raw.fileUrl) ?? `/api/generations/${id}/file`,
  };
}

export function parseGalleryPage(raw: unknown): GalleryPage {
  const list = isObj(raw) ? raw.items : null;
  const items = Array.isArray(list) ? list.map(parseItem).filter((i): i is GalleryItem => i !== null) : [];
  return { items, nextCursor: isObj(raw) ? str(raw.nextCursor) : null };
}

export async function fetchGallery(cursor: string | null, signal?: AbortSignal): Promise<GalleryPage> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return parseGalleryPage(await request<unknown>(`/api/media/gallery${q}`, signal ? { signal } : {}));
}
