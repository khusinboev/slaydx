import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LoginModal } from "../../components/overlays/LoginModal.tsx";
import { useUi } from "../../lib/ui.ts";
import { useAppStore } from "../../lib/store.ts";

/**
 * C02/FE-01/SECA-02 — login'dan keyingi `returnTo` yo'naltirishi.
 *
 * `HomeFiles`/boshqa chaqiruvchilar `?returnTo=` so'rov parametrini
 * `useUi.open("login", { returnTo })`ga beradi, `LoginModal` esa
 * muvaffaqiyatli kirishdan so'ng `router.push(returnTo)` chaqiradi.
 * Ikki qatlam sinaladi: (1) `useUi.open` xavfli qiymatni saqlamasligi,
 * (2) `LoginModal` push'dan OLDIN yana bir bor tekshirishi (holat
 * to'g'ridan-to'g'ri, `open()` chetlab o'tib, o'rnatilgan taqdirda ham).
 */

afterEach(() => {
  cleanup();
  useUi.setState({ overlay: null, returnTo: null, payPlan: null });
});

function stubAuthApi() {
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/auth/otp?action=request" && method === "POST") {
      return json(200, { sent: true, delivery: "dev", devCode: "12345" });
    }
    if (url === "/api/auth/otp?action=verify" && method === "POST") {
      return json(200, {
        user: {
          id: "u1", telegramId: null, username: null, name: "Test User", photoUrl: null, language: "uz",
          points: 0, quota: 0, balance: 0, plan: "free", planExpiresAt: null, premium: false,
          university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "",
          teacher: "", city: "", position: "", organization: "", phone: "+998900000000", isAdmin: false,
        },
      });
    }
    if (url === "/api/generations") return json(200, { generations: [] });
    return json(404, { error: "yo'q" });
  };
  useAppStore.setState({
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
    loggedIn: false,
    user: null,
  });
}

/** Telefon + bir martalik kod orqali to'liq kirish oqimini yuritadi. */
async function completePhoneLogin() {
  fireEvent.click(screen.getByText("Telefon raqami orqali kirish"));
  fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "+998901234567" } });
  fireEvent.click(screen.getByText("Kod olish"));
  await waitFor(() => screen.getByLabelText("Kod"));
  fireEvent.change(screen.getByLabelText("Kod"), { target: { value: "12345" } });
}

test("LoginModal: javascript: returnTo bilan router.push HECH QACHON chaqirilmaydi", async () => {
  stubAuthApi();
  const pushes: string[] = [];
  let refreshed = 0;
  const router: AppRouterInstance = {
    back() {}, forward() {}, refresh() { refreshed++; },
    push: (u: string) => { pushes.push(u); }, replace() {}, prefetch() {},
  };

  // Xavfli qiymat to'g'ridan-to'g'ri holatga qo'yiladi — `useUi.open`
  // qatlamini CHETLAB o'tib, `LoginModal`dagi push'dan oldingi ikkinchi
  // tekshiruvni alohida sinaydi.
  useUi.setState({ overlay: "login", returnTo: "javascript:alert(1)", payPlan: null });

  render(h(AppRouterContext.Provider, { value: router }, h(LoginModal)));
  await completePhoneLogin();

  await waitFor(() => assert.equal(refreshed, 1, "xavfli qiymatda router.refresh() ishlatilishi kerak"));
  assert.deepEqual(pushes, [], "router.push HECH QACHON javascript: qiymati bilan chaqirilmasligi kerak");
});

test("LoginModal: xavfsiz /uz yo'li bilan router.push aynan shu yo'l bilan chaqiriladi", async () => {
  stubAuthApi();
  const pushes: string[] = [];
  let refreshed = 0;
  const router: AppRouterInstance = {
    back() {}, forward() {}, refresh() { refreshed++; },
    push: (u: string) => { pushes.push(u); }, replace() {}, prefetch() {},
  };

  useUi.setState({ overlay: "login", returnTo: "/uz/purchase", payPlan: null });

  render(h(AppRouterContext.Provider, { value: router }, h(LoginModal)));
  await completePhoneLogin();

  await waitFor(() => assert.deepEqual(pushes, ["/uz/purchase"]));
  assert.equal(refreshed, 0, "xavfsiz qiymatda refresh() emas, push() ishlatilishi kerak");
});

test("useUi.open: xavfli returnTo saqlanmaydi, xavfsiz /uz yo'li saqlanadi", () => {
  useUi.getState().open("login", { returnTo: "javascript:alert(1)" });
  assert.equal(useUi.getState().returnTo, null, "xavfli qiymat holatga kirmasligi kerak");

  useUi.getState().open("login", { returnTo: "//evil.com" });
  assert.equal(useUi.getState().returnTo, null, "protokol-nisbiy // ham rad etilishi kerak");

  useUi.getState().open("login", { returnTo: "/uz/files/1" });
  assert.equal(useUi.getState().returnTo, "/uz/files/1", "xavfsiz /uz yo'li o'zgarishsiz saqlanishi kerak");
});
