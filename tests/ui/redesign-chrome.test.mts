import "./setup.ts";
import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WalletPage } from "../../components/wallet/WalletPage.tsx";
import { PayDialog } from "../../components/overlays/PayDialog.tsx";
import { DEFAULT_TOPUP, TOPUP_PRESETS, openPay, usePayAmount } from "../../components/overlays/pay-amount.ts";
import { ToolChrome } from "../../components/forms/ToolChrome.tsx";
import { RESULT_LIST_PATH, ResultView } from "../../components/files/ResultView.tsx";
import { parentOf } from "../../lib/nav/parents.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { useAppStore } from "../../lib/store.ts";
import { useUi } from "../../lib/ui.ts";
import sitemapImport from "../../app/sitemap.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Redesign W5 «Chrome & type» (docs/redesign/PLAN.md): the F0 hand-offs and
 * the Hamyon quick packages.
 *
 *   - «Tez to'ldirish»: one card per `TOPUP_PRESETS` amount, «eng qulay» on the
 *     PayDialog default; a card opens PayDialog with ITS amount preselected and
 *     the order is created with it; no amount → the default stays;
 *   - PayDialog signed out → login returning to `/uz/wallet` (was `/uz/purchase`);
 *   - ToolChrome header: PageHeader «←» to `/uz/create`, the tool's icon chip in
 *     its `tc` colour, its description as the subtitle;
 *   - ResultView: after a delete the page is REPLACED by `/uz/files` (Ishlarim);
 *   - sitemap lists `/uz/wallet`, not the `/uz/purchase` alias.
 *
 * Mutations (each turned the named test red, then restored): see the W5 report.
 */

if (!("IntersectionObserver" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

const realFetch = globalThis.fetch;
before(() => {
  // jsdom without `pretendToBeVisual`: `document.hidden === true` would park the pollers.
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useUi.setState({ overlay: null, returnTo: null });
  usePayAmount.setState({ amount: DEFAULT_TOPUP });
  useAppStore.setState({ loggedIn: false, user: null });
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const USER = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 12_000, university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "", teacher: "",
  city: "", position: "", organization: "", phone: null, isAdmin: false,
} as api.ServerUser;

type Call = { url: string; method: string; body?: string };
function stub(extra?: (c: Call) => Response | undefined): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c: Call = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : undefined };
    calls.push(c);
    const r = extra?.(c);
    if (r) return r;
    if (c.url === "/api/users/me") return json(200, { user: USER, transactions: [] });
    if (c.url === "/api/payments/orders" && c.method === "POST") return json(200, { checkoutUrl: `${window.location.origin}/uz/wallet#provayder`, orderId: "o9" });
    if (c.url === "/api/payments/orders") return json(200, { orders: [], providers: { click: true, payme: true } });
    if (c.url === "/api/referral") return json(200, { code: "k7m3p9qx", botLink: null, webLink: "https://slaydx.uz/uz?ref=k7m3p9qx", rewardPoints: 2000, invitedCount: 0, earnedPoints: 0, recent: [] });
    return json(404, {});
  }) as typeof fetch;
  return calls;
}

const noopRouter = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
function inRouter(node: ReturnType<typeof h>, pathname = "/uz/wallet", router: AppRouterInstance = noopRouter) {
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: pathname }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, node)),
  );
}

function signIn() {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    user: USER,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: true, payme: true } } as never,
    refreshSession: async () => {},
  });
}

const pressed = () => [...document.querySelectorAll<HTMLElement>("[data-pay-amount]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => Number(b.getAttribute("data-pay-amount")));

/* ───────────────────────── Hamyon «Tez to'ldirish» ───────────────────────── */

test("Hamyon packages: one card per PayDialog amount, «eng qulay» only on the dialog default", () => {
  signIn();
  stub();
  render(inRouter(h(WalletPage)));
  const packs = [...document.querySelectorAll<HTMLElement>("[data-wallet-pack]")];
  assert.deepEqual(packs.map((p) => Number(p.getAttribute("data-wallet-pack"))), [...TOPUP_PRESETS]);
  assert.deepEqual([...TOPUP_PRESETS], [10_000, 25_000, 50_000, 100_000], "the real PayDialog list");
  const best = packs.filter((p) => /eng qulay/.test(p.textContent ?? ""));
  assert.equal(best.length, 1);
  assert.equal(Number(best[0]!.getAttribute("data-wallet-pack")), DEFAULT_TOPUP);
  assert.equal(DEFAULT_TOPUP, 25_000);
  for (const p of packs) assert.match(p.className, /min-h-\[4\.5rem\]/, "≥ 44 px target");
  assert.ok(document.querySelector("[data-wallet-packs] [data-wallet-features]"), "the top-up facts live under the packages now");
});

for (const amount of TOPUP_PRESETS) {
  test(`Hamyon package ${amount}: opens PayDialog with ${amount} preselected; Click orders exactly ${amount}`, async () => {
    signIn();
    const calls = stub();
    render(inRouter(h("div", null, h(WalletPage), h(PayDialog))));
    // Start from another choice so a no-op preselect cannot pass.
    usePayAmount.setState({ amount: amount === 10_000 ? 100_000 : 10_000 });
    await act(async () => {
      fireEvent.click(document.querySelector(`[data-wallet-pack="${amount}"]`)!);
    });
    assert.equal(useUi.getState().overlay, "pay");
    assert.deepEqual(pressed(), [amount], "only that amount is selected");
    assert.match(document.querySelector("[data-pay-total]")!.textContent ?? "", new RegExp(String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Click" }));
      await new Promise((r) => setTimeout(r, 5));
    });
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/payments/orders");
    assert.ok(post, "order created");
    assert.equal(JSON.parse(post!.body ?? "{}").amount, amount);
  });
}

test("PayDialog without an amount: the default (25 000) is preselected; plain open keeps the user's choice; an unknown amount is ignored", async () => {
  signIn();
  stub();
  render(inRouter(h(PayDialog)));
  await act(async () => openPay());
  assert.deepEqual(pressed(), [DEFAULT_TOPUP], "fresh dialog: the default");
  await act(async () => {
    fireEvent.click(document.querySelector('[data-pay-amount="50000"]')!);
  });
  await act(async () => useUi.getState().close());
  await act(async () => useUi.getState().open("pay"));
  assert.deepEqual(pressed(), [50_000], "open(\"pay\") without an amount keeps the last choice");
  await act(async () => useUi.getState().close());
  await act(async () => openPay({ amount: 30_000 }));
  assert.deepEqual(pressed(), [50_000], "not a preset: ignored");
  assert.equal(useUi.getState().overlay, "pay", "the dialog still opens");
});

test("PayDialog signed out: a method opens the login returning to /uz/wallet (not the /uz/purchase alias)", async () => {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: false,
    user: null,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: true, payme: true } } as never,
  });
  stub();
  render(inRouter(h(PayDialog)));
  await act(async () => openPay({ amount: 100_000 }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Payme" }));
  });
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/wallet");
});

/* ───────────────────────── ToolChrome header ───────────────────────── */

test("ToolChrome header: PageHeader «←» to /uz/create, the tool's icon chip in its colour, the description as subtitle; price beside the button", () => {
  const tool = TOOL_BY_ID["slide"];
  render(
    inRouter(
      h(ToolChrome, { title: tool.pageTitle, submitLabel: tool.submitLabel, price: 3000, onSubmit() {}, children: h("div", null, "forma") }),
      `/uz/${tool.slug}`,
    ),
  );
  const header = document.querySelector("[data-page-header]")!;
  assert.ok(header, "PageHeader");
  assert.equal(header.querySelector("[data-page-header-back]")!.getAttribute("href"), "/uz/create");
  const chip = header.querySelector<HTMLElement>(`[data-tool-chip="${tool.id}"]`);
  assert.ok(chip?.querySelector("svg"), "tool icon chip");
  assert.equal(chip!.style.getPropertyValue("--tc"), tool.tc);
  assert.equal(header.querySelector("h1")!.textContent, tool.pageTitle);
  assert.equal(header.querySelector("p")!.textContent, tool.description);
  const card = document.querySelector("[data-submit-card]")!;
  assert.ok(card.querySelector("[data-price-total]"), "price on the bar");
  assert.match(card.className, /rounded-\[22px\]/);
  assert.match(card.querySelector("button")!.className, /\bh-12\b/, "48 px primary button");
});

test("ToolChrome header without a route (preview/test): the tool is found by its page title", () => {
  const tool = TOOL_BY_ID["referat"];
  render(inRouter(h(ToolChrome, { title: tool.pageTitle, submitLabel: tool.submitLabel, onSubmit() {}, children: h("div") }), "/"));
  assert.ok(document.querySelector(`[data-tool-chip="${tool.id}"]`));
  assert.ok(!document.querySelector("[data-price-total]"), "no price → no price block");
});

/* ───────────────────────── ResultView delete ───────────────────────── */

test("ResultView: after a confirmed delete the page is REPLACED by /uz/files (Ishlarim), the result's parent", async () => {
  const ID = "22222222-2222-4222-8222-222222222222";
  const replaced: string[] = [];
  const router = { ...noopRouter, replace: (href: string) => void replaced.push(href) } as unknown as AppRouterInstance;
  const calls = stub((c) => {
    if (c.method === "DELETE" && c.url === `/api/generations/${ID}`) return json(200, { ok: true });
    if (c.url === "/api/auth/session") return json(200, { user: null, features: null });
    if (c.method === "GET" && c.url.startsWith(`/api/generations/${ID}`)) {
      return json(200, {
        generation: {
          id: ID, type: "referat", topic: "Iqlim o'zgarishi", status: "COMPLETED", createdAt: "2026-09-23T08:00:00.000Z",
          finishedAt: "2026-09-23T08:01:00.000Z", price: 3000, fileName: "referat.docx", format: "docx", progress: 100, step: "Tayyor",
          expiresAt: null, error: null, preview: null, html: null, doc: null, hasFile: true, docVersion: 1, fileVersion: 1,
        },
      });
    }
    if (c.method === "POST") return json(404, {});
    return undefined;
  });
  signIn();
  render(inRouter(h(ResultView, { id: ID }), `/uz/files/${ID}`, router));
  const more = await waitFor(() => {
    const b = document.querySelector<HTMLElement>("[data-more-button]");
    assert.ok(b);
    return b;
  }, { timeout: 3000 });
  await act(async () => {
    fireEvent.click(more);
  });
  const item = await waitFor(() => {
    const el = [...document.querySelectorAll<HTMLElement>("button")].find((b) => /O’chirish/.test(b.textContent ?? ""));
    assert.ok(el, "menu item");
    return el;
  });
  await act(async () => {
    fireEvent.click(item);
  });
  const confirm = await waitFor(() => {
    const b = document.querySelector<HTMLElement>("[data-delete-confirm]");
    assert.ok(b, "two-step confirm");
    return b;
  });
  // FE-07: a confirm sooner than CONFIRM_MIN_MS after arming counts as a double click.
  await act(async () => new Promise((r) => setTimeout(r, 650)));
  await act(async () => {
    fireEvent.click(confirm, { detail: 1 });
    await new Promise((r) => setTimeout(r, 5));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.method === "DELETE")));
  await waitFor(() => assert.deepEqual(replaced, ["/uz/files"]));
  assert.equal(RESULT_LIST_PATH, parentOf(`/uz/files/${ID}`), "the same page «←» falls back to");
});

/* ───────────────────────── sitemap ───────────────────────── */

test("sitemap: lists /uz/wallet (the real Hamyon page), never the /uz/purchase redirect alias", () => {
  const sitemap = (sitemapImport as unknown as { default?: typeof sitemapImport }).default ?? sitemapImport;
  const urls = sitemap().map((e) => new URL(e.url).pathname);
  assert.ok(urls.includes("/uz/wallet"));
  assert.ok(!urls.includes("/uz/purchase"));
  assert.ok(urls.includes("/uz") && urls.includes("/uz/create"));
});
