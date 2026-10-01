import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ImageStudio } from "../../components/forms/ImageStudio.tsx";
import { runGeneration } from "../../components/forms/runGeneration.ts";
import { CONFIRM_MIN_MS } from "../../components/overlays/useConfirmClick.ts";
import type { ServerUser } from "../../lib/api-client.ts";
import { useAppStore } from "../../lib/store.ts";
import { TOOL_BY_ID, formatTanga, setClientPriceAdjustments, type PriceAdjustMap } from "../../lib/tools.ts";

/**
 * Admin price change between render and submit (docs/admin/02-plan.md §17.2).
 *
 * The form sends the displayed price as `expectedPrice`. A 409
 * `price_changed` charges nothing; the form then shows the new price (in the
 * message AND on the button, after the session refresh) and retries only on
 * the user's next deliberate press, with the price that was shown and a NEW
 * Idempotency-Key. A double click is not a confirmation.
 */

afterEach(async () => {
  cleanup();
  // A successful submit refreshes the session in the background; let it land before resetting.
  await new Promise((r) => setTimeout(r, 50));
  setClientPriceAdjustments({});
  useAppStore.setState({ pricing: {}, pricingVersion: 0 });
});

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.image;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const user = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 50_000, plan: "free", planExpiresAt: null, premium: false, university: "", faculty: "", department: "", group: "",
  course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
} as unknown as ServerUser;

type Post = { expectedPrice?: number; key: string | null; values: Record<string, unknown> };

/**
 * Server stub: `serverPricing` is what the session reports; the generation
 * endpoint answers 409 while `expectedPrice` differs from `serverPrice`.
 */
function stubApi(opts: { serverPricing: PriceAdjustMap; serverPrice: number }) {
  const posts: Post[] = [];
  let sessions = 0;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/auth/session" && method === "GET") {
      sessions++;
      return json(200, {
        user,
        features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: false, payments: { click: false, payme: false }, pricing: opts.serverPricing },
      });
    }
    if (url === "/api/generations" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { expectedPrice?: number; values: Record<string, unknown> };
      const headers = new Headers(init?.headers);
      posts.push({ expectedPrice: body.expectedPrice, key: headers.get("idempotency-key"), values: body.values });
      if (body.expectedPrice !== undefined && body.expectedPrice !== opts.serverPrice) {
        return json(409, { error: "Narx o'zgardi. Yangi narx: N tanga.", code: "price_changed", price: opts.serverPrice });
      }
      return json(202, { id: `5555555${posts.length}-5555-4555-8555-555555555555`, price: opts.serverPrice, status: "QUEUED" });
    }
    if (url.startsWith("/api/generations")) return json(200, { generations: [], nextCursor: null });
    return json(404, { error: "yo'q" });
  };
  return { posts, sessions: () => sessions };
}

test("ImageStudio: 409 price_changed → new price shown, NO retry until the user presses again (not a double click)", async () => {
  useAppStore.setState({ loggedIn: true, user, sessionChecked: true });
  // Admin raised image prices by 50 % after the page was rendered: the client still shows 2 000.
  const api = stubApi({ serverPricing: { image: { percent: 150, roundTo: 500 } }, serverPrice: 3000 });
  pushes.length = 0;
  render(h(AppRouterContext.Provider, { value: router }, h(ImageStudio, { tool })));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatTanga(2000));
  fireEvent.change(screen.getByLabelText("Rasm tavsifi"), { target: { value: "Registon maydoni erta tongda" } });

  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /Narx o‘zgardi/));
  const alert = screen.getByRole("alert").textContent ?? "";
  assert.ok(alert.includes(`Yangi narx: ${formatTanga(3000)}`), alert);
  assert.match(alert, /tugmani yana bir marta bosing/);
  assert.equal(api.posts.length, 1);
  assert.equal(api.posts[0].expectedPrice, 2000, "the displayed price is sent");
  // The session was refreshed before the error rendered: the button already shows the new price.
  assert.ok(api.sessions() >= 1);
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatTanga(3000));
  assert.equal(pushes.length, 0, "nothing was created");

  // An immediate second press (the tail of a double click) is not a confirmation: no request.
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  assert.equal(api.posts.length, 1, "a double click must not buy at the new price");
  assert.ok((screen.getByRole("alert").textContent ?? "").includes(formatTanga(3000)));

  // A deliberate press confirms: one request with the shown price and a NEW idempotency key.
  await sleep(CONFIRM_MIN_MS + 40);
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.equal(pushes.length, 1));
  assert.equal(api.posts.length, 2);
  assert.equal(api.posts[1].expectedPrice, 3000);
  assert.ok(api.posts[0].key && api.posts[1].key);
  assert.notEqual(api.posts[1].key, api.posts[0].key, "the confirmed retry is a new intent");
  assert.deepEqual(api.posts[1].values, api.posts[0].values);
});

/*
 * The two tests below use tools of their own (crossword, infographic, flat
 * base prices) so they do not depend on the registry state an earlier test
 * left behind: in this container tsx may load `lib/tools.ts` twice (once for
 * the test, once for the components; docs/admin/01-analysis.md §8.1), so a
 * reset from the test file cannot be relied on.
 */
const isPriceChanged = (price: number) => (e: unknown) =>
  e instanceof Error && (e as { status?: number }).status === 409 && (e as { price?: number }).price === price
  && e.message.includes(`Yangi narx: ${formatTanga(price)}`);

test("runGeneration: a changed form after a 409 is a new intent; the price armed for the old form is not reused", async () => {
  const crossword = TOOL_BY_ID.crossword;
  const api = stubApi({ serverPricing: { crossword: { percent: 150, roundTo: 500 } }, serverPrice: 3000 });
  const one = { topic: "Quyosh tizimi", wordCount: "10" };
  await assert.rejects(runGeneration(crossword, one), isPriceChanged(3000));
  assert.equal(api.posts.length, 1);
  assert.equal(api.posts[0].expectedPrice, 2000, "the displayed (formula) price was sent");

  // The session refresh applied the new adjustment: a different form sends ITS displayed (adjusted) price.
  await sleep(CONFIRM_MIN_MS + 40);
  const id = await runGeneration(crossword, { ...one, topic: "Okean hayvonlari" });
  assert.ok(id);
  assert.equal(api.posts.length, 2);
  assert.equal(api.posts[1].expectedPrice, 3000, "priceFor in the browser now applies 150 % → 3 000");
  assert.notEqual(api.posts[1].key, api.posts[0].key);
});

test("runGeneration: no adjustment and no price change → one request, expectedPrice = formula price", async () => {
  const infographic = TOOL_BY_ID.infographic;
  const api = stubApi({ serverPricing: {}, serverPrice: infographic.basePrice });
  const id = await runGeneration(infographic, { topic: "Suv aylanishi" });
  assert.ok(id);
  assert.equal(api.posts.length, 1);
  assert.equal(api.posts[0].expectedPrice, infographic.basePrice);
});
