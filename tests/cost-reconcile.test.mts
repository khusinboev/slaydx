import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import {
  canonicalModel,
  knownModels,
  parseBillingCsv,
  parseBillingDay,
  parseCsv,
  parseMoney,
  reconcile,
  renderReconciliation,
  type BillingRow,
  type OurRow,
} from "../lib/server/cost-reconcile.ts";

/**
 * `scripts/cost-reconcile.mts` logic (lib/server/cost-reconcile.ts): the billing CSV
 * parser, the SKU → model mapping, the per-model·day diff and the read-only
 * `ai_usage` loader. SYNTHETIC data only — no real billing export is in the repo.
 *
 * Mutations (each turned the named test red):
 *   - flag rule `>` → `>=` at the threshold  -> «exactly 5 % is not flagged»;
 *   - billing SKUs of one model·day overwritten instead of summed -> «SKU rows are summed»;
 *   - the loader ignoring `tz`               -> «tz decides the day bucket»;
 *   - the provider filter dropped            -> «provider filter».
 */

const GOOGLE_STYLE = `Date,SKU description,Usage,Cost ($)
2026-10-01,Gemini 3.7 Flash Input tokens,"1,200,000",$0.90
2026-10-01,Gemini 3.7 Flash Output tokens,"300,000","$1.125"
2026-10-02,Gemini 3.7 Flash Output tokens,"100,000",$0.375
2026-10-02,Gemini 2.5 Flash Preview TTS Output audio tokens,"3,700",$0.037
2026-10-02,Grounding with Google Search,12,$0.168
`;

test("parseBillingCsv: Google-style export — dates, SKU text, usage and cost (with $ and thousands separators)", () => {
  const p = parseBillingCsv(GOOGLE_STYLE);
  assert.deepEqual(p.columns, { date: "Date", model: "SKU description", usage: "Usage", cost: "Cost ($)" });
  assert.equal(p.skipped, 0);
  assert.deepEqual(p.rows[0], { day: "2026-10-01", label: "Gemini 3.7 Flash Input tokens", usage: 1_200_000, usd: 0.9 });
  assert.equal(p.rows.length, 5);
  assert.equal(p.rows[3].usd, 0.037);
  assert.equal(p.rows[4].usage, 12);
});

test("parseBillingCsv: other header names/order, `;` delimiter, decimal commas, BOM, quoted commas, ISO timestamps", () => {
  const csv = '﻿"Model";"Subtotal";"usage_start_time";"Quantity";"Unrelated"\r\n' +
    '"Gemini 3.7 Flash, input";"1.234,56";"2026-10-03T00:00:00-07:00";"2.000.000";"x"\r\n' +
    '"gemini-3.1-flash-lite-image";"(0,50)";"2026-10-04T07:00:00Z";"";"y"\r\n';
  const p = parseBillingCsv(csv);
  assert.deepEqual(p.columns, { date: "usage_start_time", model: "Model", usage: "Quantity", cost: "Subtotal" });
  assert.deepEqual(p.rows, [
    { day: "2026-10-03", label: "Gemini 3.7 Flash, input", usage: 2_000_000, usd: 1234.56 },
    { day: "2026-10-04", label: "gemini-3.1-flash-lite-image", usage: null, usd: -0.5 },
  ]);
  // Tab-separated export.
  const tsv = "Day\tModel\tCost\n10/05/2026\tGemini 3.7 Flash\t2.50\n";
  assert.deepEqual(parseBillingCsv(tsv).rows, [{ day: "2026-10-05", label: "Gemini 3.7 Flash", usage: null, usd: 2.5 }]);
});

test("parseBillingCsv: unreadable rows are skipped and counted, a missing role is reported — never guessed", () => {
  const csv = "Date,Model,Cost\n2026-10-01,Gemini 3.7 Flash,1.00\nnot a date,Gemini 3.7 Flash,1.00\n2026-10-02,Gemini 3.7 Flash,abc\n2026-10-03,,1.00\n\n2026-10-04,Gemini 3.7 Flash,2.00\n";
  const p = parseBillingCsv(csv);
  assert.deepEqual(p.rows.map((r) => r.day), ["2026-10-01", "2026-10-04"]);
  assert.equal(p.skipped, 3);

  const noCost = parseBillingCsv("Date,Model\n2026-10-01,Gemini 3.7 Flash\n");
  assert.equal(noCost.columns.cost, null);
  assert.deepEqual(noCost.rows, []);
  assert.deepEqual(parseBillingCsv("").rows, []);
});

test("parseCsv: quotes, doubled quotes, embedded newlines and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x ""y"" z","line1\nline2"\r\n'), [["a", "b"], ['x "y" z', "line1\nline2"]]);
});

test("parseMoney / parseBillingDay: tolerant number and date formats", () => {
  const money: [string, number][] = [
    ["$1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1 234,5", 1234.5],
    ["1,234", 1234],
    ["0,5", 0.5],
    ["(1.23)", -1.23],
    ["-1.23", -1.23],
    ["0.5 USD", 0.5],
    ["1.234.567", 1234567],
    ["12", 12],
  ];
  for (const [raw, want] of money) assert.equal(parseMoney(raw), want, raw);
  for (const raw of ["", "abc", "-", "1-2", "$"]) assert.ok(Number.isNaN(parseMoney(raw)), `«${raw}» must not parse`);

  const days: [string, string | null][] = [
    ["2026-10-01", "2026-10-01"],
    ["2026-10-01T23:59:59-07:00", "2026-10-01"],
    ["10/01/2026", "2026-10-01"],
    ["25/12/2026", "2026-12-25"],
    ["1.2.26", "2026-01-02"],
    ["Oct 1, 2026", "2026-10-01"],
    ["2026-02-30", null],
    ["", null],
    ["yesterday", null],
  ];
  for (const [raw, want] of days) assert.equal(parseBillingDay(raw), want, raw);
});

test("canonicalModel: the longest known model inside the SKU; grounding; unknown models keep a stable name", () => {
  const known = knownModels();
  assert.equal(canonicalModel("Gemini 3.7 Flash Input tokens", known), "gemini-3.7-flash");
  assert.equal(canonicalModel("Gemini 3.5 Flash Lite Output tokens", known), "gemini-3.5-flash-lite");
  assert.equal(canonicalModel("Gemini 2.5 Flash Preview TTS Output audio tokens", known), "gemini-2.5-flash-preview-tts");
  assert.equal(canonicalModel("Gemini 2.5 Pro Preview TTS Input text tokens", known), "gemini-2.5-pro-preview-tts");
  // lite-image must not be mistaken for flash-image and vice versa.
  assert.equal(canonicalModel("Gemini 3.1 Flash Lite Image output", known), "gemini-3.1-flash-lite-image");
  assert.equal(canonicalModel("Gemini 3.1 Flash Image output", known), "gemini-3.1-flash-image");
  assert.equal(canonicalModel("Grounding with Google Search", known), "google_search");
  // Not in the book: the SKU without its token/tier tail, identical for input and output rows.
  assert.equal(canonicalModel("Gemini 9 Ultra Input tokens", known), "gemini-9-ultra");
  assert.equal(canonicalModel("Gemini 9 Ultra Output tokens", known), "gemini-9-ultra");
  // A model only the telemetry knows (passed in) wins over the generic strip.
  assert.equal(canonicalModel("Mystery Model X Output tokens", knownModels(["mystery-model-x"])), "mystery-model-x");
});

const O = (day: string, model: string, usd: number, calls = 1): OurRow => ({ day, model, usd, calls });
const B = (day: string, label: string, usd: number, usage: number | null = null): BillingRow => ({ day, label, usd, usage });

test("reconcile: SKU rows are summed per model·day, diff and percentage are exact, totals and grand total follow", () => {
  const billing = [B("2026-10-01", "Gemini 3.7 Flash Input tokens", 0.9, 1_200_000), B("2026-10-01", "Gemini 3.7 Flash Output tokens", 1.125, 300_000), B("2026-10-02", "Gemini 3.7 Flash Output tokens", 0.375)];
  const ours = [O("2026-10-01", "gemini-3.7-flash", 2.0, 4), O("2026-10-02", "gemini-3.7-flash", 0.4, 1)];
  const r = reconcile(ours, billing);
  // MUTATION (overwrite instead of sum): day 1 billing would be 1.125, not 2.025.
  assert.deepEqual(r.daily.map((x) => [x.day, x.model, x.ours, x.billing, x.diff, x.diffPct, x.flagged]), [
    ["2026-10-01", "gemini-3.7-flash", 2, 2.025, -0.025, -1.23, false],
    // +6.67 % and $0.025 (≥ the $0.01 floor): flagged.
    ["2026-10-02", "gemini-3.7-flash", 0.4, 0.375, 0.025, 6.67, true],
  ]);
  assert.equal(r.daily[0].billingUsage, 1_500_000);
  assert.equal(r.daily[0].oursCalls, 4);
  assert.deepEqual(r.totals.map((x) => [x.model, x.ours, x.billing, x.diff, x.diffPct, x.flagged]), [["gemini-3.7-flash", 2.4, 2.4, 0, 0, false]]);
  assert.deepEqual([r.grand.model, r.grand.ours, r.grand.billing, r.grand.flagged], ["TOTAL", 2.4, 2.4, false]);
});

test("reconcile: exactly 5 % is not flagged, just above is; the $ floor keeps noise quiet; one-sided rows are flagged", () => {
  const at = (ours: number, billing: number, opts = {}) => reconcile([O("2026-10-01", "gemini-3.7-flash", ours)], [B("2026-10-01", "Gemini 3.7 Flash", billing)], opts).daily[0];
  // 100.00 billed: 95.00 → −5.00 % (not flagged: not MORE than 5), 94.99 → −5.01 % (flagged). MUTATION `>=`: first one flags.
  assert.deepEqual([at(95, 100).diffPct, at(95, 100).flagged], [-5, false]);
  assert.deepEqual([at(94.99, 100).diffPct, at(94.99, 100).flagged], [-5.01, true]);
  assert.equal(at(105.01, 100).flagged, true);
  assert.equal(at(105, 100).flagged, false);
  // −50 % of a half-cent day is noise: below the $0.01 floor.
  assert.deepEqual([at(0.005, 0.01).diffPct, at(0.005, 0.01).flagged], [-50, false]);
  assert.equal(at(0.005, 0.01, { minUsd: 0.001 }).flagged, true, "the floor is configurable");
  assert.equal(at(95, 100, { thresholdPct: 4 }).flagged, true, "the threshold is configurable");

  // Billed but never recorded by us (ours 0) / recorded but never billed.
  const r = reconcile([O("2026-10-01", "gemini-3.1-flash-image", 0.5)], [B("2026-10-01", "Gemini 2.5 Flash Preview TTS Output audio tokens", 2)]);
  const byModel = Object.fromEntries(r.daily.map((x) => [x.model, x]));
  assert.deepEqual([byModel["gemini-2.5-flash-preview-tts"].ours, byModel["gemini-2.5-flash-preview-tts"].diffPct, byModel["gemini-2.5-flash-preview-tts"].flagged], [0, -100, true]);
  assert.deepEqual([byModel["gemini-3.1-flash-image"].billing, byModel["gemini-3.1-flash-image"].diffPct, byModel["gemini-3.1-flash-image"].flagged], [0, null, true]);
  assert.equal(r.totals.length, 2);
  assert.equal(r.grand.flagged, true);
});

test("renderReconciliation: totals first, `!!` on flagged rows, a closing line that names where to fix", () => {
  const r = reconcile([O("2026-10-01", "gemini-3.7-flash", 1.0)], [B("2026-10-01", "Gemini 3.7 Flash", 2.0)]);
  const text = renderReconciliation(r);
  assert.match(text, /^Totals per model/);
  assert.ok(text.indexOf("Per model and day") > text.indexOf("TOTAL"));
  assert.match(text, /!!\s+all days\s+gemini-3\.7-flash\s+\$1\.0000\s+\$2\.0000\s+-\$1\.0000\s+-50\.0%/);
  assert.match(text, /!!\s+2026-10-01\s+gemini-3\.7-flash/);
  assert.match(text, /2 row\(s\) flagged \(!!\)/);
  assert.match(text, /llm-pricing\.ts/);
  const clean = renderReconciliation(reconcile([O("2026-10-01", "gemini-3.7-flash", 1.0)], [B("2026-10-01", "Gemini 3.7 Flash", 1.0)]));
  assert.ok(!clean.includes("!!") && clean.includes("No row exceeds the threshold."));
});

/* ══════════════════════════ the read-only loader ══════════════════════════ */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("reconcile") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

test("loadOurUsage: parts per day and model; provider filter, tz decides the day bucket, malformed parts are ignored; reads inside READ ONLY", { skip }, async (t) => {
  const { query, migrate, pool, transaction } = await import("../lib/server/db.ts");
  const { loadOurUsage } = await import("../lib/server/cost-reconcile.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const part = (kind: string, provider: string, model: string, usd: unknown, calls: unknown = 1) => ({ kind, provider, model, calls, inputTokens: 0, outputTokens: 0, units: 0, usd });
  async function usage(at: string, parts: unknown) {
    await query(`INSERT INTO ai_usage (at, source, outcome, tool_id, calls, usd, parts) VALUES ($1, 'job', 'completed', 'x', 1, 0, $2::jsonb)`, [at, JSON.stringify(parts)]);
  }
  // 2026-10-02 22:30 UTC = 2026-10-03 03:30 in Tashkent.
  await usage("2026-10-02T22:30:00Z", [part("llm", "gemini", "gemini-3.7-flash", 1.5, 2), part("tts", "gemini", "gemini-2.5-flash-preview-tts", 0.003735), part("tts", "azure", "azure:uz-UZ-MadinaNeural", 0.016), part("grounding", "gemini", "google_search", 0.028, 2)]);
  await usage("2026-10-02T10:00:00Z", [part("llm", "gemini", "gemini-3.7-flash", 0.5)]);
  await usage("2026-10-04T10:00:00Z", [part("llm", "gemini", "gemini-3.7-flash", 9)]); // outside the window
  await usage("2026-10-02T11:00:00Z", { not: "an array" }); // malformed parts
  await usage("2026-10-02T12:00:00Z", [part("llm", "gemini", "gemini-3.7-flash", "oops"), part("llm", "gemini", "", -3)]); // junk usd

  const load = (o: Partial<Parameters<typeof loadOurUsage>[1]> = {}) =>
    transaction(async (c) => {
      await c.query("SET TRANSACTION READ ONLY");
      return loadOurUsage(c, { fromDay: "2026-10-02", toDayExclusive: "2026-10-04", ...o });
    });
  const flat = (rows: Awaited<ReturnType<typeof load>>) => rows.map((r) => `${r.day} ${r.model} ${r.usd} ${r.calls}`);

  // UTC buckets: both big rows on 10-02; the 22:30 one carries all gemini parts.
  const sorted = (rows: Awaited<ReturnType<typeof load>>) => flat(rows).sort();
  assert.deepEqual(sorted(await load()), [
    "2026-10-02 gemini-2.5-flash-preview-tts 0.003735 1",
    "2026-10-02 gemini-3.7-flash 2 4",
    "2026-10-02 google_search 0.028 2",
    "2026-10-02 unknown 0 1",
  ]);
  // MUTATION (tz ignored): the 22:30Z row would stay on 10-02.
  assert.deepEqual(
    sorted(await load({ tz: "Asia/Tashkent" })),
    [
      "2026-10-02 gemini-3.7-flash 0.5 2",
      "2026-10-02 unknown 0 1",
      "2026-10-03 gemini-2.5-flash-preview-tts 0.003735 1",
      "2026-10-03 gemini-3.7-flash 1.5 2",
      "2026-10-03 google_search 0.028 2",
    ],
    "tz decides the day bucket",
  );
  // MUTATION (provider filter dropped): azure would appear. `all` is the explicit opt-out.
  assert.ok(!flat(await load()).some((l) => l.includes("azure")));
  assert.ok(flat(await load({ provider: "all" })).some((l) => l.includes("azure:uz-UZ-MadinaNeural 0.016")));
  assert.deepEqual(await load({ fromDay: "2030-01-01", toDayExclusive: "2030-01-02" }), []);
  await assert.rejects(load({ tz: "Mars/Olympus" }), /time zone/);

  // End to end with a synthetic bill: the TTS day is under-billed by us → flagged.
  const billing = parseBillingCsv("Date,SKU description,Cost\n2026-10-02,Gemini 3.7 Flash Output tokens,2.00\n2026-10-02,Gemini 2.5 Flash Preview TTS Output audio tokens,0.037\n").rows;
  const rec = reconcile(await load(), billing);
  const tts = rec.totals.find((x) => x.model === "gemini-2.5-flash-preview-tts")!;
  assert.deepEqual([tts.ours, tts.billing, tts.flagged], [0.003735, 0.037, true]);
  assert.equal(rec.totals.find((x) => x.model === "gemini-3.7-flash")!.flagged, false);
});
