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
