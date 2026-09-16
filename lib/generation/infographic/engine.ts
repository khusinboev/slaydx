/**
 * INFOGRAFIKA DVIGATELI (AUDIT-21 WP-C) — `buildInfographicArtifact`.
 *
 * R0 SHARTNOMASI saqlanadi: imzo `(tool, values, opts) → BuiltFile | null`
 * va `null` xulqi («Infografika yaratilmadi», kredit qaytadi) o'zgarmadi;
 * bu faylda faqat TANA to'ldi.
 *
 * Nega `BuiltFile`, `AcademicDoc` emas: bu oilada MATN oqimi yo'q —
 * chiqish bitta PNG. `rasm` vositasi (`image-studio.ts`) aynan shu
 * naqshda ishlaydi va `buildArtifact` uni umumiy LLM/darvoza yo'lidan
 * OLDIN chaqiradi.
 *
 * Bosqichlar (`onStage` foizlari, R0 rejasidan):
 *   1 kirish          0→10   forma → `InfographicInput`
 *   2 spetsifikatsiya 10→55  LLM: `InfographicSpec` (halollik qoidasi bilan)
 *   3 chizish         55→80  maket → SVG → `figurePng` (300 dpi)
 *   4 hisobot         80→95  `review.ts` (qoidalar + baholovchi) + sayqal
 *
 * IKKI RENDER, bir SVG dan:
 *   • FAYL      — 300 dpi (A4 ≈ 2480×3508 px), foydalanuvchi chop etadi;
 *   • ESKIZ     — 110 dpi (≈910 px), `doc.images` ga `data:` URL bo'lib
 *                 tushadi va ko'ruvchi (`viewerKind "image"`) shuni
 *                 chizadi.
 * Nega ikkita: `doc_json` BAZAGA yoziladi va 300 dpi li PNG ning
 * base64 i ≈1.5 MB bo'lardi — har ochilishda shuncha JSON tarmoqdan
 * o'tardi. Eskiz ≈120 KB va ekranda farqi ko'rinmaydi; chop etiladigan
 * nusxa esa FAYLDA, to'liq zichlikda.
 */
import type { FormValues, ToolConfig } from "../../types";
import type { AcademicDoc, BuiltFile, GenImage } from "../types";
import type { TranslationSource } from "../source-types";
import { extractMeta } from "../meta";
import { llmEnabled } from "../llm";
import { CostMeter, type LlmUsage, complete as completeRole } from "../llm-roles";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import type { CompleteFn } from "../research/pipeline";
import { figurePng } from "../figures/png";
import { packImages, type ImageFile } from "../image-studio";
import { INFOGRAPHIC_LIMITS, type InfographicModel, type InfographicSpec } from "./types";
import { infographicTypeOf } from "./registry";
import { infographicInputFromValues, infographicUserFacts, normalizeSpec, type InfographicInput } from "./input";
import { infographicCtx, infographicPrompt, infographicRetryPrompt, infographicSystemPrompt } from "./prompts";
import { layoutInfographic } from "./layout";
import { renderInfographic } from "./svg";
import { paletteOf } from "./types";
import { infographicChecks, reviewInfographic, specWords } from "./review";
import { runInfographicPolish } from "./polish";

/* ────────────────────────── shartnoma ────────────────────────── */

/** `TeacherStage`/`GameStage` bilan AYNI shakl. */
export type InfographicStage = { progress: number; step: string };

export type InfographicCost = ReturnType<CostMeter["toJson"]>;

export type InfographicBuildOpts = {
  deadline: number;
  onStage?: (ev: InfographicStage) => void;
  /** Fayl rejimi: yuklangan manba (`worker.ts sourceForJob`) — ixtiyoriy. */
  source?: TranslationSource;
  /** Testlar modelni shu orqali almashtiradi (`teacher/engine.ts` naqshi). */
  complete?: CompleteFn;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  /** `false` — avto-sayqal o'tkazib yuboriladi. */
  polish?: boolean;
  onUsage?: (u: LlmUsage) => void;
  now?: Date;
};

export type InfographicBuilder = (tool: ToolConfig, values: FormValues, opts: InfographicBuildOpts) => Promise<BuiltFile | null>;

/* ────────────────────────── vaqt chegaralari ────────────────────────── */

const MIN_CALL_MS = 8_000;
const SPEC_TIMEOUT_MS = 60_000;
export const INFOGRAPHIC_REVIEW_RESERVE_MS = 45_000;
export const INFOGRAPHIC_POLISH_RESERVE_MS = 55_000;

/** Eskiz zichligi — `doc.images` uchun (fayl 300 dpi da qoladi). */
export const PREVIEW_DPI = 110;

/* ────────────────────────── yordamchilar ────────────────────────── */

async function ask(complete: CompleteFn, system: string, user: string, o: { maxTokens: number; timeoutMs: number }, meter: CostMeter, onUsage?: (u: LlmUsage) => void): Promise<Record<string, unknown> | null> {
  if (o.timeoutMs < MIN_CALL_MS) return null;
  const r = await complete("writer", system, user, { json: true, ...o }).catch(() => null);
  if (r?.usage) {
    meter.add(r.usage);
    onUsage?.(r.usage);
  }
  return parseLlmObject<Record<string, unknown>>(r?.text ?? "");
}

/**
 * Qayta so'rov KERAKMI va nima uchun.
 *
 * Faqat MAKET va MIQDOR bandlari: `noOverflow` (matn kartaga sig'madi),
 * blok soni va umumiy hajm. Sifat bandlari (baholovchi, halollik)
 * SAYQALGA qoladi — ular hisobot bilan birga keladi va ularni bu
 * yerda takrorlash ikkinchi chaqiruvni ikki marta to'lardi.
 */
export function retryProblems(spec: InfographicSpec, want: number): string[] {
  const out: string[] = [];
  const layout = layoutInfographic(spec);
  if (layout.overflow.length) {
    const ids = new Set(layout.overflow);
    const worst = spec.blocks.filter((b) => ids.has(b.id)).map((b) => `${b.id} (${b.text.trim().split(/\s+/).length} so'z)`);
    out.push(`these blocks do not fit their printed card and were cut with «…»: ${worst.join(", ")} — make each about half as long`);
  }
  if (spec.blocks.length !== want) out.push(`the poster must have exactly ${want} blocks, you wrote ${spec.blocks.length}`);
  const total = specWords(spec);
  if (total > INFOGRAPHIC_LIMITS.textWordsMax) out.push(`the whole poster holds ${total} words, the limit is ${INFOGRAPHIC_LIMITS.textWordsMax}`);
  return out;
}

/** Plakat matni hujjat bo'limi sifatida — panel va qidiruv uchun. */
function specSection(spec: InfographicSpec) {
  return {
    id: "poster",
    title: spec.title,
    blocks: [
      ...(spec.subtitle ? [{ kind: "p" as const, text: spec.subtitle }] : []),
      ...spec.blocks.map((b) => ({ kind: "li" as const, text: `${b.heading}${b.stat?.value ? ` — ${b.stat.value}${b.stat.label ? ` ${b.stat.label}` : ""}` : ""}: ${b.text}` })),
      ...(spec.source ? [{ kind: "p" as const, text: `Manba: ${spec.source}` }] : []),
    ],
  };
}

/**
 * Maket → SVG → PNG (fayl 300 dpi + eskiz).
 *
 * EKSPORT qilingan, chunki natija sahifasidagi «Hammasini tuzatish»
 * (`lib/server/doc-polish.ts`) spetsifikatsiya o'zgarganda plakatni
 * AYNAN shu yo'l bilan qayta chizishi kerak — ikkinchi chizish kodi
 * «ekranda bitta xil, faylda boshqa xil» nuqsonini qaytarardi.
 */
export async function renderPoster(spec: InfographicSpec): Promise<{ file: ImageFile; preview: GenImage } | null> {
  const layout = layoutInfographic(spec);
  const svg = renderInfographic(layout, paletteOf(spec.palette));
  const full = await figurePng(svg, { widthMm: layout.mm.w, dpi: INFOGRAPHIC_LIMITS.dpi });
  if (!full) return null;
  const small = await figurePng(svg, { widthMm: layout.mm.w, dpi: PREVIEW_DPI });
  const shown = small ?? full;
  return {
    file: { name: "infografika.png", bytes: new Uint8Array(full.png), mime: "image/png" },
    preview: {
      id: "poster",
      url: `data:image/png;base64,${Buffer.from(shown.png).toString("base64")}`,
      alt: spec.title.slice(0, 80),
      w: shown.w,
      h: shown.h,
      mime: "image/png",
    },
  };
}

/** Yuklangan fayldan matn — tarjima ekstraktori orqali (`teacher/engine.ts` naqshi). */
async function sourceTextOf(source: TranslationSource): Promise<string> {
  try {
    const { extractSegments } = await import("../translate/index");
    const ex = await extractSegments(source.kind, source.bytes);
    return ex.segments.map((s) => s.text).join("\n\n").slice(0, INFOGRAPHIC_LIMITS.extraChars * 4);
  } catch (e) {
    console.warn("[infographic] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}

/* ────────────────────────── dvigatel ────────────────────────── */

export const buildInfographicArtifact: InfographicBuilder = async (tool, values, opts) => {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;

  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  /* ── 1. kirish ── */
  stage(0, "Ma’lumotlar tayyorlanmoqda");
  const meta = extractMeta(tool, values);
  const input: InfographicInput = infographicInputFromValues(meta, values);
  if (!input.sourceText && opts.source) input.sourceText = await sourceTextOf(opts.source);
  if (!input.topic) return null;
  const type = infographicTypeOf(input.type);
  const ctx = infographicCtx(type, input);
  const facts = infographicUserFacts(input);

  /* ── 2. spetsifikatsiya ── */
  stage(10, "Plakat mazmuni yozilmoqda");
  const system = infographicSystemPrompt(ctx);
  const writeDeadline = deadline - (opts.polish === false ? INFOGRAPHIC_REVIEW_RESERVE_MS : INFOGRAPHIC_REVIEW_RESERVE_MS + INFOGRAPHIC_POLISH_RESERVE_MS);
  const budget = () => Math.min(SPEC_TIMEOUT_MS, Math.max(0, Math.min(remainingMs(writeDeadline), remainingMs(deadline))));
  let spec = normalizeSpec(await ask(complete, system, infographicPrompt(ctx), { maxTokens: 2600, timeoutMs: budget() }, meter, opts.onUsage), input);
  if (!spec) {
    console.warn("[infographic] model yaroqli spetsifikatsiya bermadi");
    return null;
  }

  /*
   * BIR MARTALIK qayta so'rov — maket rad etganda. Ikkinchi urinish
   * YO'Q: narx tekis 2 000 va uchinchi chaqiruv byudjetni yeydi;
   * qolgan nuqsonni sayqal (`polish.ts`) hisobot bilan birga tuzatadi.
   */
  const problems = retryProblems(spec, input.blockCount);
  if (problems.length) {
    stage(40, "Matn plakatga moslanmoqda");
    const retry = normalizeSpec(
      await ask(complete, system, infographicRetryPrompt(ctx, spec, problems), { maxTokens: 2600, timeoutMs: budget() }, meter, opts.onUsage),
      input,
      { ids: spec.blocks.map((b) => b.id) },
    );
    // Qayta so'rov YOMONLASHTIRMASIN: yangi javob faqat kamroq muammo
    // bersa qabul qilinadi (jonli sinovda model ba'zan uzunroq yozadi).
    if (retry && retryProblems(retry, input.blockCount).length < problems.length) spec = retry;
  }

  /* ── 3. chizish ── */
  stage(55, "Plakat chizilmoqda");
  const drawn = await renderPoster(spec);
  if (!drawn) {
    console.warn("[infographic] PNG chizilmadi (sharp/librsvg)");
    return null;
  }

  const model: InfographicModel = { v: 1, spec };
  let doc: AcademicDoc = {
    meta: { ...meta, topic: input.topic, language: input.language, extra: facts },
    titlePage: false,
    toc: false,
    sections: [specSection(spec)],
    images: [drawn.preview],
    infographic: model,
  };

  /* ── 4. hisobot ── */
  stage(80, "Tayyorlik hisoboti");
  const judge = opts.judge !== false;
  const reviewOpts = { complete, deadline, judge, now, want: input.blockCount, onUsage: opts.onUsage };
  let review = await reviewInfographic(doc, reviewOpts);
  model.review = review;
  model.userNeeds = review.userNeeds ?? [];

  /* ── 5. avto-sayqal ── */
  let files = [drawn.file];
  let images = [drawn.preview];
  if (opts.polish !== false && remainingMs(deadline) > INFOGRAPHIC_POLISH_RESERVE_MS) {
    stage(88, "Avto-sayqal");
    const res = await runInfographicPolish(doc, review, { complete, deadline, judge, now, want: input.blockCount, onUsage: opts.onUsage });
    if (res.accepted && res.doc.infographic) {
      // Spetsifikatsiya o'zgardi → PLAKAT QAYTA CHIZILADI. Aks holda
      // fayl eski matn bilan, hisobot esa yangisi bo'yicha chiqardi —
      // aynan «ekranda bitta xil, faylda boshqa xil» nuqsoni.
      const redrawn = await renderPoster(res.doc.infographic.spec);
      if (redrawn) {
        files = [redrawn.file];
        images = [redrawn.preview];
        doc = { ...res.doc, images };
        spec = res.doc.infographic.spec;
      } else {
        doc = { ...doc, infographic: { ...model, spec } };
      }
    }
    review = res.review;
    const target = doc.infographic ?? model;
    target.review = review;
    target.polish = res.log;
    target.userNeeds = review.userNeeds ?? [];
    doc = { ...doc, infographic: target, sections: [specSection(target.spec)], images };
  }

  /* ── 6. qadoqlash ── */
  stage(96, "Tayyor");
  const packed = await packImages(files, meta.fileNameHint || "infografika", 1);
  const cost = meter.toJson();
  /*
   * `delivered` — va'da BLOK SONI bo'yicha: forma «5 blok» degan,
   * model 3 ta bergan bo'lsa worker farqni qaytaradi (`rasm` vositasidagi
   * «4 ta so'raldi, 1 tasi keldi» bilan AYNI mexanizm).
   */
  const got = doc.infographic?.spec.blocks.length ?? 0;
  const delivered = got < input.blockCount ? { got, want: input.blockCount } : undefined;
  return {
    ...packed,
    html: posterHtml(doc.infographic?.spec ?? spec, drawn.preview),
    doc,
    cost,
    ...(delivered ? { delivered } : {}),
  };
};

/* ────────────────────────── HTML eskiz ────────────────────────── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function posterHtml(spec: InfographicSpec, preview: GenImage): string {
  const type = infographicTypeOf(spec.type);
  return `<article><h1>${esc(spec.title)}</h1><p>${esc(type.label.uz)} · ${spec.blocks.length} blok · ${spec.size} · 300 dpi</p><img src="${preview.url}" alt="${esc(preview.alt ?? spec.title)}" width="${preview.w}" height="${preview.h}"/></article>`;
}

/* Hisobot qoidalarini dvigateldan tashqarida ham chaqirish uchun (zond, testlar). */
export { infographicChecks };
