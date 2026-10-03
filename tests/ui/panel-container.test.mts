import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { GameSharePanel } from "../../components/files/GameSharePanel.tsx";
import { ArticleReviewPanel } from "../../components/viewers/ArticleReviewPanel.tsx";
import { reviewSummary, shareSummary, type ShareSummary } from "../../components/files/result-layout/summary.ts";
import type { ArticleReview } from "../../lib/generation/article/types.ts";

/**
 * V3 (viewer redesign): yon panel (xl: ≈356 px dock / pastki varaq) ichidagi
 * ikki blok KONTEYNER so'roviga bog'langan — viewport breakpoint'lari
 * (`sm:`/`lg:`) bu yerda noto'g'ri (R2: «Tuzatish» yorliqqa tushardi,
 * havola maydoni ~40 px qolardi, jadval yon scroll berardi).
 *
 * jsdom Tailwind'ni hisoblamaydi, shuning uchun TUZILMA qulflanadi (klass
 * shartnomasi): ildiz `@container`, bir ustunli asos, ustma-ust tusha
 * olmaydigan grid qator, kartochka rejimidagi jadval. Haqiqiy o'lcham —
 * Chromium smoke (390/1920).
 *
 * MUTATSIYALAR (har biri qizardi, hisobotda): (1) grid `sm:grid-cols-2
 * lg:grid-cols-3` ga qaytarildi; (2) CheckRow grid → `flex` + `shrink-0`
 * tugma; (3) jadvalga `min-w-[420px]` qaytarildi; (4) `onSummary` chaqiruvi
 * olib tashlandi; (5) havola maydoni QR dan OLDIN.
 */
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});
const realFetch = globalThis.fetch;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const classesOf = (root: ParentNode) => [...root.querySelectorAll("[class]")].flatMap((e) => (e.getAttribute("class") ?? "").split(/\s+/)).filter(Boolean);
/** Viewport breakpoint prefiksi (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) — konteyner `@sm:` dan farqli. */
const VIEWPORT_BP = /^(?:sm|md|lg|xl|2xl):/;

const REVIEW: ArticleReview = {
  score: 72,
  checks: [
    { id: "structure", level: "green", label: "Tuzilma", detail: "5 bo‘lim" },
    { id: "abstracts", level: "yellow", label: "Annotatsiya ×3 (uz, ru, en) uzunligi talabga mos emas", detail: "uz 120 so‘z", fix: { op: "rewrite", target: "abstract:uz", instruction: "Rewrite." } },
    { id: "refsCount", level: "red", label: "Manbalar soni", detail: "3 ta" },
    { id: "unsourcedNumbers", level: "red", label: "Manbasiz raqamlar", detail: "37%", fix: { op: "rewrite", target: "results", instruction: "Remove." } },
  ],
  judgeNotes: ["Kirishda maqsad aniqroq yozilsin", "Xulosa natijalarga mos kelmaydi"],
  verifiedShare: 0.93,
  recentShare: 0.6,
  builtAt: "2026-09-12T10:00:00.000Z",
};

/* ═════════════════════════ ArticleReviewPanel ═════════════════════════ */

test("hisobot: ildiz va guruh qutilari `@container`; 1 ustunli asos, 2–3 ustun FAQAT konteyner kengayganda; viewport breakpoint yo'q", () => {
  render(h(ArticleReviewPanel, { review: REVIEW, onFix: () => {}, onPolish: () => {} }));
  const root = q("[data-article-review]")!;
  assert.ok(root.classList.contains("@container"), "ildiz konteyner emas");
  const grid = q("[data-review-grid]")!;
  const cls = [...grid.classList];
  assert.ok(cls.includes("grid-cols-1"), "asos — bitta ustun (dock ≈356 px)");
  assert.ok(cls.includes("@xl:grid-cols-2") && cls.includes("@4xl:grid-cols-3"), "2/3 ustun faqat keng konteynerda");
  assert.ok(!cls.some((c) => VIEWPORT_BP.test(c)), `grid viewport breakpoint ishlatadi: ${cls.join(" ")}`);
  for (const g of qa("[data-review-group]")) assert.ok(g.classList.contains("@container"), "guruh qutisi konteyner emas (qator tugmasi shunga qaraydi)");
  // Butun panelda viewport breakpoint yo'q.
  const bad = classesOf(root).filter((c) => VIEWPORT_BP.test(c));
  assert.deepEqual(bad, [], "viewport breakpoint'lar panel ichida noto'g'ri");
  // Baholovchi izohlari katakchasi grid ustunlarini to'ldiradi.
  const notes = q("[data-review-notes]")!;
  assert.ok(notes.classList.contains("@xl:col-span-2") && notes.classList.contains("@4xl:col-span-3"));
});

test("«Tuzatish» yorliq bilan ustma-ust tusha olmaydi: qator — grid (belgi | matn | tugma), matn ustuni minmax(0,1fr), tor qutida tugma matn OSTIGA", () => {
  render(h(ArticleReviewPanel, { review: REVIEW, onFix: () => {} }));
  const row = q('[data-review-check="abstracts"]')!;
  const rc = [...row.classList];
  assert.ok(rc.includes("grid"), "qator flex emas — grid");
  assert.ok(rc.includes("grid-cols-[auto_minmax(0,1fr)]"), "tor qutida 2 ustun: tugma matn ostida");
  assert.ok(rc.includes("@[20rem]:grid-cols-[auto_minmax(0,1fr)_auto]"), "keng qutida 3-ustun tugmaga");
  const btn = row.querySelector<HTMLElement>("[data-review-fix]")!;
  const bc = [...btn.classList];
  assert.ok(bc.includes("col-start-2") && bc.includes("@[20rem]:col-start-3"), "tugma o'z ustunida, yorliq ustuniga tushmaydi");
  assert.ok(!bc.some((c) => c === "absolute" || c.startsWith("-translate") || c.startsWith("-ml") || c.startsWith("float")), "tugma oqimdan chiqarilmagan");
  // Matn ustuni toraya oladi va uzun yorliqni o'raydi.
  const text = row.children[1] as HTMLElement;
  assert.ok(text.classList.contains("min-w-0") && text.classList.contains("break-words"));
  // Tugma DOM da matndan KEYIN (alohida katak) — yorliq ichida emas.
  assert.ok(!text.contains(btn));
});

test("compact (standart): ichki «Tayyorlik hisoboti» sarlavhasi va kartochka ramkasi yo'q, halqa ixcham; compact=false — sarlavha qaytadi", () => {
  const { unmount } = render(h(ArticleReviewPanel, { review: REVIEW }));
  const root = q("[data-article-review]")!;
  assert.equal(root.getAttribute("data-review-compact"), "1");
  assert.ok(!(root.textContent ?? "").includes("Tayyorlik hisoboti"), "sarlavha panel sarlavhasi bilan takrorlanadi");
  assert.ok(!root.classList.contains("border") && !root.classList.contains("rounded-xl"), "panel ichida ortiqcha ramka");
  assert.ok(q("[data-review-score]")!.classList.contains("size-12"), "ixcham halqa");
  assert.equal(root.getAttribute("aria-label"), "Tayyorlik hisoboti", "ekran o'quvchi uchun nom saqlanadi");
  unmount();
  render(h(ArticleReviewPanel, { review: REVIEW, compact: false }));
  const full = q("[data-article-review]")!;
  assert.ok((full.textContent ?? "").includes("Tayyorlik hisoboti"));
  assert.ok(full.classList.contains("rounded-xl") && full.classList.contains("border"));
  assert.ok(q("[data-review-score]")!.classList.contains("size-16"));
});

test("sarlavha qatori ixcham: «Hammasini tuzatish» tor konteynerda to'liq kenglikda, keng konteynerda o'z kengligida; xato/e’tibor va ulushlar o'qiladi", () => {
  render(h(ArticleReviewPanel, { review: REVIEW, onPolish: () => {}, onFix: () => {} }));
  const btn = q("[data-polish-button]")!;
  assert.ok(btn.classList.contains("w-full") && btn.classList.contains("@sm:w-auto"));
  const head = q("[data-review-header]")!;
  assert.ok(head.classList.contains("flex-wrap"), "sarlavha o'raladi, siqilmaydi");
  const t = head.textContent ?? "";
  assert.ok(t.includes("2 xato") && t.includes("1 e’tibor") && t.includes("93%") && t.includes("60%"), t);
});

test("baholovchi izohlari o'qiladigan: ro'yxat, so'z o'raladi, qator balandligi siqilmagan", () => {
  render(h(ArticleReviewPanel, { review: REVIEW }));
  const list = q("[data-review-notes] ul")!;
  assert.ok(list.classList.contains("break-words") && list.classList.contains("leading-snug"));
  assert.deepEqual(
    [...list.querySelectorAll("li")].map((li) => li.textContent),
    REVIEW.judgeNotes,
  );
});

test("Tuzatish/Hammasini tuzatish oqimi o'zgarmagan: bosish onFix(fix) / onPolish() ni chaqiradi; band bandligida o'chiq", async () => {
  const fixed: unknown[] = [];
  let polished = 0;
  const { rerender } = render(h(ArticleReviewPanel, { review: REVIEW, onFix: (f) => fixed.push(f), onPolish: () => void (polished += 1) }));
  await act(async () => {
    fireEvent.click(q('[data-review-fix="results"]')!);
  });
  assert.deepEqual(fixed, [REVIEW.checks[3].fix]);
  await act(async () => {
    fireEvent.click(q("[data-polish-button]")!);
  });
  assert.equal(polished, 1);
  // Tuzatish davomida (fixing) boshqa tugmalar o'chiq, o'shanisi «Tuzatilmoqda…».
  rerender(h(ArticleReviewPanel, { review: REVIEW, onFix: (f) => fixed.push(f), onPolish: () => void (polished += 1), fixing: "results" }));
  assert.equal(q('[data-review-fix="results"]')!.textContent, "Tuzatilmoqda…");
  assert.ok((q('[data-review-fix="abstract:uz"]') as HTMLButtonElement).disabled);
  assert.ok((q("[data-polish-button]") as HTMLButtonElement).disabled);
});

/* ═════════════════════════ GameSharePanel ═════════════════════════ */

const ID = "11111111-1111-4111-8111-111111111111";
const SESSION = { token: "abcdefghijklmnopqrstuv", url: "https://slaydx.uz/o/abcdefghijklmnopqrstuv", kind: "quiz" as const, createdAt: "2026-09-17T08:00:00.000Z", expiresAt: "2026-10-17T08:00:00.000Z" };
const ROW = { id: "r1", playerName: "Zulfiya Karimova", score: 8, total: 10, percent: 80, seconds: 95, createdAt: "2026-09-17T09:30:00.000Z" };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function stub(opts: { sessions?: (typeof SESSION)[]; results?: (typeof ROW)[]; total?: number } = {}) {
  let results = opts.results ?? [];
  let sessions = opts.sessions ?? [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/share") && method === "POST") {
      sessions = [SESSION, ...sessions];
      return json(200, SESSION);
    }
    if (url.endsWith("/share")) return json(200, { sessions });
    if (url.includes("/results")) return json(200, { results, count: results.length, ...(opts.total !== undefined ? { total: opts.total } : {}) });
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  return { addRow: (r: typeof ROW) => void (results = [r, ...results]) };
}

async function open(props: { onSummary?: (s: ShareSummary) => void; compact?: boolean } = {}) {
  await act(async () => {
    render(h(GameSharePanel, { id: ID, kind: "quiz", ...props }));
  });
}

test("havola bloki: ildiz `@container`; QR havola maydonidan OLDIN (tepada), maydon to'liq kenglikda (flex-1, min-w-0, basis ≥ 12rem) + nusxalash; yon-yonga faqat keng konteynerda", async () => {
  stub({ sessions: [SESSION], results: [] });
  await open();
  await waitFor(() => assert.ok(q("[data-share-qr]")));
  assert.ok(q("[data-game-share]")!.classList.contains("@container"));
  const block = q("[data-share-link-block]")!;
  const bc = [...block.classList];
  assert.ok(bc.includes("flex-col") && bc.includes("@2xl:flex-row"), "tor: ustma-ust; yon-yonga faqat @2xl");
  assert.ok(!bc.some((c) => VIEWPORT_BP.test(c)));
  const qr = q("[data-share-qr]")!;
  const row = q("[data-share-url-row]")!;
  assert.ok(qr.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING, "QR havola maydonidan keyin chizilgan");
  const input = q("[data-share-url]")!;
  const ic = [...input.classList];
  assert.ok(ic.includes("flex-1") && ic.includes("min-w-0") && ic.includes("basis-48"), `havola maydoni siqiladi: ${ic.join(" ")}`);
  assert.ok([...row.classList].includes("flex-wrap"), "nusxalash sig'masa pastga o'raladi, maydonni 40 px ga siqmaydi");
  assert.ok(q("[data-share-copy]"), "nusxalash joyida");
  assert.ok(!qr.classList.contains("size-[168px]"), "QR qat'iy 168 px — tor varaqda sig'maydi");
  assert.ok(qr.classList.contains("w-full") && qr.classList.contains("max-w-44"));
});

test("natijalar jadvali tor konteynerda KARTOCHKA qatori: min-w yo'q, yon scroll o'rami yo'q, `@max-md:` ko'rinishlari; 5 katak va CSV/yangilash joyida", async () => {
  stub({ sessions: [SESSION], results: [ROW] });
  await open();
  await waitFor(() => assert.ok(q("[data-results-table]")));
  const table = q("[data-results-table]")!;
  assert.ok(table.classList.contains("@max-md:block"));
  assert.ok(![...table.classList].some((c) => c.startsWith("min-w-")), "jadval min-w bilan yon scroll beradi");
  assert.ok(!table.parentElement!.classList.contains("overflow-x-auto"), "yon scroll o'rami");
  const row = q(`[data-result-row="${ROW.id}"]`)!;
  assert.ok(row.classList.contains("@max-md:flex") && row.classList.contains("@max-md:flex-wrap"));
  const tds = [...row.querySelectorAll("td")];
  assert.equal(tds.length, 5);
  assert.ok(tds[0].classList.contains("@max-md:basis-full"), "ism kartochkada alohida qatorda");
  assert.ok(q("thead")!.classList.contains("@max-md:sr-only"), "tor rejimda sarlavha qatori faqat ekran o'quvchiga");
  assert.ok(q("[data-results-csv]") && q("[data-results-refresh]"), "CSV va yangilash saqlangan");
  assert.ok(!classesOf(q("[data-game-share]")!).some((c) => VIEWPORT_BP.test(c)), "panel ichida viewport breakpoint");
});

test("compact (standart): ichki «O‘yin havolasi» sarlavhasi yo'q (panel sarlavhasi ko'rsatadi), o'yin turi qoladi; compact=false — sarlavha qaytadi", async () => {
  stub({ sessions: [SESSION], results: [] });
  await open();
  await waitFor(() => assert.ok(q("[data-share-url]")));
  assert.ok(!q("[data-game-share] h2"), "takroriy sarlavha");
  assert.ok(q("[data-share-kind]"), "o'yin turi ko'rinadi");
  assert.equal(q("[data-share-url]")!.getAttribute("aria-label"), "O‘yin havolasi", "maydon sarlavhasiz ham nomlangan");
  cleanup();
  stub({ sessions: [SESSION], results: [] });
  await open({ compact: false });
  await waitFor(() => assert.ok(q("[data-share-url]")));
  assert.equal(q("[data-game-share] h2")?.textContent, "O‘yin havolasi");
  assert.ok(!q("[data-share-kind]"));
});

test("onSummary: yuklanish paytida chaqirilmaydi; havolasiz → «O‘yin havolasi»; havola + natijalar → «· N natija» (yashil); yangilash/yaratish xulosani yangilaydi", async () => {
  const seen: ShareSummary[] = [];
  const api = stub({ sessions: [], results: [] });
  await open({ onSummary: (s) => seen.push(s) });
  await waitFor(() => assert.ok(q("[data-share-empty]")));
  assert.equal(seen.length, 1, "yuklanish tugagach BIR marta");
  assert.deepEqual(seen[0], { hasLink: false, results: 0, label: "O‘yin havolasi", tone: "neutral" });

  // Havola yaratildi, natija yo'q.
  await act(async () => {
    fireEvent.click(q("[data-share-create]")!);
  });
  await waitFor(() => assert.ok(q("[data-share-url]")));
  const last = () => seen[seen.length - 1]!;
  assert.deepEqual({ ...last() }, { hasLink: true, results: 0, label: "O‘yin havolasi · natija yo‘q", tone: "neutral" });

  // O'quvchi o'ynadi → «Yangilash» → 1 natija.
  api.addRow(ROW);
  await act(async () => {
    fireEvent.click(q("[data-results-refresh]")!);
  });
  await waitFor(() => assert.equal(last().results, 1));
  assert.deepEqual({ ...last() }, { hasLink: true, results: 1, label: "O‘yin havolasi · 1 natija", tone: "green" });
  const n = seen.length;
  // Natija o'zgarmasa (yana yangilash) — xulosa qayta yuborilmaydi.
  await act(async () => {
    fireEvent.click(q("[data-results-refresh]")!);
  });
  assert.equal(seen.length, n, "o'zgarmagan xulosa takrorlanmadi");
});

test("onSummary: son serverning `total` idan (ko'rsatilganlardan emas); onSummary berilmasa panel yiqilmaydi", async () => {
  const seen: ShareSummary[] = [];
  stub({ sessions: [SESSION], results: [ROW], total: 7 });
  await open({ onSummary: (s) => seen.push(s) });
  await waitFor(() => assert.ok(q("[data-results-table]")));
  await waitFor(() => assert.equal(seen[seen.length - 1]?.results, 7));
  assert.equal(seen[seen.length - 1]!.label, "O‘yin havolasi · 7 natija");
  cleanup();
  stub({ sessions: [SESSION], results: [ROW] });
  await open();
  await waitFor(() => assert.ok(q("[data-results-table]")));
});

/* ═════════════════════════ summary.ts ═════════════════════════ */

test("reviewSummary: ball + xato/e’tibor soni, rang chegaralari 80/60; buzuq ball chipni buzmaydi; shakl o'zgarmagan", () => {
  const checks = [
    { id: "a", level: "red", label: "A" },
    { id: "b", level: "yellow", label: "B" },
    { id: "c", level: "yellow", label: "C" },
    { id: "d", level: "green", label: "D" },
  ] as ArticleReview["checks"];
  assert.deepEqual(reviewSummary({ score: 77, checks }), { score: 77, errors: 1, warnings: 2, label: "Tayyorlik 77 · 1 xato · 2 e’tibor", tone: "yellow" });
  assert.equal(reviewSummary({ score: 92, checks: [] }).label, "Tayyorlik 92");
  assert.equal(reviewSummary({ score: 79.6, checks: [] }).label, "Tayyorlik 80", "kasr butunlanadi");
  assert.equal(reviewSummary({ score: 79.6, checks: [] }).tone, "green", "rang butunlangan ballga qaraydi");
  assert.equal(reviewSummary({ score: 140, checks: [] }).score, 100);
  assert.equal(reviewSummary({ score: Number.NaN, checks: [] }).label, "Tayyorlik 0");
  assert.equal(reviewSummary({ score: 59, checks: [] }).tone, "red");
});

test("shareSummary: havolasiz — chaqiruv matni; havola + 0 — «natija yo‘q»; N>0 — «N natija» (yashil); manfiy/NaN → 0", () => {
  assert.deepEqual(shareSummary({ hasLink: false, results: 5 }), { hasLink: false, results: 0, label: "O‘yin havolasi", tone: "neutral" });
  assert.deepEqual(shareSummary({ hasLink: true, results: 0 }), { hasLink: true, results: 0, label: "O‘yin havolasi · natija yo‘q", tone: "neutral" });
  assert.deepEqual(shareSummary({ hasLink: true, results: 12 }), { hasLink: true, results: 12, label: "O‘yin havolasi · 12 natija", tone: "green" });
  assert.equal(shareSummary({ hasLink: true, results: -3 }).results, 0);
  assert.equal(shareSummary({ hasLink: true, results: Number.NaN }).label, "O‘yin havolasi · natija yo‘q");
});

/* ═════════════════════════ manba shartnomalari ═════════════════════════ */

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("panellar ichida `max-h`/`overflow`/`min-w-[` YO'Q — yagona scroll `[data-panel-body]` (V0 shartnomasi)", () => {
  for (const file of ["../../components/viewers/ArticleReviewPanel.tsx", "../../components/files/GameSharePanel.tsx"]) {
    const src = strip(readFileSync(new URL(file, import.meta.url), "utf8"));
    assert.ok(!/max-h-|\boverflow(?:-[xy])?-(?:auto|scroll|hidden)|min-w-\[/.test(src), `${file}: ichki scroll/min-w`);
    assert.ok(!/["'`\s](?:sm|md|lg|xl|2xl):/.test(src), `${file}: viewport breakpoint`);
  }
});

test("ResultView: o'yin chipi `onSummary` orqali (`setShareSum`), standart matn «O‘yin havolasi»; hisobot chipi `reviewSummary`dan", () => {
  const src = readFileSync(new URL("../../components/files/ResultView.tsx", import.meta.url), "utf8");
  assert.match(src, /const \[shareSum, setShareSum\] = useState<ShareSummary \| null>\(null\);/);
  assert.match(src, /\.\.\.\(shareSum \? chipOf\(shareSum\) : \{ chip: "O‘yin havolasi" \}\),/);
  assert.match(src, /<GameSharePanel id=\{gen\.id\} kind=\{shareKind\} onSummary=\{setShareSum\} \/>/);
  assert.match(src, /\.\.\.chipOf\(reviewSummary\(review\)\)/);
  // Panel chaqiruvi: `noFix`/`noPolish`/`hideGroups` va `data-*` ilgaklari joyida.
  assert.match(src, /<div data-article-review-panel>/);
  assert.match(src, /data-ai-unpaid/);
  assert.match(src, /data-essay-nofix-note/);
});
