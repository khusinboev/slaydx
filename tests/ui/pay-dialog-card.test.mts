import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * PayDialog: «Click» and «Karta orqali» (Click `card_type`, Uzcard / Humo).
 *
 * - provider keys decide what is DRAWN: no Click → no Click / Karta buttons (and no «o'chiq»
 *   placeholders); no Payme → no Payme button;
 * - «Click» posts `{ provider: "click" }` (no `card`); «Karta orqali» only reveals the card
 *   systems, «Uzcard» / «Humo» post `{ provider: "click", card }`;
 * - the checkout URL the API returns is opened with the existing external `replace` exit
 *   (the Mini App keeps the same flow and `return_url`), signed-out users get the login first.
 *
 * Mutations: the card button posting without `card` → «card systems post card»; Click button
 * drawn although Click is off → «nothing configured»; «Karta orqali» leaving the dialog directly
 * → «Karta orqali only reveals».
 */

const nav = await import("../../lib/nav/history.ts");
const { PayDialog } = await import("../../components/overlays/PayDialog.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  nav.__setLeaveSiteForTests(null);
  nav.__resetNavForTests();
  useUi.setState({ overlay: null, returnTo: null });
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
const mount = () =>
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/uz/wallet" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, h(PayDialog))),
    ),
  );
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 2));
  });

function setup(payments: { click: boolean; payme: boolean }, loggedIn = true) {
  useAppStore.setState({
    loggedIn,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments } as never,
  });
  const posts: Record<string, unknown>[] = [];
  const exits: Array<[string, boolean]> = [];
  nav.__setLeaveSiteForTests((href, replace) => exits.push([href, replace]));
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (String(input) === "/api/payments/orders" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      return json(200, {
        order: { id: "o9", provider: body.provider },
        checkoutUrl: `https://my.click.uz/services/pay?card_type=${String(body.card ?? "-")}`,
      });
    }
    return json(404, {});
  };
  return { posts, exits };
}

async function openDialog() {
  mount();
  await act(async () => {
    useUi.getState().open("pay");
  });
  await settle();
}
const btn = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;
const methodNames = () =>
  [...document.querySelectorAll("[data-pay-methods] button, [data-pay-card-types] button")].map((b) => b.textContent);

test("Click on, Payme off: «Click» + «Karta orqali», no Payme and no «o'chiq» placeholder", async () => {
  setup({ click: true, payme: false });
  await openDialog();
  assert.deepEqual(methodNames(), ["Click", "Karta orqali"]);
  assert.ok(!document.body.textContent?.includes("o'chiq"));
  assert.ok(!document.querySelector("[data-pay-card-types]"), "card systems are hidden until «Karta orqali» is pressed");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-pay-methods] button")) {
    assert.ok(b.className.includes("h-12"), "≥ 48 px");
    assert.ok(!b.disabled);
  }
});

test("nothing configured: no method buttons at all (only the notice)", async () => {
  setup({ click: false, payme: false });
  await openDialog();
  assert.deepEqual(methodNames(), []);
  assert.ok(!btn("Click") && !btn("Karta orqali") && !btn("Payme"));
  assert.match(document.body.textContent ?? "", /To.lov provayderi hali ulanmagan/);
});

test("Payme only: just «Payme» (no Click, no Karta orqali)", async () => {
  setup({ click: false, payme: true });
  await openDialog();
  assert.deepEqual(methodNames(), ["Payme"]);
});

test("both on: Click, Karta orqali, Payme", async () => {
  setup({ click: true, payme: true });
  await openDialog();
  assert.deepEqual(methodNames(), ["Click", "Karta orqali", "Payme"]);
});

test("«Click» posts the plain order (no card) and leaves with the replace exit", async () => {
  const { posts, exits } = setup({ click: true, payme: true });
  await openDialog();
  fireEvent.click(btn("Click")!);
  await settle();
  await settle();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { provider: "click", amount: 25_000, purpose: "topup" });
  assert.deepEqual(exits, [["https://my.click.uz/services/pay?card_type=-", true]]);
});

test("«Karta orqali» only reveals Uzcard / Humo; each posts the Click order with its card", async () => {
  const { posts, exits } = setup({ click: true, payme: false });
  await openDialog();
  const open = btn("Karta orqali")!;
  assert.equal(open.getAttribute("aria-expanded"), "false");
  fireEvent.click(open);
  await settle();
  assert.equal(posts.length, 0, "Karta orqali only reveals");
  assert.equal(exits.length, 0);
  assert.equal(btn("Karta orqali")!.getAttribute("aria-expanded"), "true");
  assert.deepEqual(methodNames(), ["Click", "Karta orqali", "Uzcard", "Humo"]);

  fireEvent.click(btn("Humo")!);
  await settle();
  await settle();
  assert.deepEqual(posts, [{ provider: "click", amount: 25_000, purpose: "topup", card: "humo" }]);
  assert.deepEqual(exits, [["https://my.click.uz/services/pay?card_type=humo", true]]);
});

test("Uzcard posts card: uzcard with the chosen amount", async () => {
  const { posts } = setup({ click: true, payme: false });
  await openDialog();
  fireEvent.click(screen.getByRole("button", { name: /50.000 so'm/ }));
  fireEvent.click(btn("Karta orqali")!);
  await settle();
  fireEvent.click(btn("Uzcard")!);
  await settle();
  await settle();
  assert.deepEqual(posts, [{ provider: "click", amount: 50_000, purpose: "topup", card: "uzcard" }]);
});

test("«Karta orqali» toggles the card systems", async () => {
  setup({ click: true, payme: false });
  await openDialog();
  fireEvent.click(btn("Karta orqali")!);
  await settle();
  assert.ok(document.querySelector("[data-pay-card-types]"));
  fireEvent.click(btn("Karta orqali")!);
  await settle();
  assert.ok(!document.querySelector("[data-pay-card-types]"), "second press hides them");
});

test("signed out: «Karta orqali» → Uzcard opens the login (returning to the wallet), no order", async () => {
  const { posts } = setup({ click: true, payme: false }, false);
  await openDialog();
  fireEvent.click(btn("Karta orqali")!);
  await settle();
  fireEvent.click(btn("Humo")!);
  await settle();
  assert.equal(posts.length, 0);
  assert.equal(useUi.getState().overlay, "login");
});

test("API error on a card order shows the message and re-enables the buttons", async () => {
  setup({ click: true, payme: false });
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(400, { error: "Karta turi noto'g'ri" });
  await openDialog();
  fireEvent.click(btn("Karta orqali")!);
  await settle();
  fireEvent.click(btn("Uzcard")!);
  await settle();
  await settle();
  assert.match(screen.getByRole("alert").textContent ?? "", /Karta turi/);
  assert.ok(!btn("Uzcard")!.disabled && !btn("Click")!.disabled);
});
