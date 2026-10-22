import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * Public-offer acceptance dialog (D6): when ANY API answers 403 `offer_required`, the central client
 * (`lib/api-client.ts request`) shows ONE dialog; «Qabul qilaman» -> POST /api/oferta/accept -> the refused
 * request is repeated once and its result reaches the original caller. Dismissing leaves the original error.
 *
 * Mutations (each verified red): the retry removed from `request` ("accept -> retry"); the dialog resolving
 * `true` on close ("dismiss -> original error"); one dialog per request instead of the shared promise
 * ("two refused requests share one dialog").
 */

const nav = await import("../../lib/nav/history.ts");
const { request, ApiError } = await import("../../lib/api-client.ts");
const { OfferDialog } = await import("../../components/overlays/OfferDialog.tsx");

const realFetch = globalThis.fetch;
const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Req = { method: string; url: string };
let reqs: Req[] = [];
/** Per-path queue of answers; the last one repeats. */
let answers: Record<string, Response[]> = {};
function install() {
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    reqs.push({ method: init?.method ?? "GET", url });
    const q = answers[url];
    if (!q || q.length === 0) return json(404, {});
    const r = q.length > 1 ? q.shift()! : q[0]!.clone();
    return r;
  };
}
const REFUSED = () => json(403, { error: "Davom etish uchun ommaviy ofertani qabul qiling", code: "offer_required", version: 1 });

beforeEach(() => {
  reqs = [];
  answers = {};
  install();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  nav.__resetNavForTests();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
  });
const mount = () =>
  render(
    h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/uz" }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(OfferDialog)))),
  );
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

test("no dialog while idle; a refused request opens it with the summary and the /oferta link", async () => {
  mount();
  assert.ok(!q("[data-offer-dialog]"));
  answers["/api/generations"] = [REFUSED()];
  const p = request("/api/generations", { method: "POST", body: "{}" }).catch((e: unknown) => e);
  await settle();
  const dialog = q("[data-offer-dialog]");
  assert.ok(dialog, "the dialog is open");
  assert.ok(q("[data-offer-summary] li"), "short summary");
  const read = q("[data-offer-read]") as HTMLAnchorElement;
  assert.equal(read.getAttribute("href"), "/oferta");
  assert.equal(read.getAttribute("target"), "_blank", "the form the user is filling stays untouched");
  assert.ok(/Qabul qilaman/.test(q("[data-offer-accept]")!.textContent ?? ""));
  fireEvent.click(q("[data-offer-cancel]")!);
  await settle();
  const err = await p;
  assert.ok(err instanceof ApiError && err.status === 403 && err.data.code === "offer_required", "dismiss -> original error");
  assert.ok(!q("[data-offer-dialog]"), "closed");
  assert.equal(reqs.filter((r) => r.url === "/api/oferta/accept").length, 0, "nothing accepted");
});

test("accept -> POST /api/oferta/accept -> the refused request is repeated once and its result is returned", async () => {
  mount();
  answers["/api/payments/orders"] = [REFUSED(), json(201, { order: { id: "o1" } })];
  answers["/api/oferta/accept"] = [json(200, { ok: true, version: 1 })];
  const p = request<{ order: { id: string } }>("/api/payments/orders", { method: "POST", body: "{}" });
  await settle();
  fireEvent.click(q("[data-offer-accept]")!);
  await settle();
  const out = await p;
  assert.deepEqual(out, { order: { id: "o1" } });
  assert.deepEqual(
    reqs.map((r) => `${r.method} ${r.url}`),
    ["POST /api/payments/orders", "POST /api/oferta/accept", "POST /api/payments/orders"],
  );
  assert.ok(!q("[data-offer-dialog]"));
});

test("accept failing keeps the dialog open with the error; a second refusal after accepting is NOT retried again", async () => {
  mount();
  answers["/api/generations"] = [REFUSED()];
  answers["/api/oferta/accept"] = [json(500, { error: "Ichki xatolik" }), json(200, { ok: true, version: 1 })];
  const p = request("/api/generations", { method: "POST", body: "{}" }).catch((e: unknown) => e);
  await settle();
  fireEvent.click(q("[data-offer-accept]")!);
  await settle();
  assert.ok(q("[data-offer-dialog]"), "still open");
  assert.ok(/Ichki xatolik|Server/.test(q("[data-offer-error]")?.textContent ?? ""), "the error is shown");
  fireEvent.click(q("[data-offer-accept]")!);
  await settle();
  const err = await p;
  assert.ok(err instanceof ApiError && err.data.code === "offer_required", "the retry was refused again (version bumped): surfaced, not looped");
  assert.equal(reqs.filter((r) => r.url === "/api/generations").length, 2, "exactly one retry");
});

test("two refused requests share ONE dialog and both are retried after a single accept", async () => {
  mount();
  answers["/api/a"] = [REFUSED(), json(200, { a: 1 })];
  answers["/api/b"] = [REFUSED(), json(200, { b: 2 })];
  answers["/api/oferta/accept"] = [json(200, { ok: true, version: 1 })];
  const pa = request("/api/a", { method: "POST", body: "{}" });
  const pb = request("/api/b", { method: "POST", body: "{}" });
  await settle();
  assert.equal(document.querySelectorAll("[data-offer-dialog]").length, 1);
  fireEvent.click(q("[data-offer-accept]")!);
  await settle();
  assert.deepEqual(await Promise.all([pa, pb]), [{ a: 1 }, { b: 2 }]);
  assert.equal(reqs.filter((r) => r.url === "/api/oferta/accept").length, 1, "one acceptance");
});

test("a 403 with another code (channel_required) never opens the dialog; with no host mounted the original error surfaces", async () => {
  mount();
  answers["/api/generations"] = [json(403, { error: "Avval kanalga obuna bo‘ling", code: "channel_required" })];
  await assert.rejects(request("/api/generations", { method: "POST", body: "{}" }), (e: unknown) => e instanceof ApiError && e.data.code === "channel_required");
  assert.ok(!q("[data-offer-dialog]"));
  cleanup(); // unmount the host
  answers["/api/generations"] = [REFUSED()];
  await assert.rejects(request("/api/generations", { method: "POST", body: "{}" }), (e: unknown) => e instanceof ApiError && e.data.code === "offer_required");
});
