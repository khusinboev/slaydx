/**
 * MP3 QATLAMI (AUDIT-22 WP-A) — bo'laklarni BITTA o'ynaydigan faylga.
 *
 * Nega bu fayl bor. TTS matnni ≤900 belgilik bo'laklarga bo'lib
 * so'raydi (`tts.md` §3: eng qattiq provayder Aisha 1 000 belgi), ya'ni
 * 3 daqiqalik podkast 5–8 ta alohida audio bo'lib qaytadi. Ularni
 * shunchaki `Buffer.concat` qilish MP3 da ISHLAYDI, lekin faqat
 * shartlar bajarilganda — va aynan shu shartlarni hech kim tekshirmasa,
 * nuqson faylni OCHGANDA emas, foydalanuvchi TINGLAGANDA chiqadi
 * (o'rtasida shovqin, davomiylik noto'g'ri, pleer oxirigacha
 * o'ynatmaydi). Shu sabab bu yerda uchta ish bor:
 *
 *   1. `stripTags`   — ID3v2 sarlavhasi va ID3v1 dumini olib tashlash.
 *      Ikkinchi bo'lakning ID3v2 bloki oqim O'RTASIDA qolsa, pleer uni
 *      kadr deb o'qishga urinadi;
 *   2. `concatMp3`   — har bo'lakning KADR SARLAVHALARINI o'qib, ular
 *      bir xil profilda (versiya/qatlam/chastota/kanal) ekanini
 *      TEKSHIRIB birlashtirish. Mos kelmasa `null`: bir xil ishda ikki
 *      xil provayder aralashganini jimgina yopib qo'yishdan ko'ra,
 *      chaqiruvchining xato berishi to'g'ri;
 *   3. `wavToMp3`    — Aisha (WAV 16 kHz) va Gemini (xom PCM) yo'llari
 *      uchun kodlash. Chiqish shartnomasi MP3 (`ToolConfig.output`,
 *      `AudioViewer`, `audio/mpeg`), ya'ni WAV ni «shunchaki qaytarib»
 *      bo'lmaydi.
 *
 * BOG'LIQLIK QARORI (`tts.md` §6 ochiq savoli 6):
 *   • `ffmpeg` — worker rasmida YO'Q (Dockerfile'da LibreOffice/poppler);
 *     qo'shish +30–50 MB va tizim bog'liqligi;
 *   • `@breezystack/lamejs` — SOF JavaScript LAME porti (WASM ham,
 *     native ham emas), worker rasmiga hech qanday tizim paketi
 *     qo'shmaydi. **Litsenziyasi LGPL-3.0** (tadqiqotdagi «MIT» —
 *     XATO, `docs/research/tts.md` §1 tuzatilishi kerak): kutubxona
 *     O'ZGARTIRILMAYDI va faqat SERVERDA ishlaydi (foydalanuvchiga
 *     tarqatilmaydi), shuning uchun LGPL majburiyati yuzaga kelmaydi.
 *     MP3 patentlari 2017 da tugagan — patent to'sig'i yo'q.
 *
 * Kutubxona LAZY yuklanadi (`await import`): Azure yo'li (asosiy zanjir,
 * to'g'ridan-to'g'ri MP3) enkoderni UMUMAN ochmaydi. Yo'q bo'lsa
 * `wavToMp3` `null` qaytaradi va zanjir WAV provayderini o'tkazib
 * yuboradi — Azure ishlashda davom etadi.
 *
 * Izomorf: server/DOM importi yo'q (`Uint8Array` va lazy import).
 */

/* ══════════════════════════ kadr sarlavhasi ══════════════════════════ */

export type MpegVersion = "mpeg1" | "mpeg2" | "mpeg2.5";

export type Mp3Frame = {
  offset: number;
  /** Kadrning to'liq uzunligi (bayt), padding bilan. */
  size: number;
  version: MpegVersion;
  /** Layer I/II/III → 1/2/3. */
  layer: number;
  bitrateKbps: number;
  sampleRate: number;
  /** 0 stereo, 1 joint stereo, 2 dual, 3 mono. */
  channelMode: number;
  /** Kadrdagi PCM namunalari (MPEG1 L3 — 1152, MPEG2/2.5 L3 — 576). */
  samples: number;
};

/** Layer III bitreyt jadvallari (kbps), indeks 0 — «free», 15 — yaroqsiz. */
const BITRATES: Record<MpegVersion, readonly number[]> = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  "mpeg2.5": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

const SAMPLE_RATES: Record<MpegVersion, readonly number[]> = {
  mpeg1: [44100, 48000, 32000, 0],
  mpeg2: [22050, 24000, 16000, 0],
  "mpeg2.5": [11025, 12000, 8000, 0],
};

/**
 * Bitta kadr sarlavhasini o'qiydi; yaroqsiz bo'lsa `null`.
 *
 * Sarlavha 4 bayt: `AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM` — 11 bit sync,
 * 2 bit versiya, 2 bit qatlam, bitreyt/chastota indekslari, padding va
 * kanal rejimi. «Free» (0) va «yaroqsiz» (15/3) indekslar RAD ETILADI:
 * ular bo'lsa kadr uzunligini hisoblab bo'lmaydi, ya'ni keyingi kadrni
 * ham topib bo'lmaydi.
 */
export function readFrame(b: Uint8Array, i: number): Mp3Frame | null {
  if (i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (b[i + 1] >> 3) & 0b11;
  if (versionBits === 0b01) return null; // zaxiralangan
  const version: MpegVersion = versionBits === 0b11 ? "mpeg1" : versionBits === 0b10 ? "mpeg2" : "mpeg2.5";

  const layerBits = (b[i + 1] >> 1) & 0b11;
  if (layerBits === 0b00) return null; // zaxiralangan
  const layer = 4 - layerBits;
  if (layer !== 3) return null; // TTS provayderlari faqat Layer III beradi

  const bitrateIndex = (b[i + 2] >> 4) & 0b1111;
  const rateIndex = (b[i + 2] >> 2) & 0b11;
  const padding = (b[i + 2] >> 1) & 0b1;
  const channelMode = (b[i + 3] >> 6) & 0b11;

  const bitrateKbps = BITRATES[version][bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  if (!bitrateKbps || !sampleRate) return null;

  const samples = version === "mpeg1" ? 1152 : 576;
  // Layer III: MPEG1 — 144 000 × kbps / Hz; MPEG2/2.5 — yarmi (72 000).
  const size = Math.floor(((version === "mpeg1" ? 144_000 : 72_000) * bitrateKbps) / sampleRate) + padding;
  if (size <= 4) return null;
  // CRC (sarlavhadan keyin 2 bayt) kadr UZUNLIGIGA allaqachon kiradi —
  // alohida hisoblanmaydi.
  return { offset: i, size, version, layer, bitrateKbps, sampleRate, channelMode, samples };
}

/* ══════════════════════════ teglar ══════════════════════════ */

const ID3V2_MIN = 10;

/** ID3v2 sarlavhasining uzunligi (bayt) yoki 0 — tag yo'q. */
export function id3v2Length(b: Uint8Array): number {
  if (b.length < ID3V2_MIN) return 0;
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  // Syncsafe: har baytning faqat 7 biti ishlatiladi.
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  const footer = (b[5] & 0x10) !== 0 ? 10 : 0;
  return Math.min(b.length, ID3V2_MIN + size + footer);
}

/** ID3v1 (128 bayt, oxirida «TAG») bormi. */
export function hasId3v1(b: Uint8Array): boolean {
  if (b.length < 128) return false;
  const i = b.length - 128;
  return b[i] === 0x54 && b[i + 1] === 0x41 && b[i + 2] === 0x47; // "TAG"
}

/**
 * Teglarni olib tashlaydi va BIRINCHI kadrga tekislaydi.
 *
 * Nega tekislash ham kerak: ba'zi provayderlar tag va birinchi kadr
 * orasida nol baytlar qoldiradi. Ular oqim BOSHIDA zararsiz, lekin
 * birlashtirilgan faylning O'RTASIDA pleerni sinxronizatsiyadan
 * chiqaradi.
 */
export function stripTags(bytes: Uint8Array): Uint8Array {
  let b = bytes;
  if (hasId3v1(b)) b = b.subarray(0, b.length - 128);
  const head = id3v2Length(b);
  if (head) b = b.subarray(head);
  // Birinchi yaroqli kadrgacha skanerlash (≤4 KB — undan uzoq bo'lsa
  // bu MP3 emas va `mp3Frames` shundoq ham bo'sh qaytaradi).
  const limit = Math.min(b.length, 4096);
  for (let i = 0; i < limit; i++) {
    if (readFrame(b, i)) return i ? b.subarray(i) : b;
  }
  return b;
}

/**
 * Xing/Info (VBR) sarlavha kadrimi — u AUDIO EMAS, metama'lumot.
 *
 * Birlashtirishda har bo'lakning boshida turishi mumkin; oqim o'rtasida
 * qolgan Xing kadri pleerda «tiq» bo'lib eshitiladi va davomiylik
 * hisobini buzadi (u BUTUN fayl uzunligini e'lon qiladi).
 */
export function isXingFrame(b: Uint8Array, f: Mp3Frame): boolean {
  const end = Math.min(b.length, f.offset + f.size);
  for (let i = f.offset + 4; i + 4 <= end; i++) {
    const tag = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (tag === "Xing" || tag === "Info") return true;
  }
  return false;
}

/* ══════════════════════════ kadrlar ══════════════════════════ */

/**
 * Oqimdagi kadrlar (teglar tashlangan holda).
 *
 * Sarlavha yaroqsiz bo'lsa bitta bayt oldinga siljib QAYTA izlanadi —
 * shunda bitta buzuq joy butun faylni «bo'sh» qilib qo'ymaydi.
 */
export function mp3Frames(bytes: Uint8Array): Mp3Frame[] {
  const b = stripTags(bytes);
  const out: Mp3Frame[] = [];
  let i = 0;
  while (i + 4 <= b.length) {
    const f = readFrame(b, i);
    if (!f) {
      i++;
      continue;
    }
    out.push(f);
    i += f.size;
  }
  return out;
}

/** Audio uzunligi (soniya) — kadrlar bo'yicha, metama'lumotga ishonmasdan. */
export function mp3Seconds(bytes: Uint8Array): number {
  let s = 0;
  for (const f of mp3Frames(bytes)) {
    if (isXingFrame(bytes, f)) continue;
    s += f.samples / f.sampleRate;
  }
  return Number(s.toFixed(3));
}

export type Mp3Profile = { version: MpegVersion; layer: number; sampleRate: number; channelMode: number };

/** Oqimning profili (birinchi AUDIO kadr bo'yicha) yoki `null`. */
export function mp3Profile(bytes: Uint8Array): Mp3Profile | null {
  const b = stripTags(bytes);
  for (const f of mp3Frames(bytes)) {
    if (isXingFrame(b, f)) continue;
    return { version: f.version, layer: f.layer, sampleRate: f.sampleRate, channelMode: f.channelMode };
  }
  return null;
}

export const sameProfile = (a: Mp3Profile, b: Mp3Profile): boolean =>
  a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate && a.channelMode === b.channelMode;

/**
 * Bo'laklarni BITTA MP3 ga ulaydi.
 *
 * `null` qaytaradi, agar: bo'lak MP3 emas, yoki profillar MOS EMAS
 * (masalan 24 kHz Azure + 16 kHz Aisha). Ikkinchi holat chaqiruvchi
 * xatosi: bitta ishda bitta provayder ishlatilishi kerak
 * (`chain.ts` provayderni BUTUN ish uchun bog'laydi) — jimgina
 * birlashtirish o'ynamaydigan fayl berardi.
 *
 * Bitreyt bo'laklar orasida farq qilishi MUMKIN (CBR bo'lakning o'zi
 * bir xil bo'lsa yetarli): pleer har kadrning o'z sarlavhasini o'qiydi.
 */
export function concatMp3(parts: readonly Uint8Array[]): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let profile: Mp3Profile | null = null;
  let total = 0;

  for (const part of parts) {
    if (!part?.length) continue;
    const b = stripTags(part);
    const frames = mp3Frames(part).filter((f) => !isXingFrame(b, f));
    if (!frames.length) return null;
    const p: Mp3Profile = { version: frames[0].version, layer: frames[0].layer, sampleRate: frames[0].sampleRate, channelMode: frames[0].channelMode };
    if (!profile) profile = p;
    else if (!sameProfile(profile, p)) return null;
    for (const f of frames) {
      const end = Math.min(b.length, f.offset + f.size);
      const slice = b.subarray(f.offset, end);
      chunks.push(slice);
      total += slice.length;
    }
  }
  if (!profile || !total) return null;

  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/* ══════════════════════════ WAV ══════════════════════════ */

export type WavInfo = { sampleRate: number; channels: number; bits: number; dataOffset: number; dataLength: number };

const fourcc = (b: Uint8Array, i: number): string => (i + 4 <= b.length ? String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]) : "");

/**
 * WAV sarlavhasini o'qiydi (RIFF bo'laklarini KETMA-KET yurib).
 *
 * Qat'iy 44-baytli sarlavhaga ishonib bo'lmaydi: haqiqiy fayllarda
 * `fmt ` dan keyin `LIST`/`fact` bo'laklari bo'ladi va `data` 44-baytda
 * turmaydi — shunda «sarlavhani tashlab qolganini PCM deb o'qish»
 * boshida shovqin beradi.
 */
export function wavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44 || fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WAVE") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  while (i + 8 <= bytes.length) {
    const id = fourcc(bytes, i);
    const size = dv.getUint32(i + 4, true);
    const body = i + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.length) {
      fmt = { channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === "data" && fmt) {
      const dataLength = Math.min(size, bytes.length - body);
      if (!fmt.channels || !fmt.sampleRate || !fmt.bits) return null;
      return { ...fmt, dataOffset: body, dataLength };
    }
    // Bo'lak uzunligi TOQ bo'lsa bitta to'ldiruvchi bayt qo'shiladi (RIFF qoidasi).
    i = body + size + (size % 2);
  }
  return null;
}

/** WAV uzunligi (soniya) — `data` bo'lagi bo'yicha. */
export function wavSeconds(bytes: Uint8Array): number {
  const info = wavInfo(bytes);
  if (!info) return 0;
  const bytesPerSample = (info.bits / 8) * info.channels;
  if (!bytesPerSample) return 0;
  return Number((info.dataLength / bytesPerSample / info.sampleRate).toFixed(3));
}

/**
 * Xom PCM → WAV o'rami (Gemini TTS `audio/L16` javobi uchun).
 *
 * Gemini base64 PCM qaytaradi va SARLAVHASI yo'q — uni to'g'ridan-
 * to'g'ri `wavToMp3` ga berish mumkin emas, chunki chastota/kanal
 * faqat javobning `mimeType` ida turadi.
 */
export function pcmToWav(pcm: Uint8Array, o: { sampleRate: number; channels?: number; bits?: number }): Uint8Array {
  const channels = o.channels ?? 1;
  const bits = o.bits ?? 16;
  const blockAlign = (bits / 8) * channels;
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, o.sampleRate, true);
  dv.setUint32(28, o.sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  ascii(36, "data");
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/* ══════════════════════════ WAV → MP3 ══════════════════════════ */

/** `lamejs` `Mp3Encoder` ning BIZGA kerak bo'lgan qismi (test seam'i). */
export type Mp3EncoderLike = {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array | Uint8Array;
  flush(): Int8Array | Uint8Array;
};

export type Mp3EncoderFactory = (channels: number, sampleRate: number, kbps: number) => Mp3EncoderLike;

/** Kodlash sifat/hajm muvozanati — Azure chiqishi bilan bir xil daraja. */
export const MP3_BITRATE_KBPS = 96;

/**
 * `@breezystack/lamejs` ni LAZY yuklaydi.
 *
 * Yo'q bo'lsa (`npm i` qilinmagan muhit, kelajakdagi olib tashlash)
 * `null` — chaqiruvchi WAV provayderini o'tkazib yuboradi, Azure yo'li
 * esa buzilmaydi.
 */
export async function loadMp3Encoder(): Promise<Mp3EncoderFactory | null> {
  try {
    const mod: unknown = await import("@breezystack/lamejs");
    const m = mod as { Mp3Encoder?: unknown; default?: { Mp3Encoder?: unknown } };
    const Ctor = (m.Mp3Encoder ?? m.default?.Mp3Encoder) as (new (c: number, r: number, k: number) => Mp3EncoderLike) | undefined;
    if (typeof Ctor !== "function") return null;
    return (channels, sampleRate, kbps) => new Ctor(channels, sampleRate, kbps);
  } catch {
    return null;
  }
}

/** `Int8Array`/`Uint8Array` — lamejs `Int8Array` beradi, tiplash `Uint8Array` deydi. */
function asBytes(v: Int8Array | Uint8Array): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * WAV (PCM 16-bit) → MP3.
 *
 * `null`: WAV o'qilmadi, 16-bit emas, yoki enkoder yo'q. Chastota
 * O'ZGARTIRILMAYDI (resampling yo'q) — 16 kHz WAV 16 kHz MP3 bo'ladi.
 * Shu sabab `concatMp3` profilni tekshiradi: bitta ishda Azure (24 kHz)
 * va Aisha (16 kHz) bo'laklari aralashib qolsa, u `null` beradi.
 */
export async function wavToMp3(wav: Uint8Array, deps: { encoder?: Mp3EncoderFactory; kbps?: number } = {}): Promise<Uint8Array | null> {
  const info = wavInfo(wav);
  if (!info || info.bits !== 16) return null;
  const make = deps.encoder ?? (await loadMp3Encoder());
  if (!make) return null;

  const channels = Math.min(2, Math.max(1, info.channels));
  const enc = make(channels, info.sampleRate, deps.kbps ?? MP3_BITRATE_KBPS);

  // `data` bo'lagi juft manzilda bo'lmasligi mumkin — NUSXA olib tekislaymiz,
  // aks holda `Int16Array` konstruktori «start offset must be multiple of 2» deydi.
  const raw = wav.slice(info.dataOffset, info.dataOffset + info.dataLength - (info.dataLength % 2));
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));

  const out: Uint8Array[] = [];
  // 1152 namuna = MPEG1 Layer III kadri; lamejs shu qadamni kutadi.
  const step = 1152 * channels;
  for (let i = 0; i < pcm.length; i += step) {
    const slice = pcm.subarray(i, Math.min(pcm.length, i + step));
    const buf =
      channels === 2
        ? enc.encodeBuffer(deinterleave(slice, 0), deinterleave(slice, 1))
        : enc.encodeBuffer(slice);
    if (buf?.length) out.push(asBytes(buf).slice());
  }
  const tail = enc.flush();
  if (tail?.length) out.push(asBytes(tail).slice());
  if (!out.length) return null;

  const total = out.reduce((n, b) => n + b.length, 0);
  const mp3 = new Uint8Array(total);
  let at = 0;
  for (const b of out) {
    mp3.set(b, at);
    at += b.length;
  }
  return mp3;
}

function deinterleave(pcm: Int16Array, channel: number): Int16Array {
  const out = new Int16Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = pcm[i * 2 + channel];
  return out;
}

/* ══════════════════════════ birlashtirish (yuqori daraja) ══════════════════════════ */

export type AudioPiece = { mp3?: Uint8Array; wav?: Uint8Array };

/**
 * Aralash bo'laklarni (MP3 va/yoki WAV) BITTA MP3 ga.
 *
 * WAV bo'laklar avval kodlanadi, keyin hammasi `concatMp3` dan o'tadi —
 * ya'ni profil tekshiruvi WAV yo'lida ham amal qiladi.
 */
export async function mergeToMp3(pieces: readonly AudioPiece[], deps: { encoder?: Mp3EncoderFactory } = {}): Promise<Uint8Array | null> {
  const parts: Uint8Array[] = [];
  for (const p of pieces) {
    if (p.mp3?.length) {
      parts.push(p.mp3);
      continue;
    }
    if (!p.wav?.length) return null;
    const mp3 = await wavToMp3(p.wav, deps);
    if (!mp3) return null;
    parts.push(mp3);
  }
  return parts.length ? concatMp3(parts) : null;
}
