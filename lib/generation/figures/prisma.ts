/**
 * Maqola 2 (AUDIT-17) WP3 — PRISMA 2020 oqim diagrammasi: QAT'IY 4 qatorli
 * shablon (Identification → Screening → Eligibility → Included), chapda
 * burilgan bosqich yorliqlari, o'ngda chetlashtirilganlar. Yorliqlar
 * uz/ru/en — hujjat tiliga ergashadi (`lang`), model yozmaydi.
 *
 * Raqamlar foydalanuvchi/dvigatel statistikasidan; tekshiruv: butun, ≥0,
 * identified ≥ screened ≥ eligible ≥ included (aks holda `null` → ro'yxat
 * fallback). Aniq ayirma talab qilinmaydi — dublikatlar olib tashlanishi /
 * topilmagan hisobotlar shablonda alohida qator emas.
 */
import type { FigureSpec } from "../article/types";
import { CANVAS_W, FIGURE_WIDTH_MM, FONT_PX, LINE_K, PAD_X, PAD_Y, emptyLayout, fitToCanvas, textWidth, wrapLabel, type FigureLayout } from "./model";

export type PrismaSpec = Extract<FigureSpec, { kind: "prisma" }>;

export type PrismaLabels = {
  stages: [string, string, string, string];
  identified: string;
  sources: string;
  screened: string;
  excludedScreen: string;
  eligible: string;
  excludedElig: string;
  included: string;
};

const LABELS: Record<"uz" | "ru" | "en", PrismaLabels> = {
  uz: {
    stages: ["Identifikatsiya", "Saralash", "Moslik", "Kiritilgan"],
    identified: "Ma’lumotlar bazalaridan aniqlangan yozuvlar",
    sources: "Manbalar",
    screened: "Saralangan yozuvlar",
    excludedScreen: "Chetlashtirilgan yozuvlar",
    eligible: "Mosligi baholangan maqolalar",
    excludedElig: "Chetlashtirilgan maqolalar",
    included: "Sharhga kiritilgan tadqiqotlar",
  },
  ru: {
    stages: ["Идентификация", "Скрининг", "Приемлемость", "Включено"],
    identified: "Записи, найденные в базах данных",
    sources: "Источники",
    screened: "Записи, прошедшие скрининг",
    excludedScreen: "Исключённые записи",
    eligible: "Статьи, оценённые на приемлемость",
    excludedElig: "Исключённые статьи",
    included: "Исследования, включённые в обзор",
  },
  en: {
    stages: ["Identification", "Screening", "Eligibility", "Included"],
    identified: "Records identified from databases",
    sources: "Sources",
    screened: "Records screened",
    excludedScreen: "Records excluded",
    eligible: "Reports assessed for eligibility",
    excludedElig: "Reports excluded",
    included: "Studies included in review",
  },
};

export function prismaLabels(lang: string): PrismaLabels {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? LABELS.ru : c === "en" ? LABELS.en : LABELS.uz;
}

/** Raqamlarni tekshiradi; buzilgan bo'lsa `null`. */
export function prismaNumbers(spec: PrismaSpec): { identified: number; screened: number; excludedScreen: number; eligible: number; excludedElig: number; included: number } | null {
  const keys = ["identified", "screened", "excludedScreen", "eligible", "excludedElig", "included"] as const;
  const out = {} as Record<(typeof keys)[number], number>;
  for (const k of keys) {
    const v = Number((spec as Record<string, unknown>)[k]);
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return null;
    out[k] = v;
  }
  if (out.identified < out.screened || out.screened < out.eligible || out.eligible < out.included) return null;
  return out;
}

export const PRISMA_STAGE_W = 30;
export const PRISMA_MAIN_W = 300;
export const PRISMA_SIDE_W = 190;

export function layoutPrisma(spec: PrismaSpec, lang: string): FigureLayout | null {
  const n = prismaNumbers(spec);
  if (!n) return null;
  const L = prismaLabels(lang);
  const out = emptyLayout("prisma");
  const mainX = PRISMA_STAGE_W + 26;
  const sideX = mainX + PRISMA_MAIN_W + 36;
  const gapY = 36;
  const charsMain = Math.floor((PRISMA_MAIN_W - 2 * PAD_X) / (0.55 * FONT_PX));
  const charsSide = Math.floor((PRISMA_SIDE_W - 2 * PAD_X) / (0.55 * FONT_PX));
  const lineH = FONT_PX * LINE_K;
  const boxH = (lines: number) => lines * lineH + 2 * PAD_Y + 4;
  // «(n = 175)» BO'LINMAS (NBSP) va PRISMA shablonidagidek alohida oxirgi qatorda.
  const nEq = (v: number) => `(n = ${v})`;
  const STAGE_SIZE = FONT_PX * 0.85;

  const rows: { main: string[]; side?: string[] }[] = [];
  {
    const main = [...wrapLabel(L.identified, charsMain, 2), nEq(n.identified)];
    const src = typeof spec.sources === "string" ? spec.sources.replace(/\s+/g, " ").trim() : "";
    if (src) main.push(...wrapLabel(`${L.sources}: ${src}`, charsMain, 2));
    rows.push({ main });
  }
  rows.push({ main: [...wrapLabel(L.screened, charsMain, 2), nEq(n.screened)], side: [...wrapLabel(L.excludedScreen, charsSide, 2), nEq(n.excludedScreen)] });
  rows.push({ main: [...wrapLabel(L.eligible, charsMain, 2), nEq(n.eligible)], side: [...wrapLabel(L.excludedElig, charsSide, 2), nEq(n.excludedElig)] });
  rows.push({ main: [...wrapLabel(L.included, charsMain, 2), nEq(n.included)] });

  let y = 0;
  rows.forEach((r, i) => {
    // Qator balandligi: matn YOKI burilgan bosqich yorlig'i (band = qator + oraliq) sig'sin.
    const stageNeed = textWidth(L.stages[i], STAGE_SIZE) + 16 - (gapY - 8);
    const h = Math.max(boxH(Math.max(r.main.length, r.side?.length ?? 0)), stageNeed);
    const id = `p${i + 1}`;
    out.nodes.push({ id, x: mainX, y, w: PRISMA_MAIN_W, h, lines: r.main, shape: "rect" });
    // Bosqich yorlig'i — chap band (qator + yarim oraliq) + burilgan matn.
    const by = i === 0 ? y : y - gapY / 2 + 4;
    const bh = (i === rows.length - 1 ? y + h : y + h + gapY / 2 - 4) - by;
    out.prims.push({ k: "rect", x: 0, y: by, w: PRISMA_STAGE_W, h: bh, fill: "#e6ebf1", stroke: "#000" });
    out.texts.push({ x: PRISMA_STAGE_W / 2, y: by + bh / 2, text: L.stages[i], rotate: -90, anchor: "middle", size: STAGE_SIZE, bold: true });
    if (r.side) {
      const sh = boxH(r.side.length);
      const sy = y + (h - sh) / 2;
      out.nodes.push({ id: `${id}x`, x: sideX, y: sy, w: PRISMA_SIDE_W, h: sh, lines: r.side, shape: "rect" });
      out.edges.push({ from: id, to: `${id}x`, points: [{ x: mainX + PRISMA_MAIN_W, y: y + h / 2 }, { x: sideX, y: y + h / 2 }], arrow: true });
    }
    if (i > 0) {
      const prev = out.nodes.find((nd) => nd.id === `p${i}`)!;
      out.edges.push({ from: prev.id, to: id, points: [{ x: mainX + PRISMA_MAIN_W / 2, y: prev.y + prev.h }, { x: mainX + PRISMA_MAIN_W / 2, y }], arrow: true });
    }
    y += h + gapY;
  });
  fitToCanvas(out);
  out.w = CANVAS_W;
  out.mm.w = FIGURE_WIDTH_MM;
  return out;
}
