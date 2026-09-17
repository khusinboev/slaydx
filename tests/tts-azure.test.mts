import test from "node:test";
import assert from "node:assert/strict";
import { AZURE_OUTPUT_FORMAT, azureEndpoint, azureSsml, localeOfVoice, makeAzureTts, prosodyRate, xmlEscape } from "../lib/generation/tts/azure.ts";
import { TtsError } from "../lib/generation/tts/types.ts";

/**
 * AZURE TTS adapteri (AUDIT-22 WP-A) — `fetch` MOCK bilan.
 *
 * KALIT YO'Q (`tts.md` §6), shuning uchun adapter hujjatga ko'ra
 * yozilgan va bu yerda faqat SO'ROVNING SHAKLI va XATO TASNIFI
 * sinaladi: qaysi URL, qaysi sarlavha, qanday SSML, va qaysi status
 * kodda zanjir keyingi provayderga o'tadi. Haqiqiy ovoz sifati —
 * `scripts/tts-lab.mts` (egasi kalit bergach).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `xmlEscape` olib tashlandi — «matndagi < va & SSML ni buzmaydi»
 *      testi (so'rov tanasi yaroqsiz XML bo'lardi);
 *   2. `X-Microsoft-OutputFormat` sarlavhasi tushib qoldi — «MP3
 *      formati so'raladi» testi (Azure standart WAV qaytarardi va
 *      `concatMp3` butun ishni yiqitardi);
 *   3. `azureRetryable(403)` `true` qildi — «403 da zanjir keyingisiga
 *      o'tadi» testi (kalit yaroqsizligida uch marta qayta urinardi);
 *   4. `localeOfVoice` DOIM forma tilini qaytardi — «xml:lang ovozdan
 *      olinadi» testi (`kaa` tilida Azure 400 berardi);
 *   5. `prosodyRate(1)` `+0%` qaytardi — «tezlik 1 bo'lsa prosody
 *      yozilmaydi» testi;
 *   6. `configured()` faqat kalitni tekshirdi — «region ham shart»
 *      testi;
 *   7. javobdagi kadr tekshiruvi olib tashlandi — «MP3 bo'lmagan 200
 *      javob xato beradi» testi;
 *   8. `pauseMs` `<break>` siz yozildi — «pauza SSML ga tushadi» testi.
 */

/** MPEG2/24 kHz/96 kbps mono kadr — Azure `AZURE_OUTPUT_FORMAT` chiqishi. */
function azureMp3(frames = 5): Uint8Array {
  const size = Math.floor((72_000 * 96) / 24_000); // 288
  const out = new Uint8Array(size * frames);
  for (let i = 0; i < frames; i++) {
    const at = i * size;
    out[at] = 0xff;
    out[at + 1] = 0xf3;
    out[at + 2] = 0xa4;
    out[at + 3] = 0xc0;
  }
  return out;
}

type Call = { url: string; init: RequestInit };

function mockFetch(respond: (call: Call) => Response): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** `Response` tanasi `ArrayBuffer` kutadi — `Uint8Array` to'g'ridan-to'g'ri o'tmaydi. */
const body = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const okMp3 = () => new Response(body(azureMp3()), { status: 200, headers: { "content-type": "audio/mpeg" } });

const provider = (respond: (c: Call) => Response, key = "k", region = "westeurope") => {
  const { fetchImpl, calls } = mockFetch(respond);
  return { tts: makeAzureTts({ fetchImpl, key: () => key, region: () => region }), calls };
};

const headerOf = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

/* ══════════════════════════ sozlama ══════════════════════════ */

test("configured(): kalit VA region ikkalasi ham shart", () => {
  const f = mockFetch(okMp3).fetchImpl;
  assert.equal(makeAzureTts({ fetchImpl: f, key: () => "k", region: () => "westeurope" }).configured(), true);
  // MUTATSIYA 6: faqat kalit tekshirilsa URL `https://.tts.speech…`
  // bo'lib, DNS xatosi «tarmoq nosozligi» deb ko'rinardi.
  assert.equal(makeAzureTts({ fetchImpl: f, key: () => "k", region: () => "" }).configured(), false);
  assert.equal(makeAzureTts({ fetchImpl: f, key: () => "", region: () => "westeurope" }).configured(), false);
});

test("endpoint region bilan quriladi", () => {
  assert.equal(azureEndpoint("westeurope"), "https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1");
});

/* ══════════════════════════ SSML ══════════════════════════ */

test("SSML: ovoz, xml:lang va matn; tezlik 1 bo'lsa prosody YO'Q", () => {
  const ssml = azureSsml("Salom", { lang: "uz", voice: "uz-UZ-MadinaNeural" });
  assert.match(ssml, /<speak version="1\.0"/);
  assert.match(ssml, /xml:lang="uz-UZ"/);
  assert.match(ssml, /<voice name="uz-UZ-MadinaNeural">Salom<\/voice>/);
  // MUTATSIYA 5: `+0%` prosody keraksiz va ba'zi ovozlarda ohangni buzadi.
  assert.ok(!ssml.includes("prosody"));
  assert.equal(prosodyRate(1), null);
  assert.equal(prosodyRate(undefined), null);
  assert.equal(prosodyRate(1.1), "+10%");
  assert.equal(prosodyRate(0.9), "-10%");
  assert.match(azureSsml("Salom", { lang: "uz", voice: "uz-UZ-MadinaNeural", speed: 1.2 }), /<prosody rate="\+20%">Salom<\/prosody>/);
});

test("SSML: matndagi <, & va tirnoq ekranlanadi", () => {
  // MUTATSIYA 1: ekranlashsiz «5 < 7 & «A»» so'rovni yaroqsiz XML qilardi.
  const ssml = azureSsml('5 < 7 & "A"', { lang: "uz", voice: "uz-UZ-MadinaNeural" });
  assert.ok(ssml.includes("5 &lt; 7 &amp; &quot;A&quot;"));
  assert.equal(xmlEscape("<a>&</a>"), "&lt;a&gt;&amp;&lt;/a&gt;");
  // Ovoz nomi ham ekranlanadi — u ATRIBUT ichida turadi.
  assert.ok(azureSsml("x", { lang: "uz", voice: 'a"b' }).includes('name="a&quot;b"'));
});

test("SSML: pauza <break> bo'lib qo'shiladi (faqat Azure yo'lida)", () => {
  // MUTATSIYA 8: pauza xom matnga qo'shilsa Aisha uni O'QIB yuborardi.
  const ssml = azureSsml("Salom", { lang: "uz", voice: "uz-UZ-MadinaNeural", pauseMs: 400 });
  assert.match(ssml, /<break time="400ms"\/><\/voice>/);
  assert.ok(!azureSsml("Salom", { lang: "uz", voice: "uz-UZ-MadinaNeural", pauseMs: 0 }).includes("break"));
  // 5 s dan uzun pauza kesiladi — uzun jimlik «fayl tugadi» deb o'qiladi.
  assert.match(azureSsml("x", { lang: "uz", voice: "v", pauseMs: 99_000 }), /time="5000ms"/);
});

test("xml:lang ovoz nomidan olinadi (tasdiqlanmagan tillar uchun ham)", () => {
  assert.equal(localeOfVoice("uz-UZ-MadinaNeural", "uz"), "uz-UZ");
  // MUTATSIYA 4: `kaa` tilida ovoz o'zbekniki — `xml:lang="kaa-KAA"`
  // bo'lsa Azure 400 qaytarardi.
  assert.equal(localeOfVoice("uz-UZ-MadinaNeural", "kaa"), "uz-UZ");
  assert.equal(localeOfVoice("", "ru"), "ru-RU");
});

/* ══════════════════════════ so'rov ══════════════════════════ */

test("so'rov: URL, kalit sarlavhasi va MP3 chiqish formati", async () => {
  const { tts, calls } = provider(okMp3);
  const out = await tts.synthesize("Salom dunyo", { lang: "uz", voice: "uz-UZ-MadinaNeural" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, azureEndpoint("westeurope"));
  assert.equal(calls[0].init.method, "POST");
  assert.equal(headerOf(calls[0], "Ocp-Apim-Subscription-Key"), "k");
  assert.equal(headerOf(calls[0], "Content-Type"), "application/ssml+xml");
  // MUTATSIYA 2: formatsiz Azure WAV qaytarardi.
  assert.equal(headerOf(calls[0], "X-Microsoft-OutputFormat"), AZURE_OUTPUT_FORMAT);
  assert.match(String(calls[0].init.body), /<voice name="uz-UZ-MadinaNeural">Salom dunyo<\/voice>/);

  assert.ok(out.mp3 && out.mp3.length);
  assert.equal(out.wav, undefined);
  assert.equal(out.chars, "Salom dunyo".length);
  // Davomiylik KADRLARDAN o'lchanadi: 5 × 576 / 24 000.
  assert.ok(Math.abs(out.seconds - (5 * 576) / 24_000) < 1e-3);
});

test("kalitsiz/ovozsiz/bo'sh matn — darhol xato, tarmoqqa chiqmaydi", async () => {
  const { tts, calls } = provider(okMp3, "");
  await assert.rejects(() => tts.synthesize("x", { lang: "uz", voice: "v" }), TtsError);
  const ok = provider(okMp3);
  await assert.rejects(() => ok.tts.synthesize("   ", { lang: "uz", voice: "v" }), /bo'sh matn/);
  await assert.rejects(() => ok.tts.synthesize("x", { lang: "uz" }), /ovoz nomi/);
  assert.equal(calls.length, 0);
  assert.equal(ok.calls.length, 0);
});

/* ══════════════════════════ xatolar ══════════════════════════ */

test("403/401/400 — retryable:false (zanjir keyingi provayderga o'tadi)", async () => {
  for (const status of [400, 401, 403]) {
    const { tts } = provider(() => new Response("nope", { status }));
    // MUTATSIYA 3: `true` bo'lsa kalit yaroqsizligida uch marta urinardi.
    await assert.rejects(
      () => tts.synthesize("Salom", { lang: "uz", voice: "v" }),
      (e: unknown) => e instanceof TtsError && e.retryable === false && e.status === status && e.provider === "azure",
    );
  }
});

test("429 va 5xx — retryable:true, Retry-After o'qiladi", async () => {
  const { tts } = provider(() => new Response("slow", { status: 429, headers: { "retry-after": "2" } }));
  await assert.rejects(
    () => tts.synthesize("Salom", { lang: "uz", voice: "v" }),
    (e: unknown) => e instanceof TtsError && e.retryable === true && e.retryAfterMs === 2000,
  );
  const { tts: t5 } = provider(() => new Response("boom", { status: 503 }));
  await assert.rejects(
    () => t5.synthesize("Salom", { lang: "uz", voice: "v" }),
    (e: unknown) => e instanceof TtsError && e.retryable === true && e.status === 503,
  );
});

test("tarmoq uzilishi — retryable:true; MP3 bo'lmagan 200 javob — retryable:false", async () => {
  const net = makeAzureTts({
    fetchImpl: (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch,
    key: () => "k",
    region: () => "r",
  });
  await assert.rejects(
    () => net.synthesize("Salom", { lang: "uz", voice: "v" }),
    (e: unknown) => e instanceof TtsError && e.retryable === true,
  );

  // MUTATSIYA 7: tekshiruvsiz «xato sahifasi» audio deb ulanib, fayl
  // faqat TINGLAGANDA buzuq ekani bilinardi.
  const { tts } = provider(() => new Response("<html>error</html>", { status: 200, headers: { "content-type": "text/html" } }));
  await assert.rejects(
    () => tts.synthesize("Salom", { lang: "uz", voice: "v" }),
    (e: unknown) => e instanceof TtsError && e.retryable === false && /MP3 kadri/.test(e.message),
  );
});
