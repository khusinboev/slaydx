import test from "node:test";
import assert from "node:assert/strict";
import { buildAudioArtifact, audioFileName, retryProblems, AUDIO_MIME } from "../lib/generation/audio/engine.ts";
import { audioInputFromValues } from "../lib/generation/audio/input.ts";
import { AUDIO_LIMITS, scriptWords, type AudioLine } from "../lib/generation/audio/types.ts";
import { chainOfProvider } from "../lib/generation/tts/chain.ts";
import { mp3Frames, mp3Seconds } from "../lib/generation/tts/mp3.ts";
import { TtsError, TTS_LIMITS, type TtsAudio, type TtsProvider, type TtsSynthOpts } from "../lib/generation/tts/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOLS } from "../lib/tools.ts";
import type { FormValues, ToolConfig } from "../lib/types.ts";
import type { CompleteFn } from "../lib/generation/research/pipeline.ts";

/**
 * AUDIO DVIGATELI (AUDIT-22 WP-A) — mock LLM + mock TTS.
 *
 * Tarmoqqa CHIQILMAYDI: `complete` ssenariyni qaytaradi, `tts` esa
 * sintetik MPEG2 kadrlarini. Shu bilan butun quvur — kirish → ssenariy →
 * hisobot → sayqal → bo'laklar → MP3 birlashtirish → `delivered` —
 * uchidan uchiga sinaladi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. Sintez natijasi `concatMp3` siz birinchi bo'lak bilan qaytdi —
 *      «bo'laklar BITTA faylga ulanadi» testi (fayl birinchi replikada
 *      tugardi);
 *   2. `seconds` provayder yig'indisidan olindi (fayldan o'lchanmadi) —
 *      «uzunlik BAYTLARDAN» testi;
 *   3. `delivered` yozilmadi — «qisqa fayl uchun farq qaytadi» testi
 *      (5 daqiqa deb to'lanib, 1 daqiqalik fayl to'liq narxda ketardi);
 *   4. TTS sozlanmaganda `null` qaytdi — «ANIQ xato» testi («Audio
 *      yaratilmadi» xabari egasiga sozlama muammosini ko'rsatmasdi);
 *   5. Ovoz zanjiri ssenariydan KEYIN tekshirildi — «kalitsiz holatda
 *      LLM chaqirilmaydi» testi;
 *   6. `retryProblems` byudjetdan tashqaridagi ssenariyni o'tkazdi —
 *      «bir martalik qayta so'rov» testi;
 *   7. Qayta so'rov natijasi YOMON bo'lsa ham qabul qilindi —
 *      «yomonlashtirmaydi» testi;
 *   8. `cost` faqat LLM ni sanadi — «TTS narxi ham qo'shiladi» testi;
 *   9. `voiceB` monologda ham yozildi — «bir ovozli tabriknomada
 *      voiceB yo'q» testi;
 *  10. Ssenariy `TTS_LIMITS.maxChars` dan oshganda ham aytildi —
 *      «juda uzun ssenariy rad etiladi» testi;
 *  11. Fayl nomi kengaytmasiz qoldi — «<mavzu>.mp3» testi;
 *  12. `doc.sections` transkriptsiz qoldi — «ko'ruvchi va fayl bitta
 *      manbadan» testi.
 */

/* ── sintetik audio ── */

/** MPEG2/24 kHz/96 kbps mono kadr — 288 bayt, 576 namuna (0.024 s). */
function frame(): Uint8Array {
  const b = new Uint8Array(288);
  b[0] = 0xff;
  b[1] = 0xf3;
  b[2] = 0xa4;
  b[3] = 0xc0;
  return b;
}
const FRAME_SECONDS = 576 / 24_000;

function mp3Of(frames: number): Uint8Array {
  const out = new Uint8Array(288 * frames);
  for (let i = 0; i < frames; i++) out.set(frame(), i * 288);
  return out;
}

/* ── mock TTS ── */

type Synth = { text: string; voice?: string; pauseMs?: number };

function fakeTts(o: { configured?: boolean; framesPerCall?: number; fail?: TtsError } = {}): TtsProvider & { calls: Synth[] } {
  const calls: Synth[] = [];
  return {
    id: "azure",
    calls,
    configured: () => o.configured !== false,
    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      calls.push({ text, ...(opts.voice !== undefined ? { voice: opts.voice } : {}), ...(opts.pauseMs !== undefined ? { pauseMs: opts.pauseMs } : {}) });
      if (o.fail) throw o.fail;
      const n = o.framesPerCall ?? 20;
      return { mp3: mp3Of(n), seconds: n * FRAME_SECONDS, chars: text.length };
    },
  };
}

/* ── mock LLM ── */

/** `n` so'zli replika (raqamsiz — `noFakeStats` yolg'on qizarmasin). */
const words = (n: number) => Array.from({ length: n }, () => "so'z").join(" ");

function scriptOf(lines: { speaker: string; words: number }[]): AudioLine[] {
  return lines.map((l, i) => ({ speaker: l.speaker, text: `${i === 0 ? "Nega bu savol muhim?" : ""} ${words(l.words)}.`.trim() }));
}

/** 2 daqiqalik (300 so'z) 8 replikali, byudjetga tushadigan ssenariy. */
const goodScript = () => scriptOf(Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 === 0 ? "A" : "B", words: 37 })));

function fakeComplete(answers: AudioLine[][]): CompleteFn & { calls: { role: string; user: string }[] } {
  const calls: { role: string; user: string }[] = [];
  let at = 0;
  const fn = (async (role: string, _system: string, user: string) => {
    calls.push({ role, user });
    if (role === "judge") return { text: JSON.stringify({ notes: [], fixes: [] }), usage: { provider: "gemini", model: "m", inputTokens: 10, outputTokens: 10 } };
    const script = answers[Math.min(at, answers.length - 1)];
    at += 1;
    return { text: JSON.stringify({ script }), usage: { provider: "gemini", model: "m", inputTokens: 100, outputTokens: 200 } };
  }) as unknown as CompleteFn & { calls: { role: string; user: string }[] };
  fn.calls = calls;
  return fn;
}

/* ── ishga tushirish ── */

const podcastTool = (): ToolConfig => TOOLS.find((t) => t.id === "podcast")!;
const greetingTool = (): ToolConfig => TOOLS.find((t) => t.id === "greeting")!;

async function build(tool: ToolConfig, values: FormValues, o: { answers?: AudioLine[][]; tts?: TtsProvider; polish?: boolean } = {}) {
  const meta = extractMeta(tool, values);
  const complete = fakeComplete(o.answers ?? [goodScript()]);
  const tts = o.tts ?? fakeTts();
  const built = await buildAudioArtifact(tool, meta, values, {
    deadline: Date.now() + 600_000,
    complete,
    tts: chainOfProvider(tts, ["azure-A", "azure-B"]),
    judge: false,
    polish: o.polish ?? false,
  });
  return { built, complete, tts: tts as TtsProvider & { calls: Synth[] } };
}

const PODCAST_VALUES: FormValues = { topic: "Uyqu va xotira", durationMin: 2, podcastType: "tushuntirish", language: "uz", mode: "topic" };

/* ══════════════════════════ asosiy oqim ══════════════════════════ */

test("podkast: MP3, transkript, model va sarf — uchidan uchiga", async () => {
  const { built, tts } = await build(podcastTool(), PODCAST_VALUES);
  assert.ok(built, "dvigatel fayl qaytarishi kerak");

  assert.equal(built.mime, AUDIO_MIME);
  // MUTATSIYA 11: kengaytmasiz fayl brauzerda «yuklab olish» emas, ochilardi.
  assert.ok(built.fileName.endsWith(".mp3"), built.fileName);

  // MUTATSIYA 1: ulanmasa fayl BIRINCHI bo'lak uzunligida qolardi.
  const perCall = 20;
  assert.equal(mp3Frames(built.bytes).length, tts.calls.length * perCall);
  assert.ok(tts.calls.length >= 8, `bo'laklar soni ${tts.calls.length}`);

  const model = built.doc.audio;
  assert.ok(model);
  assert.equal(model.kind, "podcast");
  assert.equal(model.type, "tushuntirish");
  assert.equal(model.language, "uz");
  assert.equal(model.script.length, 8);
  // MUTATSIYA 2: provayder yig'indisi Xing/yaxlitlash farqini hisobga olmaydi.
  assert.equal(model.seconds, Math.round(mp3Seconds(built.bytes)));
  assert.equal(model.voice, "azure:azure-A");
  assert.equal(model.voiceB, "azure:azure-B", "ikki ovozli suhbatda B ovozi ham yoziladi");
  assert.ok(model.review, "hisobot modelga yoziladi");

  // MUTATSIYA 12: bo'limsiz `buildPreview` va qidiruv bo'sh qolardi.
  assert.equal(built.doc.sections.length, 1);
  assert.ok(built.doc.sections[0].blocks.length >= 8);
  assert.ok(built.doc.sections[0].blocks[0].kind === "p" && built.doc.sections[0].blocks[0].text.startsWith("A:"));
});

test("har replika ALOHIDA so'rov, rol bo'yicha ovoz va replikadan keyin pauza", async () => {
  const { built, tts } = await build(podcastTool(), PODCAST_VALUES);
  assert.ok(built);
  assert.equal(tts.calls.length, 8);
  assert.deepEqual(tts.calls.map((c) => c.voice), ["azure-A", "azure-B", "azure-A", "azure-B", "azure-A", "azure-B", "azure-A", "azure-B"]);
  // Oxirgi bo'lakdan keyin pauza yo'q; qolganlarida bor.
  assert.equal(tts.calls[tts.calls.length - 1].pauseMs, 0);
  assert.ok(tts.calls.slice(0, -1).every((c) => (c.pauseMs ?? 0) > 0));
  assert.ok(tts.calls.every((c) => c.text.length <= TTS_LIMITS.chunkChars));
});

/* ══════════════════════════ delivered ══════════════════════════ */

test("delivered: va'da DAQIQA bo'yicha, kam yetkazilganda farq qaytadi", async () => {
  // 8 replika × 20 kadr × 0.024 s ≈ 3.84 s — 2 daqiqa va'dasidan ancha kam.
  const short = await build(podcastTool(), PODCAST_VALUES);
  assert.ok(short.built);
  // MUTATSIYA 3: `delivered` siz 2 daqiqa narxi to'liq olinardi.
  assert.ok(short.built.delivered, "qisqa fayl uchun delivered bo'lishi kerak");
  assert.equal(short.built.delivered.want, 120);
  assert.equal(short.built.delivered.unit, "soniya");
  assert.equal(short.built.delivered.got, Math.round(mp3Seconds(short.built.bytes)));

  // Yetarli uzunlik: 8 replika × 700 kadr ≈ 134 s > 120 s.
  const full = await build(podcastTool(), PODCAST_VALUES, { tts: fakeTts({ framesPerCall: 700 }) });
  assert.ok(full.built);
  assert.equal(full.built.delivered, undefined, "va'da bajarilganda farq qaytarilmaydi");
});

/* ══════════════════════════ provayder yo'q ══════════════════════════ */

test("ovoz provayderi sozlanmagan — ANIQ xato (null emas) va LLM CHAQIRILMAYDI", async () => {
  const tool = podcastTool();
  const meta = extractMeta(tool, PODCAST_VALUES);
  const complete = fakeComplete([goodScript()]);
  const off = fakeTts({ configured: false });

  // MUTATSIYA 4: `null` bo'lsa foydalanuvchi «Audio yaratilmadi» ko'rib,
  // egasi sozlama muammosini bilmasdi.
  await assert.rejects(
    () => buildAudioArtifact(tool, meta, PODCAST_VALUES, { deadline: Date.now() + 600_000, complete, tts: chainOfProvider(off), judge: false, polish: false }),
    /Ovoz provayderi sozlanmagan/,
  );
  // MUTATSIYA 5: tekshiruv ssenariydan keyin bo'lsa LLM puli behuda ketardi.
  assert.equal(complete.calls.length, 0, "kalitsiz holatda model chaqirilmaydi");
  assert.equal(off.calls.length, 0);
});

test("sintez yiqilsa xato ko'tariladi (jimgina qisqa fayl emas)", async () => {
  const tool = podcastTool();
  const meta = extractMeta(tool, PODCAST_VALUES);
  const dead = fakeTts({ fail: new TtsError("azure", "401 kalit yaroqsiz", { retryable: false }) });
  await assert.rejects(
    () => buildAudioArtifact(tool, meta, PODCAST_VALUES, { deadline: Date.now() + 600_000, complete: fakeComplete([goodScript()]), tts: chainOfProvider(dead), judge: false, polish: false }),
    /401 kalit yaroqsiz/,
  );
});

/* ══════════════════════════ qayta so'rov ══════════════════════════ */

test("byudjetdan chiqqan ssenariy uchun BIR MARTALIK qayta so'rov", async () => {
  const tool = podcastTool();
  const short = scriptOf(Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 === 0 ? "A" : "B", words: 5 })));
  const input = audioInputFromValues("podcast", extractMeta(tool, PODCAST_VALUES), PODCAST_VALUES);
  // MUTATSIYA 6: byudjet tekshirilmasa 40 so'zlik «2 daqiqalik» podkast ketardi.
  assert.ok(retryProblems(short, input).length > 0);
  assert.equal(retryProblems(goodScript(), input).length, 0);

  const { built, complete } = await build(tool, PODCAST_VALUES, { answers: [short, goodScript()] });
  assert.ok(built);
  assert.equal(complete.calls.filter((c) => c.role === "writer").length, 2, "aynan ikki chaqiruv: asosiy + bitta qayta so'rov");
  assert.equal(scriptWords(built.doc.audio!.script), scriptWords(goodScript()));
});

test("qayta so'rov YOMONLASHTIRMAYDI — eski ssenariy qoladi", async () => {
  const tool = podcastTool();
  const ok8 = scriptOf(Array.from({ length: 8 }, (_, i) => ({ speaker: i % 2 === 0 ? "A" : "B", words: 20 })));
  const worse = scriptOf([{ speaker: "A", words: 3 }]);
  // MUTATSIYA 7: shartsiz qabul qilinsa 3 so'zli javob 160 so'zlikni yutardi.
  const { built } = await build(tool, PODCAST_VALUES, { answers: [ok8, worse] });
  assert.ok(built);
  assert.equal(built.doc.audio!.script.length, 8);
});

/* ══════════════════════════ tabriknoma ══════════════════════════ */

test("tabriknoma: bitta ovoz, voiceB YO'Q, fayl nomi adresat bilan", async () => {
  const tool = greetingTool();
  const values: FormValues = { recipient: "Dilnoza opa", relation: "ustozim", occasion: "ustoz-kuni", durationMin: 1, language: "uz" };
  const greeting: AudioLine[] = [
    { speaker: "A", text: `Hurmatli Dilnoza opa, Sizni Ustozlar va murabbiylar kuni bilan chin qalbdan tabriklayman. ${words(60)}.` },
    { speaker: "A", text: `${words(80)}. Sog' va omon bo'ling.` },
  ];
  const { built, tts } = await build(tool, values, { answers: [greeting] });
  assert.ok(built);
  const model = built.doc.audio!;
  assert.equal(model.kind, "greeting");
  assert.equal(model.type, "ustoz-kuni");
  // MUTATSIYA 9: monologda `voiceB` yozilsa ko'ruvchi ikki rangli
  // transkript chizib, bir ovozli tabrikni «suhbat» qilib ko'rsatardi.
  assert.equal(model.voiceB, undefined);
  assert.ok(model.script.every((l) => l.speaker === "A"));
  assert.ok(tts.calls.every((c) => c.voice === "azure-A"));
  assert.ok(built.fileName.includes("Dilnoza"), built.fileName);
  assert.equal(built.doc.meta.topic, "Dilnoza opa — Ustozlar va murabbiylar kuni");
});

test("«Kimga?» ham, mavzu ham bo'sh bo'lsa — null (dvigatel ishlamaydi)", async () => {
  const tool = greetingTool();
  const meta = extractMeta(tool, {});
  const built = await buildAudioArtifact(tool, meta, { durationMin: 1, language: "uz", occasion: "umumiy" }, {
    deadline: Date.now() + 600_000,
    complete: fakeComplete([[{ speaker: "A", text: "Tabriklayman!" }]]),
    tts: chainOfProvider(fakeTts()),
    judge: false,
    polish: false,
  });
  assert.equal(built, null);
});

/* ══════════════════════════ sarf va chegaralar ══════════════════════════ */

test("cost: LLM va TTS sarfi YIG'INDISI, provayder ustuni ikkalasini nomlaydi", async () => {
  const { built } = await build(podcastTool(), PODCAST_VALUES);
  assert.ok(built?.cost);
  // MUTATSIYA 8: faqat LLM sanalganda podkast marjasi yolg'on chiqardi.
  assert.ok(built.cost.provider.includes("gemini"));
  assert.ok(built.cost.provider.includes("azure"), built.cost.provider);
  assert.ok(built.cost.model.includes("azure:azure-A"), built.cost.model);
  // Belgi narxi: Azure $16/1M — ssenariy ≈1 800 belgi, ya'ni nolga teng emas.
  assert.ok(built.cost.usd > 0);
  // TTS belgilari TOKEN ustuniga QO'SHILMAYDI (birlik boshqa).
  assert.equal(built.cost.inputTokens, 100);
  assert.ok(built.cost.calls > 1);
});

test("juda uzun ssenariy TTS chegarasidan oshsa — null (jimgina kesilmaydi)", async () => {
  const tool = podcastTool();
  const meta = extractMeta(tool, { ...PODCAST_VALUES, durationMin: 5 });
  // `TTS_LIMITS.maxChars` = 12 000; 40 replika × 500 belgi = 20 000.
  const huge: AudioLine[] = Array.from({ length: 40 }, (_, i) => ({ speaker: i % 2 === 0 ? "A" : "B", text: `${"gap ".repeat(120)}oxiri.` }));
  const tts = fakeTts();
  // MUTATSIYA 10: kesilsa foydalanuvchi ekranda ko'rgan gap audioda yo'q bo'lardi.
  const built = await buildAudioArtifact(tool, meta, { ...PODCAST_VALUES, durationMin: 5 }, {
    deadline: Date.now() + 600_000,
    complete: fakeComplete([huge]),
    tts: chainOfProvider(tts),
    judge: false,
    polish: false,
  });
  assert.equal(built, null);
  assert.equal(tts.calls.length, 0, "chegaradan oshgan matn umuman aytilmaydi");
});

test("audioFileName: xavfsiz belgilar va .mp3 kengaytmasi", () => {
  const tool = podcastTool();
  const values: FormValues = { topic: 'A/B: "test" <mavzu>', durationMin: 1, language: "uz" };
  const meta = extractMeta(tool, values);
  const input = audioInputFromValues("podcast", meta, values);
  const name = audioFileName(meta, input);
  assert.ok(name.endsWith(".mp3"));
  assert.ok(!/[\\/:*?"<>|]/.test(name.slice(0, -4)), name);
});

test("replika chegarasi TTS bo'lagi bilan AYNI son (replika ikki so'rovga bo'linmasin)", () => {
  assert.equal(AUDIO_LIMITS.lineCharsMax, TTS_LIMITS.chunkChars);
});
