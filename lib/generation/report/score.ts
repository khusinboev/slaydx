/**
 * HISOBOT BALLI VA UMUMIY O'LCHOVLAR (AUDIT-19 R0-A) — neytral.
 *
 * Ball = `RULE_WEIGHT` × qoidalar (yashil 1 / sariq 0.5 / qizil 0) +
 * `JUDGE_WEIGHT` × baholovchi (mezonlar × 3 dan). Turga mos kelmaydigan
 * mezonlar (`JudgeResult.skipped`) MAXRAJGA KIRMAYDI — aks holda tezis
 * «taqqoslash» yo'qligi uchun adolatsiz past ball olardi (AUDIT-18 Q-7).
 *
 * `visualCoverageOf` — rasm/jadval matnda havola qilinganmi: SOF funksiya
 * (reja/hujjat modelini bilmaydi), maqola o'rami `planArticle` dan
 * raqam/yorliqlarni beradi, kurs ishi `planWork` dan beradi.
 */
import type { Block, DocSection } from "../types";
import type { JudgeResult, ReviewCheck, ReviewLevel } from "./types";

/* ────────────────────────── band yasash ────────────────────────── */

export const check = (id: string, level: ReviewLevel, label: string, detail?: string, fix?: ReviewCheck["fix"]): ReviewCheck => ({
  id,
  level,
  label,
  ...(detail ? { detail } : {}),
  ...(fix ? { fix } : {}),
});

export const rewrite = (target: string, instruction: string): NonNullable<ReviewCheck["fix"]> => ({ op: "rewrite", target, instruction });

/* ────────────────────────── ball ────────────────────────── */

export const LEVEL_SCORE: Record<ReviewLevel, number> = { green: 1, yellow: 0.5, red: 0 };

export const RULE_WEIGHT = 0.6;
export const JUDGE_WEIGHT = 0.4;

/**
 * 60% qoidalar + 40% baholovchi, 0–100 butun. `criteria` — turning BARCHA
 * mezonlari; `judge.skipped` dagilar maxrajdan chiqariladi.
 */
export function scoreReviewFor<C extends string>(rules: ReviewCheck[], judge: JudgeResult<C>, criteria: readonly C[]): number {
  const r = rules.length ? rules.reduce((n, c) => n + LEVEL_SCORE[c.level], 0) / rules.length : 1;
  const skip = new Set<string>(judge.skipped ?? []);
  const counted = criteria.filter((c) => !skip.has(c));
  const j = counted.length ? counted.reduce((n, c) => n + judge[c], 0) / (counted.length * 3) : 1;
  return Math.max(0, Math.min(100, Math.round(100 * (RULE_WEIGHT * r + JUDGE_WEIGHT * j))));
}

/* ────────────────────────── takror (3-gram) ────────────────────────── */

/** So'zlar → 3-gramlar to'plami (kichik harf, faqat harf/raqam). */
export function trigrams(text: string): Set<string> {
  const w = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ────────────────────────── vizuallar ────────────────────────── */

export const VISUAL_WORDS: Record<"uz" | "ru" | "en", { fig: RegExp; tab: RegExp }> = {
  uz: { fig: /\b(rasm|sxema|diagramma|chizma|grafik)/iu, tab: /\bjadval/iu },
  ru: { fig: /\b(рис|схем|диаграмм|график)/iu, tab: /\bтабл/iu },
  en: { fig: /\b(figure|fig\.|scheme|diagram|chart)/iu, tab: /\btable/iu },
};

export function langKey(lang: string): "uz" | "ru" | "en" {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
}

export function textBlocks(s: DocSection): Extract<Block, { kind: "p" | "li" | "quote" }>[] {
  return s.blocks.filter((b): b is Extract<Block, { kind: "p" | "li" | "quote" }> => b.kind === "p" || b.kind === "li" || b.kind === "quote");
}

export function sectionText(s: DocSection): string {
  return textBlocks(s)
    .map((b) => b.text)
    .join("\n");
}

export type UnreferencedVisual = { sectionId: string; kind: "figure" | "table"; id: string; label: string };

/** Chizilmagan sxema (`fallbackBlocks`) havola talab qilmaydi — shu uchun kerak. */
export type VisualFigureRef = { id: string; fallbackBlocks?: unknown[] };

export type VisualNumbers = { figures: Record<string, string>; tables: Record<string, string> };
export type VisualLabels = { figureRef: (n: string) => string; tableRef: (n: string) => string };

export type VisualCoverage = { unreferenced: UnreferencedVisual[]; fallback: number; count: number };

/**
 * Rasm/jadval bloklari matnda havola qilinganmi — hisobot `visuals`
 * qoidasi VA avto-sayqal («havola qo'sh» tuzatishi) BITTA hisobdan
 * o'qiydi. Havola: `[fig:id]`/`[tab:id]` tokeni (istalgan bo'limda),
 * «1-rasm»/«1.1-jadval» yorlig'i yoki shu bo'limda «rasm»/«jadval» so'zi.
 */
export function visualCoverageOf(sections: DocSection[], figures: VisualFigureRef[], numbers: VisualNumbers, labels: VisualLabels, lang: string): VisualCoverage {
  const VW = VISUAL_WORDS[langKey(lang)];
  const live = sections.filter((s) => s.blocks.length);
  const allText = live.map(sectionText).join("\n");
  const low = allText.toLowerCase();
  const figs = new Map(figures.map((f) => [f.id, f]));
  const unreferenced: UnreferencedVisual[] = [];
  let fallback = 0;
  let count = 0;
  for (const s of live) {
    const st = sectionText(s);
    for (const b of s.blocks) {
      if (b.kind === "figure") {
        if (figs.get(b.figureId)?.fallbackBlocks?.length) {
          fallback++;
          continue;
        }
        count++;
        const n = numbers.figures[b.figureId];
        const explicit = allText.includes(`[fig:${b.figureId}]`) || (n && low.includes(labels.figureRef(n).toLowerCase()));
        if (!explicit && !VW.fig.test(st)) unreferenced.push({ sectionId: s.id, kind: "figure", id: b.figureId, label: n ? labels.figureRef(n) : b.figureId });
      } else if (b.kind === "tableRef") {
        count++;
        const n = numbers.tables[b.tableId];
        const explicit = allText.includes(`[tab:${b.tableId}]`) || (n && low.includes(labels.tableRef(n).toLowerCase()));
        if (!explicit && !VW.tab.test(st)) unreferenced.push({ sectionId: s.id, kind: "table", id: b.tableId, label: n ? labels.tableRef(n) : b.tableId });
      }
    }
  }
  return { unreferenced, fallback, count };
}
