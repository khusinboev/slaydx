import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ImageSlideComposer } from "../../components/forms/ImageSlideComposer.tsx";
import { SlideKindSwitch } from "../../components/forms/SlideKindSwitch.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { imageSlidePrice } from "../../lib/generation/image-slide/models.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * AI slayd formasi (docs/ai-slide/SPEC.md): the price on the button is the server's formula with the catalog's pricing
 * block, the model cards change it, the submit sends every field and waits for the pricing block, and the
 * «Pro slayd · AI slayd» switch is the tool's door.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID["image-slide"];
const RATE = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {} };
const profile = { name: "", author: "Aliyev Ali", university: "12-maktab", subject: "" } as unknown as UserProfile;

type Call = { url: string; method: string; body?: Record<string, unknown> };
function stubApi() {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });
    if (url.startsWith("/api/media/catalog")) return json(200, { purpose: "studio.image", defaultModelId: null, models: [], pricing: RATE });
    if (url.startsWith("/api/forms/image-slide/draft")) return json(200, method === "GET" ? { draft: null } : { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "77777777-7777-4777-8777-777777777777", price: 1 });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { balance: 10_000_000, quota: 0, points: 0 } as never });
}

const submitButton = () => [...document.querySelectorAll("button")].find((b) => /AI slaydlarni yaratish/.test(b.textContent ?? "")) as HTMLButtonElement;
const priceText = () => document.querySelector("[data-tool-chrome]")?.textContent ?? "";
const digits = (n: number) => n.toLocaleString("uz-UZ").replace(/\D/g, "");

test("price on the form = the server formula; Pro and more slides cost more", async () => {
  stubApi();
  await login();
  render(h(AppRouterContext.Provider, { value: router }, h(ImageSlideComposer, { tool, profile })));
  const base = imageSlidePrice({ slideCount: 10, imageModel: "nb21" }, RATE);
  await waitFor(() => assert.ok(priceText().replace(/\D/g, "").includes(digits(base)), priceText().slice(0, 300)));
  // Model cards: two, nb21 checked, each shows a per-slide price.
  const cards = [...document.querySelectorAll('[data-field="imageModel"] [role="radio"]')] as HTMLButtonElement[];
  assert.equal(cards.length, 2);
  assert.equal(cards.find((c) => c.getAttribute("aria-checked") === "true")?.dataset.model, "nb21");
  assert.ok(cards.every((c) => /slayd/.test(c.textContent ?? "")));
  await act(async () => fireEvent.click(cards[1]));
  const pro = imageSlidePrice({ slideCount: 10, imageModel: "pro" }, RATE);
  await waitFor(() => assert.ok(priceText().replace(/\D/g, "").includes(digits(pro))));
  const range = document.querySelector('[data-field="slideCount"] input[type="range"]') as HTMLInputElement;
  await act(async () => fireEvent.change(range, { target: { value: "20" } }));
  const pro20 = imageSlidePrice({ slideCount: 20, imageModel: "pro" }, RATE);
  await waitFor(() => assert.ok(priceText().replace(/\D/g, "").includes(digits(pro20))));
});

test("submit sends every field with the expected price; an empty topic is refused", async () => {
  const calls = stubApi();
  await login();
  render(h(AppRouterContext.Provider, { value: router }, h(ImageSlideComposer, { tool, profile })));
  // The pricing block is loaded (or cached from the first test: `loadMediaCatalog` keeps it 30 s).
  const { getClientMediaPricing } = await import("../../lib/media/studio-pricing.ts");
  await waitFor(() => assert.ok(getClientMediaPricing()));
  await act(async () => fireEvent.click(submitButton()));
  assert.ok(!calls.some((c) => c.url === "/api/generations"), "no topic: nothing is sent");
  const topic = document.querySelector('[data-field="topic"] textarea, [data-field="topic"] input') as HTMLTextAreaElement;
  await act(async () => fireEvent.change(topic, { target: { value: "Kislotalar" } }));
  await act(async () => fireEvent.click(submitButton()));
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations")));
  const sent = calls.find((c) => c.url === "/api/generations")!.body!;
  const v = sent.values as Record<string, unknown>;
  assert.equal(sent.slug, "ai-slayd");
  for (const k of ["topic", "language", "slideCount", "imageModel", "slideStyle", "audience", "author", "organization"]) assert.ok(k in v, k);
  assert.equal(v.author, "Aliyev Ali");
  assert.equal(sent.expectedPrice, imageSlidePrice(v as never, RATE));
});

test("the «Pro slayd · AI slayd» switch links both kinds and hides when the server refuses AI slides", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ features: { llm: true, images: true } as never });
  render(h(SlideKindSwitch, { current: "pro" }));
  const links = [...document.querySelectorAll("[data-slide-kind]")] as HTMLAnchorElement[];
  assert.deepEqual(links.map((a) => a.getAttribute("href")), ["/uz/pro-slide", "/uz/ai-slayd"]);
  assert.equal(links[0].getAttribute("aria-selected"), "true");
  cleanup();
  useAppStore.setState({ features: { llm: true, images: true, imageSlide: false } as never });
  render(h(SlideKindSwitch, { current: "pro" }));
  assert.ok(!document.querySelector("[data-slide-kind]"), "hidden on the Pro slayd page when AI slides are off");
});
