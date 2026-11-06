/**
 * Shared fixtures of the `studio-*.test.mts` files: the REAL catalog entries (as `GET /api/media/catalog` serves them:
 * `MEDIA_CATALOG.clientView()` without routes), a stubbed Studio API and the signed-in store. Not a test file.
 */
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import type { ClientEntry, ParamSchema } from "../../lib/studio-core/index.ts";

const view = MEDIA_CATALOG.clientView();
export const NANO = view.find((e) => e.id === "google/nano-banana")!;
export const GPT = view.find((e) => e.id === "openai/gpt-image")!;

export const PRICING = { soumPerUsd: 12_800, markup: 2, step: 100, overrides: {} as Record<string, { markup: number }>, costUsd: {} as Record<string, number> };
export type Pricing = { soumPerUsd: number; markup: number; step: number; overrides: Record<string, { markup: number }>; costUsd?: Record<string, number> };

/** An independent copy of the price formula (provider cost × markup, rounded UP to the step) — never imports the product's. */
export function expectedPrice(entry: ClientEntry, count: number, pricing: Pricing = PRICING): number {
  // The live unit cost of the block (admin slot model) replaces the catalog's default when the server sends one.
  const usd = pricing.costUsd?.[entry.id] ?? (entry.cost as { usd: number }).usd;
  const markup = pricing.overrides[entry.id]?.markup ?? pricing.markup;
  return Math.max(1, Math.ceil((usd * count * pricing.soumPerUsd * markup) / pricing.step - 1e-9) * pricing.step);
}

export const withParams = (e: ClientEntry, id: string, params: readonly ParamSchema[], label = e.label): ClientEntry => ({ ...e, id, label, params });

export function catalogBody(models: ClientEntry[], pricing: Pricing = PRICING, defaultModelId: string | undefined = models[0]?.id) {
  return { purpose: "studio.image", defaultModelId, models, pricing };
}

export const USER = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0, balance: 48_200,
  university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "", teacher: "", city: "",
  position: "", organization: "", phone: null, isAdmin: false,
};

export const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export type Call = { url: string; method: string; body: Record<string, unknown> | null; key: string | null };

export function generationDetail(id: string, patch: Record<string, unknown> = {}) {
  return {
    id, type: "studio-image", topic: "p", status: "COMPLETED", createdAt: "2026-11-01T10:00:00.000Z", finishedAt: "2026-11-01T10:00:20.000Z",
    price: 2600, fileName: "studio.png", format: "png", progress: 100, step: "Tayyor", expiresAt: null, error: null, preview: null,
    html: null, hasFile: true,
    doc: {
      meta: { topic: "p", language: "uz" },
      images: [{ id: `${id}-1`, url: `/api/generations/${id}/assets/${id}-1`, w: 1024, h: 1024, mime: "image/png", alt: "natija" }],
      imageModel: "google/nano-banana",
    },
    ...patch,
  };
}

export type ApiOptions = {
  catalog?: unknown | (() => Response);
  /** `GET /api/generations/<id>` body, by call number for that id (0-based). */
  generation?: (id: string, n: number) => Record<string, unknown>;
  /** Answer of `POST /api/generations`; default 202 with the expected price. */
  create?: (body: Record<string, unknown>, n: number) => Response;
  /** Gallery pages by cursor (`""` = first). */
  gallery?: Record<string, unknown>;
  /** `GET /api/media/active-jobs` rows, or the whole answer; default none. */
  activeJobs?: unknown[] | (() => Response);
};

/** Installs a `fetch` stub for the whole Studio API; returns the call log. Restore with `globalThis.fetch = real`. */
export function installApi(opts: ApiOptions = {}) {
  // Each test starts without the drafts an earlier test left: `useDraft` is storage-backed by design.
  window.localStorage.clear();
  const calls: Call[] = [];
  const created: string[] = [];
  const polls = new Map<string, number>();
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const key = new Headers(init?.headers).get("idempotency-key");
    calls.push({ url, method, body, key });
    if (url.startsWith("/api/media/catalog")) {
      const c = opts.catalog;
      if (typeof c === "function") return (c as () => Response)();
      return json(200, c ?? catalogBody([NANO, GPT]));
    }
    if (url.startsWith("/api/media/gallery")) {
      const cursor = new URL(url, "http://x").searchParams.get("cursor") ?? "";
      const page = opts.gallery?.[cursor];
      return page ? json(200, page) : json(404, { error: "yo'q" });
    }
    if (url === "/api/generations" && method === "POST") {
      const n = created.length;
      if (opts.create) {
        const res = opts.create(body ?? {}, n);
        if (res.status >= 400) return res;
        const data = (await res.clone().json()) as { id: string };
        created.push(data.id);
        return res;
      }
      const id = `7777777${n}-7777-4777-8777-777777777777`;
      created.push(id);
      return json(202, { id, price: (body?.expectedPrice as number | undefined) ?? 0, status: "QUEUED" });
    }
    const one = /^\/api\/generations\/([^/?]+)(\?.*)?$/.exec(url);
    if (one && method === "GET") {
      const n = polls.get(one[1]!) ?? 0;
      polls.set(one[1]!, n + 1);
      return json(200, { generation: opts.generation ? opts.generation(one[1]!, n) : generationDetail(one[1]!) });
    }
    if (url === "/api/media/active-jobs") return typeof opts.activeJobs === "function" ? opts.activeJobs() : json(200, { items: opts.activeJobs ?? [] });
    if (url === "/api/auth/session") return json(200, { user: USER, features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: false, payments: { click: false, payme: false } } });
    if (url.startsWith("/api/channels/required")) return json(200, { ok: true, needsTelegram: false, channels: [] });
    if (url.startsWith("/api/generations")) return json(200, { generations: [], nextCursor: null });
    return json(404, { error: "yo'q" });
  };
  return { calls, created, polls, posts: () => calls.filter((c) => c.url === "/api/generations" && c.method === "POST"), catalogCalls: () => calls.filter((c) => c.url.startsWith("/api/media/catalog")) };
}
