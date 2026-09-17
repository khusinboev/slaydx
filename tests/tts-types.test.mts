import test from "node:test";
import assert from "node:assert/strict";
import {
  TTS_FALLBACK_LANG,
  TTS_LANG_VOICES,
  TTS_LIMITS,
  TTS_PRICES,
  TTS_PROVIDERS,
  TtsMeter,
  audioBytes,
  chunkText,
  formatVoiceId,
  isTtsProviderId,
  parseVoiceId,
  ttsCostUsd,
  ttsVerified,
  ttsVoiceFor,
  ttsVoicesFor,
} from "../lib/generation/tts/types.ts";
import { AUDIO_LIMITS } from "../lib/generation/audio/types.ts";
import { ALL_LANGUAGES } from "../lib/languages.ts";

/**
 * TTS SHARTNOMASI (AUDIT-22 R0) — provayder chaqiruvi YO'Q (kalitlar
 * yo'q, `tts.md` §6), shuning uchun bu yerda faqat sof mantiq sinaladi:
 * til → ovoz jadvali, bo'laklash va hisoblagich.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `chunkText` da jumla chegarasi olib tashlandi (faqat `slice`) —
 *      «bo'lak jumla o'rtasidan kesilmaydi» testi;
 *   2. `chunkText` bo'sh bo'lak qaytardi (`filter(Boolean)` olib
 *      tashlandi) — «bo'sh bo'lak yo'q» testi;
 *   3. `TTS_LIMITS.chunkChars` 900 → 1 200 — «Aisha chegarasi» testi;
 *   4. `ttsVoicesFor` noma'lum tilda `undefined` qaytardi — «noma'lum
 *      til zaxira ovozga tushadi» testi;
 *   5. `TtsMeter.add` narxni belgiga emas, chaqiruvga bog'ladi —
 *      «tannarx belgiga proporsional» testi;
 *   6. `parseVoiceId` noma'lum provayderni qabul qildi — «shakl
 *      tekshiruvi» testi.
 */

test("18 tilning HAMMASIDA ovoz bor; ovoz shakli to'liq", () => {
  /*
   * Forma 18 til taklif qiladi (`ALL_LANGUAGES`), ya'ni jadvalda tili
   * yo'q foydalanuvchi «til tanladim — audio chiqmadi» holatiga
   * tushmasligi kerak. MUTATSIYA: jadvaldan bitta tilni o'chirish.
   */
  assert.equal(ALL_LANGUAGES.length, 18, "til ro'yxati o'zgardi — jadval ham yangilansin");
  for (const l of ALL_LANGUAGES) {
    const voices = TTS_LANG_VOICES[l.value];
    assert.ok(voices && voices.length >= 1, `${l.value}: ovoz jadvalda yo'q`);
    for (const v of voices) {
      assert.ok(isTtsProviderId(v.provider), `${l.value}: noma'lum provayder ${v.provider}`);
      assert.ok(v.voice.length > 3, `${l.value}: ovoz nomi bo'sh`);
      assert.ok(v.gender === "female" || v.gender === "male", `${l.value}: jins yo'q`);
      assert.equal(typeof v.verified, "boolean", `${l.value}: tasdiqlanish bayrog'i yo'q`);
    }
  }
  // Har provayder narx jadvalida bo'lsin (aks holda tannarx 0 chiqardi).
  for (const p of TTS_PROVIDERS) assert.ok(TTS_PRICES[p], `${p}: narx yo'q`);
});

test("o'zbek tili — Azure Neural + Aisha; tasdiqlanmagan tillar belgilangan", () => {
  const uz = ttsVoicesFor("uz");
  assert.ok(uz.length >= 2, "o'zbekchada ikkinchi ovoz yo'q — dialog bir ovozda chiqardi");
  assert.equal(uz[0].provider, "azure");
  assert.match(uz[0].voice, /^uz-UZ-/, "birinchi ovoz rasmiy uz-UZ Neural bo'lishi kerak");
  assert.ok(uz.some((v) => v.provider === "aisha"), "mahalliy zaxira (Aisha) tushib qolgan");
  assert.ok(ttsVerified("uz"));

  /*
   * `tts.md` §3/§6: qoraqalpoq, qirg'iz, tojik va turkman uchun rasmiy
   * ovoz TOPILMADI — jadvalda eng yaqin til turibdi va u ATAYLAB
   * `verified: false`. MUTATSIYA: bayroqni `true` qilish — hisobot
   * foydalanuvchini ogohlantirmay qo'yardi.
   */
  for (const lang of ["kaa", "ky", "tg", "tk"]) {
    assert.ok(ttsVoicesFor(lang).length >= 1, `${lang}: ovoz yo'q`);
    assert.equal(ttsVerified(lang), false, `${lang}: tasdiqlanmagan ovoz tasdiqlangan deb belgilangan`);
  }
  for (const lang of ["uz", "ru", "en", "kk", "tr"]) assert.equal(ttsVerified(lang), true, `${lang}: tasdiqlangan ovoz yo'qoldi`);
});

test("rol bo'yicha ovoz; noma'lum til zaxira tilga tushadi", () => {
  const a = ttsVoiceFor("uz", 0);
  const b = ttsVoiceFor("uz", 1);
  assert.notEqual(formatVoiceId(a), formatVoiceId(b), "ikki rol bitta ovoz oldi");
  // Bitta ovozli tilda ikkala rol ham SHU ovozni oladi (xato emas).
  assert.equal(formatVoiceId(ttsVoiceFor("kaa", 1)), formatVoiceId(ttsVoiceFor("kaa", 0)));
  // Noma'lum til — zaxira (o'zbekcha), `undefined` EMAS.
  assert.deepEqual(ttsVoicesFor("xx"), TTS_LANG_VOICES[TTS_FALLBACK_LANG]);
  assert.deepEqual(ttsVoicesFor(""), TTS_LANG_VOICES[TTS_FALLBACK_LANG]);
  assert.equal(ttsVoiceFor("xx").provider, "azure");
  // Katta harf bilan kelgan kod ham topilsin (forma qiymati ishonchsiz).
  assert.deepEqual(ttsVoicesFor("UZ"), TTS_LANG_VOICES.uz);
});

test("`provider:voice` shakli — yozish va o'qish teskari amal", () => {
  const spec = ttsVoiceFor("ru");
  const id = formatVoiceId(spec);
  assert.equal(id, `${spec.provider}:${spec.voice}`);
  assert.deepEqual(parseVoiceId(id), { provider: spec.provider, voice: spec.voice });
  // Shakl tekshiruvi: noma'lum provayder, bo'sh ovoz, ikki nuqtasiz satr.
  for (const bad of ["", "azure", "azure:", ":voice", "openai:alloy", "  "]) {
    assert.equal(parseVoiceId(bad), null, `«${bad}» qabul qilindi`);
  }
  // Ovoz nomida ikki nuqta bo'lsa — faqat BIRINCHISI ajratgich.
  assert.deepEqual(parseVoiceId("azure:uz-UZ:Madina"), { provider: "azure", voice: "uz-UZ:Madina" });
});

test("bo'laklash: ≤900 belgi, jumla chegarasida, matn yo'qolmaydi", () => {
  // `tts.md` §3: eng qattiq provayder (Aisha) 1 000 belgi — bizda 900.
  assert.equal(TTS_LIMITS.chunkChars, 900);
  assert.equal(TTS_LIMITS.chunkChars, AUDIO_LIMITS.lineCharsMax, "replika va TTS bo'lagi chegarasi ajralib ketdi");

  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   "), []);
  assert.deepEqual(chunkText("Qisqa matn."), ["Qisqa matn."]);

  const sentence = "Bu jumla aynan yetmish besh belgidan iborat bo'lishi uchun yozilgan matn.";
  const long = Array.from({ length: 40 }, () => sentence).join(" ");
  const chunks = chunkText(long, 200);
  assert.ok(chunks.length > 1, "uzun matn bo'linmadi");
  for (const c of chunks) {
    assert.ok(c.length <= 200, `bo'lak uzun: ${c.length}`);
    assert.ok(c.trim().length > 0, "bo'sh bo'lak");
    // MUTATSIYA: sof `slice` bilan bo'lish — bo'lak nuqta bilan tugamasdi.
    assert.match(c, /[.!?…]$/, `bo'lak jumla o'rtasidan kesildi: «${c.slice(-30)}»`);
  }
  // Hech narsa yo'qolmaydi va takrorlanmaydi.
  assert.equal(chunks.join(" "), long);

  // Bitta so'zning o'zi chegaradan uzun bo'lsa — qattiq kesiladi.
  const huge = "a".repeat(250);
  const hard = chunkText(huge, 100);
  assert.deepEqual(hard.map((c) => c.length), [100, 100, 50]);
  assert.equal(hard.join(""), huge);
});

test("hisoblagich: tannarx BELGIGA proporsional, `cost_json` shakli", () => {
  const m = new TtsMeter();
  m.add({ provider: "azure", voice: "uz-UZ-MadinaNeural", chars: 1_000_000, seconds: 60 });
  const one = m.toJson();
  assert.equal(one.calls, 1);
  assert.equal(one.chars, 1_000_000);
  assert.equal(one.seconds, 60);
  assert.equal(one.usd, TTS_PRICES.azure.usdPerMillionChars, "1 M belgi = jadvaldagi narx");
  assert.equal(one.provider, "azure");
  assert.equal(one.voice, "azure:uz-UZ-MadinaNeural");

  // MUTATSIYA: narx chaqiruvga bog'lansa, ikki barobar belgi narxni oshirmasdi.
  const m2 = new TtsMeter();
  m2.add({ provider: "azure", voice: "v", chars: 500_000, seconds: 30 });
  m2.add({ provider: "aisha", voice: "gulnoza", chars: 500_000, seconds: 30 });
  const two = m2.toJson();
  assert.equal(two.calls, 2);
  assert.equal(two.chars, 1_000_000);
  assert.ok(two.usd > one.usd / 2, "aralash provayderda tannarx hisoblanmadi");
  assert.equal(two.provider, "azure+aisha", "provayderlar ro'yxati yig'ilmadi");

  assert.equal(ttsCostUsd("azure", 1_000_000), 16);
  assert.equal(ttsCostUsd("gemini", 1_000_000), 0, "bepul zveno tannarxga qo'shilmasin");
  assert.equal(ttsCostUsd("azure", 0), 0);
  // Manfiy qiymat tannarxni KAMAYTIRMASIN.
  assert.equal(ttsCostUsd("azure", -1_000_000), 0);
});

test("sintez natijasi: mp3/wav dan bittasi, formati yo'qolmaydi", () => {
  const mp3 = audioBytes({ mp3: new Uint8Array([1, 2, 3]), seconds: 1, chars: 10 });
  assert.equal(mp3?.format, "mp3");
  const wav = audioBytes({ wav: new Uint8Array([1]), seconds: 1, chars: 10 });
  assert.equal(wav?.format, "wav", "WAV chiqargan provayder (Aisha) formati yo'qoldi");
  // Bo'sh javob — `null`, «nol baytlik MP3» emas.
  assert.equal(audioBytes({ seconds: 0, chars: 0 }), null);
  assert.equal(audioBytes({ mp3: new Uint8Array(0), seconds: 0, chars: 0 }), null);
});
