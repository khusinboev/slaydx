import test from "node:test";
import assert from "node:assert/strict";
import { AISHA_MAX_CHARS, AISHA_URL, aishaAudioRef, aishaBody, makeAishaTts } from "../lib/generation/tts/aisha.ts";
import { makeGeminiTts, pcmRateOf, geminiAudioPart } from "../lib/generation/tts/gemini.ts";
import { TtsError } from "../lib/generation/tts/types.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import { pcmToWav, wavSeconds } from "../lib/generation/tts/mp3.ts";

/**
 * AISHA (WAV) va GEMINI (PCM) adapterlari (AUDIT-22 WP-A) — `fetch` MOCK.
 *
 * Ikkalasi bitta faylda, chunki ular BIR XIL masalani hal qiladi:
 * javob MP3 EMAS, shuning uchun `mp3.ts` orqali o'tkazilishi kerak.
 * Aisha ning so'rov/javob shakli TASDIQLANMAGAN (kalit yo'q, `tts.md`
 * §6) — test aynan shu shakl BITTA joyda turishini va javobning uch
 * ko'rinishi (xom WAV, base64, havola) qo'llab-quvvatlanishini qulflaydi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. 1 000 belgi tekshiruvi olib tashlandi — «uzun bo'lak tarmoqqa
 *      chiqmaydi» testi (Aisha 400 berardi, pul/vaqt behuda);
 *   2. `X-Api-Key` o'rniga `Authorization` yozildi — «kalit sarlavhasi»
 *      testi;
 *   3. `aishaAudioRef` uzun base64 ni URL deb qabul qildi — «base64
 *      javobi» testi (`fetch("eyJ…")` yiqilardi);
 *   4. WAV o'qilmaganda ham natija qaytarildi — «audio bo'lmagan 200
 *      javob xato beradi» testi;
 *   5. `geminiTts.configured()` faqat `GEMINI_API_KEY` ni tekshirdi —
 *      «preview model ataylab yoqiladi» testi;
 *   6. `pcmRateOf` `mimeType` ni o'qimay 24 000 deb qo'ydi — «16 kHz
 *      PCM davomiyligi» testi (uzunlik 1.5× xato chiqardi);
 *   7. Gemini kaliti URL query ga qo'shildi — «kalit sarlavhada» testi.
 */

/** 16-bit mono WAV, `sec` soniya. */
const wav = (sampleRate: number, sec: number) => pcmToWav(new Uint8Array(Math.round(sampleRate * sec) * 2), { sampleRate, channels: 1, bits: 16 });

/** `Response` tanasi `ArrayBuffer` kutadi — `Uint8Array` to'g'ridan-to'g'ri o'tmaydi. */
const body = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

type Call = { url: string; init: RequestInit };

function mock(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const aisha = (respond: (c: Call) => Response, key = "ak") => {
  const { fetchImpl, calls } = mock(respond);
  return { tts: makeAishaTts({ fetchImpl, key: () => key }), calls };
};

const headerOf = (c: Call, n: string) => (c.init.headers as Record<string, string>)[n];

/* ══════════════════════════ Aisha ══════════════════════════ */

test("Aisha: so'rov URL, X-Api-Key sarlavhasi va JSON tanasi", async () => {
  const { tts, calls } = aisha(() => new Response(body(wav(16_000, 1)), { status: 200, headers: { "content-type": "audio/wav" } }));
  const out = await tts.synthesize("Assalomu alaykum", { lang: "uz", voice: "gulnoza", speed: 1.2 });

  assert.equal(calls[0].url, AISHA_URL);
  // MUTATSIYA 2: `Authorization` bilan Aisha 401 qaytarardi.
  assert.equal(headerOf(calls[0], "X-Api-Key"), "ak");
  const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(sent.transcript, "Assalomu alaykum");
  assert.equal(sent.model, "gulnoza");
  assert.equal(sent.speed, 1.2);
  assert.equal(sent.language, "uz");

  assert.ok(out.wav && out.wav.length);
  assert.equal(out.mp3, undefined, "Aisha MP3 bermaydi — format yo'qolmasin");
  assert.equal(out.seconds, 1);
  assert.equal(out.chars, "Assalomu alaykum".length);
});

test("Aisha: tezlik 0.5–2.0 oralig'iga siqiladi, ovoz berilmasa standart", () => {
  assert.equal(aishaBody("x", { lang: "uz", speed: 9 }).speed, 2);
  assert.equal(aishaBody("x", { lang: "uz", speed: 0.1 }).speed, 0.5);
  assert.equal(aishaBody("x", { lang: "uz" }).model, "gulnoza");
});

test("Aisha: 1 000 belgidan uzun bo'lak tarmoqqa CHIQMAYDI", async () => {
  const { tts, calls } = aisha(() => new Response(body(wav(16_000, 1)), { headers: { "content-type": "audio/wav" } }));
  // MUTATSIYA 1: tekshiruvsiz so'rov ketib, Aisha 400 berardi.
  await assert.rejects(() => tts.synthesize("a".repeat(AISHA_MAX_CHARS + 1), { lang: "uz" }), /chegara 1000/);
  assert.equal(calls.length, 0);
});

test("Aisha: javob JSON + base64 bo'lsa ikkinchi so'rov YO'Q", async () => {
  const b64 = Buffer.from(wav(16_000, 0.5)).toString("base64");
  const { tts, calls } = aisha(() => Response.json({ audio_path: b64 }));
  const out = await tts.synthesize("Salom", { lang: "uz" });
  // MUTATSIYA 3: base64 URL deb o'qilsa `fetch("UklGR…")` yiqilardi.
  assert.equal(calls.length, 1);
  assert.equal(out.seconds, 0.5);
  assert.deepEqual(aishaAudioRef({ url: "https://x/y.wav" }), { url: "https://x/y.wav" });
  assert.deepEqual(aishaAudioRef({ data: { audio: "data:audio/wav;base64,AAA" } }), { base64: "AAA" });
  assert.equal(aishaAudioRef({ status: "ok" }), null);
});

test("Aisha: javob JSON + havola bo'lsa audio IKKINCHI so'rov bilan yuklanadi", async () => {
  const { tts, calls } = aisha((c) =>
    c.url === AISHA_URL ? Response.json({ audio_path: "/media/tts/a.wav" }) : new Response(body(wav(16_000, 2)), { headers: { "content-type": "audio/wav" } }),
  );
  // Germetik: havola `safeFetchUrl` orqali (EXT-15) — DNS stub.
  setSafeFetchLookup(async () => ["185.1.1.1"]);
  const out = await tts.synthesize("Salom", { lang: "uz" }).finally(() => setSafeFetchLookup(null));
  assert.equal(calls.length, 2);
  // Nisbiy yo'l xostga bog'lanadi.
  assert.equal(calls[1].url, "https://back.aisha.group/media/tts/a.wav");
  assert.equal(out.seconds, 2);
});

test("Aisha: audio bo'lmagan 200 javob va xato kodlari to'g'ri tasniflanadi", async () => {
  // MUTATSIYA 4: tekshiruvsiz `wavToMp3` keyinroq `null` berib, sabab
  // «enkoder yo'q» bilan chalkashardi.
  const bad = aisha(() => Response.json({ audio_path: Buffer.from("not a wav at all, just text padding".repeat(20)).toString("base64") }));
  await assert.rejects(() => bad.tts.synthesize("Salom", { lang: "uz" }), /WAV o'qilmadi/);

  const blocked = aisha(() => new Response("no key", { status: 403 }));
  await assert.rejects(
    () => blocked.tts.synthesize("Salom", { lang: "uz" }),
    (e: unknown) => e instanceof TtsError && e.retryable === false && e.provider === "aisha",
  );
  const busy = aisha(() => new Response("slow", { status: 429 }));
  await assert.rejects(
    () => busy.tts.synthesize("Salom", { lang: "uz" }),
    (e: unknown) => e instanceof TtsError && e.retryable === true,
  );
  const none = aisha(() => new Response("", { status: 200 }), "");
  await assert.rejects(() => none.tts.synthesize("Salom", { lang: "uz" }), /AISHA_API_KEY/);
});

/* ══════════════════════════ Gemini (preview) ══════════════════════════ */

const geminiOk = (rate = 24_000, sec = 1) =>
  Response.json({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: `audio/L16;codec=pcm;rate=${rate}`, data: Buffer.from(new Uint8Array(Math.round(rate * sec) * 2)).toString("base64") } }] } }],
  });

test("Gemini: configured() PREVIEW modelga bog'langan, kalitning o'ziga emas", () => {
  const { fetchImpl } = mock(() => geminiOk());
  // MUTATSIYA 5: `GEMINI_API_KEY` yetarli bo'lsa, Azure yiqilganda har
  // podkast jimgina sinovdan o'tmagan preview modelga tushardi.
  assert.equal(makeGeminiTts({ fetchImpl, key: () => "g", model: () => "" }).configured(), false);
  assert.equal(makeGeminiTts({ fetchImpl, key: () => "", model: () => "m" }).configured(), false);
  assert.equal(makeGeminiTts({ fetchImpl, key: () => "g", model: () => "m" }).configured(), true);
});

test("Gemini: kalit SARLAVHADA, so'rov AUDIO modaliteti bilan", async () => {
  const { fetchImpl, calls } = mock(() => geminiOk());
  const tts = makeGeminiTts({ fetchImpl, key: () => "g-secret", model: () => "gemini-2.5-flash-preview-tts" });
  await tts.synthesize("Salom", { lang: "uz", voice: "Kore" });
  // MUTATSIYA 7: URL query da kalit proxy/jurnal loglariga tushardi.
  assert.ok(!calls[0].url.includes("g-secret"));
  assert.equal(headerOf(calls[0], "x-goog-api-key"), "g-secret");
  assert.match(calls[0].url, /models\/gemini-2\.5-flash-preview-tts:generateContent$/);
  const sent = JSON.parse(String(calls[0].init.body)) as { generationConfig: { responseModalities: string[]; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } } };
  assert.deepEqual(sent.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
});

test("Gemini: PCM javobi chastota bilan WAV ga o'raladi", async () => {
  const { fetchImpl } = mock(() => geminiOk(16_000, 2));
  const tts = makeGeminiTts({ fetchImpl, key: () => "g", model: () => "m" });
  const out = await tts.synthesize("Salom", { lang: "uz" });
  assert.ok(out.wav);
  // MUTATSIYA 6: chastota o'qilmasa 2 s audio 1.33 s deb hisoblanardi.
  assert.equal(out.seconds, 2);
  assert.equal(wavSeconds(out.wav!), 2);
  assert.equal(pcmRateOf("audio/L16;codec=pcm;rate=16000"), 16_000);
  assert.equal(pcmRateOf(undefined), 24_000);
  assert.equal(geminiAudioPart({ candidates: [{ content: { parts: [{ text: "x" }] } }] }), null);
});

test("Gemini: model yoqilmagan yoki javobda audio yo'q — aniq xato", async () => {
  const { fetchImpl } = mock(() => Response.json({ error: { message: "model not found" } }));
  const off = makeGeminiTts({ fetchImpl, key: () => "g", model: () => "" });
  await assert.rejects(() => off.synthesize("x", { lang: "uz" }), /TTS_GEMINI_MODEL/);
  const on = makeGeminiTts({ fetchImpl, key: () => "g", model: () => "m" });
  await assert.rejects(
    () => on.synthesize("x", { lang: "uz" }),
    (e: unknown) => e instanceof TtsError && e.retryable === false && /model not found/.test(e.message),
  );
});
