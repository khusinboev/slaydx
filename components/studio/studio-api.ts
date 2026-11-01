"use client";

import { useCallback, useEffect, useState } from "react";
import { request, thumbUrl } from "@/lib/api-client";
import type { ClientEntry } from "@/lib/studio-core";
import type { GalleryItem, GalleryPage, MediaCatalog, StudioPricing } from "./studio-types";

/** The catalog purpose Studio's Rasm tab reads (docs/studio/P1-SPEC.md). */
export const STUDIO_IMAGE_PURPOSE = "studio.image";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* ───────────────────────── catalog ───────────────────────── */

/** One model of the response, or `null` when it is not a usable image model (it is then simply not offered). */
function parseEntry(raw: unknown): ClientEntry | null {
  if (!isObj(raw) || !str(raw.id) || raw.kind !== "image" || !str(raw.label)) return null;
  if (!Array.isArray(raw.params) || !isObj(raw.cost) || typeof raw.cost.per !== "string") return null;
  if (!raw.params.every((p) => isObj(p) && str(p.name) && typeof p.type === "string")) return null;
  const badges = Array.isArray(raw.badges) ? raw.badges.filter((b): b is string => typeof b === "string") : [];
  return { ...raw, badges, maker: typeof raw.maker === "string" ? raw.maker : "" } as unknown as ClientEntry;
}

function parsePricing(raw: unknown): StudioPricing | null {
  if (!isObj(raw)) return null;
  const soumPerUsd = num(raw.soumPerUsd);
  if (soumPerUsd === null || soumPerUsd <= 0) return null;
  const markup = num(raw.markup);
  const step = num(raw.step);
  const overrides: Record<string, { markup: number }> = {};
  if (isObj(raw.overrides)) {
    for (const [id, o] of Object.entries(raw.overrides)) {
      const m = isObj(o) ? num(o.markup) : null;
      if (m !== null && m >= 1) overrides[id] = { markup: m };
    }
  }
  return { soumPerUsd, markup: markup !== null && markup >= 1 ? markup : 2, step: step !== null && step >= 1 ? Math.round(step) : 100, overrides };
}

/** `null` when the answer is not a catalog at all (no pricing context = no honest price preview). */
export function parseCatalog(raw: unknown): MediaCatalog | null {
  if (!isObj(raw)) return null;
  const pricing = parsePricing(raw.pricing);
  if (!pricing || !Array.isArray(raw.models)) return null;
  const models = raw.models.map(parseEntry).filter((m): m is ClientEntry => m !== null);
  const wanted = str(raw.defaultModelId);
  const defaultModelId = wanted && models.some((m) => m.id === wanted) ? wanted : (models[0]?.id ?? "");
  return { purpose: str(raw.purpose) ?? "", defaultModelId, models, pricing };
}

export async function fetchMediaCatalog(purpose: string, signal?: AbortSignal): Promise<MediaCatalog> {
  const catalog = parseCatalog(await request<unknown>(`/api/media/catalog?purpose=${encodeURIComponent(purpose)}`, signal ? { signal } : {}));
  if (!catalog) throw new Error("Modellar ro‘yxati noto‘g‘ri keldi. Birozdan keyin qayta urinib ko‘ring.");
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

const first = (...vals: unknown[]): unknown => vals.find((v) => v !== undefined && v !== null);

function parseItem(raw: unknown): GalleryItem | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const listed = first(raw.thumbs, raw.thumbnails, raw.thumbUrls);
  const thumbs = Array.isArray(listed) ? listed.filter((t): t is string => typeof t === "string" && t !== "") : [];
  const count = num(first(raw.count, raw.imageCount, raw.images));
  return {
    id,
    createdAt: str(first(raw.createdAt, raw.created_at)) ?? "",
    modelId: str(first(raw.modelId, raw.model_id)),
    modelLabel: str(first(raw.modelLabel, raw.model_label, raw.model)) ?? "",
    prompt: str(raw.prompt) ?? "",
    count: count !== null && count >= 1 ? Math.round(count) : Math.max(1, thumbs.length),
    // No list of its own: the existing per-generation thumbnail endpoint.
    thumbs: thumbs.length ? thumbs : [thumbUrl(id, num(raw.fileVersion) ?? undefined)],
  };
}

export function parseGalleryPage(raw: unknown): GalleryPage {
  const list = isObj(raw) ? first(raw.items, raw.generations) : null;
  const items = Array.isArray(list) ? list.map(parseItem).filter((i): i is GalleryItem => i !== null) : [];
  return { items, nextCursor: isObj(raw) ? str(raw.nextCursor) : null };
}

export async function fetchGallery(cursor: string | null, signal?: AbortSignal): Promise<GalleryPage> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return parseGalleryPage(await request<unknown>(`/api/media/gallery${q}`, signal ? { signal } : {}));
}
