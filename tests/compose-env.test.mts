import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * `docker-compose.yml` faqat SANAB O'TILGAN o'zgaruvchilarni konteynerga
 * uzatadi — `.env` ga qo'shish yetarli emas. 2026-09-12 deployda (AUDIT-17)
 * `LLM_JUDGE`/`ANTHROPIC_API_KEY`/`OPENALEX_API_KEY` `.env` da bor edi, lekin
 * worker ularni ko'rmadi: baholovchi Gemini'da qoldi, OpenAlex kalitsiz
 * 5 manba topdi. Bu test LLM rollari va manba qidiruv kalitlarini ikkala
 * servisda (web — «Tuzatish», worker — generatsiya) qulflaydi.
 */
const KEYS = [
  "LLM_WRITER",
  "LLM_JUDGE",
  "LLM_RESEARCHER",
  "LLM_FAST",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENALEX_API_KEY",
  "OPENALEX_MAILTO",
  "CROSSREF_MAILTO",
  // AUDIT-19: Google Books (kitob manbalari) — kalit ixtiyoriy, lekin
  // berilsa konteynerga YETIB BORISHI kerak (aks holda kunlik kvota anonim).
  "GOOGLE_BOOKS_API_KEY",
  /*
   * AUDIT-22 (WP-A): TTS zanjiri. `AZURE_SPEECH_REGION` — KALIT EMAS,
   * lekin usiz Azure URL i qurilmaydi; uni ro'yxatdan tushirib qoldirish
   * aynan 2026-09-12 dagi nuqsonni (`.env` da bor, konteynerda yo'q)
   * takrorlardi. `TTS_GEMINI_MODEL` preview provayderni YOQADIGAN
   * o'zgaruvchi — u yetib bormasa Gemini zvenosi jimgina o'chiq qolardi.
   */
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AISHA_API_KEY",
  "TTS_GEMINI_MODEL",
];

function envBlock(yaml: string, service: string): string {
  const start = yaml.indexOf(`\n  ${service}:`);
  assert.ok(start >= 0, `${service} servisi yo'q`);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z]/);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

test("docker-compose: LLM rollari va manba qidiruv kalitlari web va worker'ga uzatiladi", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    for (const k of KEYS) {
      assert.match(block, new RegExp(`^\\s+${k}: \\$\\{${k}:-\\}$`, "m"), `${service}: ${k} compose'da uzatilmaydi`);
    }
  }
  // `.env.example` da ham hujjatlangan bo'lsin.
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const k of KEYS.filter((k) => !/^(XAI|OPENAI)_/.test(k))) assert.match(example, new RegExp(`^${k}=`, "m"), `${k} .env.example da yo'q`);
});

/**
 * AUDIT-22: ovoz jadvalini muhitdan ALMASHTIRISH (`TTS_VOICE_<TIL>`,
 * `tts/chain.ts`) faqat o'zgaruvchi konteynerga YETIB BORSA ishlaydi.
 * Uchta asosiy til (uz/ru/en) qulflanadi — qolganlari jadval bo'yicha
 * ketadi va compose qatoridan mustaqil.
 */
test("docker-compose: TTS ovoz zanjiri o'zgaruvchilari (uz/ru/en) ikkala servisda", () => {
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  for (const service of ["web", "worker"]) {
    const block = envBlock(yaml, service);
    for (const k of ["TTS_VOICE_UZ", "TTS_VOICE_RU", "TTS_VOICE_EN"]) {
      assert.match(block, new RegExp(`^\\s+${k}: \\$\\{${k}:-\\}$`, "m"), `${service}: ${k} compose'da uzatilmaydi`);
    }
  }
});
