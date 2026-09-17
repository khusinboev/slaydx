import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import { AUDIO_FORM_FIELDS, AUDIO_PARAMS, audioParamsOf, type AudioParamImpact } from "../lib/generation/audio-params.ts";
import { AUDIO_KINDS, type AudioKind } from "../lib/generation/audio/types.ts";
import { audioInputFromValues } from "../lib/generation/audio/input.ts";
import { audioTypeOf } from "../lib/generation/audio/registry.ts";
import { audioCtx, audioPrompt, audioSystemPrompt, type AudioContext } from "../lib/generation/audio/prompts.ts";
import { buildAudioArtifact } from "../lib/generation/audio/engine.ts";
import { chainOfProvider, ttsGroups } from "../lib/generation/tts/chain.ts";
import type { CompleteFn } from "../lib/generation/research/pipeline.ts";
import type { TtsAudio, TtsProvider, TtsSynthOpts } from "../lib/generation/tts/types.ts";

/**
 * AUDIO «BEZAK MAYDON YO'Q» REYESTRI (AUDIT-22 WP-A2) — `game-params.ts`/
 * `teacher-params.test.mts`/`slide-params.test.mts` naqshi.
 *
 * WP-A `audio-params.ts` ni yozdi, lekin bu zondning O'ZINI yozmadi:
 * `podcastType` va `occasion` reyestrda `structure` ta'sirini e'lon
 * qilardi, lekin `audio/registry.ts` uchala podkast turi va oltala
 * tabriknoma janri uchun BIR XIL skelet/blok/ovoz sonini ishlatardi —
 * e'lon HAQIQATDA yolg'on edi (`docs/AUDIT-22.md` §5 WP-A ochiq band 4).
 *
 * WP-A2 ikki tomondan tuzatdi: (1) `audio/registry.ts` — podkast
 * turlari endi HAQIQATAN farq qiladi (`tushuntirish` monolog 3 blok,
 * `intervyu` dialog 3 blok, `savol-javob` dialog 4 blok), tabriknoma
 * skeleti esa janrdan mustaqilligicha qoladi; (2) shu fayl — LLM/TTS
 * ni CHAQIRMASDAN (soxta `complete`/soxta TTS provayder, `audio-engine.
 * test.mts` naqshi) har parametr uchun e'lon qilingan HAR ta'sirni
 * probeA/probeB bilan solishtiradi.
 *
 * Soxta `complete` PROMPTNI O'QIMAYDI — ssenariyni YOPILGAN `ctx`
 * (spec+input) dan to'g'ridan-to'g'ri quradi (mavzu/manba/adresat/
 * sabab/munosabat matnini «aks sado» sifatida qo'shib). Bu haqiqiy
 * LLM'siz ham natijaviy `AudioModel`/hisobot probeA va probeB orasida
 * farq berishini kafolatlaydi — xuddi `infographic-params.test.mts`
 * dagi `stubComplete` kabi.
 *
 * Mutatsiyalar (qo'lda tekshirildi, WP-A2 hisobotida yozilgan):
 *   1. `savol-javob.limits.blocks` 4 → 3 (uchalasi yana bir xil) —
 *      «podkast turlari tuzilmaviy farq qiladi» VA differensial zond
 *      (`podcastType` → `structure`) qizardi;
 *   2. `tushuntirish.speakers` 1 → 2 (monolog/dialog farqi yo'qoldi) —
 *      «ovoz soni» testi VA differensial zond qizardi;
 *   3. `occasion`ga `audio-params.ts`da qayta `structure` qo'shildi —
 *      differensial zond (`occasion` → `structure`) qizardi, chunki
 *      `GREETING_SKELETON` janrdan mustaqil — e'lon yolg'on bo'lib qoladi.
 */

const podcastTool = () => TOOLS.find((t) => t.id === "podcast")!;
const greetingTool = () => TOOLS.find((t) => t.id === "greeting")!;
const toolOf = (kind: AudioKind) => (kind === "podcast" ? podcastTool() : greetingTool());

/* ══════════════════════════ reyestr butunligi ══════════════════════════ */

test("har parametr unikal id ga ega, shakli to'g'ri va probeA ≠ probeB", () => {
  const ids = AUDIO_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `takroriy id: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(", ")}`);
  assert.deepEqual(AUDIO_FORM_FIELDS, ids);
  for (const p of AUDIO_PARAMS) {
    assert.ok(/^[a-zA-Z][a-zA-Z0-9]*$/.test(p.id), `${p.id}: forma maydon nomi shakli`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond juftligi bir xil — farqni o'lchab bo'lmaydi`);
  }
});

test("har parametrning egasi (kinds) va ta'siri (impacts) bor; narx HECH BIR parametrga bog'liq emas", () => {
  for (const p of AUDIO_PARAMS) {
    assert.ok(p.kinds.length > 0, `${p.id}: hech qaysi vositaga tegishli emas`);
    for (const k of p.kinds) assert.ok((AUDIO_KINDS as readonly string[]).includes(k), `${p.id}: noma'lum kind ${k}`);
    assert.equal(new Set(p.kinds).size, p.kinds.length, `${p.id}: takroriy kind`);
    assert.ok(p.impacts.length > 0, `${p.id}: «bezak maydon» — impacts bo'sh`);
    assert.equal(new Set(p.impacts).size, p.impacts.length, `${p.id}: takroriy impact`);
  }
  const KNOWN: readonly AudioParamImpact[] = ["prompt", "structure", "model", "tts", "review", "source", "language", "budget"];
  for (const p of AUDIO_PARAMS) for (const im of p.impacts) assert.ok((KNOWN as readonly string[]).includes(im), `${p.id}: noma'lum impact ${im}`);
  // Egasi qarori 6: ikkala vosita ham tekis 4 000, davomiylik/tur narxga tegmaydi.
  const impacts = new Set<string>(AUDIO_PARAMS.flatMap((p) => p.impacts as readonly string[]));
  assert.ok(!impacts.has("price"), "MUTATSIYA: biror parametr narxga ta'sir qilsa, tekis narx va'dasi buziladi");
  for (const p of AUDIO_PARAMS) {
    const tool = toolOf(p.kinds[0]);
    assert.equal(priceFor(tool, { topic: "x", ...p.probeWith }), priceFor(tool, { topic: "x", ...p.probeWith, [p.id]: p.probeB }), `${p.id}: narxga ta'sir qildi`);
  }
});

test("`probeWith` faqat reyestrda bor parametrga ishora qiladi", () => {
  for (const p of AUDIO_PARAMS.filter((x) => x.probeWith)) {
    const keys = Object.keys(p.probeWith!);
    assert.ok(keys.length > 0, `${p.id}: bo'sh probeWith`);
    for (const k of keys) assert.ok(AUDIO_PARAMS.some((x) => x.id === k), `${p.id}: probeWith «${k}» reyestrda yo'q`);
  }
  const sourceText = AUDIO_PARAMS.find((p) => p.id === "sourceText");
  assert.deepEqual(sourceText?.probeWith, { mode: "text" });
});

test("reyestr: formadagi HAR maydon reyestrda e'lon qilingan (va aksincha)", () => {
  for (const kind of AUDIO_KINDS) {
    const tool = toolOf(kind);
    const formFields = tool.fields.map((f) => f.name);
    const declared = new Set(audioParamsOf(kind).map((p) => p.id));
    for (const name of formFields) assert.ok(declared.has(name), `«${name}» (${kind}) formada bor, lekin reyestrda yo'q`);
    /*
     * `topic`/`extra` — `StandardForm`ning umumiy maydonlari (`fields`da
     * emas); `mode` — `tool.modes` orqali (fayl/matn almashtirgichi,
     * `ToolWorkspace.tsx`), podkastda `ToolField` emas.
     */
    for (const id of declared) {
      assert.ok(formFields.includes(id) || id === "topic" || id === "extra" || id === "mode", `«${id}» (${kind}) reyestrda bor, lekin formada chizilmaydi`);
    }
  }
  assert.ok(audioParamsOf("podcast").length > audioParamsOf("greeting").length || audioParamsOf("greeting").length > 0);
});

test("zond maydonlari o'lik emas: har ta'sir kamida bitta parametrda e'lon qilingan", () => {
  const declared = new Set(AUDIO_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "structure", "model", "tts", "review", "source", "language", "budget"] as AudioParamImpact[]) {
    assert.ok(declared.has(impact), `${impact}: hech bir parametr bu ta'sirni e'lon qilmagan — zond o'lik`);
  }
});

/* ══════════════════════════ soxta LLM/TTS bilan differensial zond ══════════════════════════ */

/** `n` so'zli to'ldiruvchi — raqamsiz (`noFakeStats` yolg'on qizarmasin). */
const filler = (n: number) => Array.from({ length: Math.max(1, n) }, () => "soz").join(" ");

/**
 * Ssenariyni `ctx` (spec + input) dan to'g'ridan-to'g'ri quradi — LLM
 * javobini TAQLID qilmaydi, balki uni ORNI bosadi. Har qatorga
 * foydalanuvchi bergan matnning (mavzu/manba/adresat/sabab/munosabat)
 * «aks sadosi» qo'shiladi, shuning uchun bu maydonlar o'zgarganda
 * natijaviy SSENARIY ham (demak `model`/`review` ham) o'zgaradi —
 * haqiqiy LLM shunday qilardi, faqat bu yerda deterministik.
 */
function scriptFor(ctx: AudioContext): { speaker: string; text: string }[] {
  const { spec, input } = ctx;
  const total = spec.skeleton.length;
  const perLine = Math.max(4, Math.round(input.wordBudget / total));
  const echo = [input.mode, input.topic, input.sourceText, input.recipient, input.relation, input.occasion].filter(Boolean).join(" ").trim() || "mavzu";
  const lines: { speaker: string; text: string }[] = [];
  for (let i = 0; i < total; i++) {
    const speaker = input.speakers >= 2 ? (i % 2 === 0 ? "A" : "B") : "A";
    const tag = i === 0 ? `${echo} haqida savol` : i === total - 1 ? "Xulosa shu" : "Davomi shu";
    lines.push({ speaker, text: `${tag} ${filler(perLine)}.` });
  }
  return lines;
}

function makeStubComplete(ctx: AudioContext): CompleteFn {
  const fn = (async (role: string) => {
    if (role === "judge") return { text: JSON.stringify({ notes: [], fixes: [] }) };
    return { text: JSON.stringify({ script: scriptFor(ctx) }) };
  }) as unknown as CompleteFn;
  return fn;
}

/** Sintetik MPEG2 kadr — bayt qiymatlari ma'nosiz, faqat `mergeToMp3` yiqilmasin. */
function frame(): Uint8Array {
  const b = new Uint8Array(288);
  b[0] = 0xff;
  b[1] = 0xf3;
  b[2] = 0xa4;
  b[3] = 0xc0;
  return b;
}

type Synth = { text: string; voice?: string; pauseMs?: number };

function fakeTts(): TtsProvider & { calls: Synth[] } {
  const calls: Synth[] = [];
  return {
    id: "azure",
    calls,
    configured: () => true,
    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      calls.push({ text, ...(opts.voice !== undefined ? { voice: opts.voice } : {}), ...(opts.pauseMs !== undefined ? { pauseMs: opts.pauseMs } : {}) });
      return { mp3: frame(), seconds: 0.024, chars: text.length };
    },
  };
}

const BASE_PODCAST: FormValues = { topic: "Sun'iy intellekt ta'limda", durationMin: 2, podcastType: "tushuntirish", language: "uz", mode: "topic", extra: "" };
const BASE_GREETING: FormValues = { recipient: "Dilnoza opa", relation: "ustozim", occasion: "ustoz-kuni", durationMin: 1, language: "uz", extra: "" };

type Probe = Record<AudioParamImpact, string>;

async function probe(kind: AudioKind, values: FormValues): Promise<Probe> {
  const tool = toolOf(kind);
  const v: FormValues = { ...(kind === "podcast" ? BASE_PODCAST : BASE_GREETING), ...values };
  const meta = extractMeta(tool, v);
  const input = audioInputFromValues(kind, meta, v);
  const spec = audioTypeOf(kind, input.type);
  const ctx = audioCtx(spec, input);

  const tts = fakeTts();
  const built = await buildAudioArtifact(tool, meta, v, {
    deadline: Date.now() + 300_000,
    complete: makeStubComplete(ctx),
    tts: chainOfProvider(tts, ["azure-A", "azure-B"]),
    judge: false,
    polish: false,
  });
  assert.ok(built, `zond: audio qurilishi kerak (${kind}, ${JSON.stringify(values)})`);
  const model = built!.doc.audio!;

  return {
    prompt: [audioSystemPrompt(ctx), audioPrompt(ctx)].join("\n"),
    /*
     * SHAKL, IDENTIKLIK EMAS: `spec.id`/`spec.label` ataylab KIRITILMAGAN
     * — ular «qaysi tur» ni aytadi, «qanday shakl» ni emas, ya'ni har
     * tur-o'zgaruvchi parametr (masalan `occasion`) trivial ravishda
     * «farq beraveradi». Xuddi shunday, HAQIQIY yozilgan ssenariy so'z
     * soni emas, `input.wordBudget` (REJA) olinadi — aks holda `echo`
     * matnining uzunlik farqi (masalan `occasion` ibora uzunligi) soxta
     * «structure farq qildi» berardi (occasion testida ushlangan).
     */
    structure: JSON.stringify({
      skeleton: spec.skeleton,
      blocks: spec.kind === "podcast" ? spec.limits.blocks : undefined,
      speakers: input.speakers,
      wordBudget: input.wordBudget,
    }),
    model: JSON.stringify({ type: model.type, language: model.language, script: model.script }),
    tts: JSON.stringify({
      voices: ttsGroups(input.language).map((g) => [g.provider, g.voices]),
      calls: tts.calls.map((c) => [c.voice, c.text.length, c.pauseMs]),
    }),
    review: JSON.stringify((model.review?.checks ?? []).filter((c) => !c.id.startsWith("judge:")).map((c) => [c.id, c.level, c.detail])),
    source: JSON.stringify({ mode: input.mode, sourceText: input.sourceText }),
    language: `${input.language}/${model.language}`,
    budget: String(budgetFor(tool, v, 600_000)),
  };
}

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi (LLM/TTS chaqirilmaydi)", async () => {
  const failures: string[] = [];
  for (const p of AUDIO_PARAMS) {
    const kind = p.kinds[0];
    const base = p.probeWith ?? {};
    const a = await probe(kind, { ...base, [p.id]: p.probeA });
    const b = await probe(kind, { ...base, [p.id]: p.probeB });
    for (const impact of p.impacts) {
      if (a[impact] === b[impact]) failures.push(`${p.id} (${kind}) → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

test("podkast turlari: `structure` ta'siri HAQIQIY — tur o'zgarsa skelet/blok/ovoz soni ham o'zgaradi", async () => {
  const explainer = await probe("podcast", { podcastType: "tushuntirish" });
  const interview = await probe("podcast", { podcastType: "intervyu" });
  const qa = await probe("podcast", { podcastType: "savol-javob" });
  // Uchtasi ham BIR-BIRIDAN farq qiladi — ilgari uchtasi AYNAN bir xil edi.
  assert.notEqual(explainer.structure, interview.structure, "tushuntirish/intervyu structure bir xil (monolog/dialog farqi yo'qolgan)");
  assert.notEqual(interview.structure, qa.structure, "intervyu/savol-javob structure bir xil (blok soni farqi yo'qolgan)");
  assert.notEqual(explainer.structure, qa.structure);
  const blocksOf = (s: string) => (JSON.parse(s) as { blocks?: number }).blocks;
  assert.deepEqual([blocksOf(explainer.structure), blocksOf(interview.structure), blocksOf(qa.structure)], [3, 3, 4]);
  const speakersOf = (s: string) => (JSON.parse(s) as { speakers: number }).speakers;
  assert.deepEqual([speakersOf(explainer.structure), speakersOf(interview.structure), speakersOf(qa.structure)], [1, 2, 2]);
});

test("tabriknoma: `occasion` ssenariy TUZILMASIGA tegmaydi (halol e'lon — faqat prompt/review/model)", async () => {
  const occasion = AUDIO_PARAMS.find((p) => p.id === "occasion")!;
  assert.ok(!occasion.impacts.includes("structure" as AudioParamImpact), "occasion `structure` ta'sirini e'lon qilmasligi kerak — GREETING_SKELETON janrdan mustaqil");
  const a = await probe("greeting", { occasion: "ustoz-kuni" });
  const b = await probe("greeting", { occasion: "navroz" });
  // Skelet/blok/ovoz soni bir xil — faqat MATN (prompt/model/review) farq qiladi.
  assert.equal(a.structure, b.structure, "occasion structure'ga tegmasligi kerak (tabriknoma skeleti janrdan mustaqil)");
  assert.notEqual(a.prompt, b.prompt);
  assert.notEqual(a.model, b.model);
  assert.notEqual(a.review, b.review);
});
