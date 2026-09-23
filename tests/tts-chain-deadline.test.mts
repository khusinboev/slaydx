import test from "node:test";
import assert from "node:assert/strict";
import { makeTtsChain } from "../lib/generation/tts/chain.ts";
import { DeadlineError } from "../lib/generation/llm/chain.ts";
import { TtsError, type TtsAudio, type TtsProvider, type TtsProviderId, type TtsSynthOpts } from "../lib/generation/tts/types.ts";

/**
 * TTS zanjiri muddati (audit EXT-10): ilgari `synthesizeAll` soatga umuman
 * qaramasdi — 14 bo'lak × 2 urinish × 30 s, cheklanmagan `Retry-After`,
 * yiqilganda keyingi provayderda boshidan. Endi:
 *  - har urinish timeout'i ≤ qolgan vaqt;
 *  - vaqt yetmasa `DeadlineError` va keyingi provayderda QAYTA BOSHLANMAYDI;
 *  - `Retry-After` cheklangan (1 soatlik kutish yo'q).
 */

const ENV = { TTS_VOICE_UZ: "azure:uz-UZ-MadinaNeural,aisha:gulnoza" } as NodeJS.ProcessEnv;
const AUDIO: TtsAudio = { mp3: new Uint8Array([0xff, 0xfb, 0x90, 0x00]), seconds: 1, chars: 5 };

function fake(id: TtsProviderId, script: (opts: TtsSynthOpts, n: number) => TtsAudio | Promise<TtsAudio>) {
  const seen: TtsSynthOpts[] = [];
  const p: TtsProvider = {
    id,
    configured: () => true,
    async synthesize(_text, opts) {
      seen.push(opts);
      return script(opts, seen.length);
    },
  };
  return { p, seen };
}

const PARTS = [{ text: "salom" }, { text: "dunyo" }];

test("muddat: har bo'lak timeout'i qolgan vaqtdan oshmaydi", async () => {
  const az = fake("azure", () => AUDIO);
  const chain = makeTtsChain({ providers: [az.p], env: ENV, log: () => {} });
  await chain.synthesizeAll(PARTS, { lang: "uz", timeoutMs: 30_000, deadline: Date.now() + 8_000 });
  assert.equal(az.seen.length, 2);
  for (const o of az.seen) assert.ok((o.timeoutMs ?? Infinity) <= 8_000, `timeout ${o.timeoutMs} > qolgan vaqt`);
});

test("muddat: qayta urinish sig'masa DeadlineError, keyingi provayderda boshidan BOSHLANMAYDI", async () => {
  const az = fake("azure", () => {
    throw new TtsError("azure", "Too many requests", { retryable: true, status: 429, retryAfterMs: 3_000 });
  });
  const ai = fake("aisha", () => AUDIO);
  const chain = makeTtsChain({ providers: [az.p, ai.p], env: ENV, log: () => {} });
  const t0 = Date.now();
  await assert.rejects(chain.synthesizeAll(PARTS, { lang: "uz", deadline: Date.now() + 6_000 }), DeadlineError);
  assert.equal(az.seen.length, 1);
  assert.equal(ai.seen.length, 0, "vaqt yo'q — Aisha butun skriptni qayta boshlamaydi");
  assert.ok(Date.now() - t0 < 500, "sig'maydigan kutish uxlanmaydi");
});

test("Retry-After cheklangan: 1 soatlik kutish o'rniga keyingi provayder", { timeout: 5_000 }, async () => {
  const az = fake("azure", () => {
    throw new TtsError("azure", "quota", { retryable: true, status: 429, retryAfterMs: 3_600_000 });
  });
  const ai = fake("aisha", () => AUDIO);
  const chain = makeTtsChain({ providers: [az.p, ai.p], env: ENV, log: () => {} });
  const run = await chain.synthesizeAll(PARTS, { lang: "uz" });
  assert.equal(run.provider, "aisha");
  assert.equal(az.seen.length, 1);
});

test("muddatsiz, kichik Retry-After — kutiladi va qayta urinish muvaffaqiyatli", async () => {
  const az = fake("azure", (_o, n) => {
    if (n === 1) throw new TtsError("azure", "busy", { retryable: true, status: 429, retryAfterMs: 80 });
    return AUDIO;
  });
  const chain = makeTtsChain({ providers: [az.p], env: ENV, log: () => {} });
  const t0 = Date.now();
  const run = await chain.synthesizeAll(PARTS, { lang: "uz" });
  assert.equal(run.audios.length, 2);
  assert.ok(Date.now() - t0 >= 70);
});
