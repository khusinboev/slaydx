import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { PurchasePage } from "../../components/purchase/PurchasePage.tsx";
import { useAppStore } from "../../lib/store.ts";

/**
 * UX-04 / FE-19 — Click/Payme dan qaytgandan keyingi «To'lov tasdiqlanmoqda…»
 * banneri abadiy qotmaydi: kechikkan webhook ham ushlanadi (~2 daqiqa,
 * o'sib boruvchi oraliq), undan keyin — tushuntirish va «Tekshirish»;
 * bekor qilingan buyurtma «tasdiqlanmoqda» deb ko'rsatilmaydi.
 */

const realFetch = globalThis.fetch;
// jsdom `pretendToBeVisual` siz `document.hidden === true` — `waitTurn` yorliq ko'rinishini kutib qolardi.
Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

let now = 0;
let refreshes = 0;
function stubOrders(stateAt: (ms: number) => "pending" | "paid" | "cancelled") {
  let calls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    if (String(input) === "/api/payments/orders") {
      calls++;
      return json(200, {
        orders: [{ id: "o1", provider: "click", purpose: "topup", amountSoum: 10_000, state: stateAt(now), createdAt: "2026-09-24T08:00:00.000Z" }],
        plan: { priceSoum: 15_000, days: 30, quota: 15_000 },
        providers: { click: true, payme: false },
      });
    }
    return json(404, {});
  };
  return () => calls;
}

function mount() {
  refreshes = 0;
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    refreshSession: async () => {
      refreshes++;
    },
  });
  render(h(SearchParamsContext.Provider, { value: new URLSearchParams("order=o1") }, h(PurchasePage)));
}

async function advance(t: import("node:test").TestContext, ms: number) {
  for (let done = 0; done < ms; done += 500) {
    await act(async () => {
      t.mock.timers.tick(500);
      now += 500;
      // `Response.text()` oqimi mikrovazifa emas — bir necha makro-navbat kerak (setImmediate soxtalanmagan).
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    });
  }
}

const banner = () => document.querySelector("[data-pay-banner]")?.getAttribute("data-pay-banner") ?? null;

test("UX-04: webhook 25 s kechiksa ham banner «qabul qilindi» ga o'tadi, balans yangilanadi", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  now = 0;
  stubOrders((ms) => (ms >= 25_000 ? "paid" : "pending"));
  mount();
  await advance(t, 1000);
  assert.equal(banner(), "pending");
  await advance(t, 40_000);
  assert.ok(screen.getByText(/To.lov qabul qilindi/), "kechikkan webhook ushlandi");
  assert.ok(refreshes >= 1, "sarlavhadagi balans yangilanadi");
});

test("UX-04: webhook kelmasa — ~2 daqiqadan keyin tushuntirish + «Tekshirish»; so'rovlar cheklangan; tugma darhol tekshiradi", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  now = 0;
  let paid = false;
  const calls = stubOrders(() => (paid ? "paid" : "pending"));
  mount();
  await advance(t, 60_000);
  assert.equal(banner(), "pending", "1 daqiqada hali tekshirilmoqda");
  await advance(t, 70_000);
  assert.equal(banner(), "stalled", "2 daqiqadan keyin — abadiy «tasdiqlanmoqda» emas");
  assert.match(document.querySelector("[data-pay-banner]")?.textContent ?? "", /qayta to.lamang/);
  const n = calls();
  assert.ok(n <= 12, `server bosilmaydi: ${n} so'rov`);
  await advance(t, 60_000);
  assert.equal(calls(), n, "to'xtagandan keyin jim — so'rov yo'q");
  paid = true;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Tekshirish" }));
  });
  await advance(t, 500);
  assert.ok(calls() > n, "«Tekshirish» darhol so'raydi");
  assert.ok(screen.getByText(/To.lov qabul qilindi/));
});

test("FE-19: bekor qilingan buyurtma «tasdiqlanmoqda» emas — «bekor qilindi», polling to'xtaydi", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  now = 0;
  const calls = stubOrders(() => "cancelled");
  mount();
  await advance(t, 1000);
  assert.equal(banner(), "cancelled");
  await advance(t, 10_000);
  const n = calls();
  await advance(t, 60_000);
  assert.equal(calls(), n, "yakuniy holatdan keyin so'rov yo'q");
});
