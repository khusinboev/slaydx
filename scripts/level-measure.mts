#!/usr/bin/env node
/**
 * ESSAY LEVEL MEASURER (mobile sprint, `docs/mobile/R4-essay-level.md` §5).
 *
 * Reads saved essay documents (`eval-out/live/*.doc.json`, written by
 * `npm run live` for every essay case) and prints the deterministic level
 * measure of each text — the SAME `measureLevel`/`levelVerdict` the engine's
 * repair pass and the report rule use. No LLM, no network, no DB: re-runnable
 * for free, so the thresholds in `lib/generation/essay/level.ts` can be
 * calibrated against real outputs.
 *
 * Usage:
 *   scripts/heavy.sh npx tsx scripts/level-measure.mts [file.doc.json | dir ...] [--strict] [--json]
 *   (no path → eval-out/live)
 *
 * Output:
 *   1) one row per essay: language, stored level, sentences, mean / p90 / max
 *      words per sentence, commas per sentence, long-word share (en/ru),
 *      verdict at the stored level (or «—» for a document without a level)
 *      and the BEST-FIT level (smallest distance) — the baseline answer for
 *      documents written before the level existed (R4 §5 step 0);
 *   2) per language: mean sentence length by stored level, with the R4 pass
 *      criteria — strictly increasing, ≥ 20 % gaps between measured
 *      neighbours, and the share of green verdicts.
 * `--strict` exits 1 when a criterion fails (for a scripted gate), `--json`
 * prints the rows as JSON instead of the table.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AcademicDoc } from "../lib/generation/types.ts";
import { CEFR_LEVELS, levelVerdict, measureLevel, type CefrLevel, type LevelMeasure } from "../lib/generation/essay/level.ts";
import { essayModelOf, essayTextOf } from "../lib/generation/essay/review.ts";
import type { EssayLang } from "../lib/generation/essay/registry.ts";

type Row = {
  name: string;
  lang: EssayLang;
  context: string;
  level: CefrLevel | null;
  measure: LevelMeasure;
  p90: number;
  verdict: string;
  bestFit: CefrLevel;
};

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const asJson = args.includes("--json");
const inputs = args.filter((a) => !a.startsWith("--"));
if (!inputs.length) inputs.push(path.resolve(process.cwd(), "eval-out", "live"));

async function files(p: string): Promise<string[]> {
  const s = await stat(p);
  if (!s.isDirectory()) return [p];
  return (await readdir(p)).filter((f) => f.endsWith(".doc.json")).sort().map((f) => path.join(p, f));
}

function p90(lengths: number[]): number {
  if (!lengths.length) return 0;
  const s = [...lengths].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

function bestFit(m: LevelMeasure, lang: EssayLang): CefrLevel {
  let best: CefrLevel = CEFR_LEVELS[0];
  let bestD = Infinity;
  for (const l of CEFR_LEVELS) {
    const d = levelVerdict(m, l, lang).distance;
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

const rows: Row[] = [];
for (const input of inputs) {
  for (const file of await files(input)) {
    const doc = JSON.parse(await readFile(file, "utf8")) as AcademicDoc;
    if (!doc.essay) continue;
    const model = essayModelOf(doc);
    const m = measureLevel(essayTextOf(doc, model).paragraphs.join("\n"), model.language);
    const level = model.level ?? null;
    rows.push({
      name: path.basename(file, ".doc.json"),
      lang: model.language,
      context: model.context,
      level,
      measure: m,
      p90: p90(m.lengths),
      verdict: level ? levelVerdict(m, level, model.language).level : "—",
      bestFit: bestFit(m, model.language),
    });
  }
}

if (!rows.length) {
  console.log(`Insho doc.json topilmadi: ${inputs.join(", ")} (avval: npm run live -- essay-lvl-…)`);
  process.exit(strict ? 1 : 0);
}

if (asJson) {
  console.log(JSON.stringify(rows.map((r) => ({ ...r, measure: { ...r.measure, lengths: undefined } })), null, 2));
} else {
  const f1 = (x: number) => x.toFixed(1);
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const header = ["essay", "lang", "context", "level", "sent", "mean", "p90", "max", "comma/s", "long", "verdict", "best-fit"];
  const table = rows.map((r) => [r.name, r.lang, r.context, r.level ?? "—", String(r.measure.sentences), f1(r.measure.mean), String(r.p90), String(r.measure.max), f1(r.measure.commasPerSentence), pct(r.measure.longWordShare), r.verdict, r.bestFit]);
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((t) => t[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  for (const t of table) console.log(line(t));
}

/* ── per-language criteria (R4 §5 step 1) ── */
let failed = false;
for (const lang of ["uz", "ru", "en"] as EssayLang[]) {
  const leveled = rows.filter((r) => r.lang === lang && r.level);
  if (!leveled.length) continue;
  const byLevel = new Map<CefrLevel, number[]>();
  for (const r of leveled) byLevel.set(r.level!, [...(byLevel.get(r.level!) ?? []), r.measure.mean]);
  const means = CEFR_LEVELS.filter((l) => byLevel.has(l)).map((l) => ({ l, mean: byLevel.get(l)!.reduce((a, b) => a + b, 0) / byLevel.get(l)!.length }));
  const problems: string[] = [];
  for (let i = 1; i < means.length; i++) {
    const [a, b] = [means[i - 1], means[i]];
    if (!(b.mean > a.mean)) problems.push(`${a.l}→${b.l} o'smadi`);
    else if (b.mean < a.mean * 1.2) problems.push(`${a.l}→${b.l} farq < 20 % (${a.mean.toFixed(1)} → ${b.mean.toFixed(1)})`);
  }
  const green = leveled.filter((r) => r.verdict === "green").length;
  const red = leveled.filter((r) => r.verdict === "red").length;
  if (problems.length || red) failed = true;
  console.log(
    `\n[${lang}] ${means.map((x) => `${x.l} ${x.mean.toFixed(1)}`).join(" · ")} | yashil ${green}/${leveled.length}, qizil ${red}` +
      (problems.length ? ` | MUAMMO: ${problems.join("; ")}` : " | monoton, ≥ 20 % farq"),
  );
}

if (strict && failed) process.exit(1);
