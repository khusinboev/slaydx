/**
 * The clone sample as the server accepts it (docs/studio/P5-SPEC.md): WAV or MP3 only, its length measured from the
 * bytes. A browser recording (MediaRecorder: WebM / Ogg Opus, MP4 AAC on Safari) or an uploaded M4A / OGG is decoded
 * by the browser itself (`AudioContext.decodeAudioData`) and written as 16-bit mono PCM WAV at 24 kHz (3 min ≈ 8.6 MB,
 * under the 10 MB limit); an MP3 upload goes as is.
 */

export const SAMPLE_RATE = 24_000;

/** Mono mix of the decoded channels, resampled (linear) to `rate`. Pure: unit-tested without a browser. */
export function mixToMono(channels: readonly Float32Array[], fromRate: number, rate = SAMPLE_RATE): Float32Array {
  const len = channels[0]?.length ?? 0;
  const mono = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i]! += ch[i]! / channels.length;
  if (fromRate === rate) return mono;
  const outLen = Math.max(1, Math.floor((len * rate) / fromRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = (i * fromRate) / rate;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (mono[j] ?? 0) * (1 - f) + (mono[j + 1] ?? mono[j] ?? 0) * f;
  }
  return out;
}

/** 16-bit PCM mono WAV bytes of `samples` (-1..1). */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** First bytes say MP3 (ID3 tag or an MPEG audio frame sync): sent as is. */
export function looksLikeMp3(head: Uint8Array): boolean {
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  return head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0;
}

export type PreparedSample = { blob: Blob; seconds: number; fileName: string };

/** A recording / upload made ready for `POST /api/media/voices/samples` (browser only). */
export async function prepareSample(input: Blob): Promise<PreparedSample> {
  const bytes = new Uint8Array(await input.arrayBuffer());
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("Brauzeringiz audio yozuvni o‘qiy olmaydi — boshqa brauzerda urinib ko‘ring.");
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(bytes.slice().buffer);
    const seconds = buf.duration;
    if (looksLikeMp3(bytes)) return { blob: new Blob([bytes], { type: "audio/mpeg" }), seconds, fileName: "sample.mp3" };
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const wav = encodeWav(mixToMono(channels, buf.sampleRate));
    return { blob: new Blob([wav as BlobPart], { type: "audio/wav" }), seconds, fileName: "sample.wav" };
  } catch (e) {
    if (e instanceof Error && /brauzer/i.test(e.message)) throw e;
    throw new Error("Bu faylni audio sifatida o‘qib bo‘lmadi. WAV, MP3, M4A yoki OGG yozuv tanlang.");
  } finally {
    void ctx.close?.().catch?.(() => undefined);
  }
}
