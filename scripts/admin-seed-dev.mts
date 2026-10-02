/**
 * Development seed for the admin panel (docs/admin/02-plan.md §11, §13.4).
 *
 * Usage:
 *   npm run admin:seed-dev                    # add one batch of seed data
 *   npm run admin:seed-dev -- --reset         # delete every row this script created
 *   npm run admin:seed-dev -- --owner-telegram-id <id>   # also print the admin:create hint
 *   flags: --json (machine-readable summary), --verbose (keep library log lines)
 *
 * Refuses to run (exit 1, nothing connected, nothing written) unless
 * NODE_ENV is not "production", the database name in DATABASE_URL does not
 * contain "prod" and the database host is local (127.0.0.1, localhost, ::1).
 * It also refuses when a process that executes jobs (a worker, or a web
 * process with the inline worker) sent a heartbeat to this database in the
 * last 90 seconds, or when the queue already holds claimable jobs: seeded jobs
 * pass through QUEUED for a moment, and a live worker would run them against
 * the real LLM and image providers.
 *
 * Data goes through the product's own code paths wherever one exists:
 * `upsertTelegramUser` (signup bonus), `createSession`/`revokeAllSessions`,
 * `createOrder`/`attachTransaction`/`settleOrder`/`cancelOrder` with
 * `recordPaymentEvent` (legacy Pro orders: see below), `enqueueGeneration` → `claimJob` →
 * `setCost`/`commitJobResult`/`failJob` (the script drives the lifecycle
 * itself; it never starts a worker and never calls a provider),
 * `cancelGeneration`, `refundInTx`, `refundPartial`, `adminAdjustWalletInTx`,
 * `recordAiUsage`, `createGameSession`/`addResult`, the error sink
 * (`createErrorSink` + `log`), `writeHeartbeat` with real breaker/limiter
 * snapshots, and `recordStep`. Plain SQL is used only where no such path
 * exists without an admin account (blocking a user, broadcasts, resolving
 * errors), for the phone a user shares with the bot (the bot handler itself
 * sends Telegram messages), for history the product can no longer write
 * (subscriptions are removed, docs/SUBS-REMOVAL.md: a legacy Pro order and
 * the `subscription` quota credit it got, then migration 034's quota → balance
 * merge for the seeded users, without its audit row), and for backdating
 * timestamps that the API sets to now(); every such statement is marked
 * "BACKDATE" or "PLAIN SQL" below.
 * Pricing (`tool_pricing`) and runtime settings are never touched, and the
 * script never creates admin accounts or audit rows (`admin_audit_log` is
 * append-only, so `--reset` could not remove them).
 *
 * Every seeded row is tagged so `--reset` removes exactly these rows:
 * users have a `seed_b<N>_` username AND a synthetic Telegram id in
 * [SEED_TG_BASE, SEED_TG_BASE + SEED_TG_SPAN) (both must match); their
 * sessions, generations, files, ledger, orders, game links and results go
 * with them (ON DELETE CASCADE); ai_usage rows by user/generation id,
 * payment events by order id, error_log / heartbeats / housekeeping rows by
 * the "seed-dev" process id, broadcasts by their text prefix. Running the
 * script twice adds a second batch (`seed_b2_…`).
 */
import { randomBytes, randomUUID } from "node:crypto";

const USAGE =
  "Usage: npm run admin:seed-dev -- [--reset] [--owner-telegram-id <id>] [--json] [--verbose]";

/** Synthetic Telegram ids: far above any id Telegram has issued, so no real account can collide. */
const SEED_TG_BASE = 9_990_000_000_000;
const SEED_TG_SPAN = 1_000_000_000;
const BATCH_TG_STRIDE = 10_000;
/** Process id prefix of the seeded error_log / heartbeat / housekeeping rows. */
const SEED_HOST = "seed-dev";
const SEED_PROCESS_RE = "^(web|worker)@seed-dev(-[a-z])?:[0-9]+$";
const BROADCAST_TAG = "[seed-dev] ";
/** QUEUED seed jobs are parked this far in the future so no worker ever claims them. */
const PARK_DAYS = 3650;
const DAY_MS = 86_400_000;
/** The removed Pro subscription as it was sold (the former `payments.PRO_PLAN`): price, quota credited, days. */
const LEGACY_PRO = { priceSoum: 15_000, quota: 15_000, days: 30 } as const;
const UA = [
  "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
];
/** The only phone numbers allowed in this repository (tests/no-pii-in-repo.test.mts). */
const PHONES = ["+998901234567", "+998901112233", "+998907654321", "+998900000001", "+998900000002"];

type Args = { reset: boolean; ownerTelegramId: string | null; json: boolean; verbose: boolean };

function parseArgs(argv: string[]): Args {
  const out: Args = { reset: false, ownerTelegramId: null, json: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--reset") out.reset = true;
    else if (flag === "--json") out.json = true;
    else if (flag === "--verbose") out.verbose = true;
    else if (flag === "--owner-telegram-id") {
      const value = argv[i + 1];
      if (!value || !/^\d{1,19}$/.test(value)) throw new Error("--owner-telegram-id needs a numeric Telegram id");
      out.ownerTelegramId = value;
      i++;
    } else throw new Error(`unknown argument: ${flag}`);
  }
  return out;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Why this environment must not be seeded, or null. Checked before any module touches the database. */
function refusalReason(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV === "production") return 'NODE_ENV is "production"';
  const raw = env.DATABASE_URL ?? "";
  if (!raw) return "DATABASE_URL is not set";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "DATABASE_URL is not a valid URL";
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) return "DATABASE_URL names no database";
  if (name.toLowerCase().includes("prod")) return `the database name "${name}" contains "prod"`;
  // `?host=` overrides the authority in node-postgres, so both must be local.
  const hosts = [url.hostname, ...url.searchParams.getAll("host")];
  for (const h of hosts) {
    if (!LOCAL_HOSTS.has(h.toLowerCase())) return `the database host "${h || "(none)"}" is not local (127.0.0.1, localhost or ::1)`;
  }
  return null;
}

let args: Args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  console.error(USAGE);
  process.exit(2);
}
const refusal = refusalReason(process.env);
if (refusal) {
  console.error(`admin:seed-dev refused: ${refusal}. This script only seeds a local development database.`);
  process.exit(1);
}

// Imported only after the guards: env.ts and db.ts read DATABASE_URL at import time.
const db = await import("../lib/server/db.ts");
const auth = await import("../lib/server/auth.ts");
const session = await import("../lib/server/session.ts");
const jobs = await import("../lib/server/jobs.ts");
const credits = await import("../lib/server/credits.ts");
const { refundInTx } = await import("../lib/server/refund-tx.ts");
const payments = await import("../lib/server/payments.ts");
const { recordPaymentEvent } = await import("../lib/server/payment-events.ts");
const { recordAiUsage, flushAiUsage } = await import("../lib/server/ai-usage.ts");
const games = await import("../lib/server/game-sessions.ts");
const logm = await import("../lib/server/log.ts");
const { createErrorSink } = await import("../lib/server/error-sink.ts");
const { writeHeartbeat } = await import("../lib/server/heartbeat.ts");
const { recordStep, flushStepStatus } = await import("../lib/server/housekeeping-status.ts");
const { ADMIN_LEDGER_NOTE } = await import("../lib/server/admin-wallet.ts");
const { effectivePrice } = await import("../lib/server/pricing.ts");
const { env } = await import("../lib/server/env.ts");
const { budgetFor } = await import("../lib/generation/budget.ts");
const { JobCost } = await import("../lib/generation/job-cost.ts");
const { refundRatio } = await import("../lib/generation/delivered.ts");
const { breakerFor } = await import("../lib/generation/llm/breaker.ts");
const { limiterFor } = await import("../lib/generation/llm/limiter.ts");
const { sampleGameDoc } = await import("../lib/generation/games/samples.ts");
const { sampleTeacherDoc } = await import("../lib/generation/teacher/samples.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
type ToolId = import("../lib/types.ts").ToolId;
type FormValues = import("../lib/types.ts").FormValues;
type AcademicDoc = import("../lib/generation/types.ts").AcademicDoc;
type Delivered = import("../lib/generation/types.ts").Delivered;

/* ───────────────────────────── output ───────────────────────────── */

// Library modules write one JSON log line per money/queue step (hundreds per run);
// they would bury the summary, so they are muted unless --verbose.
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
function muteLibraryLogs(): void {
  if (args.verbose) return;
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
}
function restoreConsole(): void {
  Object.assign(console, realConsole);
}
const say = (line = "") => process.stdout.write(`${line}\n`);

/* ───────────────────────────── helpers ───────────────────────────── */

/** Deterministic PRNG (mulberry32): the same batch number gives the same dataset shape. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const sql = db.query;
const one = db.queryOne;
const WORKER_ID = `worker@${SEED_HOST}:${process.pid}`;

/** Postgres-friendly instant. */
const at = (ms: number) => new Date(ms);

/* ───────────────────────────── guards against live workers ───────────────────────────── */

async function liveRefusal(): Promise<string | null> {
  const live = await one<{ process_id: string; age: string }>(
    `SELECT process_id, extract(epoch FROM now() - last_seen_at)::int::text AS age
       FROM process_heartbeats
      WHERE concurrency > 0 AND last_seen_at > now() - interval '90 seconds' AND process_id !~ $1
      ORDER BY last_seen_at DESC LIMIT 1`,
    [SEED_PROCESS_RE],
  );
  if (live) {
    return `a process that executes jobs is attached to this database (${live.process_id}, heartbeat ${live.age} s ago). Stop it, or start the dev server with WORKER_INLINE=false, and run again`;
  }
  const queued = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM generations WHERE status = 'QUEUED' AND run_after <= now()`,
  );
  if (Number(queued?.n ?? 0) > 0) {
    return `the queue holds ${queued?.n} claimable job(s); seeding claims jobs from the queue and would take them. Use a database with an empty queue`;
  }
  return null;
}

/* ───────────────────────────── reset ───────────────────────────── */

const SEED_USERS_SQL = `SELECT id FROM users
  WHERE username LIKE 'seed\\_b%' AND telegram_id >= ${SEED_TG_BASE} AND telegram_id < ${SEED_TG_BASE + SEED_TG_SPAN}`;

async function reset(): Promise<Record<string, number>> {
  return db.transaction(async (c) => {
    const admins = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM admin_accounts WHERE user_id IN (${SEED_USERS_SQL})`);
    if (Number(admins.rows[0]?.n ?? 0) > 0) {
      throw new Error("a seed user has an admin account (created by hand); remove that admin account first");
    }
    const count = async (text: string, params: unknown[] = []) => (await c.query(text, params)).rowCount ?? 0;
    const users = (await c.query<{ id: string }>(SEED_USERS_SQL)).rows.map((r) => r.id);
    const gens = (await c.query<{ id: string }>(`SELECT id FROM generations WHERE user_id = ANY($1::bigint[])`, [users])).rows.map((r) => r.id);
    const orders = (await c.query<{ id: string }>(`SELECT id::text AS id FROM payment_orders WHERE user_id = ANY($1::bigint[])`, [users])).rows.map((r) => r.id);
    const out: Record<string, number> = {};
    out.ai_usage = await count(`DELETE FROM ai_usage WHERE user_id = ANY($1::bigint[]) OR generation_id = ANY($2::uuid[])`, [users, gens]);
    out.payment_events = await count(`DELETE FROM payment_events WHERE order_id = ANY($1::text[])`, [orders]);
    // External refunds an admin may have recorded against a seed order (FK is RESTRICT).
    out.payment_refunds = await count(`DELETE FROM payment_refunds WHERE order_id = ANY($1::uuid[])`, [orders]);
    out.broadcasts = await count(`DELETE FROM broadcasts WHERE created_by IS NULL AND starts_with(text, $1)`, [BROADCAST_TAG]);
    out.error_log = await count(`DELETE FROM error_log WHERE process ~ $1`, [SEED_PROCESS_RE]);
    out.process_heartbeats = await count(`DELETE FROM process_heartbeats WHERE process_id ~ $1`, [SEED_PROCESS_RE]);
    out.housekeeping_status = await count(`DELETE FROM housekeeping_status WHERE last_process ~ $1`, [SEED_PROCESS_RE]);
    out.generations = gens.length;
    out.payment_orders = orders.length;
    // Sessions, generations (+ files, assets, game links and results), ledger rows and orders cascade.
    out.users = await count(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [users]);
    return out;
  });
}

/* ───────────────────────────── summary ───────────────────────────── */

async function summary(): Promise<Record<string, unknown>> {
  const u = `(${SEED_USERS_SQL})`;
  const groups = async (text: string) => {
    const rows = await sql<{ k: string; n: string }>(text);
    return Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
  };
  const n = async (text: string, params: unknown[] = []) => Number((await one<{ n: string }>(text, params))?.n ?? 0);
  return {
    users: {
      total: await n(`SELECT count(*)::text AS n FROM users WHERE id IN ${u}`),
      blocked: await n(`SELECT count(*)::text AS n FROM users WHERE id IN ${u} AND is_blocked`),
      withPhone: await n(`SELECT count(*)::text AS n FROM users WHERE id IN ${u} AND phone IS NOT NULL`),
    },
    sessions: {
      total: await n(`SELECT count(*)::text AS n FROM sessions WHERE user_id IN ${u}`),
      revoked: await n(`SELECT count(*)::text AS n FROM sessions WHERE user_id IN ${u} AND revoked_at IS NOT NULL`),
    },
    generations: await groups(`SELECT status AS k, count(*)::text AS n FROM generations WHERE user_id IN ${u} GROUP BY status`),
    generationFiles: await n(`SELECT count(*)::text AS n FROM generation_files f JOIN generations g ON g.id = f.generation_id WHERE g.user_id IN ${u}`),
    transactions: await groups(`SELECT kind AS k, count(*)::text AS n FROM transactions WHERE user_id IN ${u} GROUP BY kind`),
    paymentOrders: await groups(`SELECT state AS k, count(*)::text AS n FROM payment_orders WHERE user_id IN ${u} GROUP BY state`),
    paymentEvents: await n(
      `SELECT count(*)::text AS n FROM payment_events WHERE order_id IN (SELECT id::text FROM payment_orders WHERE user_id IN ${u})`,
    ),
    aiUsage: await groups(
      `SELECT outcome AS k, count(*)::text AS n FROM ai_usage
        WHERE user_id IN ${u} OR generation_id IN (SELECT id FROM generations WHERE user_id IN ${u}) GROUP BY outcome`,
    ),
    gameSessions: await groups(`SELECT kind AS k, count(*)::text AS n FROM game_sessions WHERE user_id IN ${u} GROUP BY kind`),
    gameResults: await n(
      `SELECT count(*)::text AS n FROM game_results r JOIN game_sessions s ON s.id = r.session_id WHERE s.user_id IN ${u}`,
    ),
    errorLog: await n(`SELECT count(*)::text AS n FROM error_log WHERE process ~ $1`, [SEED_PROCESS_RE]),
    heartbeats: await n(`SELECT count(*)::text AS n FROM process_heartbeats WHERE process_id ~ $1`, [SEED_PROCESS_RE]),
    housekeeping: await n(`SELECT count(*)::text AS n FROM housekeeping_status WHERE last_process ~ $1`, [SEED_PROCESS_RE]),
    broadcasts: await groups(
      `SELECT status AS k, count(*)::text AS n FROM broadcasts WHERE created_by IS NULL AND starts_with(text, '${BROADCAST_TAG.replace(/'/g, "''")}') GROUP BY status`,
    ),
    broadcastRecipients: await n(
      `SELECT count(*)::text AS n FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id
        WHERE b.created_by IS NULL AND starts_with(b.text, $1)`,
      [BROADCAST_TAG],
    ),
  };
}

function printSummary(title: string, s: Record<string, unknown>): void {
  say(title);
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === "object") {
      const parts = Object.entries(v as Record<string, number>).map(([kk, vv]) => `${kk} ${vv}`);
      say(`  ${k.padEnd(20)} ${parts.join(", ") || "0"}`);
    } else say(`  ${k.padEnd(20)} ${String(v)}`);
  }
}

/* ───────────────────────────── seed data ───────────────────────────── */

const NAMES = [
  "Dilnoza Rahimova", "Jasur Nematov", "Malika Yusupova", "Sardor Karimov", "Gulnora Toshpo'latova", "Bekzod Aliyev",
  "Nodira Saidova", "Otabek Ergashev", "Shahnoza Qodirova", "Ulug'bek Xolmatov", "Zarina Abdullayeva", "Akmal Ismoilov",
  "Madina Sobirova", "Javohir Tursunov", "Feruza Mirzayeva", "Rustam Hamidov", "Kamola Nurmatova", "Doston Rahmonov",
  "Sevara Ortiqova", "Islom Yo'ldoshev", "Mohira Bakirova", "Behruz Sultonov", "Lola Azimova", "Sanjar Qosimov",
  "Nilufar Jo'rayeva", "Azizbek Raximov", "Dildora Normatova", "Shohruh Usmonov", "Yulduz Hasanova", "Temur Abdurahmonov",
  "Barno Islomova", "Elyor Murodov", "Umida Fayzullayeva", "Abbos Shodiyev", "Gavhar Ahmedova", "Firdavs Olimov",
  "Hilola Komilova", "Muhammadali G'aniyev", "Rayhona Valiyeva", "Sherzod Boboyev",
];
const UNIVERSITIES = ["Toshkent davlat universiteti", "TDIU", "TATU", "Samarqand davlat universiteti", "TDPU", "Buxoro davlat universiteti"];
const TOPICS = [
  "Raqamli iqtisodiyotning rivojlanish istiqbollari",
  "Iqlim o'zgarishi va uning O'zbekistonga ta'siri",
  "Kichik biznesni qo'llab-quvvatlash mexanizmlari",
  "Sun'iy intellektning ta'limdagi o'rni",
  "Amir Temur davlatining boshqaruv tizimi",
  "Suv resurslarini muhofaza qilish",
  "Bank tizimida raqamli xizmatlar",
  "Turizm sohasining eksport salohiyati",
  "Boshlang'ich sinfda o'qish ko'nikmalarini rivojlantirish",
  "Qayta tiklanuvchi energiya manbalari",
  "Kiberxavfsizlik asoslari",
  "Marketing strategiyalari va iste'molchi xulqi",
  "O'zbek adabiyotida Navoiy merosi",
  "Fotosintez va o'simlik fiziologiyasi",
  "Logistika va ta'minot zanjirlari",
  "Sog'lom turmush tarzi va jismoniy tarbiya",
];
/** Tools of the bulk jobs, weighted by how often they are used. */
const BULK_TOOLS: ToolId[] = [
  "slide", "slide", "slide", "slide", "slide", "pro-slide", "pro-slide", "referat", "referat", "referat",
  "coursework", "essay", "essay", "article", "mustaqil-ish", "mustaqil-ish", "thesis", "translation", "lesson-plan", "glossary",
];
type PublicKind = "quiz" | "crossword" | "flashcards" | "sorting" | "listening";
const GAME_KINDS: PublicKind[] = ["quiz", "crossword", "flashcards", "sorting", "listening"];
const PLAYER_NAMES = ["Aziza", "Bobur", "Diyor", "Elif", "Farruh", "Gulruh", "Hasan", "Iroda", "Jahongir", "Komila", "Lazizbek", "Mubina", "Nurali", "Oysha"];

function valuesFor(tool: ToolId, topic: string, author: string, university: string): FormValues {
  const common = { topic, language: "uz", author, university };
  switch (tool) {
    case "slide":
      return { ...common, slideCount: "12" };
    case "pro-slide":
      return { ...common, slideCount: 10 };
    case "coursework":
      return { ...common, pages: "20-25", faculty: "Iqtisodiyot", ministry: "oliy" };
    case "referat":
    case "mustaqil-ish":
      return { ...common, pages: "15-20" };
    case "essay":
      return { ...common, pages: "5" };
    case "article":
      return { ...common, kind: "imrad", pages: "3-5", degree: "Tadqiqotchi" };
    case "thesis":
      return { ...common, articleType: "conference_thesis", pubProfile: "conference", pages: "1-2" };
    case "translation":
      return {
        mode: "text",
        sourceLang: "uz",
        language: "en",
        sourceText: `${topic}. Bu matn ingliz tiliga tarjima qilinishi kerak bo'lgan qisqa ilmiy annotatsiya namunasi.`,
      };
    case "test":
      return { topic, subject: "Biologiya", grade: 8, language: "uz" };
    default:
      return { topic, language: "uz", subject: "Biologiya", grade: 7 };
  }
}

/** A small but valid DOCX / PPTX, so a download from the admin panel opens. */
async function fileFor(tool: ToolId, topic: string): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  const safe = topic.replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, 60).trim() || "Hujjat";
  if (TOOL_BY_ID[tool].output === "pptx") {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.addSlide().addText(topic, { x: 0.5, y: 2, w: 9, h: 1.5, fontSize: 28, bold: true });
    pptx.addSlide().addText("Reja", { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 24 });
    const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    return { bytes: buf, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", fileName: `${safe}.pptx` };
  }
  const { Document, Packer, Paragraph, HeadingLevel } = await import("docx");
  const doc = new Document({
    sections: [{ children: [new Paragraph({ text: topic, heading: HeadingLevel.TITLE }), new Paragraph("Kirish")] }],
  });
  return {
    bytes: await Packer.toBuffer(doc),
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: `${safe}.docx`,
  };
}

function costFor(tool: ToolId, rnd: () => number): import("../lib/generation/types.ts").CostJson {
  const c = new JobCost();
  const k = 0.6 + rnd() * 0.8;
  c.addLlm({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: Math.round(60_000 * k), outputTokens: Math.round(9_000 * k) });
  c.addLlm({ provider: "gemini", model: "gemini-3.5-flash-lite", inputTokens: Math.round(20_000 * k), outputTokens: Math.round(3_000 * k) });
  if (tool === "article" || tool === "thesis" || tool === "coursework") {
    c.addLlm({ provider: "anthropic", model: "claude-sonnet-5", inputTokens: Math.round(30_000 * k), outputTokens: Math.round(4_000 * k) });
    c.addGrounding(1 + Math.floor(rnd() * 3));
  }
  if (tool === "slide" || tool === "pro-slide") {
    c.addImage("gemini", "gemini-3.1-flash-lite-image", tool === "pro-slide" ? 6 : 3);
  }
  return c.toJson();
}

async function seed(rnd: () => number, batch: number): Promise<void> {
  const now = Date.now();
  const tgBase = SEED_TG_BASE + batch * BATCH_TG_STRIDE;

  /* ── users: real signup path (bonus ledger row), synthetic Telegram ids ── */
  type SeedUser = { id: string; name: string; createdAt: number; university: string };
  const users: SeedUser[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const telegramId = String(tgBase + i);
    const taken = await one(`SELECT 1 FROM users WHERE telegram_id = $1`, [telegramId]);
    if (taken) throw new Error(`synthetic Telegram id ${telegramId} is already used; run with --reset first`);
    const name = NAMES[i]!;
    const first = name.split(" ")[0]!.toLowerCase().replace(/[^a-z]/g, "");
    const u = await auth.upsertTelegramUser({ telegramId, username: `seed_b${batch}_${first}${String(i).padStart(2, "0")}`, name, photoUrl: null });
    // Signups grow towards today: the square root spreads older users thinner over 60 days.
    const createdAt = now - Math.round(60 * DAY_MS * Math.sqrt((NAMES.length - i) / NAMES.length)) + Math.round(rnd() * 6 * 3_600_000);
    // BACKDATE: upsertTelegramUser stamps now() on the user and its signup bonus.
    await sql(`UPDATE users SET created_at = $2, updated_at = $2 WHERE id = $1`, [u.id, at(createdAt)]);
    await sql(`UPDATE transactions SET created_at = $2 WHERE user_id = $1 AND kind = 'bonus'`, [u.id, at(createdAt)]);
    users.push({ id: u.id, name, createdAt, university: UNIVERSITIES[i % UNIVERSITIES.length]! });
  }

  // PLAIN SQL: the phone a user shares with the bot (same UPDATE as telegram.ts handleContact,
  // which itself sends Telegram messages). Unique column: skipped when a number is taken.
  for (let i = 0; i < PHONES.length; i++) {
    await sql(
      `UPDATE users SET phone = $2 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE phone = $2)`,
      [users[i]!.id, PHONES[i]],
    );
  }

  /* ── sessions: real createSession; most users 1–2, the last two never logged in on the web ── */
  for (let i = 0; i < users.length - 2; i++) {
    const u = users[i]!;
    const count = 1 + (i % 3 === 0 ? 1 : 0);
    for (let s = 0; s < count; s++) {
      await session.createSession(u.id, { userAgent: UA[(i + s) % UA.length], ip: `10.20.${i}.${s + 1}` });
      const created = u.createdAt + Math.round(rnd() * Math.max(1, now - u.createdAt) * 0.5);
      const seen = created + Math.round(rnd() * Math.max(1, now - created));
      // BACKDATE: createSession stamps now().
      await sql(
        `UPDATE sessions SET created_at = $2, last_seen_at = $3 WHERE id = (SELECT max(id) FROM sessions WHERE user_id = $1)`,
        [u.id, at(created), at(seen)],
      );
    }
  }

  /* ── payment orders: real create/attach/settle/cancel + webhook trail (legacy Pro orders: PLAIN SQL) ── */
  const fundedAt = new Map<string, number>();
  const proUsers = new Set([3, 8, 15, 22]);
  const teachers = [10, 11, 12];
  let txnSeq = 0;
  const clickTxn = () => String(3_000_000_000 + batch * 100_000 + ++txnSeq);
  const paymeTxn = () => randomBytes(12).toString("hex");

  async function trail(o: { id: string; provider: string; amountSoum: number }, txn: string, outcome: "paid" | "pending" | "cancelled", t: number) {
    if (o.provider === "click") {
      const base = {
        click_trans_id: txn,
        service_id: "12345",
        merchant_trans_id: o.id,
        amount: String(o.amountSoum),
        sign_time: new Date(t).toISOString().slice(0, 19).replace("T", " "),
        sign_string: randomBytes(16).toString("hex"),
      };
      await recordPaymentEvent({ provider: "click", method: "prepare", orderId: o.id, providerTxn: txn, payload: { ...base, action: "0", error: "0" }, responseCode: 0 });
      if (outcome === "paid") {
        await recordPaymentEvent({ provider: "click", method: "complete", orderId: o.id, providerTxn: txn, payload: { ...base, action: "1", error: "0", merchant_prepare_id: String(1000 + txnSeq) }, responseCode: 0 });
      } else if (outcome === "cancelled") {
        await recordPaymentEvent({ provider: "click", method: "complete", orderId: o.id, providerTxn: txn, payload: { ...base, action: "1", error: "-9", error_note: "Foydalanuvchi bekor qildi" }, responseCode: -9 });
      }
    } else {
      const account = { order_id: o.id };
      const amount = o.amountSoum * 100;
      await recordPaymentEvent({ provider: "payme", method: "CheckPerformTransaction", orderId: o.id, providerTxn: null, payload: { method: "CheckPerformTransaction", params: { amount, account } }, responseCode: 0 });
      await recordPaymentEvent({ provider: "payme", method: "CreateTransaction", orderId: o.id, providerTxn: txn, payload: { method: "CreateTransaction", params: { id: txn, time: t, amount, account } }, responseCode: 0 });
      if (outcome === "paid") {
        await recordPaymentEvent({ provider: "payme", method: "PerformTransaction", orderId: o.id, providerTxn: txn, payload: { method: "PerformTransaction", params: { id: txn } }, responseCode: 0 });
      } else if (outcome === "cancelled") {
        await recordPaymentEvent({ provider: "payme", method: "CancelTransaction", orderId: o.id, providerTxn: txn, payload: { method: "CancelTransaction", params: { id: txn, reason: 3 } }, responseCode: 0 });
      }
    }
    // BACKDATE: recordPaymentEvent stamps now(); events follow the order a few seconds apart.
    await sql(
      `UPDATE payment_events e SET received_at = $2::timestamptz + (x.rn * interval '20 seconds')
         FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM payment_events WHERE order_id = $1) x
        WHERE e.id = x.id`,
      [o.id, at(t)],
    );
  }

  /**
   * PLAIN SQL: a legacy Pro order row, exactly as `createOrder` inserted one
   * before the subscription removal (it now accepts top-ups only).
   */
  async function legacyProOrder(u: SeedUser, provider: "click" | "payme") {
    const row = await one<{ id: string }>(
      `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES ($1, $2, $3, 'pro', $4) RETURNING id::text AS id`,
      [randomUUID(), u.id, provider, LEGACY_PRO.priceSoum],
    );
    return { id: row!.id, provider, amountSoum: LEGACY_PRO.priceSoum };
  }

  /**
   * PLAIN SQL: what `settleOrder` → `activateProInTx` wrote for a Pro order
   * before the removal — the order marked paid, a `subscription` ledger row
   * crediting `quota` (reference `<provider>:<txn>`, like every settlement) and
   * the plan stamp — in one transaction. The quota is merged into balance
   * further down, as migration 034 did in production.
   */
  async function settleLegacyPro(o: { id: string; provider: string }, userId: string, txn: string, performTime: number) {
    await db.transaction(async (c) => {
      const paid = await c.query(
        `UPDATE payment_orders
            SET state = 'paid', perform_time = $2, create_time = CASE WHEN create_time = 0 THEN $2 ELSE create_time END, updated_at = now()
          WHERE id = $1 AND state = 'pending'`,
        [o.id, performTime],
      );
      if (paid.rowCount !== 1) throw new Error(`legacy Pro settle: order ${o.id} is not pending`);
      await c.query(`INSERT INTO transactions (user_id, kind, quota_delta, reference, note) VALUES ($1, 'subscription', $2, $3, 'Pro obuna')`, [
        userId,
        LEGACY_PRO.quota,
        `${o.provider}:${txn}`,
      ]);
      await c.query(
        `UPDATE users SET quota = quota + $2, plan = 'pro', plan_expires_at = $3::timestamptz + $4::int * interval '1 day', updated_at = now() WHERE id = $1`,
        [userId, LEGACY_PRO.quota, at(performTime), LEGACY_PRO.days],
      );
    });
  }

  type OrderPlan = { purpose: "topup" | "pro"; amount: number; outcome: "paid" | "pending" | "created" | "cancelled" };
  async function order(u: SeedUser, idx: number, p: OrderPlan, t: number) {
    const provider = (idx + txnSeq) % 2 === 0 ? "click" : "payme";
    const o =
      p.purpose === "pro"
        ? await legacyProOrder(u, provider)
        : await payments.createOrder({ userId: u.id, provider, purpose: p.purpose, amountSoum: p.amount });
    // BACKDATE: createOrder stamps now() on created_at/updated_at.
    await sql(`UPDATE payment_orders SET created_at = $2, updated_at = $2 WHERE id = $1`, [o.id, at(t)]);
    if (p.outcome === "created") return;
    const txn = provider === "click" ? clickTxn() : paymeTxn();
    await payments.attachTransaction(o.id, txn, t + 30_000);
    if (p.outcome === "paid" && p.purpose === "pro") {
      await settleLegacyPro(o, u.id, txn, t + 90_000);
    } else if (p.outcome === "paid") {
      const out = await payments.settleOrder(o.id, t + 90_000);
      if (out.status !== "paid") throw new Error(`settleOrder: ${out.status}`);
    }
    if (p.outcome === "paid") {
      // BACKDATE: the credit ledger row and updated_at are stamped now(); perform_time is the argument above.
      await sql(`UPDATE transactions SET created_at = $2 WHERE reference = $1`, [`${provider}:${txn}`, at(t + 90_000)]);
      await sql(`UPDATE payment_orders SET updated_at = $2 WHERE id = $1`, [o.id, at(t + 90_000)]);
      fundedAt.set(u.id, Math.min(fundedAt.get(u.id) ?? Infinity, t + 90_000));
    } else if (p.outcome === "cancelled") {
      await payments.cancelOrder(o.id, t + 600_000, provider === "payme" ? 3 : -9);
      // BACKDATE: cancelOrder stamps updated_at = now().
      await sql(`UPDATE payment_orders SET updated_at = $2 WHERE id = $1`, [o.id, at(t + 600_000)]);
    } else {
      // BACKDATE: attachTransaction stamps updated_at = now().
      await sql(`UPDATE payment_orders SET updated_at = $2 WHERE id = $1`, [o.id, at(t + 30_000)]);
    }
    await trail(o, txn, p.outcome, t);
  }

  const amounts = [10_000, 20_000, 30_000, 50_000, 75_000, 100_000, 150_000];
  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    if (i % 5 === 4 && !teachers.includes(i) && !proUsers.has(i)) continue; // free users: signup bonus only
    const span = Math.max(DAY_MS, now - u.createdAt);
    const first = u.createdAt + Math.round(span * 0.05 + rnd() * span * 0.2);
    const plans: OrderPlan[] = [];
    if (proUsers.has(i)) plans.push({ purpose: "pro", amount: LEGACY_PRO.priceSoum, outcome: "paid" });
    plans.push({ purpose: "topup", amount: teachers.includes(i) ? 150_000 : amounts[Math.floor(rnd() * amounts.length)]!, outcome: "paid" });
    const extra = i % 3;
    const outcomes: OrderPlan["outcome"][] = ["paid", "pending", "created", "cancelled", "paid", "cancelled"];
    for (let k = 0; k < extra; k++) {
      const pro = rnd() < 0.15;
      const amount = amounts[Math.floor(rnd() * 4)]!;
      plans.push({ purpose: pro ? "pro" : "topup", amount: pro ? LEGACY_PRO.priceSoum : amount, outcome: outcomes[(i + k) % outcomes.length]! });
    }
    for (let k = 0; k < plans.length; k++) {
      const t = k === 0 ? first : first + Math.round(rnd() * Math.max(1, now - first - 3_600_000));
      await order(u, i, plans[k]!, t);
    }
  }

  /* ── admin wallet corrections: the panel's ledger core, without an admin (no audit row) ── */
  const adjust = async (u: SeedUser, delta: number, t: number) => {
    const res = await db.transaction((c) =>
      credits.adminAdjustWalletInTx(c, { userId: u.id, wallet: "balance", delta, reference: `seed:${randomUUID()}`, note: ADMIN_LEDGER_NOTE }),
    );
    if (!res.ok) throw new Error("adminAdjustWalletInTx: insufficient");
    // BACKDATE: the ledger row is stamped now().
    await sql(`UPDATE transactions SET created_at = $2 WHERE id = $1`, [res.transactionId, at(t)]);
  };
  await adjust(users[1]!, 5_000, now - 20 * DAY_MS);
  await adjust(users[6]!, 10_000, now - 9 * DAY_MS);
  await adjust(users[13]!, 3_000, now - 2 * DAY_MS);
  await adjust(users[1]!, -2_000, now - 19 * DAY_MS);

  /* ── generations through the queue ── */
  const leaseOf = () => jobs.newLease(WORKER_ID);

  async function enqueue(u: SeedUser, tool: ToolId, topic: string): Promise<string | null> {
    const t = TOOL_BY_ID[tool];
    const values = valuesFor(tool, topic, u.name, u.university);
    const price = await effectivePrice(t, values);
    const res = await jobs.enqueueGeneration({
      userId: u.id,
      toolId: tool,
      topic,
      price,
      format: t.output,
      values,
      budgetMs: budgetFor(t, values, env.worker.jobTimeoutMs),
    });
    if (!res.ok) return null; // wallet too small: the product refuses the same way
    return res.id;
  }

  async function claim(id: string): Promise<string> {
    const lease = leaseOf();
    const c = await jobs.claimJob(lease, { userMaxRunning: 1_000_000 });
    if (c?.id !== id) {
      if (c) await jobs.releaseJobs([lease]);
      throw new Error(`claimJob returned ${c?.id ?? "nothing"} instead of the seeded job ${id}; is a worker running?`);
    }
    return lease;
  }

  /** BACKDATE: the queue stamps now() on every lifecycle step; moves one job and its ledger/usage rows to `t0`. */
  async function backdate(id: string, t0: number, runSec: number | null) {
    const started = t0 + 2_000 + Math.round(rnd() * 20_000);
    const finished = runSec === null ? null : started + runSec * 1000;
    await sql(
      `UPDATE generations SET created_at = $2, run_after = $2,
              started_at = CASE WHEN started_at IS NULL THEN NULL ELSE $3::timestamptz END,
              finished_at = CASE WHEN finished_at IS NULL THEN NULL ELSE $4::timestamptz END
        WHERE id = $1`,
      [id, at(t0), at(started), finished === null ? null : at(finished)],
    );
    await sql(`UPDATE transactions SET created_at = $2 WHERE reference = $1 AND kind = 'charge'`, [id, at(t0)]);
    if (finished !== null) {
      await sql(`UPDATE transactions SET created_at = $2 WHERE reference = $1 AND kind = 'refund'`, [id, at(finished + 1_000)]);
      await sql(`UPDATE ai_usage SET at = $2 WHERE generation_id = $1`, [id, at(finished)]);
      await sql(`UPDATE generation_files SET created_at = $2 WHERE generation_id = $1`, [id, at(finished)]);
    }
  }

  async function complete(
    u: SeedUser,
    tool: ToolId,
    topic: string,
    t0: number,
    opts: { doc?: AcademicDoc | null; delivered?: Delivered; usage?: boolean; cost?: boolean } = {},
  ): Promise<string | null> {
    const id = await enqueue(u, tool, topic);
    if (!id) return null;
    const lease = await claim(id);
    const cost = costFor(tool, rnd);
    if (opts.cost !== false) await jobs.setCost(id, lease, cost);
    const file = await fileFor(tool, topic);
    const ok = await jobs.commitJobResult(id, lease, file, [], {
      html: `<h1>${topic.replace(/[<&>]/g, "")}</h1><p>Kirish</p>`,
      doc: opts.doc ?? null,
      fileName: file.fileName,
      preview: null,
      ...(opts.delivered ? { delivered: opts.delivered } : {}),
    });
    if (!ok) throw new Error(`commitJobResult refused ${id}`);
    if (opts.usage !== false && opts.cost !== false) {
      await recordAiUsage({ source: "job", outcome: "completed", generationId: id, userId: u.id, toolId: tool, cost });
    }
    if (opts.delivered) {
      const ratio = refundRatio(opts.delivered);
      if (ratio !== null) {
        const { got, want, unit } = opts.delivered;
        await credits.refundPartial(u.id, id, ratio, `${want} tadan ${got} ta${unit ? ` ${unit}` : "si"} yaratildi — farq qaytarildi`);
      }
    }
    await flushAiUsage();
    await backdate(id, t0, 40 + Math.round(rnd() * 260));
    return id;
  }

  async function fail(u: SeedUser, tool: ToolId, topic: string, t0: number, message: string, refund: boolean): Promise<string | null> {
    const id = await enqueue(u, tool, topic);
    if (!id) return null;
    const lease = await claim(id);
    if (!(await jobs.failJob(id, lease, message))) throw new Error(`failJob refused ${id}`);
    const cost = new JobCost();
    cost.addLlm({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 18_000, outputTokens: 2_500 });
    await recordAiUsage({ source: "job", outcome: "failed", generationId: id, userId: u.id, toolId: tool, cost: cost.toJson() });
    // Same note as the worker's refundThenCleanup; left out on purpose for the reconciliation screen.
    if (refund) await db.transaction((c) => refundInTx(c, u.id, id, `Xatolik: ${message}`.slice(0, 200)));
    await flushAiUsage();
    await backdate(id, t0, 30 + Math.round(rnd() * 120));
    return id;
  }

  const topic = () => TOPICS[Math.floor(rnd() * TOPICS.length)]!;
  const between = (from: number, to: number) => from + Math.round(rnd() * Math.max(1, to - from));
  const FAILURES = [
    "LLM provayderi javob bermadi (503)",
    "Ish vaqti tugadi",
    "Hujjatni yig'ishda xatolik: rasm yuklanmadi",
    "Manbalar topilmadi — qidiruv bo'sh qaytdi",
  ];

  // Bulk history: mostly completed, some failed (refunded like the worker does).
  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    if (teachers.includes(i)) continue;
    const from = Math.max(fundedAt.get(u.id) ?? u.createdAt, u.createdAt) + 60_000;
    const n = fundedAt.has(u.id) ? 2 + Math.floor(rnd() * 5) : 1;
    for (let k = 0; k < n; k++) {
      const tool = BULK_TOOLS[Math.floor(rnd() * BULK_TOOLS.length)]!;
      const t0 = between(from, now - 3 * 3_600_000);
      const ageDays = (now - t0) / DAY_MS;
      if (rnd() < 0.08) await fail(u, tool, topic(), t0, FAILURES[Math.floor(rnd() * FAILURES.length)]!, true);
      // ai_usage exists only for the last ~40 days (older jobs keep their legacy cost_json); ~8 % have no cost data.
      else await complete(u, tool, topic(), t0, { usage: ageDays < 40, cost: rnd() > 0.08 });
    }
  }

  // Shortfalls: two refunded in part (refundPartial), one with refundShare 0 (logged only, no refund).
  const BLOCKED = [5, 17, 30];
  const candidates = users.filter((_, i) => !BLOCKED.includes(i) && !teachers.includes(i)).map((u) => u.id);
  const byId = new Map(users.map((u) => [u.id, u]));
  /** One of the five richest candidates right now, so the special jobs below never lack funds. */
  async function pick(k: number): Promise<SeedUser> {
    const row = await one<{ id: string }>(
      `SELECT id::text AS id FROM users WHERE id = ANY($1::bigint[]) ORDER BY points + quota + balance DESC, id LIMIT 1 OFFSET $2`,
      [candidates, k % 5],
    );
    return byId.get(row!.id)!;
  }
  await complete(await pick(0), "pro-slide", "Yashil energetika: quyosh va shamol", now - 4 * DAY_MS, {
    delivered: { got: 4, want: 6, unit: "rasm", refundShare: 0.25 },
  });
  await complete(await pick(1), "glossary", "Biologiya atamalari lug'ati", now - 11 * DAY_MS, { delivered: { got: 16, want: 20 } });
  await complete(await pick(2), "slide", "Ekologik muammolar", now - 6 * DAY_MS, {
    delivered: { got: 2, want: 3, unit: "rasm", refundShare: 0 },
  });

  // Failed: refunded and two left unrefunded (a reconciliation finding).
  for (let k = 0; k < 3; k++) await fail(await pick(3 + k), "coursework", topic(), now - (2 + k * 5) * DAY_MS, FAILURES[k]!, true);
  const lostUser = await pick(6);
  const lostJob = await fail(lostUser, "article", "Raqamli marketing samaradorligi", now - 3 * DAY_MS, "Ish vaqti tugadi", false);
  const lateUser = await pick(7);
  const lateJob = await fail(lateUser, "referat", "Xalqaro savdo shartnomalari", now - 26 * 3_600_000, FAILURES[0]!, false);
  // An abandoned meter flush (the worker lost its lease after spending) on the last failed job.
  if (lateJob) {
    const c = new JobCost();
    c.addLlm({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 9_000, outputTokens: 1_200 });
    await recordAiUsage({ source: "job", outcome: "abandoned", generationId: lateJob, userId: lateUser.id, toolId: "referat", cost: c.toJson() });
    await flushAiUsage();
    // BACKDATE: recordAiUsage stamps now().
    await sql(`UPDATE ai_usage SET at = now() - interval '26 hours' WHERE generation_id = $1 AND outcome = 'abandoned'`, [lateJob]);
  }

  // Revoked by the user while queued (cancelGeneration refunds in the same transaction).
  for (let k = 0; k < 3; k++) {
    const u = await pick(8 + k);
    const id = await enqueue(u, k === 0 ? "slide" : "referat", topic());
    if (!id) continue;
    if (!(await jobs.cancelGeneration(id, u.id))) throw new Error(`cancelGeneration refused ${id}`);
    const t0 = now - (1 + k * 7) * DAY_MS;
    // BACKDATE: cancel stamps finished_at = now(); started_at stays NULL for a job that never ran.
    await sql(`UPDATE generations SET created_at = $2, run_after = $2, finished_at = $3 WHERE id = $1`, [id, at(t0), at(t0 + 45_000)]);
    await sql(`UPDATE transactions SET created_at = $2 WHERE reference = $1 AND kind = 'charge'`, [id, at(t0)]);
    await sql(`UPDATE transactions SET created_at = $2 WHERE reference = $1 AND kind = 'refund'`, [id, at(t0 + 45_000)]);
  }

  // Running now: one healthy, one stuck past its budget. attempts = 2 makes a real worker's
  // reclaimStaleJobs fail them (and refund-reconcile refund them) instead of requeueing them.
  for (const [k, stuck] of [[11, false], [12, true]] as const) {
    const u = await pick(k);
    const id = await enqueue(u, stuck ? "coursework" : "slide", topic());
    if (!id) continue;
    await claim(id);
    // PLAIN SQL: no further retry for a seeded job; BACKDATE the stuck job's lease.
    await sql(
      `UPDATE generations SET attempts = 2, progress = $2, step = $3,
              created_at = now() - $4::int * interval '1 minute', started_at = now() - $4::int * interval '1 minute',
              locked_at = now() - $5::int * interval '1 minute', run_after = now() - $4::int * interval '1 minute'
        WHERE id = $1`,
      [id, stuck ? 35 : 60, stuck ? "Bo'limlar yozilmoqda" : "Slaydlar tayyorlanmoqda", stuck ? 45 : 2, stuck ? 40 : 0],
    );
    await sql(`UPDATE transactions SET created_at = (SELECT created_at FROM generations WHERE id = $1::uuid) WHERE reference = $1::text AND kind = 'charge'`, [id]);
  }

  // Waiting in the queue: parked PARK_DAYS ahead so no worker claims them (the admin queue shows them as waiting).
  for (let k = 0; k < 4; k++) {
    const u = await pick(13 + k);
    const id = await enqueue(u, BULK_TOOLS[k * 3]!, topic());
    if (!id) continue;
    // PLAIN SQL (park) + BACKDATE (created minutes ago).
    await sql(
      `UPDATE generations SET run_after = now() + $2::int * interval '1 day', created_at = now() - $3::int * interval '1 minute' WHERE id = $1`,
      [id, PARK_DAYS, 1 + k * 3],
    );
    await sql(`UPDATE transactions SET created_at = (SELECT created_at FROM generations WHERE id = $1::uuid) WHERE reference = $1::text AND kind = 'charge'`, [id]);
  }

  /* ── game links: teachers' quizzes and games, completed through the queue, shared, played ── */
  const GAME_TOPICS = ["Fotosintez", "Amir Temur davri", "Kasrlar", "Ingliz tili: fe'llar", "Kimyoviy elementlar", "O'zbekiston geografiyasi"];
  let g = 0;
  for (const kind of GAME_KINDS) {
    for (let k = 0; k < 4; k++, g++) {
      const teacher = users[teachers[g % teachers.length]!]!;
      const tool: ToolId = kind === "quiz" ? "test" : kind;
      const t0 = between(Math.max(teacher.createdAt, fundedAt.get(teacher.id) ?? teacher.createdAt) + 60_000, now - 3_600_000);
      const doc = kind === "quiz" ? sampleTeacherDoc("test") : sampleGameDoc(kind);
      const gid = await complete(teacher, tool, `${GAME_TOPICS[g % GAME_TOPICS.length]} — ${kind === "quiz" ? "test" : "o'yin"}`, t0, { doc });
      if (!gid) continue;
      const s = await games.createGameSession(gid, teacher.id, kind, {});
      if (!s) throw new Error(`createGameSession refused ${gid}`);
      const shared = t0 + 600_000;
      // BACKDATE: created_at = now(); the last two links of each kind are past their 30-day expiry.
      await sql(`UPDATE game_sessions SET created_at = $2, expires_at = $3 WHERE id = $1`, [
        s.id,
        at(shared),
        at(k >= 2 && kind !== "quiz" ? now - (k - 1) * DAY_MS : shared + games.SESSION_TTL_DAYS * DAY_MS),
      ]);
      const players = k === 0 ? 0 : 2 + Math.floor(rnd() * 10);
      for (let p = 0; p < players; p++) {
        const total = 10;
        const r = await games.addResult({
          sessionId: s.id,
          submissionId: randomUUID(),
          playerName: `${PLAYER_NAMES[(g + p) % PLAYER_NAMES.length]} ${p + 1}`,
          score: Math.floor(rnd() * (total + 1)),
          total,
          seconds: 60 + Math.floor(rnd() * 400),
          answers: { q1: rnd() > 0.3, q2: rnd() > 0.5, q3: rnd() > 0.4 },
          ipHash: games.ipHash(`10.30.${g}.${p + 1}`),
        });
        // BACKDATE: results arrive after the link was shared.
        await sql(`UPDATE game_results SET created_at = $2 WHERE id = $1`, [r.id, at(Math.min(now - 60_000, shared + (p + 1) * 3_600_000))]);
      }
    }
  }

  /*
   * ── legacy quota → balance: PLAIN SQL, migration 034's merge for the seeded users ──
   * 034 ran when this database was migrated, before these users existed, so the
   * seed repeats its statement here, after every job has charged and refunded
   * (charges drained some quota first, as they did in production): one
   * `quota_merge` row per holder (quota −q, balance +q), so each wallet column
   * still equals its ledger sum. Without 034's audit row: the script never
   * writes audit rows (append-only, `--reset` could not remove them).
   */
  {
    // A Pro bought in the last days before the removal and not spent yet: at least one holder is merged
    // whatever the jobs above drained (they charge quota before balance).
    await order(users[22]!, 22, { purpose: "pro", amount: LEGACY_PRO.priceSoum, outcome: "paid" }, now - 2 * DAY_MS);
    const merged = await sql<{ id: string }>(
      `WITH src AS (
         SELECT id, quota AS q FROM users WHERE id = ANY($1::bigint[]) AND quota > 0 ORDER BY id FOR UPDATE
       ),
       moved AS (
         UPDATE users u SET quota = u.quota - s.q, balance = u.balance + s.q, updated_at = now()
           FROM src s WHERE u.id = s.id
         RETURNING u.id, s.q
       )
       INSERT INTO transactions (user_id, kind, quota_delta, balance_delta, reference, note)
       SELECT id, 'quota_merge', -q, q, 'quota-merge:' || id::text, 'Kvota balansga o''tkazildi: ' || q::text || ' tanga'
         FROM moved
       RETURNING user_id::text AS id`,
      [users.map((u) => u.id)],
    );
    if (!merged.length) throw new Error("no seeded user holds legacy quota to merge (the Pro orders above should have credited some)");
  }

  /* ── blocked users: PLAIN SQL (the block route needs an admin), then the real session revoke ── */
  for (const i of BLOCKED) {
    await sql(`UPDATE users SET is_blocked = true, updated_at = now() WHERE id = $1`, [users[i]!.id]);
    await session.revokeAllSessions(users[i]!.id);
  }

  /* ── free AI endpoints ── */
  const FREE = ["free:outline", "free:udk", "free:polish", "free:rewrite"];
  for (let k = 0; k < 48; k++) {
    const u = users[Math.floor(rnd() * users.length)]!;
    const c = new JobCost();
    c.addLlm({ provider: "gemini", model: "gemini-3.5-flash-lite", inputTokens: 2_000 + Math.floor(rnd() * 6_000), outputTokens: 300 + Math.floor(rnd() * 900) });
    await recordAiUsage({ source: "free", outcome: "free", userId: u.id, toolId: FREE[k % FREE.length]!, cost: c.toJson() });
    await flushAiUsage();
    // BACKDATE: recordAiUsage stamps now().
    await sql(`UPDATE ai_usage SET at = $2 WHERE id = (SELECT max(id) FROM ai_usage WHERE user_id = $1 AND source = 'free')`, [
      u.id,
      at(between(Math.max(u.createdAt, now - 60 * DAY_MS), now - 60_000)),
    ]);
  }

  /* ── errors through the real sink (also warnings), with this script's process id ── */
  {
    const handle = createErrorSink({ processId: WORKER_ID, maxPerMinute: 100_000 });
    logm.setErrorSink(handle.sink, { warn: true });
    const anyJob = lostJob ? { id: lostJob, user_id: lostUser.id } : null;
    const ERRORS: Array<[level: "error" | "warn", msg: string, err: string | null, path: string | null, repeat: number]> = [
      ["error", "[pdf] LibreOffice konvertatsiyasi vaqt chegarasidan oshdi", "soffice: convert timeout after 90000ms", "/api/generations/[id]/pdf", 7],
      ["error", "[llm] gemini so'rovi yiqildi", "503 Service Unavailable", null, 12],
      ["warn", "[llm] anthropic sekin javob berdi", null, null, 4],
      ["error", "[worker] ish yiqildi", "Manbalar topilmadi — qidiruv bo'sh qaytdi", null, 3],
      ["error", "[payments] click complete: imzo mos kelmadi", null, "/api/payments/click/complete", 2],
      ["warn", "[payments] payme CheckPerformTransaction: buyurtma topilmadi", null, "/api/payments/payme", 5],
      ["error", "[storage] fayl yozilmadi", "ENOSPC: no space left on device", null, 1],
      ["error", "[telegram] sendMessage yiqildi", "403 Forbidden: bot was blocked by the user", null, 9],
      ["warn", "[images] pexels kvotasi tugadi", "429 Too Many Requests", null, 6],
      ["error", "[db] so'rov vaqti tugadi", "canceling statement due to statement timeout", "/api/generations", 2],
      ["warn", "[ratelimit] IP chegarasi oshdi", null, "/api/auth/telegram", 11],
      ["error", "[render] PPTX yig'ishda xatolik", "Cannot read properties of undefined (reading 'w')", null, 1],
      ["error", "[api] kutilmagan xato", "TypeError: fetch failed", "/api/free/outline", 3],
      ["warn", "[heartbeat] yozilmadi", "Connection terminated unexpectedly", null, 1],
      ["error", "[tts] ovoz yaratilmadi", "Azure TTS 401 Unauthorized", null, 2],
      ["warn", "[worker] job kam yetkazildi — narxda ulushi yo'q, pul qaytarilmadi", null, null, 2],
    ];
    let reqN = 0;
    for (const [level, msg, err, path, repeat] of ERRORS) {
      for (let r = 0; r < repeat; r++) {
        logm.log(level, msg, {
          reqId: `seed-req-${batch}-${++reqN}`,
          ...(path ? { path } : {}),
          ...(err ? { err: new Error(err) } : {}),
          ...(msg.startsWith("[worker]") && anyJob ? { jobId: anyJob.id, userId: anyJob.user_id } : {}),
        });
        // The sink starts in a microtask and caps writes in flight; wait for each one.
        await new Promise<void>((res) => setImmediate(res));
        await handle.flush();
      }
    }
    await handle.flush();
    logm.setErrorSink(null);
    // BACKDATE: the sink stamps now(); spread first/last seen over the period.
    await sql(
      `UPDATE error_log SET first_seen_at = now() - ((id % 50) + 3) * interval '1 day',
                            last_seen_at = now() - (id % 72) * interval '1 hour'
        WHERE process = $1`,
      [WORKER_ID],
    );
    // PLAIN SQL: three resolved without an admin (resolving through the panel writes an audit row).
    await sql(
      `UPDATE error_log SET resolved_at = LEAST(now(), last_seen_at + interval '2 hours')
        WHERE id IN (SELECT id FROM error_log WHERE process = $1 AND resolved_at IS NULL AND level = 'warn' ORDER BY id LIMIT 3)`,
      [WORKER_ID],
    );
  }

  /* ── heartbeats with real breaker/limiter snapshots of this process ── */
  {
    const startedAt = new Date(now - 5 * 3_600_000);
    const rename = async (from: string, to: string, host: string) => {
      // PLAIN SQL: writeHeartbeat keys rows by this host/pid; the tag lets --reset find them.
      await sql(`DELETE FROM process_heartbeats WHERE process_id = $1`, [to]);
      await sql(`UPDATE process_heartbeats SET process_id = $2, hostname = $3 WHERE process_id = $1`, [from, to, host]);
    };
    const { processIdFor } = await import("../lib/server/heartbeat.ts");
    // The web process first: it has no job slots and, before any provider call, no breakers.
    await writeHeartbeat({ role: "web", concurrency: 0, getRunning: () => 0 }, startedAt);
    await rename(processIdFor("web"), `web@${SEED_HOST}-a:${process.pid}`, `${SEED_HOST}-a`);
    const gem = breakerFor("gemini");
    gem.failure();
    gem.failure();
    breakerFor("anthropic").success();
    breakerFor("image:pexels").trip(30_000, "kvota");
    const held: Array<() => void> = [];
    for (let k = 0; k < 3; k++) {
      const release = await limiterFor("gemini").acquire(0);
      if (release) held.push(release);
    }
    const r1 = await limiterFor("anthropic").acquire(0);
    if (r1) held.push(r1);
    await writeHeartbeat({ role: "worker", concurrency: 4, getRunning: () => 2 }, startedAt);
    await rename(processIdFor("worker"), `worker@${SEED_HOST}-a:${process.pid}`, `${SEED_HOST}-a`);
    await writeHeartbeat({ role: "worker", concurrency: 4, getRunning: () => 1 }, new Date(now - 30 * 3_600_000));
    await rename(processIdFor("worker"), `worker@${SEED_HOST}-b:${process.pid}`, `${SEED_HOST}-b`);
    // BACKDATE: the second worker stopped beating 25 minutes ago (stale on the system page).
    await sql(`UPDATE process_heartbeats SET last_seen_at = now() - interval '25 minutes' WHERE process_id = $1`, [
      `worker@${SEED_HOST}-b:${process.pid}`,
    ]);
    for (const release of held) release();
  }

  /* ── housekeeping status through recordStep (the steps' work itself is not run) ── */
  {
    const STEPS: Array<[string, number]> = [
      ["reclaim", 0], ["queue-ttl", 1], ["refund-reconcile", 0], ["retention", 12], ["payment-events", 0], ["sessions", 4],
      ["game-sessions", 2], ["rate-limits", 37], ["tickets", 3], ["sources", 0], ["photos", 0], ["source-cache", 5],
      ["error-log", 0], ["heartbeats", 1], ["admin-sessions", 0], ["broadcast-recipients", 0], ["broadcasts", 0],
    ];
    for (const [name, rows] of STEPS) await recordStep(name, WORKER_ID, async () => rows);
    await recordStep("source-cache", WORKER_ID, async () => {
      throw new Error("canceling statement due to lock timeout");
    }).catch(() => undefined);
    await flushStepStatus();
  }

  /* ── broadcasts: PLAIN SQL (creating and sending one needs an admin and writes audit rows) ── */
  {
    const reachable = users.filter((_, i) => !BLOCKED.includes(i));
    const tg = (u: SeedUser) => String(tgBase + users.indexOf(u));
    const DRAFTS = [
      "Yangi vosita: interaktiv o'yinlar endi havola orqali o'ynaladi. Sinab ko'ring!",
      "Hurmatli foydalanuvchilar, 5-oktabr kuni 02:00–03:00 da texnik ishlar o'tkaziladi.",
    ];
    for (const text of DRAFTS) {
      await sql(`INSERT INTO broadcasts (status, text, audience, created_at) VALUES ('draft', $1, $2::jsonb, now() - interval '3 hours')`, [
        BROADCAST_TAG + text,
        JSON.stringify({ kind: "all" }),
      ]);
    }
    const DONE: Array<[string, Record<string, unknown>, number]> = [
      ["Bizdan foydalanganingiz uchun rahmat! Balansni Click yoki Payme orqali bir necha soniyada to'ldirish mumkin.", { kind: "paid" }, 21],
      ["Kurs ishlari uchun yangi shablonlar qo'shildi.", { kind: "all" }, 9],
      ["Imtihonlar oldidan: referat va mustaqil ishlarni oldindan buyurtma qiling.", { kind: "active_days", days: 30 }, 2],
    ];
    for (const [text, audience, daysAgo] of DONE) {
      const queued = now - daysAgo * DAY_MS;
      const recipients = reachable.filter(() => rnd() < 0.7);
      const failed = recipients.filter(() => rnd() < 0.08);
      const row = await one<{ id: string }>(
        `INSERT INTO broadcasts (status, text, audience, total, sent, failed, created_at, queued_at, finished_at)
         VALUES ('done', $1, $2::jsonb, $3, $4, $5, $6, $6, $7) RETURNING id::text AS id`,
        [BROADCAST_TAG + text, JSON.stringify(audience), recipients.length, recipients.length - failed.length, failed.length, at(queued), at(queued + 300_000)],
      );
      for (const u of recipients) {
        const bad = failed.includes(u);
        await sql(
          `INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_id, status, error, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [row!.id, u.id, tg(u), bad ? "failed" : "sent", bad ? "Telegram xabarni qabul qilmadi (bot bloklangan yoki chat topilmadi)" : null, bad ? null : at(queued + 60_000)],
        );
      }
    }
  }
}

/* ───────────────────────────── main ───────────────────────────── */

async function main(): Promise<number> {
  muteLibraryLogs();
  await db.ensureMigrated();
  if (args.reset) {
    const deleted = await reset();
    restoreConsole();
    if (args.json) say(JSON.stringify({ reset: deleted }));
    else printSummary("admin:seed-dev — removed seed rows:", deleted);
    return 0;
  }
  const live = await liveRefusal();
  if (live) {
    process.stderr.write(`admin:seed-dev refused: ${live}.\n`);
    return 1;
  }
  const last = await one<{ n: string }>(
    `SELECT COALESCE(max((substring(username from '^seed_b([0-9]+)_'))::int), 0)::text AS n FROM (${SEED_USERS_SQL}) s JOIN users u USING (id)`,
  );
  const batch = Number(last?.n ?? 0) + 1;
  if (batch * BATCH_TG_STRIDE >= SEED_TG_SPAN) throw new Error("too many seed batches; run with --reset");
  try {
    await seed(prng(0x5eed + batch), batch);
  } finally {
    restoreConsole();
  }
  const s = await summary();
  if (args.json) {
    say(JSON.stringify({ batch, counts: s }));
  } else {
    printSummary(`admin:seed-dev — batch ${batch} added. Seed rows now in the database:`, s);
    say();
    say("Nothing runs these jobs: QUEUED seed jobs are parked; start the dev server with WORKER_INLINE=false anyway.");
    say("Remove every seed row with: npm run admin:seed-dev -- --reset");
  }
  if (args.ownerTelegramId) {
    say();
    say("To open the panel as owner (the script never creates admin accounts):");
    say(`  1. Log in to the site once with the Telegram account ${args.ownerTelegramId}.`);
    say(`  2. npm run admin:create -- --telegram-id ${args.ownerTelegramId} --role owner`);
    say("  3. Open the printed /admin/enroll link while logged in and scan the QR code.");
  }
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  restoreConsole();
  console.error("admin:seed-dev failed:", e instanceof Error ? (args.verbose ? e.stack : e.message) : String(e));
  code = 1;
} finally {
  await db
    .pool()
    .end()
    .catch(() => {});
}
process.exit(code);
