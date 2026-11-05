import { createElement as h, type ReactElement } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { MarketCard, MarketItemView, MarketListResponse } from "../../lib/market/types.ts";

/** Shared fixtures of the market UI tests: a request log over a stubbed `fetch`, a card, an item and the router contexts. */

export const ID = "3f1c2a9e-1111-4111-8111-111111111111";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const json = (status: number, data: unknown): Response => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function card(id: string, patch: Partial<MarketCard> = {}): MarketCard {
  return {
    id,
    toolId: "referat",
    title: `Referat ${id}`,
    summary: "Referat, 18 bet.",
    subject: "tarix",
    level: "otm",
    language: "uz",
    pages: 18,
    slideCount: null,
    price: 1500,
    originalPrice: 3000,
    soldCount: 12,
    rating: null,
    cover: `/api/market/items/${id}/preview/1?v=2`,
    status: "active",
    ...patch,
  };
}

export function item(patch: Partial<MarketItemView> = {}): MarketItemView {
  return {
    ...card(ID),
    outline: ["Kirish", "Asosiy qism", "Xulosa"],
    previewPages: 2,
    totalPages: 18,
    owned: null,
    requiredFields: ["author", "university"],
    createTool: { slug: "referat", topic: `Referat ${ID}` },
    ...patch,
  };
}

export const list = (items: MarketCard[], nextCursor: string | null = null): MarketListResponse => ({ items, nextCursor, facets: { tools: [{ id: "referat", count: items.length }], subjects: [{ id: "tarix", count: items.length }] } });

export type Req = { method: string; url: string; body: Record<string, unknown> | null; key: string | null };

/** Installs the `fetch` stub; `answer` returns a Response, or `undefined` for an empty 200. */
export function stubFetch(answer: (r: Req) => Response | Promise<Response> | undefined): { reqs: Req[] } {
  const reqs: Req[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const r: Req = { method: init?.method ?? "GET", url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, key: headers["Idempotency-Key"] ?? null };
    reqs.push(r);
    return (await answer(r)) ?? json(200, {});
  }) as typeof fetch;
  return { reqs };
}

export function routerStub(pushes: string[]): AppRouterInstance {
  return {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    replace() {},
    push(href: string) {
      pushes.push(href);
    },
  } as unknown as AppRouterInstance;
}

/** The app-router contexts a page needs; `search` is the query the page starts from. */
export function withRouter(el: ReactElement, opts: { pushes?: string[]; search?: string; pathname?: string } = {}): ReactElement {
  return h(
    AppRouterContext.Provider,
    { value: routerStub(opts.pushes ?? []) },
    h(PathnameContext.Provider, { value: opts.pathname ?? "/uz/market" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(opts.search ?? "") as never }, el)),
  );
}

export const USER = { id: "u1", name: "Ali Valiyev", author: "Valiyev Ali", university: "TDIU", faculty: "", department: "", group: "301", course: "3", teacher: "", city: "", points: 0, quota: 0, balance: 5000, isAdmin: false };
