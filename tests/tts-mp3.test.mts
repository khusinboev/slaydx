import test from "node:test";
import assert from "node:assert/strict";
import {
  concatMp3,
  hasId3v1,
  id3v2Length,
  isXingFrame,
  mergeToMp3,
  mp3Frames,
  mp3Profile,
  mp3Seconds,
  pcmToWav,
  readFrame,
  stripTags,
  wavInfo,
  wavSeconds,
  wavToMp3,
  type Mp3EncoderFactory,
} from "../lib/generation/tts/mp3.ts";

/**
 * MP3 QATLAMI (AUDIT-22 WP-A) — bo'laklarni bitta faylga ulash.
 *
 * Bu yerdagi MP3 lar SINTETIK: kadr sarlavhalari qo'lda quriladi
 * (haqiqiy audio ma'lumot o'rniga nol baytlar). Kod faqat SARLAVHALARNI
 * o'qiydi, ya'ni sintetik kadr real Azure javobi bilan bir xil yo'ldan
 * o'tadi — lekin test tarmoqqa ham, 100 KB fikstura fayliga ham
 * muhtoj bo'lmaydi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `stripTags` ID3v2 uzunligini «syncsafe» emas, oddiy 32-bit deb
 *      o'qidi — «ID3v2 tashlanadi» testi (uzunlik 10 bayt siljirdi);
 *   2. `concatMp3` profil tekshiruvini tashlab, har doim ulayverdi —
 *      «24 kHz + 44.1 kHz → null» testi;
 *   3. `mp3Seconds` MPEG2 da ham 1152 namuna deb hisobladi — «MPEG2
 *      kadri 576 namuna» testi (davomiylik 2× katta chiqdi);
 *   4. `concatMp3` Xing kadrini tashlamadi — «Xing kadri ulanmaydi»
 *      testi (davomiylik bitta kadrga oshdi);
 *   5. `wavInfo` `data` ni qat'iy 44-baytdan o'qidi (bo'laklarni
 *      yurmasdan) — «LIST bo'lagi bor WAV» testi;
 *   6. `wavToMp3` 16-bit tekshiruvini tashladi — «8-bit WAV → null» testi;
 *   7. `readFrame` «free» bitreyt indeksini (0) qabul qildi — «yaroqsiz
 *      sarlavha o'tmaydi» testi (kadr uzunligi 0 bo'lib, `mp3Frames`
 *      cheksiz aylanardi);
 *   8. `mergeToMp3` WAV bo'lakni kodlamasdan to'g'ridan-to'g'ri ulab
 *      yubordi — «WAV bo'lak MP3 ga o'giriladi» testi.
 */

/* ── sintetik kadr quruvchilar ── */

/** MPEG1 Layer III, 44 100 Hz, 128 kbps, mono — kadr 417 bayt. */
function mpeg1Frame(fill = 0): Uint8Array {
  const size = Math.floor((144_000 * 128) / 44_100); // 417
  const b = new Uint8Array(size).fill(fill);
  b[0] = 0xff;
  b[1] = 0xfb; // sync + MPEG1 + Layer III + CRC yo'q
  b[2] = 0x90; // bitreyt indeksi 9 (128), chastota indeksi 0 (44 100)
  b[3] = 0xc0; // mono
  return b;
}

/** MPEG2 Layer III, 24 000 Hz, 96 kbps, mono — kadr 288 bayt (Azure formati). */
function mpeg2Frame(fill = 0): Uint8Array {
  const size = Math.floor((72_000 * 96) / 24_000); // 288
  const b = new Uint8Array(size).fill(fill);
  b[0] = 0xff;
  b[1] = 0xf3; // MPEG2
  b[2] = 0xa4; // bitreyt indeksi 10 (96), chastota indeksi 1 (24 000)
  b[3] = 0xc0;
  return b;
}

const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const stream = (make: () => Uint8Array, n: number) => join(...Array.from({ length: n }, make));

/** ID3v2.3 sarlavhasi: `size` — syncsafe 4 bayt (har baytda 7 bit). */
function id3v2(size: number): Uint8Array {
  const b = new Uint8Array(10 + size);
  b.set([0x49, 0x44, 0x33, 3, 0, 0], 0); // "ID3", v2.3, bayroqsiz
  b[6] = (size >> 21) & 0x7f;
  b[7] = (size >> 14) & 0x7f;
  b[8] = (size >> 7) & 0x7f;
  b[9] = size & 0x7f;
  return b;
}

function id3v1(): Uint8Array {
  const b = new Uint8Array(128);
  b.set([0x54, 0x41, 0x47], 0); // "TAG"
  return b;
}

/** Xing (VBR) sarlavha kadri — MPEG1 kadrining ichiga «Xing» yoziladi. */
function xingFrame(): Uint8Array {
  const b = mpeg1Frame();
  b.set([0x58, 0x69, 0x6e, 0x67], 36); // "Xing"
  return b;
}

/** 16-bit mono WAV (jimlik) — `sec` soniya. */
function wav(sampleRate: number, sec: number, bits = 16, extraChunk = false): Uint8Array {
  const samples = Math.round(sampleRate * sec);
  const pcm = new Uint8Array(samples * (bits / 8));
  const body = pcmToWav(pcm, { sampleRate, channels: 1, bits });
  if (!extraChunk) return body;
  // `fmt ` dan keyin `LIST` bo'lagi qo'shiladi — `data` endi 44-baytda emas.
  const list = new Uint8Array(8 + 10);
  list.set([0x4c, 0x49, 0x53, 0x54], 0); // "LIST"
  new DataView(list.buffer).setUint32(4, 10, true);
  const out = join(body.subarray(0, 36), list, body.subarray(36));
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/* ══════════════════════════ kadr o'qish ══════════════════════════ */

test("kadr sarlavhasi: MPEG1 va MPEG2 uzunlik/namuna soni to'g'ri", () => {
  const f1 = readFrame(mpeg1Frame(), 0);
  assert.ok(f1);
  assert.equal(f1.version, "mpeg1");
  assert.equal(f1.sampleRate, 44_100);
  assert.equal(f1.bitrateKbps, 128);
  assert.equal(f1.size, 417);
  assert.equal(f1.samples, 1152);

  const f2 = readFrame(mpeg2Frame(), 0);
  assert.ok(f2);
  assert.equal(f2.version, "mpeg2");
  assert.equal(f2.sampleRate, 24_000);
  assert.equal(f2.size, 288);
  // MUTATSIYA 3: MPEG2 Layer III kadri 576 namuna, 1152 emas.
  assert.equal(f2.samples, 576);
});

test("yaroqsiz sarlavha rad etiladi (sync yo'q, «free» bitreyt, zaxiralangan versiya)", () => {
  assert.equal(readFrame(new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0), null);
  const free = mpeg1Frame();
  free[2] = 0x00; // bitreyt indeksi 0 = «free»
  // MUTATSIYA 7: qabul qilinsa kadr uzunligi 0 bo'lib, skaner qotardi.
  assert.equal(readFrame(free, 0), null);
  const reserved = mpeg1Frame();
  reserved[1] = 0xeb; // versiya bitlari 01 — zaxiralangan
  assert.equal(readFrame(reserved, 0), null);
  const layer2 = mpeg1Frame();
  layer2[1] = 0xfd; // Layer II
  assert.equal(readFrame(layer2, 0), null);
});

/* ══════════════════════════ teglar ══════════════════════════ */

test("ID3v2 sarlavhasi va ID3v1 dumi tashlanadi (syncsafe uzunlik)", () => {
  const audio = stream(mpeg1Frame, 3);
  // 200 syncsafe da 0x00,0x00,0x01,0x48 — oddiy 32-bit o'qishda boshqa son.
  const tagged = join(id3v2(200), audio, id3v1());
  assert.equal(id3v2Length(tagged), 210);
  assert.ok(hasId3v1(tagged));
  const clean = stripTags(tagged);
  // MUTATSIYA 1: syncsafe emas, oddiy o'qishda uzunlik siljib, birinchi
  // kadr yarmidan kesilardi.
  assert.equal(clean.length, audio.length);
  assert.equal(mp3Frames(tagged).length, 3);
});

test("Xing/Info kadri metama'lumot deb taniladi va davomiylikka kirmaydi", () => {
  const withXing = join(xingFrame(), stream(mpeg1Frame, 2));
  const frames = mp3Frames(withXing);
  assert.equal(frames.length, 3);
  assert.ok(isXingFrame(stripTags(withXing), frames[0]));
  assert.ok(!isXingFrame(stripTags(withXing), frames[1]));
  // Ikkita AUDIO kadr: 2 × 1152 / 44 100.
  assert.ok(Math.abs(mp3Seconds(withXing) - (2 * 1152) / 44_100) < 1e-3);
});

/* ══════════════════════════ davomiylik ══════════════════════════ */

test("mp3Seconds kadrlarni sanaydi (metama'lumotga emas)", () => {
  const a = stream(mpeg1Frame, 40);
  assert.ok(Math.abs(mp3Seconds(a) - (40 * 1152) / 44_100) < 1e-3);
  const b = stream(mpeg2Frame, 100);
  assert.ok(Math.abs(mp3Seconds(b) - (100 * 576) / 24_000) < 1e-3);
  assert.equal(mp3Seconds(new Uint8Array([1, 2, 3])), 0);
});

/* ══════════════════════════ birlashtirish ══════════════════════════ */

test("concatMp3: bir xil profildagi bo'laklar ulanadi, davomiylik yig'iladi", () => {
  const a = stream(mpeg2Frame, 10);
  const b = stream(mpeg2Frame, 15);
  const out = concatMp3([a, b]);
  assert.ok(out);
  assert.equal(mp3Frames(out).length, 25);
  assert.ok(Math.abs(mp3Seconds(out) - (mp3Seconds(a) + mp3Seconds(b))) < 1e-3);
  assert.deepEqual(mp3Profile(out), { version: "mpeg2", layer: 3, sampleRate: 24_000, channelMode: 3 });
});

test("concatMp3: mos kelmagan profil — null (24 kHz Azure + 44.1 kHz boshqa manba)", () => {
  // MUTATSIYA 2: tekshiruvsiz ulash o'ynamaydigan fayl berardi.
  assert.equal(concatMp3([stream(mpeg2Frame, 5), stream(mpeg1Frame, 5)]), null);
  assert.equal(concatMp3([new Uint8Array([1, 2, 3, 4])]), null);
  assert.equal(concatMp3([]), null);
});

test("concatMp3: har bo'lakning teglari tashlanadi va Xing kadri ulanmaydi", () => {
  const p1 = join(id3v2(64), xingFrame(), stream(mpeg1Frame, 4));
  const p2 = join(id3v2(32), stream(mpeg1Frame, 6), id3v1());
  const out = concatMp3([p1, p2]);
  assert.ok(out);
  // MUTATSIYA 4: Xing qolsa 11 kadr bo'lardi.
  assert.equal(mp3Frames(out).length, 10);
  assert.equal(id3v2Length(out), 0);
  assert.ok(!hasId3v1(out));
});

/* ══════════════════════════ WAV ══════════════════════════ */

test("wavInfo RIFF bo'laklarini yuradi (LIST bo'lsa ham data topiladi)", () => {
  const plain = wav(16_000, 1);
  assert.deepEqual(wavInfo(plain), { sampleRate: 16_000, channels: 1, bits: 16, dataOffset: 44, dataLength: 32_000 });
  const withList = wav(16_000, 1, 16, true);
  const info = wavInfo(withList);
  assert.ok(info);
  // MUTATSIYA 5: qat'iy 44-bayt o'qishda `data` 18 bayt siljib, boshida
  // shovqin chiqardi.
  assert.equal(info.dataOffset, 62);
  assert.equal(info.dataLength, 32_000);
  assert.equal(wavSeconds(withList), 1);
  assert.equal(wavInfo(new Uint8Array(10)), null);
});

test("pcmToWav xom PCM ni o'raydi (Gemini `audio/L16` yo'li)", () => {
  const pcm = new Uint8Array(24_000 * 2); // 1 s, 24 kHz, 16-bit
  const out = pcmToWav(pcm, { sampleRate: 24_000 });
  assert.equal(out.length, 44 + pcm.length);
  assert.equal(wavSeconds(out), 1);
});

/* ══════════════════════════ WAV → MP3 ══════════════════════════ */

/**
 * Soxta enkoder: har 1152 namuna uchun BITTA yaroqli MPEG1 kadri.
 *
 * Nega haqiqiy `lamejs` emas: unit test kutubxonaning sifatini emas,
 * BIZNING kodimizni (WAV tahlili, qadam, bo'laklarni ulash) sinaydi.
 * Haqiqiy enkoder `scripts/tts-lab.mts` da, jonli sinovda ishlaydi.
 */
const fakeEncoder: Mp3EncoderFactory = () => {
  let pending = 0;
  return {
    encodeBuffer(left: Int16Array) {
      pending += left.length;
      const frames: Uint8Array[] = [];
      while (pending >= 1152) {
        frames.push(mpeg1Frame());
        pending -= 1152;
      }
      return join(...frames);
    },
    flush() {
      return pending > 0 ? mpeg1Frame() : new Uint8Array(0);
    },
  };
};

test("wavToMp3: uzunlik saqlanadi (1 s WAV → ≈1 s MP3)", async () => {
  const mp3 = await wavToMp3(wav(44_100, 1), { encoder: fakeEncoder });
  assert.ok(mp3);
  const seconds = mp3Seconds(mp3);
  assert.ok(Math.abs(seconds - 1) < 0.05, `kutilgan ≈1 s, olingan ${seconds}`);
});

test("wavToMp3: 8-bit yoki WAV bo'lmagan kirish — null", async () => {
  // MUTATSIYA 6: 16-bit tekshiruvisiz `Int16Array` 8-bit ni ikki barobar
  // tez o'qib, tovushni «tez» qilardi.
  assert.equal(await wavToMp3(wav(16_000, 1, 8), { encoder: fakeEncoder }), null);
  assert.equal(await wavToMp3(new Uint8Array([1, 2, 3]), { encoder: fakeEncoder }), null);
});

test("mergeToMp3: MP3 va WAV bo'laklar bitta MP3 ga (WAV kodlanadi)", async () => {
  const mp3Part = stream(mpeg1Frame, 4);
  const wavPart = wav(44_100, 1);
  const out = await mergeToMp3([{ mp3: mp3Part }, { wav: wavPart }], { encoder: fakeEncoder });
  assert.ok(out);
  // MUTATSIYA 8: WAV to'g'ridan-to'g'ri ulansa kadr soni 4 bo'lib
  // qolardi (RIFF baytlari kadr deb o'qilmaydi).
  assert.ok(mp3Frames(out).length > 4);
  assert.ok(mp3Seconds(out) > 1);
});

test("mergeToMp3: enkoder yo'q bo'lsa WAV bo'lakli ish null beradi", async () => {
  const none: Mp3EncoderFactory = () => ({ encodeBuffer: () => new Uint8Array(0), flush: () => new Uint8Array(0) });
  assert.equal(await mergeToMp3([{ wav: wav(16_000, 1) }], { encoder: none }), null);
  // Faqat MP3 bo'laklar bo'lsa enkoder umuman kerak emas.
  assert.ok(await mergeToMp3([{ mp3: stream(mpeg2Frame, 3) }], { encoder: none }));
});
