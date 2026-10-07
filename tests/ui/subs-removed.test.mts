import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { PurchasePage } from "../../components/purchase/PurchasePage.tsx";
import { PayDialog } from "../../components/overlays/PayDialog.tsx";
import { SearchDialog } from "../../components/overlays/SearchDialog.tsx";
import { ProfilePage } from "../../components/profile/ProfilePage.tsx";
// Redesign F0: the Sidebar / TopBar are gone; their successors carry the same promises.
import { BalanceChip } from "../../components/shell/BalanceChip.tsx";
import { TabBar } from "../../components/shell/TabBar.tsx";
import { CreateSheet } from "../../components/shell/CreateSheet.tsx";
import { creditTotal, useAppStore, writerProfile } from "../../lib/store.ts";
import { useUi } from "../../lib/ui.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Obuna (Pro) mahsulotdan olib tashlandi: sessiyada `plan`/`planExpiresAt`/`premium`
 * yo'q (`quota` — doim 0 — bir reliz saqlanadi). Iste'molchi UI'da «Pro», «obuna»,
 * «tarif», «kvota» yo'q; to'lov faqat balansni to'ldirish (`purpose: "topup"`).
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useUi.setState({ overlay: null, returnTo: null });
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Eski sessiya shakli (kvota bor) ham, yangisi (kvota yo'q) ham NaN bermasligi kerak.
const base = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 3000,
  balance: 12_000, university: "", faculty: "", department: "", group: "",
  course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
};
const userWith = (quota?: number) => ({ ...base, ...(quota === undefined ? {} : { quota }) }) as unknown as api.ServerUser;

const FORBIDDEN = /\bPRO\b|\bPro\b|obuna|tarif|kvota|Bepul reja|Rejani/i;

function signIn(user = userWith(0)) {
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    user,
    features: { payments: { click: true, payme: true } } as never,
    refreshSession: async () => {},
  });
}

type Captured = { url: string; body: Record<string, unknown> }[];
function stubOrders(captured: Captured = []) {
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/payments/orders" && init?.method === "POST") {
      captured.push({ url, body: JSON.parse(String(init.body)) });
      return json(200, {
        order: { id: "o9", provider: "click", purpose: "topup", amountSoum: 25_000, state: "created", createdAt: "2026-10-02T08:00:00.000Z" },
        checkoutUrl: "#checkout",
      });
    }
    if (url === "/api/payments/orders") {
      return json(200, {
        orders: [
          { id: "o1", provider: "click", purpose: "topup", amountSoum: 10_000, state: "paid", createdAt: "2026-09-24T08:00:00.000Z" },
          { id: "o2", provider: "payme", purpose: "pro", amountSoum: 15_000, state: "paid", createdAt: "2026-09-20T08:00:00.000Z" },
        ],
        providers: { click: true, payme: true },
      });
    }
    return json(404, {});
  };
  return captured;
}

const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
const withRouter = (node: ReturnType<typeof h>) =>
  h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: "/uz" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, node)),
  );

function mountPurchase() {
  render(withRouter(h("div", null, h(PurchasePage), h(PayDialog))));
}

test("purchase: Pro/Bepul taklifi yo'q, bitta «Balansni to'ldirish» kartasi", async () => {
  signIn();
  stubOrders();
  mountPurchase();
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  const text = document.body.textContent ?? "";
  assert.doesNotMatch(text, FORBIDDEN);
  assert.ok(screen.getByRole("heading", { level: 1, name: /Balansni to.ldirish/ }));
  assert.equal(document.querySelectorAll("article").length, 1, "yagona karta");
  assert.ok(screen.getByRole("button", { name: /Balansni to.ldirish/ }));
  assert.match(document.querySelector("[data-testid=purchase-total]")?.textContent ?? "", /15[\s .,]?000 tanga/);
  // Buyurtma tarixi saqlangan (eski «pro» buyurtma ham ko'rinadi).
  assert.ok(screen.getByText(/Oxirgi to.lovlar/));
});

test("purchase: to'lov faqat purpose=topup buyurtma yaratadi (tanlangan summa bilan)", async () => {
  signIn();
  const captured = stubOrders();
  mountPurchase();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Balansni to.ldirish/ }));
  });
  const dialog = screen.getByRole("dialog");
  assert.doesNotMatch(dialog.textContent ?? "", FORBIDDEN);
  assert.ok(dialog.querySelector("fieldset"), "summa tanlash har doim ko'rinadi");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "50 000 so'm" })); // redesign W5: was «50k»
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Click" }));
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].body, { provider: "click", amount: 50_000, purpose: "topup" });
});

test("purchase: kirmagan foydalanuvchi — tugma kirish oynasini ochadi, Pro yo'q", async () => {
  useAppStore.setState({ loggedIn: false, sessionChecked: true, user: null });
  stubOrders();
  mountPurchase();
  assert.doesNotMatch(document.body.textContent ?? "", FORBIDDEN);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Balansni to.ldirish/ }));
  });
  assert.equal(useUi.getState().overlay, "login");
});

// Redesign W4: Ball/Balans and the top-up link moved to Hamyon (`/uz/wallet`, W3); the profile keeps one
// «Hamyon» row with the total and the link (was: «Ball» + «Balans» stats and a link to /uz/purchase).
test("profil: PRO belgisi, muddat va kvota yo'q; «Hamyon» qatori jami tangani ko'rsatadi va /uz/wallet ga olib boradi", () => {
  signIn(userWith(0));
  render(withRouter(h(ProfilePage)));
  assert.doesNotMatch(document.body.textContent ?? "", FORBIDDEN);
  const wallet = document.querySelector<HTMLAnchorElement>("a[data-profile-row='hamyon']");
  assert.ok(wallet);
  assert.equal(wallet.getAttribute("href"), "/uz/wallet");
  assert.match(wallet.textContent ?? "", /Hamyon/);
  assert.match(wallet.textContent ?? "", /15[\s .,]?000 tanga/);
  assert.ok(!/NaN/.test(document.body.textContent ?? ""));
});

test("balans chipi, pastki panel va «+» oynasi (sidebar o'rnida): PRO belgisi yo'q, balans tanga bilan", () => {
  signIn(userWith(0));
  useUi.setState({ overlay: "create" });
  render(withRouter(h("div", null, h(BalanceChip), h(TabBar, { shown: true, createOpen: true }), h(CreateSheet))));
  assert.doesNotMatch(document.body.textContent ?? "", FORBIDDEN);
  const chip = document.querySelector<HTMLAnchorElement>("[data-balance]");
  assert.ok(chip);
  assert.match(chip.textContent ?? "", /15[\s\u00a0.,]?000/);
  assert.equal(chip.getAttribute("href"), "/uz/wallet");
  assert.ok(document.querySelector('[data-tab="hamyon"]'), "Hamyon har sahifada");
});

test("qidiruv oynasi: «Tariflar» o'rniga «Balansni to'ldirish» → /uz/purchase", () => {
  signIn();
  useUi.setState({ overlay: "search" });
  render(withRouter(h(SearchDialog)));
  assert.doesNotMatch(document.body.textContent ?? "", /Tarif|Rejani/);
  assert.ok(screen.getByText("Balansni to'ldirish"));
});

test("sessiyada plan/premium/quota bo'lmasa ham hech joyda NaN yo'q", () => {
  signIn(userWith(undefined));
  assert.equal(creditTotal(useAppStore.getState().user), 15_000);
  const profileCopy = writerProfile(useAppStore.getState().user);
  assert.ok(!("plan" in profileCopy) && !("premium" in profileCopy));
  assert.equal(profileCopy.quota, 0);
  useUi.setState({ overlay: "create" });
  const nodes = [h(BalanceChip), h(TabBar, { shown: true, createOpen: true }), h(CreateSheet), h(ProfilePage)];
  for (const node of nodes) {
    cleanup();
    render(withRouter(node));
    const text = document.body.textContent ?? "";
    assert.ok(!/NaN|undefined/.test(text), `NaN/undefined: ${text.slice(0, 120)}`);
  }
});
