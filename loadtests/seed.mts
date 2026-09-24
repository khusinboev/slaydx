/**
 * Load-test seeder — users, sessions, balances and COMPLETED generations.
 *
 * Uses ONLY the application's own helpers (no raw balance UPDATEs), imported at
 * run time from the checkout under test (cwd = REPO_DIR), so the same script works
 * on `main@76ddf91` and on the audit branch. Helpers used (present on both):
 *   auth.upsertLocalUser   — user row + 3 000-point signup bonus (ledger row)
 *   session.createSession  — real session row; the raw token is the cookie value
 *   credits.topUp          — balance top-up, idempotent on its reference
 *   jobs.enqueueGeneration — charge + QUEUED row in one transaction
 *   jobs.claimJob / completeJob, storage.putGenerationFile, assets.putAssets
 *
 * Run it through `loadtests/seed.sh` (stack env + heavy2 gate). Workers must NOT be
 * running while generations are seeded, otherwise they would claim (and fail) the
 * seed jobs — `stack.sh up` with WORKERS_DEFER=1, seed, then `stack.sh workers`.
 *
 * Flags: --users 2000 --gen-users 400 --gens 3 --heavy-users 10 --heavy-gens 40
 *        --balance 200000 --file-kb 40 --asset-kb 60 --concurrency 8 --out tokens.json
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Args = Record<string, string>;
const args: Args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const num = (k: string, d: number) => (args[k] === undefined ? d : Number(args[k]));

const USERS = num("users", 2000);
const GEN_USERS = Math.min(num("gen-users", 400), USERS);
const GENS = num("gens", 3);
const HEAVY_USERS = Math.min(num("heavy-users", 10), GEN_USERS);
const HEAVY_GENS = num("heavy-gens", 40);
const BALANCE = num("balance", 200_000);
const FILE_KB = num("file-kb", 40);
const ASSET_KB = num("asset-kb", 60);
const CONCURRENCY = num("concurrency", 8);
const OUT = args.out ?? "tokens.json";
const PREFIX = args.prefix ?? "lt";

const REPO = process.cwd();
const req = createRequire(join(REPO, "package.json"));
const load = (p: string) => import(pathToFileURL(join(REPO, p)).href);

type SessionUser = { id: string };
type EnqueueRes = { ok: boolean; id?: string; reason?: string };
type Claimed = { id: string; values?: { topic?: unknown } } | null;

const auth = (await load("lib/server/auth.ts")) as { upsertLocalUser(id: string): Promise<SessionUser> };
const session = (await load("lib/server/session.ts")) as {
  createSession(userId: string, meta?: { userAgent?: string | null; ip?: string | null }): Promise<{ token: string }>;
};
const credits = (await load("lib/server/credits.ts")) as {
  topUp(userId: string, delta: { balance?: number }, reference: string, kind?: string, note?: string): Promise<boolean>;
};
const jobs = (await load("lib/server/jobs.ts")) as {
  enqueueGeneration(input: Record<string, unknown>): Promise<EnqueueRes>;
  claimJob(lease: string): Promise<Claimed>;
  completeJob(id: string, lease: string, result: Record<string, unknown>): Promise<boolean>;
};
const storage = (await load("lib/server/storage.ts")) as {
  putGenerationFile(id: string, file: { bytes: Uint8Array; mime: string; fileName: string }): Promise<unknown>;
};
const assets = (await load("lib/server/assets.ts")) as {
  putAssets(id: string, list: { assetId: string; mime: string; bytes: Buffer }[]): Promise<void>;
};
const db = (await load("lib/server/db.ts")) as {
  ensureMigrated(): Promise<void>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  pool(): { end(): Promise<void> };
};
// Same constant on both commits (lib/server/thumb.ts); literal so thumb.ts's LibreOffice deps are not loaded.
const THUMB_ASSET_ID = "ab00000000000000000000e1";

type Sharp = (input?: unknown, opts?: unknown) => {
  jpeg(o?: unknown): { toBuffer(): Promise<Buffer> };
  png(o?: unknown): { toBuffer(): Promise<Buffer> };
};
type ZipCtor = new () => {
  file(name: string, data: string | Buffer, opts?: unknown): void;
  generateAsync(o: unknown): Promise<Buffer>;
};
const sharp = req("sharp") as Sharp;
const JSZip = req("jszip") as ZipCtor;

async function noiseImage(w: number, h: number, kind: "jpeg" | "png"): Promise<Buffer> {
  const raw = randomBytes(w * h * 3);
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return kind === "jpeg" ? img.jpeg({ quality: 72 }).toBuffer() : img.png({ compressionLevel: 9 }).toBuffer();
}

/** Minimal valid DOCX padded with an uncompressed random blob to ~FILE_KB. */
async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SlaydX load-test document</w:t></w:r></w:p></w:body></w:document>',
  );
  zip.file("word/media/pad.bin", randomBytes(Math.max(0, FILE_KB * 1024 - 1500)), { compression: "STORE" });
  return zip.generateAsync({ type: "nodebuffer" });
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

const t0 = Date.now();
await db.ensureMigrated();
const busy = await db.queryOne<{ n: string }>(
  "SELECT count(*)::text AS n FROM generations WHERE status IN ('QUEUED','IN_PROGRESS')",
);
if (Number(busy?.n ?? 0) > 0 && GEN_USERS > 0) {
  console.error(`[seed] ${busy?.n} QUEUED/IN_PROGRESS rows exist — seed generations only on an idle queue with workers stopped`);
  process.exit(2);
}

// Shared payloads (every generation row still stores its own copy, like production).
const docx = await makeDocx();
// ~20 KB like a real 36-dpi first-page thumbnail (random noise barely compresses).
const thumb = await noiseImage(110, 150, "jpeg");
const side = Math.max(64, Math.round(Math.sqrt((ASSET_KB * 1024) / 3)));
const png = await noiseImage(side, side, "png");
const pngId = createHash("sha256").update(png).digest("hex").slice(0, 24);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Out = { u: string; t: string; g: string[] };
const users: Out[] = new Array(USERS);
let stolen = 0;

await pool(
  Array.from({ length: USERS }, (_, i) => i),
  CONCURRENCY,
  async (i) => {
    const ident = `${PREFIX}-u${String(i).padStart(6, "0")}`;
    const user = await auth.upsertLocalUser(ident);
    const { token } = await session.createSession(user.id, { userAgent: "slaydx-loadtest/k6", ip: "127.0.0.1" });
    await credits.topUp(user.id, { balance: BALANCE }, `loadtest-seed:${user.id}`, "topup", "loadtest seed");
    users[i] = { u: String(user.id), t: token, g: [] };
    if ((i + 1) % 500 === 0) console.log(`[seed] users ${i + 1}/${USERS}`);
  },
);

const genPlan: number[] = [];
for (let i = 0; i < GEN_USERS; i++) genPlan.push(i);

await pool(genPlan, CONCURRENCY, async (i) => {
  const count = i < HEAVY_USERS ? HEAVY_GENS : GENS;
  for (let k = 0; k < count; k++) {
    const topic = `Loadtest insho ${i}-${k}`;
    const enq = await jobs.enqueueGeneration({
      userId: users[i].u,
      toolId: "essay",
      topic,
      price: 2000,
      format: "docx",
      values: { topic, essayContext: "school" },
      budgetMs: 90_000,
    });
    if (!enq.ok || !enq.id) throw new Error(`enqueue failed for user ${users[i].u}: ${enq.reason}`);
    users[i].g.push(enq.id);
    // Claim + complete with the app's own fenced functions. The claim takes the oldest
    // QUEUED row — normally ours; if another seeder coroutine got ours first we
    // complete theirs (all rows are seed rows), totals stay equal.
    const lease = `loadtest-seed:${randomUUID()}`;
    let claimed: Claimed = null;
    for (let tries = 0; tries < 50 && !claimed; tries++) {
      claimed = await jobs.claimJob(lease);
      if (!claimed) await new Promise((r) => setTimeout(r, 20));
    }
    if (!claimed) {
      stolen++;
      continue;
    }
    await storage.putGenerationFile(claimed.id, { bytes: docx, mime: DOCX_MIME, fileName: "loadtest.docx" });
    await assets.putAssets(claimed.id, [
      { assetId: THUMB_ASSET_ID, mime: "image/jpeg", bytes: thumb },
      { assetId: pngId, mime: "image/png", bytes: png },
    ]);
    const title = String(claimed.values?.topic ?? topic);
    const done = await jobs.completeJob(claimed.id, lease, {
      html: `<h1>${title}</h1><p>Load-test body.</p>`,
      doc: null,
      fileName: "loadtest.docx",
      preview: { lines: [title, "Load-test preview line"] },
    });
    if (!done) stolen++;
  }
});

const completed = await db.queryOne<{ n: string }>(
  "SELECT count(*)::text AS n FROM generations WHERE status = 'COMPLETED' AND topic LIKE 'Loadtest insho %'",
);
writeFileSync(
  OUT,
  JSON.stringify({
    createdAt: new Date().toISOString(),
    thumbAssetId: THUMB_ASSET_ID,
    assetId: pngId,
    fileBytes: docx.byteLength,
    thumbBytes: thumb.byteLength,
    assetBytes: png.byteLength,
    users,
  }),
);
console.log(
  `[seed] done in ${((Date.now() - t0) / 1000).toFixed(1)} s: users=${USERS} completed=${completed?.n} ` +
    `not-completed=${stolen} docx=${docx.byteLength}B thumb=${thumb.byteLength}B png=${png.byteLength}B -> ${OUT}`,
);
await db.pool().end();
if (stolen) process.exit(3);
