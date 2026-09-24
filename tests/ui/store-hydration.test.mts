import "./setup.ts";

/*
 * FE-09 (2-qism) — QO'RIQCHI test: saqlangan sozlama gidratsiya
 * snapshotini buzmaydi.
 *
 * Store import qilinishidan OLDIN localStorage da tun mavzusi turadi
 * (qaytgan foydalanuvchi). Server hech qachon localStorage ni ko'rmaydi —
 * u `hydrated:false`, kun mavzusi bilan chizadi. `getInitialState()`
 * (React gidratsiyada `useSyncExternalStore` ning server snapshoti) ham
 * AYNAN shunday bo'lishi shart. zustand 5.0.15 `persist` buni o'zi
 * ta'minlaydi (`api.getInitialState = () => configResult`) — auditdagi
 * «gidratsiya nomuvofiqligi» shu versiyada takrorlanmadi. Bu test
 * zustand yangilanganda yoki `persist` o'rniga qo'lda o'qish yozilganda
 * shu kafolat jim yo'qolmasligi uchun. 1-qism (kirish oynasi) —
 * `session-resilience.test.mts`.
 */
(globalThis.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = ((q: string) =>
  ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as unknown as (
  q: string,
) => MediaQueryList;
window.localStorage.setItem("slaydx-ui", JSON.stringify({ state: { theme: "dark", dir: "ltr" }, version: 2 }));

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup } from "@testing-library/react";

afterEach(() => cleanup());

const { useAppStore } = await import("../../lib/store.ts");
const { TopBar } = await import("../../components/shell/TopBar.tsx");
const { renderToString } = await import("react-dom/server");
const { hydrateRoot } = await import("react-dom/client");

test("FE-09: getInitialState = server holati (hydrated:false, kun); joriy holat = saqlangan (tun)", () => {
  const init = useAppStore.getInitialState();
  assert.equal(init.hydrated, false, "gidratsiya snapshoti serverdagidek — hydrated:false");
  assert.equal(init.theme, "light", "gidratsiya snapshoti serverdagidek — kun mavzusi");
  assert.equal(useAppStore.getState().theme, "dark", "saqlangan tun mavzusi baribir o'qiladi");
  assert.equal(document.documentElement.classList.contains("dark"), true, "va qo'llanadi");
});

test("FE-09: TopBar serverda Kun bilan chiziladi va gidratsiya XATOSIZ o'tadi, keyin Tun ga o'tadi", async () => {
  const html = renderToString(h(TopBar, { onMenu: () => {} }));
  assert.match(html, /Mavzu: Kun/, "server HTML (localStorage yo'q) kun mavzusini chizadi");
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.appendChild(box);
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  };
  try {
    await act(async () => {
      hydrateRoot(box, h(TopBar, { onMenu: () => {} }), {
        onRecoverableError: (e) => errors.push(`recoverable: ${e instanceof Error ? e.message : String(e)}`),
      });
    });
  } finally {
    console.error = origError;
  }
  assert.deepEqual(
    errors.filter((e) => /hydrat|did not match|recoverable/i.test(e)),
    [],
    "gidratsiya nomuvofiqligi bo'lmasligi kerak",
  );
  assert.ok(box.querySelector('[aria-label^="Mavzu: Tun"]'), "gidratsiyadan keyin saqlangan tun mavzusi ko'rinadi");
  box.remove();
});
