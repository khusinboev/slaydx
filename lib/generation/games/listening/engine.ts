/**
 * TINGLASH O'YINI DVIGATELI (AUDIT-22 WP-D) — `buildListeningDoc`.
 *
 * Bosqichlar (`onStage` foizlari — R0 rejasi):
 *   1 kirish       0→10   forma → `ListeningInput`
 *   2 yozish      10→50   LLM: so'z + tarjima + distraktorlar
 *   3 audio       50→70   TTS parchalari (SEAM — kalitlar bo'lsa)
 *   4 qurish      70→75   model + `sections` (nasr)
 *   5 hisobot     75→90   `review.ts`
 *   6 sayqal      90→96   `polish.ts`
 *
 * ── Eshitiladigan matn BOSMA varaqda YO'Q
 *
 * `sections.items` faqat RAQAM va VARIANTLARni beradi; so'zning o'zi
 * javob kalitida (`answers`, yangi betdan) turadi. Bu bosma versiyaning
 * MOHIYATI: o'qituvchi so'zni ovoz chiqarib o'qiydi, o'quvchi esa
 * eshitganini tanlaydi. Agar so'z varaqda bosilsa, mashq tinglash emas,
 * O'QISH bo'lib qolardi — va audio kalitlari kelganda (`tts.md` §6)
 * bosma versiya interaktiv rejimga zid ishlardi.
 *
 * ── TTS — SEAM, bog'liqlik emas
 *
 * `opts.tts` berilmasa (bugungi holat: kalitlar yo'q) dvigatel AUDIOSIZ
 * ishlaydi va `ListeningItem.audioAssetId` bo'sh qoladi. Berilsa —
 * har `text` uchun bitta parcha sintez qilinadi va `opts.putAsset`
 * orqali aktivga chiqariladi. Bitta parcha yiqilsa QOLGANLARI davom
 * etadi: audiosiz topshiriq bosma varaqda baribir ishlaydi, butun
 * hujjatni yo'qotish esa foydalanuvchi uchun ancha qimmat.
 */
import type { FormValues } from "../../../types";
import type { AcademicDoc, Block, DocMeta, DocSection } from "../../types";
import type { CompleteFn } from "../../research/pipeline";
import { llmEnabled } from "../../llm";
import { CostMeter, complete as completeRole } from "../../llm-roles";
import { assertJobTime } from "../../deadline";
import { parseLlmObject } from "../../json";
import { remainingMs } from "../../quality";
import { langInfo } from "../../i18n";
import { audioBytes, formatVoiceId, ttsVoiceFor } from "../../tts/types";
import type { GameBuildOpts, GameBuilt } from "../engine";
import { gameTypeOf, type ListeningTypeSpec } from "../registry";
import type { GameModel, ListeningItem, ListeningModel } from "../types";
import { gameLayoutLabels, type GameDocLabels } from "../layout";
import { listeningInputFromValues, type ListeningInput } from "./input";
import { listeningSystemPrompt, listeningUserPrompt, type ListeningContext } from "./prompts";
import { reviewListening } from "./review";
import { runListeningPolish, LISTENING_ACCEPT_DELTA } from "./polish";

/* ────────────────────────── chegaralar ────────────────────────── */

/** Va'da qilingan topshiriqlarning kamida shu ulushi kerak. */
export const LISTENING_FLOOR = 0.7;
/** Yetishmasa YANA BITTA so'rov — undan ortiq emas. */
export const LISTENING_MAX_ROUNDS = 2;
const CALL_MS = 55_000;
const MIN_CALL_MS = 8_000;
/** Bitta TTS parchasi uchun eng ko'p kutish (so'z/ibora — qisqa). */
export const TTS_ITEM_MS = 15_000;
export const LISTENING_REVIEW_RESERVE_MS = 40_000;
export const LISTENING_POLISH_RESERVE_MS = 55_000;
/** Bitta so'rovda so'raladigan eng ko'p topshiriq (`listeningCountMax` + zaxira). */
const LISTENING_ASK_MAX = 22;
/** Eng kichik ma'noli to'plam — undan pastda mashq o'yin emas. */
const LISTENING_MIN_ITEMS = 5;

/* ────────────────────────── normalizatsiya ────────────────────────── */

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** Chegaradan uzun matnni SO'Z chegarasida kesadi. */
export function clipWords(s: unknown, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trim();
}

/** Taqqoslash kaliti — kichik harf, tinish belgisisiz (`uniqueItems`/`uniqueOptions`). */
export function textKey(s: string): string {
  return clean(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type PickListeningOpts = {
  spec: ListeningTypeSpec;
  /** Variantlar soni (to'g'ri javob + distraktorlar). */
  optionCount: number;
  /** Ko'rilgan eshitiladigan matnlar — to'plamda takror bo'lmasin. */
  seen: Set<string>;
};

/**
 * LLM javobidagi ro'yxat → yaroqli topshiriqlar.
 *
 * To'g'ri javob MATN sifatida keladi va bu yerda INDEKSGA aylanadi:
 * variantlar «javob + distraktorlar» tartibida yig'iladi, so'ng
 * BARQAROR tartibda aralashtiriladi — to'g'ri javob har doim birinchi
 * turgan to'plamda o'quvchi qoidani bir necha topshiriqdan keyin
 * payqab qolardi va o'yin tugardi.
 *
 * Yaroqsiz topshiriq JIMGINA tashlanadi (bo'sh matn, javob yo'q, yetarli
 * distraktor yo'q, dublikat) — bitta buzuq band butun javobni yo'qqa
 * chiqarmasin.
 */
export function pickItems(raw: unknown, o: PickListeningOpts): ListeningItem[] {
  if (!Array.isArray(raw)) return [];
  const [textMin, textMax] = o.spec.limits.textChars;
  const out: ListeningItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const text = clipWords(r.text ?? r.word ?? r.phrase, textMax);
    if (text.length < textMin) continue;
    const key = textKey(text);
    if (!key || o.seen.has(key)) continue;

    const answer = clipWords(r.answer ?? r.translation ?? r.correct, textMax);
    if (!answer) continue;
    const rawWrong = Array.isArray(r.distractors) ? r.distractors : Array.isArray(r.options) ? r.options : [];
    const options = [answer];
    const optionKeys = new Set([textKey(answer)]);
    for (const w of rawWrong) {
      if (options.length >= o.optionCount) break;
      const t = clipWords(w, textMax);
      const k = textKey(t);
      // To'g'ri javobning takrori distraktor bo'la olmaydi — o'shanda
      // topshiriqning IKKI to'g'ri javobi bo'lardi (`uniqueOptions`).
      if (!t || !k || optionKeys.has(k)) continue;
      optionKeys.add(k);
      options.push(t);
    }
    if (options.length < o.spec.limits.options[0]) continue;

    o.seen.add(key);
    const id = `l${o.seen.size}`;
    const order = stableOrder(options.length, id);
    const shuffled = order.map((i) => options[i]);
    out.push({ id, text, options: shuffled, answer: order.indexOf(0) });
  }
  return out;
}

/**
 * Variantlarning BARQAROR tartibi — urug'i topshiriq id si.
 *
 * `Math.random` YO'Q: hujjat qayta render qilinganda javob kaliti bilan
 * varaqdagi harflar mos kelishi shart.
 */
export function stableOrder(n: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/* ────────────────────────── audio (SEAM) ────────────────────────── */

export type SynthDeps = Pick<GameBuildOpts, "tts" | "putAsset" | "deadline">;

/**
 * Har topshiriq uchun TTS parchasi → aktiv id.
 *
 * Seam bo'sh bo'lsa (kalit yo'q, `putAsset` yo'q) ro'yxat O'ZGARMAY
 * qaytadi — bu bugungi standart yo'l va u SINALADI (`listening-engine`
 * testi ikkala shoxni ham yuradi).
 */
export async function attachAudio(items: ListeningItem[], lang: string, deps: SynthDeps): Promise<ListeningItem[]> {
  const { tts, putAsset } = deps;
  if (!tts || !putAsset || !tts.configured()) return items;
  const voice = ttsVoiceFor(lang);
  const out: ListeningItem[] = [];
  for (const it of items) {
    if (remainingMs(deps.deadline) < TTS_ITEM_MS) {
      // Byudjet tugadi — QOLGANLARI audiosiz qoladi, hujjat esa chiqadi.
      out.push(it);
      continue;
    }
    try {
      const audio = await tts.synthesize(it.text, { lang, voice: formatVoiceId(voice) });
      const bytes = audioBytes(audio);
      if (!bytes) {
        out.push(it);
        continue;
      }
      const assetId = await putAsset(bytes.bytes, bytes.format === "mp3" ? "audio/mpeg" : "audio/wav");
      out.push(assetId ? { ...it, audioAssetId: assetId } : it);
    } catch (e) {
      console.warn(`[listening] TTS parchasi yiqildi («${it.text}»):`, e instanceof Error ? e.message : e);
      out.push(it);
    }
  }
  return out;
}

/* ────────────────────────── nasr ────────────────────────── */

/**
 * Model → hujjat NASRI (`doc.sections`).
 *
 *   `intro`    ko'rsatma (maket uni `note` bilan chizadi);
 *   `items`    RAQAM + VARIANTLAR — eshitiladigan matn ATAYLAB yo'q;
 *   `answers`  javob kaliti: so'z — tarjima (harfi bilan), yangi betdan.
 *
 * Bo'lim id lari `layout.ts LISTENING_SECTIONS` da qulflangan.
 */
export function listeningSections(model: ListeningModel, L: GameDocLabels, targetName: string): DocSection[] {
  const intro: Block[] = [{ kind: "p", text: L.listenHint(targetName, model.items.length) }];
  /*
   * Qatorlar `li` EMAS, `p`: ular allaqachon RAQAMLANGAN («1.», «2.»)
   * va marker qo'shilsa bosma varaqda «• 1.» bo'lib IKKI marta
   * belgilanardi (LibreOffice ko'z tekshiruvi, AUDIT-22). Raqamni
   * markerga almashtirib ham bo'lmaydi: o'qituvchi so'zlarni AYNAN shu
   * tartibda o'qiydi va javob kaliti ham shu raqamga ishora qiladi.
   */
  const items: Block[] = model.items.map((it, n) => ({
    kind: "p",
    text: L.itemLine(n + 1, it.options.map((o, i) => `${L.optionLabel(i)}) ${o}`)),
  }));
  const answers: Block[] = [
    { kind: "p", text: L.keyHint },
    ...model.items.map((it, n): Block => ({ kind: "p", text: L.answerLine(n + 1, it.text, it.options[it.answer] ?? "", L.optionLabel(it.answer)) })),
  ];
  return [
    { id: "intro", title: L.sectionTitle.intro, blocks: intro },
    { id: "items", title: L.sectionTitle.items, blocks: items },
    { id: "answers", title: L.sectionTitle.answers, blocks: answers },
  ];
}

/* ────────────────────────── dvigatel ────────────────────────── */

export async function buildListeningDoc(meta: DocMeta, values: FormValues, opts: GameBuildOpts): Promise<GameBuilt | null> {
  const complete: CompleteFn = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) {
    console.warn("[listening] LLM o'chiq — null");
    return null;
  }

  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  stage(0, "Ma’lumotlar tayyorlanmoqda");
  const input: ListeningInput = listeningInputFromValues(meta, values);
  const spec = gameTypeOf("listening", input.type);
  const ctx: ListeningContext = { spec, input };
  const L = gameLayoutLabels(input.nativeLanguage);
  const system = listeningSystemPrompt(ctx);

  const ask = async (user: string, maxTokens: number): Promise<string | null> => {
    const timeoutMs = Math.min(CALL_MS, remainingMs(deadline));
    if (timeoutMs < MIN_CALL_MS) {
      // Ish muddati tugagan (EXT-03) — asosiy yozuv: yarim o'yin emas, `DeadlineError`.
      assertJobTime(deadline, "listening:writer", MIN_CALL_MS);
      console.warn(`[listening] byudjet tugadi: ${timeoutMs} ms qoldi`);
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
  stage(10, "So‘zlar tanlanmoqda");
  const want = input.itemCount;
  const seen = new Set<string>();
  const items: ListeningItem[] = [];
  assertJobTime(deadline, "listening:writer", MIN_CALL_MS);
  const writeDeadline = deadline - (opts.polish === false ? LISTENING_REVIEW_RESERVE_MS : LISTENING_REVIEW_RESERVE_MS + LISTENING_POLISH_RESERVE_MS);

  for (let round = 0; round < LISTENING_MAX_ROUNDS && items.length < want; round++) {
    if (remainingMs(writeDeadline) < MIN_CALL_MS) {
      console.warn(`[listening] yozish byudjeti tugadi: ${remainingMs(writeDeadline)} ms`);
      break;
    }
    const need = want - items.length;
    // IKKINCHI so'rovda biroz ORTIQCHA: qaysi topshiriq tushib qolishi
    // (dublikat, yetarli distraktor yo'q) oldindan ma'lum emas.
    const askFor = Math.min(LISTENING_ASK_MAX, round === 0 ? need : need + 2);
    const raw = await ask(listeningUserPrompt(ctx, askFor, items.map((i) => i.text)), Math.min(8000, 900 + askFor * 130));
    const data = parseLlmObject<{ items?: unknown; pairs?: unknown }>(raw);
    const batch = pickItems(data?.items ?? data?.pairs, { spec, optionCount: input.optionCount, seen });
    if (!batch.length) break;
    items.push(...batch);
    stage(Math.min(50, 15 + Math.round((items.length / want) * 35)), `So‘zlar: ${Math.min(items.length, want)}/${want}`);
  }

  const floor = Math.max(LISTENING_MIN_ITEMS, Math.ceil(want * LISTENING_FLOOR));
  if (items.length < floor) {
    console.warn(`[games] tinglash: ${items.length} topshiriq, kerak ~${want}`);
    return null;
  }

  /* ── audio (seam) ── */
  stage(50, "Audio tayyorlanmoqda");
  const picked = await attachAudio(items.slice(0, want), input.targetLanguage, opts);

  /* ── qurish ── */
  stage(70, "Varaq tayyorlanmoqda");
  const listeningModel: ListeningModel = { items: picked, nativeLanguage: input.nativeLanguage, targetLanguage: input.targetLanguage };
  const docMeta: DocMeta = { ...meta, language: input.nativeLanguage, topic: input.topic || meta.topic, subject: input.subject };
  const model: GameModel = {
    v: 1,
    kind: "listening",
    type: input.type,
    language: input.nativeLanguage,
    topic: input.topic || meta.topic,
    listening: listeningModel,
  };
  let doc: AcademicDoc = {
    meta: docMeta,
    titlePage: false,
    toc: false,
    sections: listeningSections(listeningModel, L, langInfo(input.targetLanguage).native),
    game: model,
  };

  /* ── hisobot ── */
  stage(75, "Tayyorlik hisoboti");
  const judge = opts.judge !== false;
  let review = await reviewListening(doc, { complete, deadline, judge, now, onUsage: opts.onUsage });
  model.review = review;

  /* ── avto-sayqal ── */
  if (opts.polish !== false && remainingMs(deadline) > LISTENING_POLISH_RESERVE_MS) {
    stage(90, "Avto-sayqal");
    const res = await runListeningPolish(doc, review, {
      complete,
      deadline,
      judge,
      now,
      acceptDelta: LISTENING_ACCEPT_DELTA,
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
  return {
    doc,
    cost,
    delivered: { got: doc.game?.listening?.items.length ?? picked.length, want, unit: "topshiriq" },
  };
}
