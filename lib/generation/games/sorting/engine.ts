/**
 * SARALASH O'YINI DVIGATELI (AUDIT-22 WP-D) — `buildSortingDoc`.
 *
 * `games/engine.ts` ning `buildGameDoc` shartnomasini KIND bo'yicha
 * to'ldiradi: imzo, `GameBuildOpts` va `null` xulqi R0 da qulflangan,
 * bu yerda faqat saralash yo'li (`flashcards/engine.ts` naqshi).
 *
 * Bosqichlar (`onStage` foizlari — R0 rejasi):
 *   1 kirish       0→10   forma → `SortingInput`
 *   2 yozish      10→55   LLM: toifalar + elementlar (kerak bo'lsa +1 so'rov)
 *   3 qurish      55→75   model + `sections` (nasr)
 *   4 hisobot     75→90   `review.ts` (qoidalar + baholovchi)
 *   5 sayqal      90→96   `polish.ts`
 *
 * ── Ikki manba, bitta ro'yxat
 *
 * TUZILMA `doc.game.sorting` da, NASR esa `doc.sections` da
 * (`sortingSections`). Ikkalasi ham BITTA `SortingCategory[]` dan
 * quriladi va hech qachon mustaqil o'zgartirilmaydi: sayqal o'yinni
 * MODEL shaklida qayta yozadi va bo'limlarni shu yerdagi quruvchi
 * bilan QAYTA yig'adi (`polish.ts`).
 *
 * ── Nega aralash ro'yxat NASRDA saqlanadi
 *
 * Bosma varaqdagi elementlar ARALASH bo'lishi kerak (toifa bo'yicha
 * guruhlangan ro'yxat javobni oshkor qiladi), lekin aralashtirish
 * TASODIFIY bo'lsa, bitta hujjat har renderda boshqacha chiqardi:
 * DOCX bilan ko'ruvchi ajralib ketar va paritet testi tasodifan
 * qizarardi. Shuning uchun tartib DETERMINISTIK (`shuffleStable`,
 * urug' — elementlarning o'zi) va NATIJA nasrda yozilib qoladi: maket
 * uni qayta hisoblamaydi, o'qiydi.
 */
import type { FormValues } from "../../../types";
import type { AcademicDoc, Block, DocMeta, DocSection } from "../../types";
import type { CompleteFn } from "../../research/pipeline";
import { llmEnabled } from "../../llm";
import { CostMeter, complete as completeRole } from "../../llm-roles";
import { assertJobTime } from "../../deadline";
import { parseLlmObject } from "../../json";
import { remainingMs } from "../../quality";
import type { GameBuildOpts, GameBuilt } from "../engine";
import { gameTypeOf, type SortingTypeSpec } from "../registry";
import type { GameModel, SortingCategory, SortingModel } from "../types";
import { gameLayoutLabels, type GameDocLabels } from "../layout";
import { promisedItems, sortingInputFromValues, type SortingInput } from "./input";
import { sortingSystemPrompt, sortingUserPrompt, type SortingContext } from "./prompts";
import { reviewSorting } from "./review";
import { runSortingPolish, SORTING_ACCEPT_DELTA } from "./polish";

/* ────────────────────────── chegaralar ────────────────────────── */

/** Va'da qilingan elementlarning kamida shu ulushi kerak (`delivered` farqni qaytaradi). */
export const SORTING_FLOOR = 0.7;
/** Yetishmasa YANA BITTA so'rov — undan ortiq emas (byudjet chekli). */
export const SORTING_MAX_ROUNDS = 2;
/** Bitta toifali «saralash» o'yin emas — hamma element bitta tugmaga ketardi. */
export const SORTING_MIN_CATEGORIES = 2;
/**
 * Eng kichik ma'noli o'yin — 2 toifa × 3 element.
 *
 * Chegara `wantItems * SORTING_FLOOR` bilan BIRGA ishlaydi: kichik
 * buyurtmada (2 × 3 = 6) 70 % 5 ta bo'lardi, ya'ni bitta toifa ikki
 * elementli chiqib, o'yin kulgili ko'rinardi.
 */
export const SORTING_MIN_ITEMS = SORTING_MIN_CATEGORIES * 3;
const CALL_MS = 55_000;
const MIN_CALL_MS = 8_000;
export const SORTING_REVIEW_RESERVE_MS = 40_000;
export const SORTING_POLISH_RESERVE_MS = 55_000;

/* ────────────────────────── normalizatsiya ────────────────────────── */

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** Chegaradan uzun matnni SO'Z chegarasida kesadi (katakdan chiqmasin). */
export function clipWords(s: unknown, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trim();
}

/**
 * Taqqoslash kaliti — kichik harf, tinish belgisisiz.
 *
 * `uniqueItems` qoidasi, dublikat filtri va `itemSingleCategory`
 * evristikasi AYNI kalitdan foydalanadi: aks holda «Mushuk» bilan
 * «mushuk,» hisobotda dublikat bo'lib, dvigatelda esa ikki xil element
 * bo'lib qolardi.
 */
export function itemKey(s: string): string {
  return clean(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Barqaror aralashtirish — urug'i matnning O'ZI.
 *
 * `Math.random` YO'Q: bitta hujjat DOCX da ham, ko'ruvchida ham, qayta
 * render qilinganda ham AYNI tartibda chiqishi kerak.
 */
export function shuffleStable<T>(list: readonly T[], keyOf: (v: T) => string, seed: string): T[] {
  const hash = (s: string): number => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  return [...list]
    .map((v, i) => ({ v, i, h: hash(`${seed}:${keyOf(v)}`) }))
    .sort((a, b) => a.h - b.h || a.i - b.i)
    .map((x) => x.v);
}

export type PickSortingOpts = {
  spec: SortingTypeSpec;
  /** Toifadagi eng ko'p element (`SortingInput.itemsPerCategory`). */
  maxItems: number;
  /** Butun o'yin bo'yicha ko'rilgan element kalitlari (toifalar ORASIDA ham noyob). */
  seen: Set<string>;
  /** Ko'rilgan toifa nomlari — ikkinchi so'rov eskilarini qaytarmasin. */
  seenNames?: Set<string>;
};

/**
 * LLM javobidagi ro'yxat → yaroqli toifalar.
 *
 * Yaroqsiz element JIMGINA tashlanadi (bo'sh nom, juda qisqa element,
 * dublikat) — bitta buzuq band butun javobni yo'qqa chiqarmasin
 * (`pickCards` naqshi). Kam chiqqani `delivered` da ko'rinadi va farq
 * qaytariladi.
 *
 * `id` bu yerda BERILMAYDI: toifalar keyin birlashtiriladi va id lar
 * FAQAT yakuniy ro'yxatda, tartib bo'yicha qo'yiladi (`numbered`) —
 * aks holda ikkinchi so'rovdan kelgan toifa `s1` bo'lib, birinchisi
 * bilan to'qnashardi va ball hisobi (`lib/game/score.ts`) o'sha id ga
 * tayanadi.
 */
export function pickCategories(raw: unknown, o: PickSortingOpts): { name: string; items: string[] }[] {
  if (!Array.isArray(raw)) return [];
  const [nameMin, nameMax] = o.spec.limits.nameChars;
  const [itemMin, itemMax] = o.spec.limits.itemChars;
  const seenNames = o.seenNames ?? new Set<string>();
  const out: { name: string; items: string[] }[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const name = clipWords(r.name ?? r.category ?? r.title, nameMax).replace(/[.;:,]+$/, "").trim();
    if (name.length < nameMin) continue;
    const nameKey = itemKey(name);
    if (!nameKey || seenNames.has(nameKey)) continue;
    const rawItems = Array.isArray(r.items) ? r.items : Array.isArray(r.words) ? r.words : [];
    const items: string[] = [];
    for (const it of rawItems) {
      if (items.length >= o.maxItems) break;
      const text = clipWords(typeof it === "object" && it ? (it as Record<string, unknown>).text : it, itemMax).replace(/[.;:,]+$/, "").trim();
      if (text.length < itemMin) continue;
      const key = itemKey(text);
      /*
       * Element toifa NOMI bilan bir xil bo'lsa ham tashlanadi:
       * «Qushlar» toifasidagi «qushlar» elementi o'yinni ma'nosiz
       * qiladi va `itemSingleCategory` evristikasi uni har doim
       * ikki ma'noli deb belgilardi.
       */
      if (!key || o.seen.has(key) || key === nameKey) continue;
      o.seen.add(key);
      items.push(text);
    }
    if (!items.length) continue;
    seenNames.add(nameKey);
    out.push({ name, items });
  }
  return out;
}

/** Toifalarga barqaror id berish — `s1`, `s2`, … (tartib bo'yicha). */
export function numbered(cats: readonly { name: string; items: string[] }[]): SortingCategory[] {
  return cats.map((c, i) => ({ id: `s${i + 1}`, name: c.name, items: [...c.items] }));
}

/* ────────────────────────── nasr ────────────────────────── */

/** Barcha elementlar — ARALASH tartibda (bosma varaqdagi ro'yxat). */
export function shuffledItems(model: SortingModel): string[] {
  const flat = model.categories.flatMap((c) => c.items);
  return shuffleStable(flat, (t) => itemKey(t), model.categories.map((c) => c.name).join("|"));
}

/**
 * Model → hujjat NASRI (`doc.sections`).
 *
 *   `intro`    ko'rsatma (maket uni `note` bilan chizadi);
 *   `sorting`  ARALASH elementlar ro'yxati (`li`) — maket shundan
 *              keyin BO'SH toifalar jadvalini qo'yadi;
 *   `answers`  javob kaliti: toifa → elementlari (yangi betdan).
 *
 * Bo'lim id lari `layout.ts SORTING_SECTIONS` da qulflangan.
 */
export function sortingSections(model: SortingModel, L: GameDocLabels): DocSection[] {
  const items = shuffledItems(model);
  const intro: Block[] = [{ kind: "p", text: L.sortHint(model.categories.length, items.length) }];
  const sorting: Block[] = items.map((t) => ({ kind: "li", text: t }));
  const answers: Block[] = [
    { kind: "p", text: L.keyHint },
    ...model.categories.map((c): Block => ({ kind: "li", text: L.categoryLine(c.name, c.items) })),
  ];
  return [
    { id: "intro", title: L.sectionTitle.intro, blocks: intro },
    { id: "sorting", title: L.sectionTitle.sorting, blocks: sorting },
    { id: "answers", title: L.sectionTitle.answers, blocks: answers },
  ];
}

/* ────────────────────────── dvigatel ────────────────────────── */

export async function buildSortingDoc(meta: DocMeta, values: FormValues, opts: GameBuildOpts): Promise<GameBuilt | null> {
  const complete: CompleteFn = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) {
    console.warn("[sorting] LLM o'chiq — null");
    return null;
  }

  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  stage(0, "Ma’lumotlar tayyorlanmoqda");
  const input: SortingInput = sortingInputFromValues(meta, values);
  const spec = gameTypeOf("sorting", input.type);
  const ctx: SortingContext = { spec, input };
  const L = gameLayoutLabels(input.language);
  const system = sortingSystemPrompt(ctx);

  const ask = async (user: string, maxTokens: number): Promise<string | null> => {
    const timeoutMs = Math.min(CALL_MS, remainingMs(deadline));
    if (timeoutMs < MIN_CALL_MS) {
      // Ish muddati tugagan (EXT-03) — asosiy yozuv: yarim o'yin emas, `DeadlineError`.
      assertJobTime(deadline, "sorting:writer", MIN_CALL_MS);
      console.warn(`[sorting] byudjet tugadi: ${timeoutMs} ms qoldi`);
      return null;
    }
    const r = await complete("writer", system, user, { json: true, maxTokens, timeoutMs, deadline });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };

  /* ── yozish ── */
  stage(10, "Toifalar yozilmoqda");
  const wantItems = promisedItems(values);
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const cats: { name: string; items: string[] }[] = [];
  assertJobTime(deadline, "sorting:writer", MIN_CALL_MS);
  const writeDeadline = deadline - (opts.polish === false ? SORTING_REVIEW_RESERVE_MS : SORTING_REVIEW_RESERVE_MS + SORTING_POLISH_RESERVE_MS);
  const total = () => cats.reduce((n, c) => n + c.items.length, 0);

  for (let round = 0; round < SORTING_MAX_ROUNDS; round++) {
    const missing = input.categoryCount - cats.length;
    const thin = cats.some((c) => c.items.length < input.itemsPerCategory);
    if (round > 0 && missing <= 0 && !thin) break;
    if (remainingMs(writeDeadline) < MIN_CALL_MS) {
      console.warn(`[sorting] yozish byudjeti tugadi: ${remainingMs(writeDeadline)} ms`);
      break;
    }
    /*
     * IKKINCHI so'rovda YETISHMAGAN toifalar so'raladi (yoki hech bo'lmasa
     * bittasi, agar faqat elementlar kam bo'lsa): model allaqachon
     * berilgan nomlarni takrorlamasin — `seenNames` filtri ularni
     * baribir tashlardi va so'rov behuda ketardi.
     */
    const askFor = round === 0 ? input.categoryCount : Math.max(1, missing);
    const already = cats.flatMap((c) => c.items);
    const raw = await ask(sortingUserPrompt(ctx, askFor, already), Math.min(8000, 900 + askFor * input.itemsPerCategory * 40));
    const data = parseLlmObject<{ categories?: unknown; groups?: unknown }>(raw);
    const batch = pickCategories(data?.categories ?? data?.groups, { spec, maxItems: input.itemsPerCategory, seen, seenNames });
    // Model progress bermay qo'ydi — yana so'rash foydasiz.
    if (!batch.length) break;
    cats.push(...batch);
    stage(Math.min(55, 15 + Math.round((total() / Math.max(1, wantItems)) * 40)), `Elementlar: ${Math.min(total(), wantItems)}/${wantItems}`);
  }

  const picked = numbered(cats.slice(0, input.categoryCount));
  const got = picked.reduce((n, c) => n + c.items.length, 0);
  const floor = Math.max(SORTING_MIN_ITEMS, Math.ceil(wantItems * SORTING_FLOOR));
  if (picked.length < SORTING_MIN_CATEGORIES || got < floor) {
    console.warn(`[games] saralash: ${picked.length} toifa / ${got} element, kerak ~${input.categoryCount} × ${input.itemsPerCategory}`);
    return null;
  }

  /* ── qurish ── */
  stage(55, "Varaq tayyorlanmoqda");
  const sortingModel: SortingModel = { categories: picked };
  const docMeta: DocMeta = { ...meta, language: input.language, topic: input.topic || meta.topic, subject: input.subject };
  const model: GameModel = {
    v: 1,
    kind: "sorting",
    type: input.type,
    language: input.language,
    topic: input.topic || meta.topic,
    sorting: sortingModel,
  };
  let doc: AcademicDoc = {
    meta: docMeta,
    // Titul beti YO'Q: birinchi bet — o'yin varag'ining O'ZI (`gameProfile`).
    titlePage: false,
    toc: false,
    sections: sortingSections(sortingModel, L),
    game: model,
  };

  /* ── hisobot ── */
  stage(75, "Tayyorlik hisoboti");
  const judge = opts.judge !== false;
  let review = await reviewSorting(doc, { complete, deadline, judge, now, onUsage: opts.onUsage });
  model.review = review;

  /* ── avto-sayqal ── */
  if (opts.polish !== false && remainingMs(deadline) > SORTING_POLISH_RESERVE_MS) {
    stage(90, "Avto-sayqal");
    const res = await runSortingPolish(doc, review, {
      complete,
      deadline,
      judge,
      now,
      acceptDelta: SORTING_ACCEPT_DELTA,
      ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
    });
    doc = res.doc;
    review = res.review;
    const target = doc.game ?? model;
    target.review = review;
    target.polish = res.log;
    if (review.userNeeds?.length) target.userNeeds = review.userNeeds;
    doc = { ...doc, game: target };
  } else {
    model.userNeeds = review.userNeeds ?? [];
  }

  stage(96, "Tayyor");
  const cost = meter.toJson();
  opts.onCost?.(cost);
  const delivered = (doc.game?.sorting?.categories ?? picked).reduce((n, c) => n + c.items.length, 0);
  return { doc, cost, delivered: { got: delivered, want: wantItems, unit: "element" } };
}
