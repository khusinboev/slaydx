import "./setup.ts";
import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultView, resultSubtitle } from "../../components/files/ResultView.tsx";
import { useAppStore } from "../../lib/store.ts";
import { groupDigits } from "../../lib/format.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";
import type { ArticleReview } from "../../lib/generation/article/types.ts";

/**
 * Natija sahifasi (C20 / UX-07 / UX-08 / W1-E / W2-D2) — HAQIQIY
 * `ResultView`, `fetch` stubi bilan.
 *
 * Ilgari polling taslim bo'lganda xato FAQAT COMPLETED da ko'rsatilardi:
 * QUEUED ish uchun sahifa progress bar bilan jim qotib qolardi.
 *
 * jsdom standartda `document.hidden === true` («prerender») — polling
 * yashirin yorliqda kutadi, shuning uchun test yorliqni «ko'rinadigan»
 * qiladi.
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
const ID = "11111111-1111-4111-8111-111111111111";
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

before(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function gen(patch: Record<string, unknown> = {}) {
  return {
    id: ID,
    type: "referat",
    topic: "Iqlim o'zgarishi",
    status: "QUEUED",
    createdAt: "2026-09-23T08:00:00.000Z",
    finishedAt: null,
    price: 3000,
    fileName: "referat.docx",
    format: "docx",
    progress: 0,
    step: "Navbatga qo‘yildi",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc: null,
    hasFile: false,
    docVersion: 1,
    fileVersion: 1,
    ...patch,
  };
}

type Call = { url: string; method: string; body?: string };

/** `route(url, method)` → Response (yoki Promise). Hamma chaqiruv yoziladi. */
function stub(route: (url: string, method: string, n: number, body?: string) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? opts.body : undefined;
    calls.push({ url, method, body });
    if (url === "/api/auth/session") return json(200, { user: null, features: null });
    return route(url, method, calls.filter((c) => c.url.startsWith(`/api/generations/${ID}`) && c.method === "GET").length, body);
  };
  return calls;
}

function mount() {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: false, payme: false } },
  });
  // `refreshSession` tarmoqqa chiqib `loggedIn` ni o'chirmasin.
  useAppStore.setState({ refreshSession: async () => {} });
  render(h(AppRouterContext.Provider, { value: router }, h(ResultView, { id: ID })));
}

test("QUEUED dan keyin polling taslim bo'ldi (404) — xato ko'rinadi va «Qayta tekshirish» pollingni qayta boshlaydi", async () => {
  let gone = true;
  const calls = stub((url, method) => {
    if (method === "GET" && url.startsWith(`/api/generations/${ID}`)) {
      const n = calls.filter((c) => c.method === "GET" && c.url.startsWith(`/api/generations/${ID}`)).length;
      if (n === 1) return json(200, { generation: gen() });
      return gone ? json(404, { error: "Topilmadi" }) : json(200, { generation: gen({ step: "Qayta tekshirildi" }) });
    }
    return json(404, { error: "yo'q" });
  });
  mount();
  // Birinchi tick: RunningPanel.
  await waitFor(() => assert.ok(screen.getByRole("progressbar")), { timeout: 3000 });
  // ~1 s dan keyin ikkinchi so'rov 404 → ilgari hech narsa ko'rinmasdi.
  const alert = await waitFor(() => screen.getByRole("alert"), { timeout: 4000 });
  assert.match(alert.textContent ?? "", /Holat yangilanmay qoldi/);
  assert.match(alert.textContent ?? "", /Topilmadi/);
  const retry = screen.getByRole("button", { name: /Qayta tekshirish/ });
  gone = false;
  const before = calls.length;
  await act(async () => {
    fireEvent.click(retry);
  });
  await waitFor(() => assert.ok(screen.getByText("Qayta tekshirildi")), { timeout: 3000 });
  assert.ok(calls.length > before, "qayta so'rov ketdi");
  assert.ok(!screen.queryByRole("alert"), "xato yo'qoldi");
});

test("QUEUED — navbatdagi o'rin va taxminiy kutish ko'rsatiladi (UX-07)", async () => {
  stub((url, method) => {
    if (method === "GET") return json(200, { generation: gen({ queuePosition: 3, etaSec: 300 }) });
    return json(404, { error: "yo'q" });
  });
  mount();
  const el = await waitFor(() => {
    const q = document.querySelector("[data-queue-position]");
    assert.ok(q, "navbat o'rni chiqmadi");
    return q;
  }, { timeout: 3000 });
  assert.match(el.textContent ?? "", /Navbatdagi o‘rningiz: 3/);
  assert.match(el.textContent ?? "", /5 daqiqa/);
});

test("eski server (queuePosition yo'q) — navbat qatori chizilmaydi", async () => {
  stub((url, method) => (method === "GET" ? json(200, { generation: gen() }) : json(404, {})));
  mount();
  await waitFor(() => assert.ok(screen.getByRole("progressbar")), { timeout: 3000 });
  assert.ok(!document.querySelector("[data-queue-position]"));
});

/*
 * Rewritten for the mobile sprint (PLAN §4.5): the header PDF button and the
 * «PDF tayyorlanmoqda — bu 1 daqiqagacha…» notice are gone; the PDF is a row of
 * the «Yuklab olish» sheet, prepared as soon as the sheet opens, with its own
 * state (spinner + elapsed seconds), and a 503 shows the server text + «qachon
 * qayta» on that row with «Qayta urinish». The other rows stay usable.
 */
test("PDF (varaq qatori): ochilganda tayyorlanadi, «PDF tayyorlanmoqda… N s», 503 da server matni + qachon qayta (UX-08, W2-A)", async () => {
  let release!: (r: Response) => void;
  const calls = stub((url, method, _n, body) => {
    if (method === "POST" && url === `/api/generations/${ID}/download`) {
      if (body === JSON.stringify({ format: "pdf" })) return new Promise<Response>((r) => (release = r));
      return json(200, { state: "ready", url: "/api/dl/tok-native", fileName: "referat.docx", size: 48_000, mime: "application/octet-stream", expiresAt: new Date(Date.now() + 900_000).toISOString() });
    }
    if (method === "GET") return json(200, { generation: gen({ status: "COMPLETED", hasFile: true, progress: 100, step: "Tayyor" }) });
    return json(404, { error: "yo'q" });
  });
  mount();
  const button = await waitFor(() => {
    const b = document.querySelector("[data-download-button]") as HTMLElement | null;
    assert.ok(b);
    return b;
  }, { timeout: 3000 });
  assert.ok(!screen.queryByTitle("PDF ga o‘girib yuklab olish"), "alohida PDF tugmasi yo'q");
  assert.match(button.textContent ?? "", /Yuklab olish/);
  await act(async () => {
    fireEvent.click(button);
  });
  const row = await waitFor(() => {
    const r = document.querySelector('[data-download-row="pdf"]') as HTMLElement | null;
    assert.ok(r, "PDF qatori");
    return r;
  });
  // Prepared on open (lead decision): the PDF request is already in flight.
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST" && c.body === JSON.stringify({ format: "pdf" }))));
  await act(async () => {
    fireEvent.click(row);
  });
  assert.equal(row.getAttribute("data-row-state"), "preparing");
  assert.equal(row.getAttribute("aria-busy"), "true");
  assert.match(row.querySelector("[data-row-status]")!.textContent ?? "", /^PDF tayyorlanmoqda… \(odatda 5–15 soniya\) \d+ s$/);
  assert.equal(calls.filter((c) => c.method === "POST" && c.body === JSON.stringify({ format: "pdf" })).length, 1, "bosish o'sha tayyorlashga ulanadi (ikkinchi so'rov yo'q)");
  const native = document.querySelector('[data-download-row="native"]') as HTMLButtonElement;
  assert.equal(native.disabled, false, "boshqa qator ishlaydi");
  await act(async () => {
    release(json(503, { error: "PDF xizmati hozir band", code: "busy" }, { "retry-after": "30" }));
  });
  await waitFor(() => assert.equal(row.getAttribute("data-row-state"), "error"), { timeout: 2000 });
  const status = row.querySelector("[data-row-status]")!;
  assert.equal(status.getAttribute("role"), "alert");
  assert.match(status.textContent ?? "", /PDF xizmati hozir band/);
  assert.match(status.textContent ?? "", /30 soniyadan keyin/);
  assert.match(row.textContent ?? "", /Qayta urinish/);
  assert.ok(!row.hasAttribute("aria-busy"), "qator odatiy holatga qaytdi (qayta bosish mumkin)");
  assert.ok(!document.querySelector("[data-pdf-status]"), "eski PDF izohi yo'q");
});

test("fayl retention bilan o'chirilgan (`filesPurgedAt`) — 180 kun izohi (W2-D2)", async () => {
  stub((url, method) =>
    method === "GET"
      ? json(200, { generation: gen({ status: "COMPLETED", hasFile: false, filesPurgedAt: "2026-09-01T00:00:00.000Z" }) })
      : json(404, {}),
  );
  mount();
  const el = await waitFor(() => {
    const p = document.querySelector("[data-files-purged]");
    assert.ok(p);
    return p;
  }, { timeout: 3000 });
  assert.match(el.textContent ?? "", /Bonus bilan yaratilgan hujjatlar 180 kun saqlanadi — bu hujjat fayli o‘chirilgan\./);
});

test("fayl yo'q, lekin `filesPurgedAt` yo'q — eski umumiy matn", async () => {
  stub((url, method) => (method === "GET" ? json(200, { generation: gen({ status: "COMPLETED", hasFile: false }) }) : json(404, {})));
  mount();
  await waitFor(() => assert.ok(screen.getByText(/Bu hujjatning fayli topilmadi/)), { timeout: 3000 });
  assert.ok(!document.querySelector("[data-files-purged]"));
});

test("FAILED: no dead end — «Yangi yaratish» opens the same tool's form, «Orqaga» goes back; no download actions (R5 P6/F8)", async () => {
  stub((url, method) =>
    method === "GET" ? json(200, { generation: gen({ status: "FAILED", error: "Xizmat vaqtincha javob bermadi", progress: 0 }) }) : json(404, {}),
  );
  mount();
  const box = await waitFor(() => {
    const b = document.querySelector("[data-failed-actions]");
    assert.ok(b, "failed actions");
    return b;
  }, { timeout: 3000 });
  const fresh = box.querySelector("[data-failed-new]") as HTMLAnchorElement;
  assert.equal(fresh.getAttribute("href"), "/uz/referat");
  assert.match(fresh.textContent ?? "", /Yangi yaratish/);
  const back = box.querySelector("[data-failed-back]") as HTMLAnchorElement;
  assert.ok(back, "«Orqaga»");
  assert.match(back.textContent ?? "", /Orqaga/);
  assert.ok(!document.querySelector("[data-download-button]"), "no download on a failed result");
  // UX review m2: no empty «· ·» part, and the state says it failed.
  const sub = document.querySelector("[data-result-subtitle]")!.textContent ?? "";
  assert.equal(sub, `Referat · Xato · ${groupDigits(3000)} tanga`);
  assert.match(document.body.textContent ?? "", /Xizmat vaqtincha javob bermadi/);
});

test("resultSubtitle: empty parts dropped (no «· ·»), FAILED → «Xato», REVOKED → «Bekor qilindi»", () => {
  const p = `${groupDigits(3000)} tanga`;
  assert.equal(resultSubtitle({ status: "QUEUED", step: "", price: 3000 }, "Slayd", false, false), `Slayd · ${p}`);
  assert.equal(resultSubtitle({ status: "QUEUED", step: "  ", price: 3000 }, undefined, false, false), p);
  assert.equal(resultSubtitle({ status: "FAILED", step: "", price: 3000 }, "Kurs ishi", false, false), `Kurs ishi · Xato · ${p}`);
  assert.equal(resultSubtitle({ status: "REVOKED", step: "", price: 3000 }, "Kurs ishi", false, false), `Kurs ishi · Bekor qilindi · ${p}`);
  assert.equal(resultSubtitle({ status: "COMPLETED", step: "Tayyor", price: 3000 }, "Slayd", true, false), `Slayd · Tayyor · ${p}`);
  assert.equal(resultSubtitle({ status: "COMPLETED", step: "", price: 3000 }, "Slayd", true, true), `Slayd · Topilmadi · ${p}`);
});

test("COMPLETED header: one «Yuklab olish», the title clamps to 2 lines on phones, delete is not a header button", async () => {
  stub((url, method) => (method === "GET" ? json(200, { generation: gen({ status: "COMPLETED", hasFile: true, progress: 100, step: "Tayyor" }) }) : json(404, {})));
  mount();
  await waitFor(() => assert.ok(document.querySelector("[data-download-button]")), { timeout: 3000 });
  assert.equal(document.querySelectorAll("[data-download-button]").length, 1);
  const title = document.querySelector("[data-result-title]")!;
  assert.ok(title.className.split(/\s+/).includes("line-clamp-2"), "2-line title on phones");
  assert.ok(!title.className.split(/\s+/).includes("truncate"), "not cut to one line");
  const buttons = [...document.querySelectorAll("[data-result-nav] button")].map((b) => b.textContent ?? "");
  assert.ok(!buttons.some((t) => /O’chirish/.test(t)), "delete lives in «⋯»");
  assert.ok(document.querySelector('[data-more-button][aria-label="Boshqa amallar"]'));
});

// ─────────────────────────── 402 unpaid (W1-E follow-up)

const META = { topic: "Sun’iy intellekt", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;
function articleDoc(): AcademicDoc {
  const d = JSON.parse(JSON.stringify(sampleArticleDoc(META))) as AcademicDoc;
  d.article!.review = {
    score: 71,
    checks: [
      { id: "filler", level: "yellow", label: "«Suv» iboralar", fix: { op: "rewrite", target: "intro", instruction: "Remove filler." } },
    ],
    judgeNotes: [],
    verifiedShare: 1,
    recentShare: 1,
    builtAt: "2026-09-12T00:00:00.000Z",
  } as ArticleReview;
  return d;
}

test("«Hammasini tuzatish» 402 unpaid — server sababi ko'rsatiladi va AI tugmalari o'chadi", async () => {
  const UNPAID = "AI tahrir faqat pul bilan to'langan hujjatlarda ishlaydi. Bu hujjat bonus ballar hisobidan yaratilgan.";
  stub((url, method) => {
    if (url.endsWith("/polish")) return json(402, { error: UNPAID, code: "unpaid" });
    if (method === "GET")
      return json(200, {
        generation: gen({ type: "article", status: "COMPLETED", hasFile: true, doc: articleDoc(), progress: 100, step: "Tayyor" }),
      });
    return json(404, { error: "yo'q" });
  });
  mount();
  const btn = await waitFor(() => {
    const b = document.querySelector("[data-polish-button]");
    assert.ok(b, "«Hammasini tuzatish» chiqmadi");
    return b as HTMLElement;
  }, { timeout: 4000 });
  await act(async () => {
    fireEvent.click(btn);
  });
  const note = await waitFor(() => {
    const n = document.querySelector("[data-ai-unpaid]");
    assert.ok(n, "sabab chiqmadi");
    return n;
  }, { timeout: 3000 });
  assert.equal(note.textContent, UNPAID);
  assert.ok(!document.querySelector("[data-polish-button]"), "qayta bosib 402 olmasin — tugma yashirildi");
});
