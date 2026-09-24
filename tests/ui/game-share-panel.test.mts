import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GameSharePanel } from "../../components/files/GameSharePanel.tsx";

/**
 * O'YIN HAVOLASI PANELI (AUDIT-22 WP-C) — EGASI tomoni.
 *
 * Egasi qarori 8 ni qulflaydi: ochiq havola + QR, natijalar JADVALI +
 * CSV, real-time/leaderboard YO'Q. Panel `ResultView` da faqat
 * o'ynaladigan vositalarda chiziladi — buni oxirgi test manba matni
 * bo'yicha tekshiradi (`ResultView` tarmoqqa bog'liq, `result-flow`
 * testidagi naqsh).
 *
 * MUTATSIYALAR (tasdiqlangan):
 *   1. QR `session.url` o'rniga `session.token` dan chizildi — «QR
 *      HAVOLADAN chiziladi» qizardi (telefon skanerlab hech qayerga
 *      bormasdi);
 *   2. CSV havolasi natijasiz ham chizildi — «natijasiz CSV yo'q»
 *      qizardi (bo'sh fayl yuklab olinardi);
 *   3. `ResultView` da panel sharti `isGame` ga almashtirildi —
 *      «shartnoma: `publicGameKindOf`» qizardi (test hujjatida panel
 *      yo'qolardi: `doc.game` unda yo'q, u `doc.teacher.test`).
 */
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const realFetch = globalThis.fetch;
const ID = "11111111-1111-4111-8111-111111111111";

const SESSION = {
  token: "abcdefghijklmnopqrstuv",
  url: "https://slaydx.uz/o/abcdefghijklmnopqrstuv",
  kind: "quiz" as const,
  createdAt: "2026-09-17T08:00:00.000Z",
  expiresAt: "2026-10-17T08:00:00.000Z",
};

const ROW = {
  id: "r1",
  playerName: "Zulfiya Karimova",
  score: 8,
  total: 10,
  percent: 80,
  seconds: 95,
  createdAt: "2026-09-17T09:30:00.000Z",
};

type Call = { url: string; method: string };

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function stubApi(opts: { sessions?: (typeof SESSION)[]; results?: (typeof ROW)[]; shareStatus?: number; resultsStatus?: number } = {}) {
  const calls: Call[] = [];
  let sessions = opts.sessions ?? [];
  let results = opts.results ?? [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/share") && method === "POST") {
      if (opts.shareStatus) return json(opts.shareStatus, { error: "Bu vosita uchun o'yin havolasi yo'q" });
      sessions = [SESSION, ...sessions];
      return json(200, SESSION);
    }
    if (url.endsWith("/share")) return json(200, { sessions });
    if (url.includes("/results")) {
      if (opts.resultsStatus) return json(opts.resultsStatus, { error: "Server javob bermadi" });
      return json(200, { results, count: results.length });
    }
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  return {
    calls,
    /** Keyingi `results` javobiga qator qo'shadi («Yangilash» sinovi uchun). */
    addRow: (r: typeof ROW) => {
      results = [r, ...results];
    },
  };
}

async function open(opts: Parameters<typeof stubApi>[0] = {}) {
  const api = stubApi(opts);
  await act(async () => {
    render(h(GameSharePanel, { id: ID, kind: "quiz" }));
  });
  return api;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

/* ────────────────────────── bo'sh holat ────────────────────────── */

test("bo'sh holat: nima bo'lishini aytadi, jadval va CSV chizilmaydi", async () => {
  await open();
  await waitFor(() => assert.ok(q("[data-share-empty]")));
  const text = q("[data-share-empty]")!.textContent ?? "";
  assert.match(text, /QR kod/, "QR eslatiladi");
  assert.match(text, /ro‘yxatdan o‘tmasdan/, "loginsiz ekani aytiladi");
  assert.ok(q("[data-share-create]"), "yaratish tugmasi bor");
  assert.ok(!q("[data-results-table]"), "havola yo'q — natijalar ham yo'q");
  assert.ok(!q("[data-results-csv]"));
  assert.ok(!q("[data-share-qr]"));
});

test("havola yaratish: POST → URL, QR va amal muddati", async () => {
  const api = await open();
  await waitFor(() => assert.ok(q("[data-share-create]")));
  await act(async () => {
    fireEvent.click(q("[data-share-create]")!);
  });

  await waitFor(() => assert.ok(q("[data-share-url]")));
  assert.equal((q("[data-share-url]") as HTMLInputElement).value, SESSION.url);
  await waitFor(() => assert.ok(q("[data-share-qr]")));
  assert.match(q("[data-share-qr]")!.innerHTML, /<svg/, "QR — SVG (proyektor va bosma uchun)");
  /*
   * QR aynan HAVOLANI kodlashi kerak, «biror narsani» emas: `<svg`
   * borligi token yoki bo'sh satr uchun ham to'g'ri bo'lardi va
   * skanerlangan telefon hech qayerga bormasdi. Shuning uchun AYNI
   * kutubxona bilan kutilgan modul yo'li (`path d`) hisoblanadi.
   */
  const QRCode = (await import("qrcode")).default;
  const want = await QRCode.toString(SESSION.url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 200 });
  const pathOf = (svg: string) => /\sd="([^"]+)"/.exec(svg)?.[1] ?? "";
  assert.ok(pathOf(want), "kutilgan QR qurildi");
  assert.equal(pathOf(q("[data-share-qr]")!.innerHTML), pathOf(want), "QR HAVOLADAN chizilgan");
  assert.match(q("[data-share-expires]")!.textContent ?? "", /Amal muddati: 17\.10\.2026/);
  assert.ok(
    api.calls.some((c) => c.method === "POST" && c.url === `/api/generations/${ID}/share`),
    "havola SERVERDA yaratiladi",
  );
});

/* ────────────────────────── mavjud havola ────────────────────────── */

test("mavjud havola: mount da ro'yxat va natijalar olinadi", async () => {
  const api = await open({ sessions: [SESSION], results: [ROW] });
  await waitFor(() => assert.ok(q("[data-results-table]")));

  const row = q(`[data-result-row="${ROW.id}"]`)!;
  const cells = [...row.querySelectorAll("td")].map((td) => td.textContent?.replace(/\s+/g, " ").trim());
  // Ustunlar: ism, ball, foiz, vaqt, sana (sana MAHALLIY mintaqada —
  // o'qituvchi o'z soatida ko'radi, shuning uchun qiymat emas, SHAKL
  // qulflanadi).
  assert.deepEqual(cells.slice(0, 4), ["Zulfiya Karimova", "8 / 10", "80%", "1:35"]);
  assert.match(cells[4]!, /^\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/, "sana kun.oy.yil soat:daqiqa");
  assert.ok(!q("[data-share-empty]"), "bo'sh holat matni yo'q");
  assert.equal(api.calls.filter((c) => c.url.includes("/results")).length, 1, "natijalar BIR marta so'raldi (real-time yo'q)");
});

test("natijasiz havola: bo'sh holat matni, CSV havolasi YO'Q", async () => {
  await open({ sessions: [SESSION], results: [] });
  await waitFor(() => assert.ok(q("[data-results-empty]")));
  assert.match(q("[data-results-empty]")!.textContent ?? "", /Hali hech kim o‘ynamagan/);
  assert.ok(!q("[data-results-csv]"), "bo'sh CSV yuklab olinmaydi");
  assert.ok(!q("[data-results-table]"));
});

test("CSV havolasi natijalar bo'lganda chiqadi va route'ga ishora qiladi", async () => {
  await open({ sessions: [SESSION], results: [ROW] });
  await waitFor(() => assert.ok(q("[data-results-csv]")));
  const a = q("[data-results-csv]") as HTMLAnchorElement;
  assert.match(a.getAttribute("href") ?? "", new RegExp(`^/api/generations/${ID}/results\\?format=csv$`));
  assert.ok(a.hasAttribute("download"), "tabda ochilmaydi — yuklab olinadi");
});

test("«Yangilash» natijalarni QAYTA so'raydi (avtomatik yangilanish yo'q)", async () => {
  const api = await open({ sessions: [SESSION], results: [] });
  await waitFor(() => assert.ok(q("[data-results-empty]")));
  api.addRow(ROW);

  await act(async () => {
    fireEvent.click(q("[data-results-refresh]")!);
  });
  await waitFor(() => assert.ok(q("[data-results-table]")));
  assert.equal(api.calls.filter((c) => c.url.includes("/results")).length, 2);
  assert.ok(q(`[data-result-row="${ROW.id}"]`));
});

test("«Nusxalash» havolani buferga oladi va buni tasdiqlaydi", async () => {
  const copied: string[] = [];
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText: async (t: string) => void copied.push(t) },
    configurable: true,
  });
  await open({ sessions: [SESSION], results: [] });
  await waitFor(() => assert.ok(q("[data-share-copy]")));
  await act(async () => {
    fireEvent.click(q("[data-share-copy]")!);
  });
  assert.deepEqual(copied, [SESSION.url], "aynan HAVOLA nusxalanadi");
  await waitFor(() => assert.match(q("[data-share-copy]")!.textContent ?? "", /Nusxalandi/));
});

test("xato: server matni o'zbekcha ko'rsatiladi va panel yiqilmaydi", async () => {
  await open({ shareStatus: 400 });
  await waitFor(() => assert.ok(q("[data-share-create]")));
  await act(async () => {
    fireEvent.click(q("[data-share-create]")!);
  });
  await waitFor(() => assert.ok(q("[data-share-error]")));
  assert.match(q("[data-share-error]")!.textContent ?? "", /o'yin havolasi yo'q/);
  assert.ok(q("[data-share-create]"), "tugma joyida — qayta urinish mumkin");
});

/* ────────────────────────── sahifalash (W3-G nit 2) ────────────────────────── */

/*
 * Server natijalarni sahifalab beradi (standart 500, `nextCursor`,
 * HAQIQIY `total`). Ilgari panel faqat birinchi sahifani ko'rsatardi va
 * sonni `rows.length` dan olardi: 800 o'quvchi o'ynagan bo'lsa «500 ta»
 * deb yolg'on son chiqardi, qolgan 300 tasi hech qayerda ko'rinmasdi.
 */
test("sahifalash: «jami N» serverning `total` idan, «Yana ko‘rsatish» kursor bilan keyingi sahifani qo'shadi", async () => {
  const r = (n: number) => ({ ...ROW, id: `r${n}`, playerName: `O‘quvchi ${n}`, createdAt: `2026-09-17T09:3${n}:00.000Z` });
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/share")) return json(200, { sessions: [SESSION] });
    if (url.includes("/results")) {
      const u = new URL(url, "http://x");
      if (u.searchParams.get("before") === r(2).createdAt && u.searchParams.get("beforeId") === "r2") {
        return json(200, { results: [r(3)], count: 1, total: 3, nextCursor: null });
      }
      return json(200, { results: [r(1), r(2)], count: 2, total: 3, nextCursor: { createdAt: r(2).createdAt, id: "r2" } });
    }
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  await act(async () => {
    render(h(GameSharePanel, { id: ID, kind: "quiz" }));
  });
  await waitFor(() => assert.equal(document.querySelectorAll("[data-result-row]").length, 2));
  assert.match(q("[data-results-total]")!.textContent ?? "", /jami 3 ta/, "son serverning total idan");
  const more = q("[data-results-more]");
  assert.ok(more, "keyingi sahifa bor — tugma chiqadi");
  assert.match(more!.textContent ?? "", /Yana ko‘rsatish/);

  await act(async () => {
    fireEvent.click(more!);
  });
  await waitFor(() => assert.equal(document.querySelectorAll("[data-result-row]").length, 3));
  assert.ok(q('[data-result-row="r3"]'), "keyingi sahifa QO'SHILDI (almashtirilmadi)");
  assert.ok(!q("[data-results-more]"), "oxirgi sahifa — tugma yo'qoladi");
  assert.ok(calls.some((c) => c.url.includes(`before=${encodeURIComponent(r(2).createdAt)}`) && c.url.includes("beforeId=r2")), "kursor so'rovga uzatildi");

  // «Yangilash» — yana birinchi sahifadan (eski sahifalar tashlanadi, dublikat yo'q).
  await act(async () => {
    fireEvent.click(q("[data-results-refresh]")!);
  });
  await waitFor(() => assert.equal(document.querySelectorAll("[data-result-row]").length, 2));
  assert.ok(q("[data-results-more]"), "yangilangandan keyin yana keyingi sahifa taklif qilinadi");
});

test("sahifalash: eski server (`total`/`nextCursor` yo'q) — son qatorlardan, tugma yo'q", async () => {
  await open({ sessions: [SESSION], results: [ROW] });
  await waitFor(() => assert.ok(q("[data-results-table]")));
  assert.match(q("[data-results-total]")!.textContent ?? "", /1 ta/);
  assert.ok(!q("[data-results-more]"));
});

/* ────────────────────────── ResultView shartnomasi ────────────────────────── */

test("shartnoma: `ResultView` panelni `publicGameKindOf` bo'yicha chizadi", () => {
  const src = readFileSync(new URL("../../components/files/ResultView.tsx", import.meta.url), "utf8");
  assert.match(src, /const shareKind = completed && !expired \? publicGameKindOf\(gen\.type\) : null;/, "ro'yxat share route bilan BITTA manbadan");
  assert.match(src, /<GameSharePanel id=\{gen\.id\} kind=\{shareKind\} \/>/, "panel ulangan");
  assert.match(src, /\{shareKind \? \(/, "faqat o'ynaladigan vositada");
  // Panel ko'ruvchidan OLDIN: o'qituvchi avval hujjatni, keyin havolani ko'radi.
  assert.ok(src.indexOf("<GameSharePanel") < src.indexOf("<ArtifactViewer"), "hisobot ostida, ko'ruvchi ustida");
  assert.ok(src.indexOf("ArticleReviewPanel\n") < src.indexOf("<GameSharePanel"), "tayyorlik hisoboti panelidan KEYIN");
});
