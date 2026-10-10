/**
 * Our recorded AI spend against the Google bill (READ-ONLY: no network, no writes).
 *
 * Input: a CSV exported from Google AI Studio → Billing (or the Cloud Billing report)
 * with one row per day and SKU — columns date, model/SKU, usage (optional), cost in
 * USD. Header names are matched tolerantly; the exact rules and the accepted number
 * and date formats are documented at the top of `lib/server/cost-reconcile.ts`.
 *
 * Output: per model a total and per model·day a row — ours (`ai_usage.parts`), billed,
 * the difference and its percentage; rows with |diff| ≥ $0.01 AND > 5 % are marked
 * `!!`. A flagged model means the price book (`lib/generation/llm-pricing.ts`) or the
 * metering misses something: cache tokens, `toolUsePromptTokenCount`, image size,
 * grounding queries.
 *
 * Usage (heavy command — ONLY through `scripts/heavy.sh`; DATABASE_URL is read, point
 * it at a copy or a read-only role for production data):
 *   DATABASE_URL=… scripts/heavy.sh npx tsx --env-file-if-exists=.env.local --conditions=react-server \
 *     scripts/cost-reconcile.mts billing-2026-09-10_2026-10-10.csv [--tz UTC] [--threshold 5] [--min-usd 0.01] [--provider gemini|all]
 *
 * `--tz` is the zone our `ai_usage.at` is bucketed in (default UTC; Google invoices use
 * Pacific Time, so compare the per-model TOTALS first). `--provider` limits our side to
 * parts of one provider (default `gemini`: the only one Google bills).
 */
import { readFile } from "node:fs/promises";
import { loadOurUsage, parseBillingCsv, reconcile, renderReconciliation } from "../lib/server/cost-reconcile.ts";
import { pool, transaction } from "../lib/server/db.ts";

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const o = { file: "", tz: "UTC", threshold: 5, minUsd: 0.01, provider: "gemini" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => argv[++i] ?? fail(`${a} needs a value`);
    if (a === "--tz") o.tz = value();
    else if (a === "--threshold") o.threshold = Number(value());
    else if (a === "--min-usd") o.minUsd = Number(value());
    else if (a === "--provider") o.provider = value();
    else if (a.startsWith("--")) fail(`unknown option ${a}`);
    else if (!o.file) o.file = a;
    else fail(`unexpected argument ${a}`);
  }
  if (!o.file) fail("usage: scripts/cost-reconcile.mts <billing.csv> [--tz UTC] [--threshold 5] [--min-usd 0.01] [--provider gemini|all]");
  if (!Number.isFinite(o.threshold) || o.threshold < 0) fail("--threshold must be a non-negative number");
  if (!Number.isFinite(o.minUsd) || o.minUsd < 0) fail("--min-usd must be a non-negative number");
  return o;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseBillingCsv(await readFile(args.file, "utf8"));
  const c = parsed.columns;
  if (!c.date || !c.model || !c.cost) {
    fail(`could not find the date / model / cost columns (found: date=${c.date}, model=${c.model}, cost=${c.cost}); see lib/server/cost-reconcile.ts for the accepted headers`);
  }
  if (!parsed.rows.length) fail(`no readable rows in ${args.file} (${parsed.skipped} skipped)`);
  console.log(`Billing: ${parsed.rows.length} rows (${parsed.skipped} skipped) — date="${c.date}" model="${c.model}" cost="${c.cost}"${c.usage ? ` usage="${c.usage}"` : ""}`);

  const days = parsed.rows.map((r) => r.day).sort();
  const first = days[0];
  const last = new Date(`${days[days.length - 1]}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 1);
  const toDayExclusive = last.toISOString().slice(0, 10);

  const ours = await transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    return loadOurUsage(client, { fromDay: first, toDayExclusive, tz: args.tz, provider: args.provider });
  });
  console.log(`Ours: ${ours.length} model·day rows from ai_usage (${first} … ${toDayExclusive}, tz ${args.tz}, provider ${args.provider})\n`);

  const opts = { thresholdPct: args.threshold, minUsd: args.minUsd };
  console.log(renderReconciliation(reconcile(ours, parsed.rows, opts), opts));
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
