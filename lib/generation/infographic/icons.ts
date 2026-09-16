/**
 * IKON CHIZMALARI (AUDIT-21 WP-C) — AVTOMATIK YARATILGAN, QO'LDA TAHRIRLAMANG.
 *
 *   manba:   @tabler/icons@3.46.0 (MIT, Paweł Kuna — data/ICONS-LICENSE.md)
 *   generator: scripts/gen-icons.mts
 *   qayta yaratish: npx tsx scripts/gen-icons.mts
 *
 * Har ikon — 24×24 viewBox dagi `d` satrlari; ular STROK bilan chiziladi
 * (`fill: none`, `stroke-width: 2`, yumaloq uch va burchak), shuning
 * uchun `svg.ts` ularni bitta `<g transform="… scale(s)">` ichiga
 * qo'yadi: strok qalinligi ikon bilan birga masshtablanadi va 14 mm li
 * doirada Tabler ning o'z nisbati (2/24) saqlanadi.
 *
 * Nomlar `types.ts ICONS` dan; farq qilgan slug lar (sigma → sum)
 * generatorning `ALIASES` jadvalida izohlangan.
 */
import { ICON_FALLBACK, ICONS } from "./types";

/** `ICONS` nomi → 24×24 panjaradagi `d` satrlari (chizish tartibida). */
export const ICON_PATHS: Readonly<Record<string, readonly string[]>> = {
  "book": ["M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0", "M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0", "M3 6l0 13", "M12 6l0 13", "M21 6l0 13"],
  "books": ["M5 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -14", "M9 5a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -14", "M5 8h4", "M9 16h4", "M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041", "M14 9l4 -1", "M16 16l3.923 -.98"],
  "school": ["M22 9l-10 -4l-10 4l10 4l10 -4v6", "M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"],
  "backpack": ["M5 18v-6a6 6 0 0 1 6 -6h2a6 6 0 0 1 6 6v6a3 3 0 0 1 -3 3h-8a3 3 0 0 1 -3 -3", "M10 6v-1a2 2 0 1 1 4 0v1", "M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4", "M11 10h2"],
  "certificate": ["M12 15a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M13 17.5v4.5l2 -1.5l2 1.5v-4.5", "M10 19h-5a2 2 0 0 1 -2 -2v-10c0 -1.1 .9 -2 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -1 1.73", "M6 9l12 0", "M6 12l3 0", "M6 15l2 0"],
  "pencil": ["M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4", "M13.5 6.5l4 4"],
  "ruler": ["M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-7a1 1 0 0 0 -1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1", "M4 8l2 0", "M4 12l3 0", "M4 16l2 0", "M8 4l0 2", "M12 4l0 3", "M16 4l0 2"],
  "ruler-2": ["M17 3l4 4l-14 14l-4 -4l14 -14", "M16 7l-1.5 -1.5", "M13 10l-1.5 -1.5", "M10 13l-1.5 -1.5", "M7 16l-1.5 -1.5"],
  "math-function": ["M3 19a2 2 0 0 0 2 2c2 0 2 -4 3 -9s1 -9 3 -9a2 2 0 0 1 2 2", "M5 12h6", "M15 12l6 6", "M15 18l6 -6"],
  "sigma": ["M18 16v2a1 1 0 0 1 -1 1h-11l6 -7l-6 -7h11a1 1 0 0 1 1 1v2"],
  "abacus": ["M5 3v18", "M19 21v-18", "M5 7h14", "M5 15h14", "M8 13v4", "M11 13v4", "M16 13v4", "M14 5v4", "M11 5v4", "M8 5v4", "M3 21h18"],
  "atom": ["M12 12v.01", "M19.071 4.929c-1.562 -1.562 -6 .337 -9.9 4.243c-3.905 3.905 -5.804 8.337 -4.242 9.9c1.562 1.561 6 -.338 9.9 -4.244c3.905 -3.905 5.804 -8.337 4.242 -9.9", "M4.929 4.929c-1.562 1.562 .337 6 4.243 9.9c3.905 3.905 8.337 5.804 9.9 4.242c1.561 -1.562 -.338 -6 -4.244 -9.9c-3.905 -3.905 -8.337 -5.804 -9.9 -4.242"],
  "flask": ["M9 3l6 0", "M10 9l4 0", "M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"],
  "test-pipe": ["M20 8.04l-12.122 12.124a2.857 2.857 0 1 1 -4.041 -4.04l12.122 -12.124", "M7 13h8", "M19 15l1.5 1.6a2 2 0 1 1 -3 0l1.5 -1.6", "M15 3l6 6"],
  "microscope": ["M5 21h14", "M6 18h2", "M7 18v3", "M9 11l3 3l6 -6l-3 -3l-6 6", "M10.5 12.5l-1.5 1.5", "M17 3l3 3", "M12 21a6 6 0 0 0 3.715 -10.712"],
  "dna": ["M14.828 14.828a4 4 0 1 0 -5.656 -5.656a4 4 0 0 0 5.656 5.656", "M9.172 20.485a4 4 0 1 0 -5.657 -5.657", "M14.828 3.515a4 4 0 0 0 5.657 5.657"],
  "world": ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M3.6 9h16.8", "M3.6 15h16.8", "M11.5 3a17 17 0 0 0 0 18", "M12.5 3a17 17 0 0 1 0 18"],
  "map": ["M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13", "M9 4v13", "M15 7v13"],
  "globe": ["M7 9a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M5.75 15a8.015 8.015 0 1 0 9.25 -13", "M11 17v4", "M7 21h8"],
  "language": ["M9 6.371c0 4.418 -2.239 6.629 -5 6.629", "M4 6.371h7", "M5 9c0 2.144 2.252 3.908 6 4", "M12 20l4 -9l4 9", "M19.1 18h-6.2", "M6.694 3l.793 .582"],
  "bulb": ["M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7", "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3", "M9.7 17l4.6 0"],
  "target": ["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"],
  "clipboard-check": ["M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2", "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2", "M9 14l2 2l4 -4"],
  "clipboard-list": ["M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2", "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2", "M9 12l.01 0", "M13 12l2 0", "M9 16l.01 0", "M13 16l2 0"],
  "checklist": ["M9.615 20h-2.615a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8", "M14 19l2 2l4 -4", "M9 8h4", "M9 12h2"],
  "chart-bar": ["M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6", "M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10", "M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14", "M4 20h14"],
  "chart-pie": ["M10 3.2a9 9 0 1 0 10.8 10.8a1 1 0 0 0 -1 -1h-6.8a2 2 0 0 1 -2 -2v-7a.9 .9 0 0 0 -1 -.8", "M15 3.5a9 9 0 0 1 5.5 5.5h-4.5a1 1 0 0 1 -1 -1v-4.5"],
  "chart-line": ["M4 19l16 0", "M4 15l4 -6l4 2l4 -5l4 4"],
  "trending-up": ["M3 17l6 -6l4 4l8 -8", "M14 7l7 0l0 7"],
  "users": ["M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2", "M16 3.13a4 4 0 0 1 0 7.75", "M21 21v-2a4 4 0 0 0 -3 -3.85"],
  "calendar": ["M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12", "M16 3v4", "M8 3v4", "M4 11h16", "M11 15h1", "M12 15v3"],
  "clock": ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 7v5l3 3"],
  "award": ["M6 9a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M12 15l3.4 5.89l1.598 -3.233l3.598 .232l-3.4 -5.889", "M6.802 12l-3.4 5.89l3.598 -.233l1.598 3.232l3.4 -5.889"],
  "trophy": ["M8 21l8 0", "M12 17l0 4", "M7 4l10 0", "M17 4v8a5 5 0 0 1 -10 0v-8", "M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],
  "star": ["M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"],
  "puzzle": ["M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1"],
  "compass": ["M8 16l2 -6l6 -2l-2 6l-6 2", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 3l0 2", "M12 19l0 2", "M3 12l2 0", "M19 12l2 0"],
  "flag": ["M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9", "M5 21v-7"],
  "brain": ["M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8", "M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8", "M17.5 16a3.5 3.5 0 0 0 0 -7h-.5", "M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0", "M6.5 16a3.5 3.5 0 0 1 0 -7h.5", "M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10"],
  "heart": ["M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"],
  "history": ["M12 8l0 4l2 2", "M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"],
};

/** Ikon panjarasi (Tabler 24×24) — masshtab shu sondan hisoblanadi. */
export const ICON_GRID = 24;
/** Tabler strok qalinligi (panjaraga nisbatan) — masshtab bilan birga o'zgaradi. */
export const ICON_STROKE = 2;

/**
 * Nom → chizma. Noma'lum/bo'sh nom `ICON_FALLBACK` ga tushadi
 * (`iconKnown` qoidasi, hisobot §4): plakat ikonsiz qolmaydi, hisobot
 * esa almashtirishni AYTADI.
 */
export function iconPaths(name: unknown): readonly string[] {
  return ICON_PATHS[String(name ?? "")] ?? ICON_PATHS[ICON_FALLBACK];
}

/** Chizmasi bor ikonlar — `ICONS` bilan AYNI to'plam (`tests/infographic-icons` qulflaydi). */
export const DRAWN_ICONS: readonly string[] = ICONS.filter((n) => Boolean(ICON_PATHS[n]));
