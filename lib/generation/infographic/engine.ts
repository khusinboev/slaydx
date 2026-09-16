/**
 * INFOGRAFIKA DVIGATELI (AUDIT-21) — `buildInfographicArtifact`.
 *
 * R0 da bu fayl SHARTNOMA: imzo va `null` xulqi qulflanadi, TANASI esa
 * WP-C da to'ladi (`prompts.ts` → `InfographicSpec`, `figures/
 * layout-infographic.ts` → maket, `figures/icons.ts` → SVG path lar,
 * `figures/infographic-svg.ts` → rangli SVG, `review.ts` → hisobot).
 *
 * Nega `BuiltFile`, `AcademicDoc` emas: bu oilada MATN oqimi yo'q —
 * chiqish bitta PNG. `rasm` vositasi (`image-studio.ts
 * buildImageArtifact`) aynan shu naqshda ishlaydi va `buildArtifact`
 * uni umumiy LLM/darvoza yo'lidan OLDIN chaqiradi; infografika ham shu
 * yerdan o'tadi. Fayl qadoqlash `packImages` bilan — bitta rasm xom
 * PNG, kelgusida PDF o'rami qo'shilsa arxiv (WP-C).
 *
 * Rejalashtirilgan bosqichlar (`onStage` foizlari, WP-C):
 *   1 kirish       0→10   forma → tur/palitra/o'lcham/blok soni
 *   2 spetsifikatsiya 10→55  LLM: `InfographicSpec` (halollik qoidasi bilan)
 *   3 chizish      55→80   maket → SVG → `figurePng` (300 dpi)
 *   4 hisobot      80→95   `review.ts` (qoidalar + baholovchi)
 *
 * `null` — dvigatel ishlamadi (LLM kalitsiz muhit, model javob bermadi,
 * sifat darvozasidan o'tmadi). Chaqiruvchi (`index.ts buildArtifact`)
 * shunda «Infografika yaratilmadi» xatosini tashlaydi va worker
 * kreditni qaytaradi — bu `rasm` vositasidagi «Rasm yaratilmadi»
 * bilan AYNI xulq.
 */
import type { FormValues, ToolConfig } from "../../types";
import type { BuiltFile } from "../types";

/* ────────────────────────── shartnoma ────────────────────────── */

/** `TeacherStage`/`GameStage` bilan AYNI shakl. */
export type InfographicStage = { progress: number; step: string };

export type InfographicBuildOpts = {
  deadline: number;
  onStage?: (ev: InfographicStage) => void;
};

/**
 * Dvigatelning SHARTNOMASI — R0 da qulflangan imzo (WP-C shunga
 * tayanadi); tanasi WP-C da to'ladi.
 */
export type InfographicBuilder = (tool: ToolConfig, values: FormValues, opts: InfographicBuildOpts) => Promise<BuiltFile | null>;

/* ────────────────────────── dvigatel (STUB) ────────────────────────── */

export const buildInfographicArtifact: InfographicBuilder = async () => {
  // WP-C: kirish → LLM spetsifikatsiyasi → SVG → PNG → hisobot → `packImages`.
  return null;
};
