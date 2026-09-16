/**
 * KROSSVORD TO'RINING SVG i (AUDIT-21 WP-A) — BOSMA o'lchovda.
 *
 * `figures/omr.ts` naqshi: maket birligi MILLIMETR (1 mm = `MM_PX` SVG
 * birligi), chunki bu ekran grafikasi emas — o'quvchi qalam bilan
 * to'ldiradigan blanka. Katak 7–9 mm (qalam bilan harf yozish uchun eng
 * kichigi ≈7 mm), to'r kengligi ≤170 mm (A4 210 mm − 2×20 mm chekka),
 * shuning uchun `figurePng(svg, { widthMm: crosswordWidthMm(grid) })`
 * da har o'lcham qog'ozda AYNAN o'zi bo'lib chiqadi.
 *
 * IKKI KO'RINISH:
 *   — `answers: false` — bo'sh to'r: oq kataklar, chegara, raqamlar
 *     (o'quvchiga beriladigan bet);
 *   — `answers: true`  — javob to'ri: o'sha to'r + harflar (o'qituvchi
 *     uchun, hujjatda YANGI BETDAN).
 *
 * «QORA KATAK» QARORI: bizning to'r «criss-cross» (siyrak, 30–40 %
 * to'la) — klassik NYT uslubidagi zich to'r emas. Shuning uchun standart
 * ko'rinishda so'zga tegishli bo'lmagan katak CHIZILMAYDI (oq qog'oz
 * qoladi): 21×21 ramkaning 60 % ini qora bo'yash betni qoraytiradi va
 * siyoh/toner sarfini oshiradi. Egasi zich ko'rinishni xohlasa —
 * `blackCells: true` (ikkala yo'l ham testda qulflangan).
 *
 * Izomorf: `sharp`/DOM importi YO'Q — PNG ga aylantirish `figures/png.ts`
 * (`figurePng`) ning ishi, bu modul faqat satr qaytaradi. Deterministik:
 * bir xil kirishda bayt-bayt bir xil satr.
 */
import { xmlEscape } from "../../xml";
import { MM_PX } from "../../figures/omr";
import type { CrosswordGridData, PlacedWord } from "./grid";

export { MM_PX };

/** Bosma o'lchovlar — millimetrda. Testlar shu jadvalni qulflaydi. */
export const CROSSWORD_MM = {
  /** Eng katta bosma kenglik: A4 210 mm − 2×20 mm chekka. */
  maxWidth: 170,
  /** Standart katak (qalam bilan harf yozishga qulay). */
  cell: 9,
  /** Eng kichik katak — bundan pastda harf o'qilmaydi. */
  cellMin: 7,
  /** To'r atrofidagi bo'sh joy. */
  pad: 2,
  /** Chiziq qalinligi. */
  stroke: 0.3,
  /** Raqam shrifti. */
  numberFont: 2.4,
  /** Harf shrifti katakka nisbatan. */
  letterRatio: 0.55,
} as const;

/** Shrift zanjiri — `figures/svg.ts`/`omr.ts` bilan bir xil (worker konteynerida `ttf-liberation`). */
export const CROSSWORD_FONT = "Times New Roman, Liberation Serif, Noto Serif, serif";

const n = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * Katak o'lchami (mm): 9 mm dan boshlanadi va to'r 170 mm ga sig'maguncha
 * kichrayadi (21 ustun → 8,09 mm). `cellMin` dan pastga tushmaydi —
 * 21×21 da ham 8 mm chiqadi, demak bu faqat himoya chegarasi.
 */
export function cellMm(cols: number): number {
  if (cols <= 0) return CROSSWORD_MM.cell;
  const fit = CROSSWORD_MM.maxWidth / cols;
  // PASTGA yaxlitlash: yuqoriga yaxlitlansa 19 ustun 170,05 mm bo'lib
  // chegaradan chiqadi (testda ushlandi).
  const raw = Math.floor(Math.min(CROSSWORD_MM.cell, fit) * 100) / 100;
  return Math.max(CROSSWORD_MM.cellMin, raw);
}

export const crosswordWidthMm = (grid: CrosswordGridData, cell = cellMm(grid.cols)): number =>
  Math.round((grid.cols * cell + 2 * CROSSWORD_MM.pad) * 100) / 100;

export const crosswordHeightMm = (grid: CrosswordGridData, cell = cellMm(grid.cols)): number =>
  Math.round((grid.rows * cell + 2 * CROSSWORD_MM.pad) * 100) / 100;

export type CrosswordSvgOpts = {
  /** `true` — javob to'ri (harflar bilan). */
  answers?: boolean;
  /** `true` — so'zsiz kataklar qora bo'yaladi (zich, NYT uslubi). */
  blackCells?: boolean;
  /** Katakni majburan belgilash (testlar va maxsus maketlar uchun). */
  cellMm?: number;
};

/** So'z BOSHLANADIGAN kataklarning raqamlari (`row:col` → raqam). */
export function numberMap(words: readonly PlacedWord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of words) {
    const k = `${w.row}:${w.col}`;
    const cur = out.get(k);
    if (cur === undefined || w.number < cur) out.set(k, w.number);
  }
  return out;
}

/**
 * To'r SVG i. Bo'sh to'r ham, javob to'ri ham AYNI maketdan chiqadi —
 * o'quvchi va o'qituvchi beti bir-biriga piksel-bapiksel tushadi.
 */
export function crosswordSvg(grid: CrosswordGridData, words: readonly PlacedWord[], opts: CrosswordSvgOpts = {}): string {
  const cell = opts.cellMm ?? cellMm(grid.cols);
  const W = crosswordWidthMm(grid, cell);
  const H = crosswordHeightMm(grid, cell);
  const mm = (v: number) => v * MM_PX;
  const out: string[] = [];

  out.push(`<rect x="0" y="0" width="${n(mm(W))}" height="${n(mm(H))}" fill="#fff"/>`);

  if (grid.rows > 0 && grid.cols > 0) {
    const numbers = numberMap(words);
    const sw = n(mm(CROSSWORD_MM.stroke));
    const letterFont = cell * CROSSWORD_MM.letterRatio;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const ch = grid.cells[r][c];
        const x = CROSSWORD_MM.pad + c * cell;
        const y = CROSSWORD_MM.pad + r * cell;
        if (ch === null) {
          // So'zsiz katak: standart — chizilmaydi; `blackCells` — to'q to'rtburchak.
          if (opts.blackCells) {
            out.push(`<rect x="${n(mm(x))}" y="${n(mm(y))}" width="${n(mm(cell))}" height="${n(mm(cell))}" fill="#000" stroke="#000" stroke-width="${sw}"/>`);
          }
          continue;
        }
        out.push(`<rect x="${n(mm(x))}" y="${n(mm(y))}" width="${n(mm(cell))}" height="${n(mm(cell))}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`);
        const num = numbers.get(`${r}:${c}`);
        if (num) {
          const fs = mm(CROSSWORD_MM.numberFont);
          out.push(
            `<text x="${n(mm(x + 0.7))}" y="${n(mm(y + 0.7) + fs * 0.85)}" font-size="${n(fs)}" text-anchor="start">${xmlEscape(String(num))}</text>`,
          );
        }
        if (opts.answers) {
          const fs = mm(letterFont);
          // Baza chizig'i qo'lda: librsvg `dominant-baseline` ni to'liq
          // qo'llamaydi (`figures/svg.ts` bilan bir xil qoida).
          out.push(
            `<text x="${n(mm(x + cell / 2))}" y="${n(mm(y + cell / 2) + fs * 0.35)}" font-size="${n(fs)}" text-anchor="middle">${xmlEscape(ch)}</text>`,
          );
        }
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(mm(W))} ${n(mm(H))}" width="${n(mm(W))}" height="${n(mm(H))}" font-family="${xmlEscape(CROSSWORD_FONT)}" fill="#000">`,
    ...out,
    `</svg>`,
  ].join("");
}
