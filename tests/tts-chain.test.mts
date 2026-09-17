import test from "node:test";
import assert from "node:assert/strict";
import { chainOfProvider, makeTtsChain, ttsGroups, ttsVoiceChain, ttsVoiceEnvName } from "../lib/generation/tts/chain.ts";
import { TtsError, type TtsAudio, type TtsProvider, type TtsProviderId, type TtsSynthOpts } from "../lib/generation/tts/types.ts";

/**
 * TTS ZAXIRA ZANJIRI (AUDIT-22 WP-A) — `llm/chain.ts` naqshi, til bilan
 * parametrlangan.
 *
 * Eng muhim shartnoma: provayder BUTUN ISH uchun bog'lanadi. Aks holda
 * bitta podkastda Azure MP3 (24 kHz) va Aisha WAV (16 kHz) aralashib,
 * `concatMp3` profil tekshiruvida yiqilardi — yoki tekshiruvsiz
 * o'ynamaydigan fayl chiqardi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. Zanjir provayderni HAR BO'LAK uchun tanladi (birinchi yiqilgan
 *      bo'lakdan keyin keyingisiga o'tdi, avvalgilarini saqlab) —
 *      «yiqilganda BUTUN ish keyingi provayderda boshidan» testi;
 *   2. `configured()` tekshiruvi tashlandi — «kalitsiz provayder
 *      o'tkazib yuboriladi va tarmoqqa chiqmaydi» testi;
 *   3. `TTS_VOICE_<TIL>` jadvalni KENGAYTIRDI (qo'shib qo'ydi) —
 *      «muhit jadvalni almashtiradi» testi;
 *   4. Rol B ovozi rol A niki bilan bir xil berildi — «ikki ovoz»
 *      testi;
 *   5. `retryable:false` xatosida ham bo'lak qayta urinildi — «kalit
 *      xatosida qayta urinish yo'q» testi;
 *   6. Jurnal qatori yozilmadi — «[tts:uz] provider → ok N ms» testi;
 *   7. Hech bir provayder sozlanmaganda `null` qaytdi — «aniq xato»
 *      testi (dvigatel `null` ni «model javob bermadi» deb ko'rsatardi);
 *   8. Bo'lak uzunligi tekshiruvi tashlandi — «900 dan uzun bo'lak
 *      rad etiladi» testi;
 *   9. `TTS_VOICE_UZ` dagi noma'lum provayder qabul qilindi — «yaroqsiz
 *      yozuv tashlanadi» testi.
 */

/* ── mock provayderlar ── */

type Rec = { text: string; voice?: string; pauseMs?: number };

function fake(id: TtsProviderId, o: { configured?: boolean; failAt?: number; error?: TtsError } = {}): TtsProvider & { calls: Rec[] } {
  const calls: Rec[] = [];
  let n = 0;
  return {
    id,
    calls,
    configured: () => o.configured !== false,
    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      calls.push({ text, ...(opts.voice !== undefined ? { voice: opts.voice } : {}), ...(opts.pauseMs !== undefined ? { pauseMs: opts.pauseMs } : {}) });
      n += 1;
      if (o.failAt !== undefined && n === o.failAt) throw o.error ?? new TtsError(id, "yiqildi", { retryable: false });
      return { mp3: new Uint8Array([1, 2, 3]), seconds: 1, chars: text.length };
    },
  };
}

const parts = (...texts: string[]) => texts.map((text, i) => ({ text, voice: i % 2 }));

const envOf = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

/* ══════════════════════════ ovoz zanjiri ══════════════════════════ */

test("TTS_VOICE_<TIL> jadvalni ALMASHTIRADI, kengaytirmaydi", () => {
  assert.equal(ttsVoiceEnvName("uz"), "TTS_VOICE_UZ");
  assert.equal(ttsVoiceEnvName("kaa"), "TTS_VOICE_KAA");

  const table = ttsVoiceChain("uz", envOf({}));
  assert.equal(table[0].provider, "azure");
  assert.equal(table[0].voice, "uz-UZ-MadinaNeural");
  assert.equal(table.length, 3);

  const custom = ttsVoiceChain("uz", envOf({ TTS_VOICE_UZ: "aisha:gulnoza" }));
  // MUTATSIYA 3: kengaytirilsa Azure baribir birinchi qolardi va
  // operator ovozni boshqara olmasdi.
  assert.deepEqual(
    custom.map((v) => `${v.provider}:${v.voice}`),
    ["aisha:gulnoza"],
  );
});

test("TTS_VOICE_<TIL> dagi yaroqsiz yozuv tashlanadi; hammasi yaroqsiz bo'lsa jadvalga qaytiladi", () => {
  const mixed = ttsVoiceChain("uz", envOf({ TTS_VOICE_UZ: "shovqin, :bo'sh, unknown:x, azure:uz-UZ-SardorNeural" }));
  // MUTATSIYA 9: noma'lum provayder qabul qilinsa zanjir adapter
  // topolmay, jimgina bo'sh qolardi.
  assert.deepEqual(
    mixed.map((v) => v.voice),
    ["uz-UZ-SardorNeural"],
  );
  const broken = ttsVoiceChain("uz", envOf({ TTS_VOICE_UZ: "shovqin,unknown:x" }));
  assert.equal(broken[0].provider, "azure");
  assert.equal(broken.length, 3);
});

test("ttsGroups provayder bo'yicha guruhlaydi (tartib saqlanadi, A/B ovozlar bitta guruhda)", () => {
  const groups = ttsGroups("uz", envOf({}));
  assert.deepEqual(groups, [
    { provider: "azure", voices: ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"] },
    { provider: "aisha", voices: ["gulnoza"] },
  ]);
});

/* ══════════════════════════ zanjir ══════════════════════════ */

test("birinchi sozlangan provayder butun ishni bajaradi; jurnalga «ok N ms» yoziladi", async () => {
  const azure = fake("azure");
  const aisha = fake("aisha");
  const log: string[] = [];
  const chain = makeTtsChain({ providers: [azure, aisha], env: envOf({}), log: (l) => log.push(l) });

  const run = await chain.synthesizeAll(parts("Bir", "Ikki", "Uch"), { lang: "uz" });
  assert.equal(run.provider, "azure");
  assert.equal(azure.calls.length, 3);
  assert.equal(aisha.calls.length, 0);
  assert.equal(run.audios.length, 3);
  assert.equal(run.seconds, 3);
  assert.equal(run.chars, "BirIkkiUch".length);
  assert.equal(run.usages.length, 3);
  assert.equal(run.usages[0].provider, "azure");
  // MUTATSIYA 6: jurnalsiz jonli sinovda qaysi provayder ishlagani
  // umuman ko'rinmasdi.
  assert.ok(log.some((l) => /^\[tts:uz\] azure → ok \d+ ms \(3 bo'lak, 10 belgi\)$/.test(l)), log.join(" | "));
});

test("ikki ovoz: rol A birinchi, rol B ikkinchi ovozni oladi", async () => {
  const azure = fake("azure");
  const chain = makeTtsChain({ providers: [azure], env: envOf({}), log: () => {} });
  const run = await chain.synthesizeAll(parts("A gapiradi", "B gapiradi", "A yana"), { lang: "uz" });
  // MUTATSIYA 4: bir xil ovoz bo'lsa dialog monologga aylanardi.
  assert.deepEqual(
    azure.calls.map((c) => c.voice),
    ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural", "uz-UZ-MadinaNeural"],
  );
  assert.equal(run.voiceA, "azure:uz-UZ-MadinaNeural");
  assert.equal(run.voiceB, "azure:uz-UZ-SardorNeural");
});

test("bitta ovozli guruhda ikkala rol ham SHU ovozni oladi (fayl baribir chiqadi)", async () => {
  const aisha = fake("aisha");
  const chain = makeTtsChain({ providers: [aisha], env: envOf({ TTS_VOICE_UZ: "aisha:gulnoza" }), log: () => {} });
  const run = await chain.synthesizeAll(parts("A", "B"), { lang: "uz" });
  assert.equal(run.voiceA, "aisha:gulnoza");
  assert.equal(run.voiceB, "aisha:gulnoza");
  assert.deepEqual(aisha.calls.map((c) => c.voice), ["gulnoza", "gulnoza"]);
});

test("kalitsiz provayder O'TKAZIB yuboriladi (tarmoqqa chiqmasdan) va jurnalga tushadi", async () => {
  const azure = fake("azure", { configured: false });
  const aisha = fake("aisha");
  const log: string[] = [];
  const chain = makeTtsChain({ providers: [azure, aisha], env: envOf({}), log: (l) => log.push(l) });

  const run = await chain.synthesizeAll(parts("Salom"), { lang: "uz" });
  // MUTATSIYA 2: tekshiruvsiz kalitsiz Azure ga so'rov ketib, 401 bilan
  // vaqt yo'qotilardi.
  assert.equal(azure.calls.length, 0);
  assert.equal(run.provider, "aisha");
  assert.ok(log.some((l) => l.includes("azure → kalit yo'q")), log.join(" | "));
  assert.deepEqual(chain.providersFor("uz"), ["aisha"]);
});

test("provayder o'rtada yiqilsa — BUTUN ish keyingi provayderda BOSHIDAN", async () => {
  // Uchinchi bo'lakda yiqiladi: birinchi ikkitasi allaqachon MP3 bo'lgan.
  const azure = fake("azure", { failAt: 3, error: new TtsError("azure", "400 bad ssml", { retryable: false }) });
  const aisha = fake("aisha");
  const chain = makeTtsChain({ providers: [azure, aisha], env: envOf({}), log: () => {} });

  const run = await chain.synthesizeAll(parts("Bir", "Ikki", "Uch"), { lang: "uz" });
  assert.equal(run.provider, "aisha");
  /*
   * MUTATSIYA 1: bo'lak darajasida almashtirilsa natija 2 ta Azure MP3
   * + 1 ta Aisha WAV bo'lardi — ya'ni 24 kHz va 16 kHz bitta faylda.
   */
  assert.equal(run.audios.length, 3);
  assert.equal(aisha.calls.length, 3, "zaxira provayder HAMMA bo'lakni qaytadan aytadi");
  assert.ok(run.usages.every((u) => u.provider === "aisha"));
});

test("retryable xato bo'lakda qayta uriladi; retryable:false darhol keyingi provayderga", async () => {
  // 429 — birinchi urinishda yiqiladi, ikkinchisida o'tadi.
  const flaky = fake("azure", { failAt: 1, error: new TtsError("azure", "429", { retryable: true, retryAfterMs: 1 }) });
  const chain = makeTtsChain({ providers: [flaky], env: envOf({}), log: () => {} });
  const run = await chain.synthesizeAll(parts("Salom"), { lang: "uz" });
  assert.equal(run.audios.length, 1);
  assert.equal(flaky.calls.length, 2, "429 dan keyin AYNI bo'lak qayta so'raladi");

  // 401 — qayta urinish yo'q.
  const dead = fake("azure", { failAt: 1, error: new TtsError("azure", "401", { retryable: false }) });
  const aisha = fake("aisha");
  const c2 = makeTtsChain({ providers: [dead, aisha], env: envOf({}), log: () => {} });
  await c2.synthesizeAll(parts("Salom"), { lang: "uz" });
  // MUTATSIYA 5: kalit xatosida ikki marta urinish har bo'lakda ikki
  // barobar kechikish berardi.
  assert.equal(dead.calls.length, 1);
  assert.equal(aisha.calls.length, 1);
});

test("hech bir provayder sozlanmagan — ANIQ xato («Ovoz provayderi sozlanmagan»), null emas", async () => {
  const chain = makeTtsChain({ providers: [fake("azure", { configured: false }), fake("aisha", { configured: false })], env: envOf({}), log: () => {} });
  assert.equal(chain.configured(), false);
  assert.deepEqual(chain.providersFor("uz"), []);
  // MUTATSIYA 7: `null` bo'lsa dvigatel buni «model javob bermadi» deb
  // ko'rsatib, egasiga sozlama muammosi ko'rinmasdi.
  await assert.rejects(
    () => chain.synthesizeAll(parts("Salom"), { lang: "uz" }),
    (e: unknown) => e instanceof TtsError && /sozlanmagan/.test(e.message) && e.retryable === false,
  );
});

test("barcha provayderlar yiqilsa — OXIRGI xato ko'tariladi", async () => {
  const azure = fake("azure", { failAt: 1, error: new TtsError("azure", "azure yiqildi") });
  const aisha = fake("aisha", { failAt: 1, error: new TtsError("aisha", "aisha yiqildi") });
  const chain = makeTtsChain({ providers: [azure, aisha], env: envOf({}), log: () => {} });
  await assert.rejects(() => chain.synthesizeAll(parts("Salom"), { lang: "uz" }), /aisha yiqildi/);
});

test("900 belgidan uzun bo'lak RAD etiladi (bo'laklash chaqiruvchida)", async () => {
  const azure = fake("azure");
  const chain = makeTtsChain({ providers: [azure], env: envOf({}), log: () => {} });
  // MUTATSIYA 8: jimgina kesish matnni YO'QOTARDI — foydalanuvchi
  // ssenariyda ko'rgan gap audioda yo'q bo'lardi.
  await assert.rejects(() => chain.synthesizeAll([{ text: "a".repeat(901) }], { lang: "uz" }), /chegara 900/);
  assert.equal(azure.calls.length, 0);
});

test("pauza va tezlik provayderga uzatiladi; bo'sh bo'laklar tashlanadi", async () => {
  const azure = fake("azure");
  const chain = makeTtsChain({ providers: [azure], env: envOf({}), log: () => {} });
  const run = await chain.synthesizeAll([{ text: "Bir", pauseMs: 400 }, { text: "   " }, { text: "Ikki", pauseMs: 800 }], { lang: "uz", speed: 1.1 });
  assert.equal(run.audios.length, 2);
  assert.deepEqual(azure.calls.map((c) => c.pauseMs), [400, 800]);
});

test("chainOfProvider bitta adapterni o'raydi (test/lab yo'li, jadvalga qaramaydi)", async () => {
  const p = fake("azure");
  const log: string[] = [];
  const chain = chainOfProvider(p, ["V1", "V2"], (l) => log.push(l));
  const run = await chain.synthesizeAll(parts("A", "B"), { lang: "ru" });
  assert.equal(run.voiceA, "azure:V1");
  assert.equal(run.voiceB, "azure:V2");
  assert.deepEqual(p.calls.map((c) => c.voice), ["V1", "V2"]);
  assert.ok(log.some((l) => l.startsWith("[tts:ru] azure → ok")));

  const off = chainOfProvider(fake("azure", { configured: false }));
  await assert.rejects(() => off.synthesizeAll(parts("A"), { lang: "uz" }), /sozlanmagan/);
});
