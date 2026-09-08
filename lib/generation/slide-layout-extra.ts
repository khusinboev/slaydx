import { LAYOUT_KIT, type PlanCtx, type SlidePlan } from "./slide-layout";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel, SlideTheme } from "./slide-types";

/**
 * Yangi maketlar — `quiz` (nazorat testi), `references` (adabiyotlar),
 * `answers` (test javoblari, izoh o'chiq bo'lganda).
 *
 * WP-0b: STUB — uchalasi ham bandlar ro'yxati sifatida chiziladi, deka
 * buzilmaydi. WP-C haqiqiy maketlarni yozadi: savol + A/B/C/D kartalar
 * (javob slaydda EMAS), raqamlangan manbalar + domen, javoblar jadvali.
 * Faqat `LAYOUT_KIT` dan foydalanadi — `slide-layout.ts` ga tegmaydi.
 */
/*
 * `LAYOUT_KIT` FAQAT chaqiruv vaqtida o'qiladi — modul darajasida
 * destrukturasiya qilinmaydi. `slide-layout.ts` ↔ bu fayl ESM sikli:
 * `slide-layout.ts` yuklanayotganda bu modul avval baholanadi va
 * `LAYOUT_KIT` hali TDZ da bo'ladi («Cannot access before initialization»
 * — 0b da aynan shu xato beshta test faylini yuklanmaydigan qilib qo'ydi).
 */
function asList(s: SlideModel, lines: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { planHeading, pushFooter, pushChrome, fitLines, M, W, H } = LAYOUT_KIT;
  const layers: SlidePlan["layers"] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushChrome(layers, theme, "full");
  const x = M + 0.18;
  planHeading(layers, s, theme, 12.1, x, ctx.reserve);
  const box = { x, y: 1.5, w: 12.1, h: 5.35 };
  layers.push({
    t: "text",
    box,
    lines,
    bullets: true,
    color: theme.text,
    size: fitLines(lines, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, 10),
    paraSpace: 10,
  });
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, false);
  return { bg: theme.bg, layers };
}

export function planQuiz(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number, ctx: PlanCtx): SlidePlan {
  void visual;
  const lines = (s.quiz ?? []).map((q, i) => `${i + 1}. ${q.q}`);
  return asList(s, lines.length ? lines : s.bullets ?? [], theme, index, total, ctx);
}

export function planReferences(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number, ctx: PlanCtx): SlidePlan {
  void visual;
  const lines = (s.refs ?? []).map((r, i) => `${i + 1}. ${r.title}${r.source ? ` — ${r.source}` : ""}`);
  return asList(s, lines.length ? lines : s.bullets ?? [], theme, index, total, ctx);
}

export function planAnswers(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number, ctx: PlanCtx): SlidePlan {
  void visual;
  return asList(s, s.bullets ?? [], theme, index, total, ctx);
}
