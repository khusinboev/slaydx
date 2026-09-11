/**
 * Maqola 2 (AUDIT-17) WP3 — sxema/diagramma generatori: spec → maket → SVG
 * → PNG (300 dpi) → `figure.url = data:image/png;base64,…`.
 *
 * Shartnoma (`article/types.ts Figure`, WP2 renderer):
 *   - muvaffaqiyat: `url` (data PNG), `w`/`h` piksel (1890 px = 160 mm);
 *   - maket bo'lmasa (sikl, chegara, buzuq raqam, `sharp` xatosi):
 *     `url` YO'Q + `fallbackBlocks` (raqamlangan `li` ro'yxat) — `planArticle`
 *     rasm raqami bermaydi, ro'yxatni matn o'rniga qo'yadi;
 *   - `chart` faqat `dataSource: "user"`; aks holda fallback + `source`
 *     «Ma’lumot berilmagan» — uydirma raqam TAQIQ (Q-2), raqamlar chiqarilmaydi.
 *
 * Server-only (`sharp`); `layoutFigure`/`figureSvg` izomorf.
 */
import type { Block } from "../types";
import type { Figure, FigureSpec } from "../article/types";
import { flowGraph, layoutFigure, processSteps, treeNodes } from "./layout";
import { figureSvg } from "./svg";
import { figurePng } from "./png";
import { prismaLabels, prismaNumbers } from "./prisma";
import { chartData, fmtNum } from "./chart";

export { layoutFigure } from "./layout";
export { figureSvg } from "./svg";
export { figurePng } from "./png";
export type { FigureLayout } from "./model";

export type BuildFigureOpts = { lang: string };

const NO_DATA: Record<"uz" | "ru" | "en", string> = {
  uz: "Ma’lumot berilmagan",
  ru: "Данные не предоставлены",
  en: "Data not provided",
};

function langOf(lang: string): "uz" | "ru" | "en" {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
}

/** «Ma’lumot berilmagan» — grafik uchun foydalanuvchi raqami yo'q. */
export function noDataLabel(lang: string): string {
  return NO_DATA[langOf(lang)];
}

/** Maket → SVG (sinov/oldindan ko'rish uchun); maket bo'lmasa `null`. */
export function figureSvgOf(spec: FigureSpec, lang: string): string | null {
  const layout = layoutFigure(spec, { lang });
  return layout ? figureSvg(layout) : null;
}

/**
 * Rasm o'rniga matn: sarlavha paragrafi + raqamlangan `li` ro'yxat.
 * flow — qirralar «A → B (yorliq)» topologik tartibda (sikl bo'lsa kirish
 * tartibida) + yolg'iz tugunlar; process — qadamlar; tree — chuqurlik bilan
 * «– » chekinish; prisma — 4 qator; chart — faqat kategoriyalar (raqamsiz,
 * agar manba foydalanuvchi bo'lmasa) yoki «kategoriya: qiymat».
 */
export function figureFallbackBlocks(figure: Figure, lang: string): Block[] {
  const spec = figure.spec;
  const caption = String(figure.caption ?? "").trim();
  const head: Block[] = caption ? [{ kind: "p", text: caption.endsWith(":") ? caption : `${caption}:` }] : [];
  const li = (items: string[]): Block[] => items.map((t) => ({ kind: "li", text: t }));
  if (!spec || typeof spec !== "object") return head;
  switch (spec.kind) {
    case "flow": {
      const nodes = Array.isArray(spec.nodes) ? spec.nodes.filter((n) => n && typeof n === "object" && n.id) : [];
      const label = new Map(nodes.map((n) => [String(n.id), String(n.label ?? "").trim() || String(n.id)]));
      const g = flowGraph(spec);
      const order = g ? g.order : nodes.map((n) => String(n.id));
      const edges = Array.isArray(spec.edges) ? spec.edges.filter((e) => e && label.has(String(e.from)) && label.has(String(e.to))) : [];
      const rank = new Map(order.map((id, i) => [id, i]));
      const sorted = [...edges].sort((a, b) => (rank.get(String(a.from)) ?? 0) - (rank.get(String(b.from)) ?? 0) || (rank.get(String(a.to)) ?? 0) - (rank.get(String(b.to)) ?? 0));
      const items = sorted.map((e) => `${label.get(String(e.from))} → ${label.get(String(e.to))}${e.label ? ` (${String(e.label).trim()})` : ""}`);
      const touched = new Set(edges.flatMap((e) => [String(e.from), String(e.to)]));
      for (const id of order) if (!touched.has(id)) items.push(label.get(id)!);
      return [...head, ...li(items)];
    }
    case "process":
      return [...head, ...li(processSteps(spec) ?? [])];
    case "tree": {
      const t = treeNodes(spec);
      const items: string[] = [];
      const walk = (label: string, children: import("../article/types").TreeNode[] | undefined, depth: number) => {
        items.push(`${"– ".repeat(depth)}${label}`);
        for (const c of children ?? []) walk(c.label, c.children, depth + 1);
      };
      if (t) walk(t.root, t.children, 0);
      else if (spec.root) walk(String(spec.root), Array.isArray(spec.children) ? spec.children : [], 0);
      return [...head, ...li(items)];
    }
    case "prisma": {
      const L = prismaLabels(lang);
      const num = (v: unknown) => (Number.isFinite(Number(v)) ? `(n = ${Number(v)})` : "");
      const n = prismaNumbers(spec) ?? spec;
      return [
        ...head,
        ...li([
          `${L.stages[0]}: ${L.identified} ${num(n.identified)}${spec.sources ? ` — ${L.sources}: ${String(spec.sources).trim()}` : ""}`,
          `${L.stages[1]}: ${L.screened} ${num(n.screened)}; ${L.excludedScreen} ${num(n.excludedScreen)}`,
          `${L.stages[2]}: ${L.eligible} ${num(n.eligible)}; ${L.excludedElig} ${num(n.excludedElig)}`,
          `${L.stages[3]}: ${L.included} ${num(n.included)}`,
        ]),
      ];
    }
    case "chart": {
      const d = chartData(spec);
      if (!d) {
        // Foydalanuvchi ma'lumoti yo'q — RAQAM CHIQARILMAYDI, faqat kategoriyalar.
        const cats = Array.isArray(spec.categories) ? spec.categories.map((c) => String(c ?? "").trim()).filter(Boolean) : [];
        return [...head, { kind: "p", text: `${noDataLabel(lang)}${cats.length ? ` (${cats.join(", ")})` : ""}.` }];
      }
      const unit = d.unit ? ` ${d.unit}` : "";
      const items = d.categories.map((c, i) => `${c}: ${d.series.map((s) => (d.series.length > 1 ? `${s.name} — ${fmtNum(s.values[i], lang)}${unit}` : `${fmtNum(s.values[i], lang)}${unit}`)).join("; ")}`);
      return [...head, ...li(items)];
    }
    default:
      return head;
  }
}

/**
 * Asosiy kirish: rasmni quradi. Har doim YANGI obyekt qaytaradi (kirish
 * o'zgarmaydi). Fallback holatida `url`/`assetId` olib tashlanadi, `w`/`h` = 0.
 */
export async function buildFigure(figure: Figure, opts: BuildFigureOpts): Promise<Figure> {
  const lang = opts.lang || "uz";
  const fallback = (extra: Partial<Figure> = {}): Figure => {
    const out: Figure = { ...figure, w: 0, h: 0, fallbackBlocks: figureFallbackBlocks(figure, lang), ...extra };
    delete out.url;
    delete out.assetId;
    return out;
  };
  const spec = figure.spec;
  if (!spec || typeof spec !== "object") return fallback();
  if (spec.kind === "chart" && spec.dataSource !== "user") return fallback({ source: noDataLabel(lang) });
  const layout = layoutFigure(spec, { lang });
  if (!layout) return fallback();
  const svg = figureSvg(layout);
  const png = await figurePng(svg);
  if (!png) return fallback();
  const out: Figure = { ...figure, url: `data:image/png;base64,${png.png.toString("base64")}`, w: png.w, h: png.h };
  delete out.fallbackBlocks;
  return out;
}

/** Bir nechta rasm — ketma-ket (sharp CPU ishi; parallel foyda bermaydi). */
export async function buildFigures(figures: Figure[], opts: BuildFigureOpts): Promise<Figure[]> {
  const out: Figure[] = [];
  for (const f of figures) out.push(await buildFigure(f, opts));
  return out;
}
