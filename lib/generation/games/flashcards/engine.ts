/**
 * FLESH KARTALAR DVIGATELI (AUDIT-21 WP-B) — `buildFlashcardsDoc`.
 *
 * `games/engine.ts` (WP-A) ning `buildGameDoc` shartnomasini KIND
 * bo'yicha to'ldiradi: imzo, `GameBuildOpts` va `null` xulqi R0 da
 * qulflangan, bu yerda faqat flesh kartalar yo'li.
 *
 * Bosqichlar (`onStage` foizlari — R0 rejasi):
 *   1 kirish       0→10   forma → `FlashcardsInput`
 *   2 yozish      10→55   LLM: karta juftliklari (kerak bo'lsa +1 so'rov)
 *   3 qurish      55→75   model + `sections` (nasr)
 *   4 hisobot     75→90   `review.ts` (qoidalar + baholovchi)
 *   5 sayqal      90→96   `polish.ts`
 *
 * ── Ikki manba, bitta ro'yxat
 *
 * TUZILMA `doc.game.cards` da, NASR esa `doc.sections` da
 * (`cardSections`). Ikkalasi ham BITTA `Flashcard[]` dan quriladi va
 * hech qachon mustaqil o'zgartirilmaydi: sayqal kartani MODEL shaklida
 * qayta yozadi va bo'limni shu yerdagi quruvchi bilan QAYTA yig'adi
 * (`polish.ts`). Nasrni alohida tahrirlash yo'li ataylab yo'q — u
 * ko'ruvchida umuman chizilmaydi (`planGame` kartani modeldan chizadi),
 * ya'ni ikki nusxa jimgina ajralib ketardi.
 *
 * `null` — dvigatel ishlamadi (LLM kalitsiz muhit, model javob bermadi,
 * sifat darvozasidan o'tmadi). `write-llm.ts` shunda `null` qaytaradi va
 * `buildArtifact` MAVJUD xulqni beradi (kredit qaytadi).
 */
import type { FormValues } from "../../../types";
import type { AcademicDoc, Block, DocMeta, DocSection } from "../../types";
import type { CompleteFn } from "../../research/pipeline";
import { llmEnabled } from "../../llm";
import { CostMeter, complete as completeRole } from "../../llm-roles";
import { parseLlmObject } from "../../json";
import { remainingMs } from "../../quality";
import type { GameBuildOpts, GameBuilt } from "../engine";
import { gameTypeOf, type CardsTypeSpec } from "../registry";
import { GAME_LIMITS, type Flashcard, type FlashcardsModel, type GameModel } from "../types";
import { gameLayoutLabels, type GameDocLabels } from "../layout";
import { flashcardsInputFromValues, type FlashcardsInput } from "./input";
import { cardsSystemPrompt, cardsUserPrompt, type FlashcardsContext } from "./prompts";
import { reviewFlashcards } from "./review";
import { runFlashcardsPolish, FLASHCARDS_ACCEPT_DELTA } from "./polish";

/* ────────────────────────── chegaralar ────────────────────────── */

/** Va'da qilingan kartalarning kamida shu ulushi kerak (`delivered` farqni qaytaradi). */
export const CARDS_FLOOR = 0.7;
/** Yetishmasa YANA BITTA so'rov — undan ortiq emas (byudjet chekli). */
export const CARDS_MAX_ROUNDS = 2;
const CALL_MS = 55_000;
const MIN_CALL_MS = 8_000;
export const CARDS_REVIEW_RESERVE_MS = 40_000;
export const CARDS_POLISH_RESERVE_MS = 55_000;

/* ────────────────────────── normalizatsiya ────────────────────────── */

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Chegaradan uzun matnni SO'Z chegarasida kesadi.
 *
 * Belgi bo'yicha kesish so'zni ikkiga bo'lardi («jarayo»), bu esa
 * kartada eng ko'rinadigan nuqson. Kesilgan karta baribir hisobotda
 * `backLength` bandi bilan ko'rinadi va sayqal uni qayta yozadi —
 * lekin FAYLDAGI matn hech qachon katakdan chiqib ketmaydi.
 */
export function clipWords(s: unknown, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trim();
}

/** Dublikat kaliti: kichik harf, tinish belgisisiz (`noDuplicate` bilan BIR XIL qoida). */
export function frontKey(front: string): string {
  return clean(front)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type PickCardsOpts = { spec: CardsTypeSpec; includeExample: boolean; seen: Set<string> };

/**
 * LLM javobidagi ro'yxat → yaroqli kartalar.
 *
 * Yaroqsiz karta JIMGINA tashlanadi (bo'sh yuz, juda qisqa old yuz,
 * juda qisqa orqa yuz, dublikat) — bitta buzuq element butun javobni
 * yo'qqa chiqarmasin (`pickTerms` naqshi). Kam chiqqani `delivered` da
 * ko'rinadi va farq qaytariladi.
 */
export function pickCards(raw: unknown, o: PickCardsOpts): Flashcard[] {
  if (!Array.isArray(raw)) return [];
  const [frontMin, frontMax] = o.spec.limits.frontChars;
  const [backMin, backMax] = o.spec.limits.backChars;
  const out: Flashcard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    let front = clipWords(r.front ?? r.term ?? r.question, frontMax);
    const back = clipWords(r.back ?? r.def ?? r.definition ?? r.answer, backMax);
    /*
     * Atama–ta'rif turida old yuz OXIRIDAGI nuqta olib tashlanadi
     * (reyestr `guidance`: «no trailing punctuation»). Savol–javobda
     * esa tegilmaydi: u yerda oxirgi belgi «?» bo'lishi KERAK va uni
     * `cardTypeMatch` bandi tekshiradi.
     */
    if (o.spec.cardType === "term-def") front = front.replace(/[.;:,]+$/, "").trim();
    if (front.length < frontMin || back.length < backMin) continue;
    const key = frontKey(front);
    if (!key || o.seen.has(key)) continue;
    o.seen.add(key);
    const example = o.includeExample ? clipWords(r.example ?? r.sample, GAME_LIMITS.cardExampleCharsMax) : "";
    out.push({ id: `c${o.seen.size}`, front, back, ...(example ? { example } : {}) });
  }
  return out;
}

/* ────────────────────────── nasr ────────────────────────── */

/**
 * Model → hujjat NASRI (`doc.sections`).
 *
 * Har karta: `h3` old yuz + `p` orqa yuz (+ `p` misol). Bu matn
 * ko'ruvchida ham, DOCX da ham CHIZILMAYDI — maket kartani modeldan
 * chizadi — lekin hisobot, baholovchi, qidiruv va hujjat hajmi aynan
 * shu bo'limni o'qiydi. Shakl glossariy `glossaryTermBlocks` niki bilan
 * bir xil, chunki savol ham, atama ham bir xil ishni bajaradi.
 */
export function cardSections(model: FlashcardsModel, L: GameDocLabels): DocSection[] {
  const blocks: Block[] = [];
  for (const c of model.cards) {
    blocks.push({ kind: "h3", text: c.front });
    blocks.push({ kind: "p", text: c.back });
    if (c.example) blocks.push({ kind: "p", text: `${L.example}: ${c.example}` });
  }
  return [{ id: "cards", title: L.sectionTitle.cards, blocks }];
}

/* ────────────────────────── dvigatel ────────────────────────── */

/**
 * Flesh kartalar hujjati. `games/engine.ts buildGameDoc` (WP-A) bu
 * funksiyani `kind === "flashcards"` shoxida chaqiradi; imzo
 * `GameBuilder` bilan AYNI, shuning uchun u yerda moslashtiruvchi
 * qatlam kerak emas.
 */
export async function buildFlashcardsDoc(meta: DocMeta, values: FormValues, opts: GameBuildOpts): Promise<GameBuilt | null> {
  const complete: CompleteFn = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;

  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  stage(0, "Ma’lumotlar tayyorlanmoqda");
  const input: FlashcardsInput = flashcardsInputFromValues(meta, values);
  const spec = gameTypeOf("flashcards", input.type);
  const ctx: FlashcardsContext = { spec, input };
  const L = gameLayoutLabels(input.language);
  const system = cardsSystemPrompt(ctx);

  const ask = async (user: string, maxTokens: number): Promise<string | null> => {
    const timeoutMs = Math.min(CALL_MS, remainingMs(deadline));
    if (timeoutMs < MIN_CALL_MS) return null;
    const r = await complete("writer", system, user, { json: true, maxTokens, timeoutMs });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };

  /* ── yozish ── */
  stage(10, "Kartalar yozilmoqda");
  const want = input.cardCount;
  const seen = new Set<string>();
  const cards: Flashcard[] = [];
  const writeDeadline = deadline - (opts.polish === false ? CARDS_REVIEW_RESERVE_MS : CARDS_REVIEW_RESERVE_MS + CARDS_POLISH_RESERVE_MS);

  for (let round = 0; round < CARDS_MAX_ROUNDS && cards.length < want; round++) {
    if (remainingMs(writeDeadline) < MIN_CALL_MS) break;
    const need = want - cards.length;
    /*
     * IKKINCHI so'rovda biroz ORTIQCHA so'raladi: birinchi aylanishda
     * qaysi kartalar tushib qolgani (dublikat, qisqa ta'rif) oldindan
     * ma'lum emas, ya'ni aniq `need` ta so'rash yana kam qaytishi mumkin.
     */
    const askFor = Math.min(GAME_LIMITS.countMax, round === 0 ? need : need + 2);
    const raw = await ask(cardsUserPrompt(ctx, askFor, cards.map((c) => c.front)), Math.min(8000, 900 + askFor * 160));
    const data = parseLlmObject<{ cards?: unknown; items?: unknown }>(raw);
    const batch = pickCards(data?.cards ?? data?.items, { spec, includeExample: input.includeExample, seen });
    // Model progress bermay qo'ydi — yana so'rash foydasiz.
    if (!batch.length) break;
    cards.push(...batch);
    stage(Math.min(55, 15 + Math.round((cards.length / want) * 40)), `Kartalar: ${Math.min(cards.length, want)}/${want}`);
  }

  const floor = Math.max(GAME_LIMITS.countMin, Math.ceil(want * CARDS_FLOOR));
  if (cards.length < floor) {
    console.warn(`[games] flesh kartalar: ${cards.length} karta, kerak ~${want}`);
    return null;
  }

  /* ── qurish ── */
  stage(55, "Varaqlar tayyorlanmoqda");
  const picked = cards.slice(0, want);
  const cardsModel: FlashcardsModel = { type: input.cardType, cards: picked, includeExample: input.includeExample };
  const docMeta: DocMeta = { ...meta, language: input.language, topic: input.topic || meta.topic, subject: input.subject };
  const model: GameModel = {
    v: 1,
    kind: "flashcards",
    type: input.type,
    language: input.language,
    topic: input.topic || meta.topic,
    cards: cardsModel,
  };
  let doc: AcademicDoc = {
    meta: docMeta,
    // Titul beti YO'Q: birinchi bet — kartalarning O'ZI (`gameProfile`).
    titlePage: false,
    toc: false,
    sections: cardSections(cardsModel, L),
    game: model,
  };

  /* ── hisobot ── */
  stage(75, "Tayyorlik hisoboti");
  const judge = opts.judge !== false;
  let review = await reviewFlashcards(doc, { complete, deadline, judge, now, onUsage: opts.onUsage });
  model.review = review;

  /* ── avto-sayqal ── */
  if (opts.polish !== false && remainingMs(deadline) > CARDS_POLISH_RESERVE_MS) {
    stage(90, "Avto-sayqal");
    const res = await runFlashcardsPolish(doc, review, {
      complete,
      deadline,
      judge,
      now,
      acceptDelta: FLASHCARDS_ACCEPT_DELTA,
      ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
    });
    doc = res.doc;
    review = res.review;
    // Sayqal hujjatni ALMASHTIRGAN bo'lishi mumkin — model o'sha nusxada.
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
  return {
    doc,
    cost,
    delivered: { got: doc.game?.cards?.cards.length ?? picked.length, want, unit: "karta" },
  };
}
