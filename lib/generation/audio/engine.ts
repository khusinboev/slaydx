/**
 * AUDIO DVIGATELI (AUDIT-22 WP-A) — `buildAudioArtifact`.
 *
 * R0 SHARTNOMASI saqlanadi: imzo `(tool, meta, values, opts) →
 * BuiltFile | null` o'zgarmadi; bu faylda TANA to'ldi.
 *
 * Nega `BuiltFile` (boshqa oilalardagi `AcademicDoc` emas): chiqish
 * DOCX emas, MP3 — `renderDocx` yo'li bu oilaga tegishli emas
 * (`infographic`/`image` bilan ayni naqsh).
 *
 * Bosqichlar (`onStage` foizlari, R0 rejasidan):
 *   1 kirish       0→8    forma → `AudioInput` (rejim, janr, daqiqa)
 *   2 ssenariy     8→45   LLM: skelet bo'yicha replikalar (150 so'z/daq)
 *   3 hisobot     45→60   `review.ts` (qoidalar + baholovchi)
 *   4 sayqal      60→68   `polish.ts`
 *   5 sintez      68→95   `tts/chain.ts`: bo'laklar → MP3 birlashtirish
 *
 * ⚠ TARTIB `infographic` DAN FARQ QILADI va bu ataylab: u yerda plakat
 * avval chiziladi, so'ng hisobot/sayqal, so'ng KERAK BO'LSA qayta
 * chiziladi. Bu yerda qayta «chizish» — TTS ni ikkinchi marta to'lash
 * degani (5 daqiqalik podkastda ≈4 500 belgi × 2). Shuning uchun matn
 * TO'LIQ tayyorlanadi (yozish → hisobot → sayqal), va SO'NGRA bir
 * marta aytiladi. Sintezdan keyingi hisobot bandlari matnga bog'liq
 * emas, ya'ni hech narsa yo'qotilmaydi.
 *
 * ⚠ `null` VA ISTISNO — IKKI XIL holat:
 *   • `null`  — MATN chiqmadi (LLM kaliti yo'q, model javob bermadi):
 *     `index.ts` mavjud «Audio yaratilmadi» xatosini beradi;
 *   • ISTISNO — OVOZ provayderi sozlanmagan yoki sintez yiqildi. Bu
 *     KONFIGURATSIYA muammosi va uni «model javob bermadi» deb
 *     ko'rsatish egasini noto'g'ri yo'lga solardi: xabar aniq
 *     («Ovoz provayderi sozlanmagan»), kredit esa ikkala yo'lda ham
 *     qaytadi (ish `FAILED` bo'ladi).
 */
import type { FormValues, ToolConfig } from "../../types";
import type { AcademicDoc, BuiltFile, DocMeta } from "../types";
import type { TranslationSource } from "../source-types";
import type { CompleteFn } from "../research/pipeline";
import { CostMeter, type LlmUsage, complete as completeRole } from "../llm-roles";
import { llmEnabled } from "../llm";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import { extractMeta } from "../meta";
import { TTS_LIMITS, TtsMeter, ttsVerified, type TtsProvider } from "../tts/types";
import { mergeToMp3, mp3Seconds } from "../tts/mp3";
import { asTtsChain, ttsChain as defaultChain, type TtsChain } from "../tts/chain";
import { audioKindOf, audioTypeOf } from "./registry";
import { AUDIO_LIMITS, scriptWords, type AudioLine, type AudioModel } from "./types";
import { audioInputFromValues, audioTitleOf, audioUserFacts, normalizeScript, type AudioInput } from "./input";
import { audioCtx, audioPrompt, audioRetryPrompt, audioSystemPrompt } from "./prompts";
import { scriptChars, speakerShares, speechParts, withinBudget, wordRange } from "./script";
import { reviewAudio, type AudioReviewOpts } from "./review";
import { runAudioPolish } from "./polish";

/* ────────────────────────── shartnoma ────────────────────────── */

/** `GameStage`/`TeacherStage` bilan AYNI shakl — chaqiruvchi bittasini uzatadi. */
export type AudioStage = { progress: number; step: string };

export type AudioBuildOpts = {
  deadline: number;
  /** Fayl rejimi (podkast): yuklangan manba (`worker.ts sourceForJob`). */
  source?: TranslationSource;
  onStage?: (ev: AudioStage) => void;
  /** LLM + TTS sarfi — chaqiruvchi uni `BuiltFile.cost` ga yozadi. */
  onCost?: (cost: AudioCost) => void;
  onUsage?: (u: LlmUsage) => void;
  /** Testlar modelni shu orqali almashtiradi (`games/engine.ts` naqshi). */
  complete?: CompleteFn;
  /** Testlar/lab ovozni shu orqali almashtiradi; berilmasa muhit zanjiri. */
  tts?: TtsChain | TtsProvider;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  /** `false` — avto-sayqal o'tkazib yuboriladi. */
  polish?: boolean;
  now?: Date;
};

export type AudioCost = ReturnType<CostMeter["toJson"]>;

export type AudioBuilder = (tool: ToolConfig, meta: DocMeta, values: FormValues, opts: AudioBuildOpts) => Promise<BuiltFile | null>;

/* ────────────────────────── vaqt chegaralari ────────────────────────── */

const MIN_CALL_MS = 8_000;
const SCRIPT_TIMEOUT_MS = 60_000;
export const AUDIO_REVIEW_RESERVE_MS = 40_000;
export const AUDIO_POLISH_RESERVE_MS = 50_000;
/**
 * Sintezga ajratiladigan eng kam vaqt.
 *
 * Sintez — oxirgi bosqich va uni YARIM QOLDIRIB bo'lmaydi: yarim
 * ssenariy aytilgan MP3 to'liq narxga sotilardi. Shuning uchun matn
 * bosqichlari o'z byudjetini shu zaxiradan OSHIRMAYDI.
 */
export const AUDIO_TTS_RESERVE_MS = 60_000;

export const AUDIO_MIME = "audio/mpeg";

/* ────────────────────────── yordamchilar ────────────────────────── */

async function ask(
  complete: CompleteFn,
  system: string,
  user: string,
  o: { maxTokens: number; timeoutMs: number },
  meter: CostMeter,
  onUsage?: (u: LlmUsage) => void,
): Promise<Record<string, unknown> | null> {
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
 * Faqat MIQDOR bandlari: so'z byudjeti, replika soni va ovoz
 * muvozanati. Sifat bandlari (halollik, kirish, baholovchi) SAYQALGA
 * qoladi — ular hisobot bilan birga keladi va ularni bu yerda
 * takrorlash ikkinchi chaqiruvni ikki marta to'lardi
 * (`infographic/engine.ts` da o'rganilgan taqsimot).
 */
export function retryProblems(script: AudioLine[], input: AudioInput): string[] {
  const out: string[] = [];
  const n = scriptWords(script);
  const { min, max } = wordRange(input.wordBudget);
  if (n < min) out.push(`the script holds ${n} words but must hold at least ${min} (about ${input.minutes} minute(s) of speech)`);
  if (n > max) out.push(`the script holds ${n} words but must stay under ${max}`);
  if (script.length < AUDIO_LIMITS.linesMin) out.push(`only ${script.length} turns — the format needs at least ${AUDIO_LIMITS.linesMin}`);
  if (input.speakers >= 2) {
    const shares = speakerShares(script);
    const roles = Object.keys(shares);
    if (roles.length < 2) out.push('only one voice speaks — this format needs both "A" and "B" with real turns');
    else if (Math.min(...roles.map((r) => shares[r])) < 0.3) out.push("one voice carries less than a third of the words — rebalance the dialogue");
  }
  return out;
}

/** Transkript hujjat bo'limi sifatida — panel, qidiruv va `buildPreview` uchun. */
function scriptSection(model: AudioModel, title: string) {
  return {
    id: "script",
    title,
    blocks: model.script.map((l) => ({ kind: "p" as const, text: model.script.some((x) => x.speaker !== model.script[0].speaker) ? `${l.speaker}: ${l.text}` : l.text })),
  };
}

/** Yuklangan fayldan matn — tarjima ekstraktori orqali (`infographic/engine.ts` naqshi). */
async function sourceTextOf(source: TranslationSource): Promise<string> {
  try {
    const { extractSegments } = await import("../translate/index");
    const ex = await extractSegments(source.kind, source.bytes);
    return ex.segments.map((s) => s.text).join("\n\n").slice(0, AUDIO_LIMITS.sourceTextChars);
  } catch (e) {
    console.warn("[audio] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}

/**
 * Fayl nomi — `<mavzu>.mp3`, xavfsiz belgilar bilan.
 *
 * Manba — `audioTitleOf` (hujjat sarlavhasi bilan AYNI), `fileNameHint`
 * emas: tabriknomada `extractMeta` mavzuni VOSITA NOMIGA tushiradi
 * («Tabriknoma»), ya'ni hint bo'yicha hamma tabriknoma bir xil nomli
 * fayl bo'lardi va yuklamalar papkasida «Tabriknoma (3).mp3» to'planardi.
 */
export function audioFileName(meta: DocMeta, input: AudioInput): string {
  const base = (audioTitleOf(input) || meta.fileNameHint || "audio").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "audio"}.mp3`;
}

/* ────────────────────────── dvigatel ────────────────────────── */

export const buildAudioArtifact: AudioBuilder = async (tool, meta, values, opts) => {
  const kind = audioKindOf(String(meta.toolId ?? tool.id));
  if (!kind) return null;

  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;

  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const ttsMeter = new TtsMeter();
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  /* ── 1. kirish ── */
  stage(0, "Ma’lumotlar tayyorlanmoqda");
  const base = meta.toolId ? meta : extractMeta(tool, values);
  const input = audioInputFromValues(kind, base, values);
  if (!input.sourceText && opts.source) input.sourceText = await sourceTextOf(opts.source);
  /*
   * Podkastda MAVZU (yoki manba matn) majburiy; tabriknomada uning
   * o'rnini «Kimga?» egallaydi (`lib/tools.ts` — `topicLegend` ataylab
   * yo'q, `recipient` esa `required: true`).
   *
   * DIQQAT: `input.topic` ning O'ZINI tekshirib bo'lmaydi — `extractMeta`
   * mavzu bo'sh bo'lsa uni VOSITA NOMIGA tushiradi («Podkast»,
   * «Tabriknoma»), ya'ni u hech qachon bo'sh chiqmaydi. Shuning uchun
   * forma qiymati o'qiladi.
   */
  const typedTopic = String(values.topic ?? "").trim();
  if (kind === "podcast" && !typedTopic && !input.sourceText) return null;
  if (kind === "greeting" && !input.recipient) return null;

  const spec = audioTypeOf(kind, input.type);
  const ctx = audioCtx(spec, input);
  const facts = audioUserFacts(input);

  /*
   * OVOZ zanjiri MATNDAN OLDIN tekshiriladi: provayder sozlanmagan
   * bo'lsa, ssenariyni yozib LLM puli sarflangandan keyin yiqilish
   * mantiqsiz — foydalanuvchi baribir faylni olmaydi.
   */
  const chain = opts.tts ? asTtsChain(opts.tts) : defaultChain;
  if (!chain.configured() || !chain.providersFor(input.language).length) {
    throw new Error("Ovoz provayderi sozlanmagan. Administrator bilan bog‘laning — to‘lov qaytarildi.");
  }

  /* ── 2. ssenariy ── */
  stage(8, kind === "podcast" ? "Ssenariy yozilmoqda" : "Tabrik matni yozilmoqda");
  const system = audioSystemPrompt(ctx);
  const textDeadline = deadline - AUDIO_TTS_RESERVE_MS - (opts.polish === false ? AUDIO_REVIEW_RESERVE_MS : AUDIO_REVIEW_RESERVE_MS + AUDIO_POLISH_RESERVE_MS);
  const budget = () => Math.min(SCRIPT_TIMEOUT_MS, Math.max(0, Math.min(remainingMs(textDeadline), remainingMs(deadline))));

  let script = normalizeScript(await ask(complete, system, audioPrompt(ctx), { maxTokens: 3000, timeoutMs: budget() }, meter, opts.onUsage), input);
  if (!script) {
    console.warn("[audio] model yaroqli ssenariy bermadi");
    return null;
  }

  /*
   * BIR MARTALIK qayta so'rov — MIQDOR bandlari buzilganda. Ikkinchi
   * urinish YO'Q: narx tekis 4 000 va uchinchi chaqiruv byudjetni
   * yeydi; qolgan nuqsonni sayqal hisobot bilan birga tuzatadi.
   */
  const problems = retryProblems(script, input);
  if (problems.length) {
    stage(30, "Ssenariy davomiylikka moslanmoqda");
    const retry = normalizeScript(await ask(complete, system, audioRetryPrompt(ctx, script, problems), { maxTokens: 3000, timeoutMs: budget() }, meter, opts.onUsage), input);
    // Qayta so'rov YOMONLASHTIRMASIN (`infographic/engine.ts` bilan ayni qoida).
    if (retry && retryProblems(retry, input).length < problems.length) script = retry;
  }

  const model: AudioModel = { v: 1, kind, type: input.type, language: input.language, script };
  const title = audioTitleOf(input);
  let doc: AcademicDoc = {
    meta: { ...base, topic: title, language: input.language, extra: input.extra },
    titlePage: false,
    toc: false,
    sections: [scriptSection(model, title)],
    audio: model,
  };

  /* ── 3. hisobot ── */
  stage(45, "Tayyorlik hisoboti");
  const judge = opts.judge !== false;
  const reviewOpts: AudioReviewOpts = { complete, deadline: deadline - AUDIO_TTS_RESERVE_MS, judge, now, minutes: input.minutes, facts, recipient: input.recipient, relation: input.relation, ...(opts.onUsage ? { onUsage: opts.onUsage } : {}) };
  let review = await reviewAudio(doc, reviewOpts);
  model.review = review;
  model.userNeeds = review.userNeeds ?? [];

  /* ── 4. avto-sayqal (SINTEZDAN OLDIN — fayl boshidagi izoh) ── */
  if (opts.polish !== false && remainingMs(deadline) > AUDIO_POLISH_RESERVE_MS + AUDIO_TTS_RESERVE_MS) {
    stage(60, "Avto-sayqal");
    const res = await runAudioPolish(doc, review, {
      complete,
      deadline: deadline - AUDIO_TTS_RESERVE_MS,
      judge,
      now,
      minutes: input.minutes,
      facts,
      recipient: input.recipient,
      relation: input.relation,
      ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
    });
    review = res.review;
    if (res.accepted && res.doc.audio) doc = res.doc;
    const target = doc.audio ?? model;
    target.review = review;
    target.polish = res.log;
    target.userNeeds = review.userNeeds ?? [];
    doc = { ...doc, audio: target, sections: [scriptSection(target, title)] };
  }

  const finalModel = doc.audio ?? model;

  /* ── 5. sintez ── */
  stage(68, "Ovozga o‘girilmoqda");
  const parts = speechParts(finalModel.script);
  if (!parts.length) return null;
  const chars = scriptChars(finalModel.script);
  if (chars > TTS_LIMITS.maxChars) {
    /*
     * Matn chegaradan oshdi — bu byudjet nuqsoni, jimgina kesish esa
     * foydalanuvchi ekranda ko'rgan gapni audiodan YO'QOTARDI.
     */
    console.warn(`[audio] ssenariy ${chars} belgi, chegara ${TTS_LIMITS.maxChars}`);
    return null;
  }

  const run = await chain.synthesizeAll(parts, { lang: input.language, timeoutMs: Math.min(TTS_LIMITS.callTimeoutMs, Math.max(1_000, remainingMs(deadline))) });
  for (const u of run.usages) ttsMeter.add(u);

  stage(92, "Audio yig‘ilmoqda");
  const bytes = await mergeToMp3(run.audios);
  if (!bytes?.length) {
    // Birlashtirish yiqildi (profil mos emas yoki enkoder yo'q) —
    // `null` emas, ANIQ xato: bu ham konfiguratsiya/provayder holati.
    throw new Error("Audio fayl yig‘ilmadi. Qayta urinib ko‘ring.");
  }

  /*
   * Uzunlik BAYTLARDAN qayta o'lchanadi, provayder yig'indisidan emas:
   * birlashtirishda Xing kadrlari tashlanadi va haqiqiy fayl biroz
   * qisqaroq bo'ladi. `delivered` shu songa tayanadi, ya'ni u FAYLNING
   * o'zini o'lchashi shart.
   */
  const seconds = mp3Seconds(bytes) || run.seconds;
  finalModel.seconds = Math.round(seconds);
  finalModel.voice = run.voiceA;
  if (finalModel.script.some((l) => l.speaker !== finalModel.script[0].speaker)) finalModel.voiceB = run.voiceB;
  doc = { ...doc, audio: finalModel };

  /* ── 6. qadoqlash ── */
  stage(96, "Tayyor");
  const llm = meter.toJson();
  const tts = ttsMeter.toJson();
  /*
   * `cost` — LLM va TTS YIG'INDISI. `CostJson` shakli o'zgarmaydi
   * (`scripts/cost-report.mts` `usd` ni o'qiydi), provayder/model
   * ustunlari esa ikkala manbani ham nomlaydi: «gemini+azure».
   * TTS belgilari `inputTokens` ga QO'SHILMAYDI — token va belgi
   * boshqa birlik, ularni aralashtirish marja hisobini yolg'onga
   * chiqarardi (`TtsMeter` izohi).
   */
  const cost = {
    provider: [llm.provider, tts.provider].filter((s) => s && s !== "none").join("+") || "none",
    model: [llm.model, tts.voice].filter(Boolean).join("+"),
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    calls: llm.calls + tts.calls,
    usd: Number((llm.usd + tts.usd).toFixed(6)),
  };
  opts.onCost?.(cost);

  const want = input.minutes * 60;
  /*
   * `delivered` — VA'DA qilingan DAQIQA bo'yicha. «5 daqiqa» deb
   * to'lagan foydalanuvchi 3 daqiqalik fayl olsa worker farqni
   * qaytaradi (`refundPartial`). Birlik «soniya»: natija sahifasidagi
   * jumla «300 tadan 180 ta soniya yetkazildi» bo'ladi.
   */
  const got = Math.round(seconds);
  const delivered = got < want ? { got, want, unit: "soniya" } : undefined;

  return {
    bytes,
    fileName: audioFileName(base, input),
    mime: AUDIO_MIME,
    html: audioHtml(finalModel, title, got),
    doc,
    cost,
    ...(delivered ? { delivered } : {}),
  };
};

/* ────────────────────────── HTML eskiz ────────────────────────── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function audioHtml(model: AudioModel, title: string, seconds: number): string {
  const spec = audioTypeOf(model.kind, model.type);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  const warn = ttsVerified(model.language) ? "" : " · ovoz tili taxminiy";
  return [
    `<article><h1>${esc(title)}</h1>`,
    `<p>${esc(spec.label.uz)} · ${mm}:${ss} · ${model.script.length} replika${esc(warn)}</p>`,
    ...model.script.map((l) => `<p><b>${esc(l.speaker)}:</b> ${esc(l.text)}</p>`),
    "</article>",
  ].join("");
}

/* Byudjet tekshiruvini dvigateldan tashqarida ham chaqirish uchun (zond, testlar). */
export { withinBudget };
