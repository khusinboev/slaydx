/**
 * Seed for the slide-navigation browser smoke (T1, todo sprint 2026-10-07).
 *
 * Creates a synthetic user (phone +998901234567) with a session and ONE finished
 * 9-slide deck, through the app's own helpers (`upsertLocalUser`, `createSession`,
 * `enqueueGeneration`, `claimJob`, `commitJobResult`) — no hand-written rows.
 * Prints one JSON line `{ userId, token, genId }` for the Playwright script.
 *
 * Test database ONLY (never .env.local, 55432 or 5432):
 *   DATABASE_URL=postgres://slaydx:slaydx@127.0.0.1:55440/slaydx_t1 \
 *   SESSION_SECRET=test-session-secret-at-least-32-characters \
 *   scripts/heavy.sh npx tsx --conditions=react-server tests/smoke/slide-nav-seed.mts
 */
import { upsertLocalUser } from "../../lib/server/auth.ts";
import { createSession } from "../../lib/server/session.ts";
import { claimJob, commitJobResult, enqueueGeneration, newLease } from "../../lib/server/jobs.ts";
import { pool } from "../../lib/server/db.ts";
import { sampleDeck } from "../../lib/generation/slide-samples.ts";
import { renderPptx } from "../../lib/generation/render-pptx.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { FormValues } from "../../lib/types.ts";

const url = process.env.DATABASE_URL ?? "";
if (!/127\.0\.0\.1:55440\/slaydx_t\d/.test(url)) {
  console.error("refusing to run: DATABASE_URL must be the 55440 slaydx_t<n> test database");
  process.exit(2);
}

const topic = "Fotosintez jarayoni va uning bosqichlari";
const user = await upsertLocalUser("+998901234567");
const { token } = await createSession(user.id, { userAgent: "slide-nav-smoke" });

const values = { topic, language: "uz", author: "Karimova Nilufar", slideCount: "9" } as unknown as FormValues;
const queued = await enqueueGeneration({
  userId: user.id,
  toolId: "slide",
  topic,
  price: 1000,
  format: "pptx",
  values,
  budgetMs: 120_000,
});
if (!queued.ok) throw new Error(`enqueue refused: ${queued.reason}`);

const lease = newLease("slide-nav-seed");
const job = await claimJob(lease);
if (!job || job.id !== queued.id) throw new Error("claimed a different job");

const doc = {
  meta: { topic, author: "Karimova Nilufar", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
  titlePage: false,
  toc: false,
  sections: [],
  slides: sampleDeck("lecture"),
} as unknown as AcademicDoc;
const built = await renderPptx(doc, "fotosintez.pptx");
const ok = await commitJobResult(
  job.id,
  lease,
  { bytes: built.bytes, mime: built.mime, fileName: built.fileName },
  [],
  { html: "", doc, fileName: built.fileName, preview: null },
);
if (!ok) throw new Error("commit failed");

console.log(JSON.stringify({ userId: user.id, token, genId: job.id }));
await pool().end();
