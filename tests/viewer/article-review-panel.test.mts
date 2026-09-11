import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { ArticleReviewPanel, REVIEW_GROUPS, reviewGroupOf, scoreTone } from "../../components/viewers/ArticleReviewPanel.tsx";
import type { ArticleReview } from "../../lib/generation/article/types.ts";

/**
 * Tayyorlik hisoboti paneli (Maqola 2, WP5) — SSR: ball halqasi, 5 blok,
 * belgi ✅/⚠️/❌, `data-review-check`, «Tuzatish» tugmasi (WP7 gacha
 * o'chiq), baholovchi izohlari; `ResultView` da article natijasida
 * `<details open>` bilan ulanish (manba matni bo'yicha — sahifa tarmoqqa
 * bog'liq).
 *
 * Mutatsiyalar (har biri qizardi): rang chegarasi 80 → 70 (`scoreTone(75)`
 * yashil chiqdi); `judge:*` → «structure» guruhi (ilmiy mazmun testi);
 * fix tugmasi `disabled` shartisiz (`onFix` siz ham faol); ResultView
 * sharti `gen.type === "article"` olib tashlandi.
 */

const REVIEW: ArticleReview = {
  score: 72,
  checks: [
    { id: "structure", level: "green", label: "Tuzilma", detail: "5 bo‘lim" },
    { id: "abstracts", level: "yellow", label: "Annotatsiya ×3", detail: "uz 120", fix: { op: "rewrite", target: "abstract:uz", instruction: "Rewrite to 150–250 words." } },
    { id: "refsCount", level: "red", label: "Manbalar soni", detail: "3 ta" },
    { id: "visuals", level: "green", label: "Vizuallar" },
    { id: "unsourcedNumbers", level: "red", label: "Manbasiz raqamlar", detail: "37%", fix: { op: "rewrite", target: "results", instruction: "Remove." } },
    { id: "limitations", level: "yellow", label: "Cheklovlar" },
    { id: "judge:novelty", level: "yellow", label: "Yangilik va hissa", detail: "2/3" },
    { id: "judge:fix:1", level: "yellow", label: "Baholovchi tavsiyasi", detail: "intro: Maqsad", fix: { op: "rewrite", target: "intro", instruction: "Maqsadni aniq yozing" } },
  ],
  judgeNotes: ["Kirishda maqsad aniqroq yozilsin"],
  verifiedShare: 0.93,
  recentShare: 0.6,
  builtAt: "2026-09-12T10:00:00.000Z",
};

const html = (r: ArticleReview, onFix?: () => void) => renderToStaticMarkup(h(ArticleReviewPanel, { review: r, onFix }));

test("ball halqasi: data-review-score, rang ≥80 yashil / 60–79 sariq / <60 qizil", () => {
  const out = html(REVIEW);
  assert.ok(out.includes('data-review-score="72"'));
  assert.ok(out.includes('data-review-tone="yellow"'));
  assert.ok(out.includes(">72<"), "ball matni");
  assert.ok(out.includes("<svg") && out.includes("stroke-dasharray"));
  assert.equal(scoreTone(80), "green");
  assert.equal(scoreTone(79), "yellow");
  assert.equal(scoreTone(60), "yellow");
  assert.equal(scoreTone(59), "red");
  assert.ok(html({ ...REVIEW, score: 91 }).includes('data-review-tone="green"'));
  assert.ok(html({ ...REVIEW, score: 12 }).includes('data-review-tone="red"'));
});

test("5 blok (Tuzilma · Manbalar · Vizuallar · Ilmiy mazmun · AI izi) tartibda; har check o'z guruhida, judge:* — ilmiy mazmunda", () => {
  const out = html(REVIEW);
  const groups = [...out.matchAll(/data-review-group="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ["structure", "sources", "visuals", "science", "ai"]);
  assert.deepEqual(
    REVIEW_GROUPS.map((g) => g.label),
    ["Tuzilma", "Manbalar", "Vizuallar", "Ilmiy mazmun", "AI izi"],
  );
  const within = (group: string) => {
    const start = out.indexOf(`data-review-group="${group}"`);
    const next = out.indexOf("data-review-group=", start + 1);
    return out.slice(start, next === -1 ? undefined : next);
  };
  assert.ok(within("structure").includes('data-review-check="structure"') && within("structure").includes('data-review-check="abstracts"'));
  assert.ok(within("sources").includes('data-review-check="refsCount"'));
  assert.ok(within("visuals").includes('data-review-check="visuals"'));
  assert.ok(within("science").includes('data-review-check="limitations"') && within("science").includes('data-review-check="judge:novelty"') && within("science").includes('data-review-check="judge:fix:1"'));
  assert.ok(within("ai").includes('data-review-check="unsourcedNumbers"'));
  assert.equal(reviewGroupOf("judge:style"), "science");
  assert.equal(reviewGroupOf("recent"), "sources");
  assert.equal(reviewGroupOf("nimadir"), "structure");
  // Bo'sh guruh — «Tekshiruv yo‘q».
  const empty = html({ ...REVIEW, checks: REVIEW.checks.filter((c) => c.id !== "visuals") });
  assert.ok(empty.includes("Tekshiruv yo‘q"));
});

test("belgi ✅/⚠️/❌ va data-review-level; yorliq + detail; baholovchi izohlari; sarlavha qatori (xato/e’tibor/ulushlar)", () => {
  const out = html(REVIEW);
  const row = (id: string) => {
    const i = out.indexOf(`data-review-check="${id}"`);
    return out.slice(i, out.indexOf("</li>", i));
  };
  assert.ok(row("structure").includes("✅") && row("structure").includes('data-review-level="green"'));
  assert.ok(row("abstracts").includes("⚠️") && row("abstracts").includes("uz 120"));
  assert.ok(row("refsCount").includes("❌") && row("refsCount").includes("Manbalar soni"));
  assert.ok(out.includes("Kirishda maqsad aniqroq yozilsin"));
  assert.ok(out.includes("2 xato") && out.includes("4 e’tibor") && out.includes("93%") && out.includes("60%"));
  assert.ok(html({ ...REVIEW, judgeNotes: [] }).includes("Izoh yo‘q"));
});

test("«Tuzatish» faqat fix li va yashil bo'lmagan bandlarda; onFix siz disabled + «Tez orada»; onFix bilan faol, data-review-fix=target", () => {
  const out = html(REVIEW);
  const buttons = [...out.matchAll(/<button[^>]*data-review-fix="([^"]+)"[^>]*>/g)];
  // DOM tartibi — guruhlar bo'yicha: Tuzilma (abstracts) → Ilmiy mazmun (judge:fix) → AI izi (unsourcedNumbers).
  assert.deepEqual(
    buttons.map((m) => m[1]),
    ["abstract:uz", "intro", "results"],
  );
  // ATRIBUT `disabled=""` — `disabled:opacity-50` Tailwind klassi bilan adashtirmaslik uchun.
  assert.ok(buttons.every((m) => /\sdisabled=""/.test(m[0]) && m[0].includes('title="Tez orada"')), buttons[0]?.[0]);
  const on = html(REVIEW, () => {});
  const live = [...on.matchAll(/<button[^>]*data-review-fix="([^"]+)"[^>]*>/g)];
  assert.equal(live.length, 3);
  assert.ok(live.every((m) => !/\sdisabled=""/.test(m[0])));
  assert.ok(live[0][0].includes('title="Rewrite to 150–250 words."'));
  // Yashil bandda fix bo'lsa ham tugma yo'q.
  const g = html({ ...REVIEW, checks: [{ id: "x", level: "green", label: "X", fix: { op: "rewrite", target: "intro", instruction: "i" } }] });
  assert.ok(!g.includes("data-review-fix"));
});

test("ResultView: article natijasida `doc.article.review` bo'lsa ko'ruvchi tepasida <details open> panel", () => {
  const src = readFileSync(new URL("../../components/files/ResultView.tsx", import.meta.url), "utf8");
  assert.match(src, /gen\.type === "article" && gen\.doc\?\.article\?\.review \? \(/, "faqat maqola + hisobot bor");
  assert.match(src, /<details open[^>]*data-article-review-panel/, "yig'iladigan panel");
  assert.match(src, /<ArticleReviewPanel review=\{gen\.doc\.article\.review\} \/>/, "panel ulanishi (onFix yo'q — WP7)");
  assert.ok(src.indexOf("data-article-review-panel") < src.indexOf("<ArtifactViewer"), "panel ko'ruvchidan OLDIN");
});
