import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LoginForm } from "../../components/overlays/LoginModal.tsx";
import { useAppStore } from "../../lib/store.ts";

/**
 * UX-01 — Telegram oynasi bosish ICHIDA sinxron ochiladi (Safari/iOS
 * `await` dan keyingi `window.open` ni jim bloklaydi); bloklansa —
 * tushuntirish va katta havola. UX-02 — «shu qurilmada oching» izohi.
 */

const realFetch = globalThis.fetch;
const realOpen = window.open;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.open = realOpen;
});

const TICKET = { nonce: "n1", url: "https://t.me/slaydx_bot?start=n1", expiresAt: new Date(Date.now() + 300_000).toISOString() };
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

/** Chipta so'rovi qo'lda yechiladi — `window.open` qachon chaqirilganini aniq ko'rish uchun. */
function stubTicket() {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    if (url === "/api/auth/telegram/ticket") {
      await gate;
      return new Response(JSON.stringify(TICKET), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ user: null, features: {} }), { status: 200 });
  };
  return () => release();
}

function mountForm() {
  useAppStore.setState({
    features: { llm: true, images: true, telegram: true, telegramBot: "slaydx_bot", devLogin: false, pdf: true, payments: { click: false, payme: false } },
    loggedIn: false,
    user: null,
  });
  render(h(AppRouterContext.Provider, { value: router }, h(LoginForm, {})));
}

test("UX-01: oyna bosish ichida SINXRON ochiladi, chipta kelgach havola unga yoziladi", async () => {
  const release = stubTicket();
  const fake = { closed: false, opener: {} as unknown, location: { href: "" }, close() {} };
  const opens: unknown[][] = [];
  window.open = ((...args: unknown[]) => {
    opens.push(args);
    return fake;
  }) as unknown as typeof window.open;
  mountForm();
  fireEvent.click(screen.getByText("Telegram orqali kirish"));
  assert.equal(opens.length, 1, "window.open chipta javobini KUTMASDAN, bosish ichida chaqiriladi");
  await act(async () => {
    release();
  });
  await waitFor(() => assert.equal(fake.location.href, TICKET.url));
  assert.equal(fake.opener, null, "ochilgan sahifa bizning oynaga yeta olmaydi");
  assert.ok(!document.querySelector("[data-popup-blocked]"), "oyna ochildi — ogohlantirish yo'q");
  assert.ok(document.querySelector("[data-same-device-hint]"), "UX-02: shu qurilmada ochish izohi");
});

test("UX-01: brauzer oynani bloklasa (null) — tushuntirish va bosiladigan havola darhol chiqadi", async () => {
  const release = stubTicket();
  window.open = (() => null) as unknown as typeof window.open;
  mountForm();
  fireEvent.click(screen.getByText("Telegram orqali kirish"));
  await act(async () => {
    release();
  });
  const alert = await waitFor(() => {
    const el = document.querySelector("[data-popup-blocked]");
    assert.ok(el);
    return el;
  });
  assert.match(alert.textContent ?? "", /bloklagan/);
  const link = document.querySelector<HTMLAnchorElement>("[data-ticket-link]");
  assert.ok(link);
  assert.equal(link.getAttribute("href"), TICKET.url);
  assert.match(link.textContent ?? "", /Telegram’da ochish/);
  assert.ok(document.querySelector("[data-same-device-hint]"), "UX-02 izohi bloklangan holatda ham");
});
