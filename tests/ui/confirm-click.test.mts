import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { CONFIRM_MIN_MS, useConfirmClick } from "../../components/overlays/useConfirmClick.ts";
import { EditActions } from "../../components/files/EditActions.tsx";
import { HomeFiles } from "../../components/home/HomeFiles.tsx";
import { useAppStore } from "../../lib/store.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * FE-07 — qo'sh bosish «Rostdan?» ikki bosqichli tasdiqni chetlab o'ta olmaydi.
 *
 * Qo'sh bosish = ikki `click`: birinchisi `detail:1`, ikkinchisi `detail:2`
 * (~100–250 ms farq bilan). Ilgari ikkinchisi darhol amalni bajarardi:
 * to'langan hujjat DELETE bo'lardi, saqlanmagan tahrir tashlanardi.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Probe({ onAction }: { onAction: () => void }) {
  const c = useConfirmClick(onAction);
  return h("button", { type: "button", onClick: c.trigger }, c.armed ? "Rostdan?" : "O‘chirish");
}

test("useConfirmClick: qo'sh bosish (detail 1 → 2) amalni bajarmaydi, tugma qurollangan qoladi", async () => {
  let n = 0;
  render(h(Probe, { onAction: () => n++ }));
  fireEvent.click(screen.getByText("O‘chirish"), { detail: 1 });
  fireEvent.click(screen.getByText("Rostdan?"), { detail: 2 });
  assert.equal(n, 0, "qo'sh bosish o'chirmasligi kerak");
  assert.ok(screen.getByText("Rostdan?"), "tasdiq hali kutilmoqda");
});

test("useConfirmClick: juda tez ikkinchi bosish (detail 1, <600 ms, sensorli ekran) ham e'tiborsiz", async () => {
  let n = 0;
  render(h(Probe, { onAction: () => n++ }));
  fireEvent.click(screen.getByText("O‘chirish"), { detail: 1 });
  fireEvent.click(screen.getByText("Rostdan?"), { detail: 1 });
  assert.equal(n, 0);
});

test("useConfirmClick: ongli ikkinchi bosish (≥600 ms) amalni BIR marta bajaradi", async () => {
  let n = 0;
  render(h(Probe, { onAction: () => n++ }));
  fireEvent.click(screen.getByText("O‘chirish"), { detail: 1 });
  await pause(CONFIRM_MIN_MS + 40);
  fireEvent.click(screen.getByText("Rostdan?"), { detail: 1 });
  assert.equal(n, 1);
  assert.ok(screen.getByText("O‘chirish"), "holat tushadi");
});

test("EditActions: «Asliga qaytarish» ni qo'sh bosish saqlanmagan tahrirni tashlamaydi", async () => {
  let discarded = 0;
  render(
    h(EditActions, {
      state: { pending: 3, saving: false, justSaved: false, save: () => undefined, discard: () => discarded++ },
    }),
  );
  const btn = screen.getByTitle("Saqlanmagan o‘zgarishlarni bekor qilish");
  fireEvent.click(btn, { detail: 1 });
  fireEvent.click(btn, { detail: 2 });
  assert.equal(discarded, 0);
  await pause(CONFIRM_MIN_MS + 40);
  fireEvent.click(btn, { detail: 1 });
  assert.equal(discarded, 1);
});

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("HomeFiles: kartadagi o'chirishni qo'sh bosish DELETE yubormaydi; ongli tasdiq yuboradi", async () => {
  const deletes: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      deletes.push(String(input));
      return json(200, { ok: true, refunded: false });
    }
    if (String(input).startsWith("/api/auth/session")) return json(200, { user: null, features: {} });
    return json(200, { generations: [] });
  };
  const row = {
    id: "d1",
    type: "referat",
    topic: "Hujjat d1",
    status: "COMPLETED",
    createdAt: "2026-09-20T08:00:00.000Z",
    price: 3000,
    fileName: "r.docx",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: null,
  } as unknown as api.ServerGeneration;
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    generations: [row],
    generationsLoaded: true,
    refreshGenerations: async () => {},
    refreshSession: async () => {},
  });
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(HomeFiles)),
    ),
  );
  const del = () =>
    document.querySelector<HTMLButtonElement>(`[aria-label^="Hujjat d1 — o'chirish"]`)!;
  await act(async () => {
    fireEvent.click(del(), { detail: 1 });
  });
  await act(async () => {
    fireEvent.click(del(), { detail: 2 });
  });
  await pause(20);
  assert.equal(deletes.length, 0, "qo'sh bosish hujjatni o'chirmasligi kerak");
  assert.match(del().getAttribute("aria-label") ?? "", /tasdiqlang/);
  await pause(CONFIRM_MIN_MS + 40);
  await act(async () => {
    fireEvent.click(del(), { detail: 1 });
  });
  await waitFor(() => assert.equal(deletes.length, 1));
  assert.equal(deletes[0], "/api/generations/d1");
});
