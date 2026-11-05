/**
 * Uzbek quality bench for the text models (owner tool, docs/ops/LLM-FALLBACK.md). No published benchmark covers Uzbek on
 * Qwen or DeepSeek, so a human reads the same five prompts side by side and decides before trusting a fallback.
 *
 * Sends a fixed set of prompts to every model whose key is in the environment, and writes one markdown file with the
 * answers, the latency, the tokens and the cost from the price book. A model with no key is skipped; with no key at all
 * nothing is sent. It spends real money (a few cents a run).
 *
 *   DASHSCOPE_API_KEY=… DEEPSEEK_API_KEY=… GEMINI_API_KEY=… \
 *     scripts/heavy.sh npx tsx --conditions=react-server scripts/llm-uz-bench.mts [out.md]
 *
 * Reads no database and no admin store: keys come only from the environment. Default output: `eval-out/llm-uz-bench.md`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { costUsd } from "../lib/generation/llm-pricing.ts";
import { FALLBACK_ADAPTERS } from "../lib/generation/llm/fallback-adapters.ts";
import { geminiAdapter } from "../lib/generation/llm/gemini.ts";
import type { ProviderAdapter, ProviderId, RoleSpec } from "../lib/generation/llm/types.ts";
import { getProviderKey } from "../lib/server/providers/resolve.ts";

const MODELS: RoleSpec[] = [
  { provider: "gemini", model: "gemini-3.7-flash" },
  { provider: "qwen", model: "qwen3.7-plus" },
  { provider: "qwen", model: "qwen3.8-flash" },
  { provider: "deepseek", model: "deepseek-flash" },
  { provider: "deepseek", model: "deepseek-v4-pro" },
];

const UZ = "Faqat o'zbek tilida (lotin yozuvida) yozing. Oʻ va gʻ harflarini va tutuq belgisini toʻgʻri ishlating.";

const PROMPTS: { id: string; title: string; system: string; user: string; json?: boolean; maxTokens: number }[] = [
  {
    id: "slide-outline",
    title: "Slayd rejasi (JSON)",
    system: `${UZ} Siz taqdimot tuzuvchisiz.`,
    user: `«Oʻzbekistonda suv resurslaridan oqilona foydalanish» mavzusida 5 slaydlik reja tuzing. Faqat JSON: {"slides":[{"title":"","bullets":["",""]}]}`,
    json: true,
    maxTokens: 1500,
  },
  {
    id: "referat",
    title: "Referat xatboshisi",
    system: `${UZ} Siz oliy taʼlim talabasi uchun ilmiy uslubda yozasiz.`,
    user: "«Raqamli iqtisodiyotning kichik biznesga taʼsiri» mavzusidagi referat uchun kirish qismining 150–200 soʻzlik xatboshisini yozing.",
    maxTokens: 1000,
  },
  {
    id: "insho",
    title: "Insho",
    system: `${UZ} Siz maktab oʻquvchisi uchun jonli, samimiy uslubda yozasiz.`,
    user: "«Ona tilim — faxrim» mavzusida 120–150 soʻzlik qisqa insho yozing.",
    maxTokens: 1000,
  },
  {
    id: "apostrophes",
    title: "Lotin harflari oʻ/gʻ va tutuq belgisi",
    system: UZ,
    user: "Quyidagi soʻzlar bilan bittadan gap tuzing: oʻqituvchi, togʻ, maʼlumot, sanʼat, gʻoya, oʻzgarish, taʼlim, qoʻshiq.",
    maxTokens: 600,
  },
  {
    id: "formal",
    title: "Rasmiy uslub",
    system: `${UZ} Siz davlat tashkiloti uchun rasmiy-idoraviy uslubda hujjat yozasiz.`,
    user: "Tuman xalq taʼlimi boʻlimi mudiriga maktabda kompyuter xonasini taʼmirlash uchun mablagʻ soʻrab rasmiy ariza matnini yozing.",
    maxTokens: 800,
  },
];

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = { gemini: geminiAdapter, ...FALLBACK_ADAPTERS };

type Row = { spec: RoleSpec; ms: number; text: string; note: string; usd: number };

const label = (s: RoleSpec) => `${s.provider}:${s.model}`;

async function run(spec: RoleSpec, p: (typeof PROMPTS)[number]): Promise<Row> {
  const started = Date.now();
  const r = await ADAPTERS[spec.provider]!.complete(spec.model, p.system, p.user, { json: p.json, maxTokens: p.maxTokens, timeoutMs: 120_000 });
  const ms = Date.now() - started;
  if (!r.ok) return { spec, ms, text: "", note: `XATO: ${r.status ?? "-"} ${r.error}`, usd: 0 };
  const usd = costUsd({ provider: spec.provider, model: spec.model, ...r.usage });
  return { spec, ms, text: r.text, note: `${r.usage.inputTokens} / ${r.usage.outputTokens} token`, usd };
}

function report(models: RoleSpec[], rows: Map<string, Row[]>): string {
  const out = [`# Uzbek text bench`, ``, `Generated ${new Date().toISOString()}. Models: ${models.map(label).join(", ")}.`, ``];
  out.push(`Read for: correct oʻ/gʻ and tutuq belgisi, natural Uzbek (no Russian or Turkish words), the register asked for, valid JSON.`, ``);
  out.push(`| Model | Total latency | Total cost |`, `|---|---|---|`);
  for (const m of models) {
    const own = [...rows.values()].flat().filter((r) => label(r.spec) === label(m));
    out.push(`| ${label(m)} | ${(own.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)} s | $${own.reduce((a, r) => a + r.usd, 0).toFixed(5)} |`);
  }
  for (const p of PROMPTS) {
    out.push(``, `## ${p.title}`, ``, `> ${p.user}`, ``);
    for (const r of rows.get(p.id) ?? []) {
      out.push(`### ${label(r.spec)}`, ``, `${(r.ms / 1000).toFixed(1)} s · ${r.note} · $${r.usd.toFixed(5)}`, ``, r.text ? "```text" : "", r.text, r.text ? "```" : "", ``);
    }
  }
  return out.join("\n");
}

async function main() {
  const models = MODELS.filter((m) => getProviderKey(m.provider));
  for (const m of MODELS) if (!models.includes(m)) console.log(`skip ${label(m)}: no key`);
  if (models.length === 0) {
    console.log("No provider key in the environment: nothing was sent.");
    return;
  }
  const rows = new Map<string, Row[]>();
  for (const p of PROMPTS) {
    const done = await Promise.all(models.map((m) => run(m, p)));
    rows.set(p.id, done);
    for (const r of done) console.log(`${p.id} ${label(r.spec)} ${r.ms} ms ${r.note}`);
  }
  const file = path.resolve(process.argv[2] ?? "eval-out/llm-uz-bench.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, report(models, rows));
  console.log(`Written: ${file}`);
}

await main();
