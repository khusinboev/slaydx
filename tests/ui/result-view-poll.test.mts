import "./setup.ts";
import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultView } from "../../components/files/ResultView.tsx";
import { useAppStore } from "../../lib/store.ts";
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

type Call = { url: string; method: string };

/** `route(url, method)` → Response (yoki Promise). Hamma chaqiruv yoziladi. */
function stub(route: (url: string, method: string, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/auth/session") return json(200, { user: null, features: null });
    return route(url, method, calls.filter((c) => c.url.startsWith(`/api/generations/${ID}`) && c.method === "GET").length);
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

test("PDF: o'girish davomida tugma «PDF tayyorlanmoqda…», 503 da server matni + qachon qayta (UX-08, W2-A)", async () => {
  let release!: (r: Response) => void;
  stub((url, method) => {
    if (url.includes("/file?format=pdf")) return new Promise<Response>((r) => (release = r));
    if (method === "GET") return json(200, { generation: gen({ status: "COMPLETED", hasFile: true, progress: 100, step: "Tayyor" }) });
    return json(404, { error: "yo'q" });
  });
  mount();
  const pdf = await waitFor(() => screen.getByTitle("PDF ga o‘girib yuklab olish"), { timeout: 3000 });
  assert.ok(!pdf.hasAttribute("data-pdf-busy"));
  await act(async () => {
    fireEvent.click(pdf);
  });
  await waitFor(() => assert.ok(document.querySelector("[data-pdf-busy]")), { timeout: 2000 });
  assert.match(pdf.textContent ?? "", /PDF tayyorlanmoqda…/);
  assert.equal(pdf.getAttribute("aria-busy"), "true");
  assert.ok(document.querySelector("[data-pdf-status]"), "holat qatori");
  await act(async () => {
    release(json(503, { error: "PDF xizmati hozir band" }, { "retry-after": "30" }));
  });
  const alert = await waitFor(() => screen.getByRole("alert"), { timeout: 2000 });
  assert.match(alert.textContent ?? "", /PDF xizmati hozir band/);
  assert.match(alert.textContent ?? "", /30 soniyadan keyin/);
  assert.ok(!document.querySelector("[data-pdf-busy]"), "tugma odatiy holatga qaytdi");
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
