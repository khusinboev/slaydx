import "server-only";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { transaction } from "./db";
import { OPTION_COUNT, parseAnswerLetter } from "../tests/rules";

/**
 * Importer of a test bank (owner request 7; the first bank is the @BMB_testbot export, see
 * `scripts/export-bmb-tests.md`). Two stages so the same code serves the CLI and the tests:
 *
 *  1. `buildPlan(json, images)` -- PURE: validates the whole export and resolves every image (no database).
 *     Any error means nothing is imported.
 *  2. `importPlan(plan, { dryRun })` -- one transaction, IDEMPOTENT: subjects by (bank, code), assets by SHA-256,
 *     questions by `legacy_ref`. Running the same export again changes nothing. `dryRun` does the real work
 *     and rolls it back, so the counts are exact.
 *
 * Export format (JSON):
 *   { "bank": { "slug", "title", "source"? },
 *     "subjects": [ { "code", "name", "sort"?, "variants": [ { "variant": 1, "questions": [
 *        { "legacy_ref", "answer_letter": "a".."d" (any case), "image_path"? | "file_id"?, "text"?, "options"?, "explanation"? } ] } ] } ] }
 *
 * A question needs an image (image_path, else a file named after its file_id) and/or text. Text questions need
 * exactly 4 options; image-only questions have none (the A-D letters are the buttons) but still an A-D answer.
 */

export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"] as const;
const TEXT_MAX = 2000;

export type PlannedImage = { sha256: string; mime: "image/png" | "image/jpeg" | "image/webp"; bytes: Buffer };
export type PlannedQuestion = {
  subject: string;
  variant: number;
  legacyRef: string;
  text: string | null;
  options: string[] | null;
  answer: number;
  explanation: string | null;
  image: PlannedImage | null;
};
export type Plan = {
  bank: { slug: string; title: string; source: string };
  subjects: { code: string; name: string; sort: number }[];
  questions: PlannedQuestion[];
  /** Questions skipped because their image is already used by another question of the same subject. */
  duplicates: { legacyRef: string; sameAs: string }[];
};
export type BuiltPlan = { plan: Plan | null; errors: string[]; warnings: string[] };

/** Where the image bytes come from: a folder on disk, or (tests) an in-memory map. Paths are relative to the root. */
export type ImageSource = { read(relPath: string): Buffer | null };

/** Disk source: never leaves `root` (a `..` or absolute path is simply "not found"). */
export function dirImages(root: string): ImageSource {
  const base = existsSync(root) ? realpathSync(resolve(root)) : resolve(root);
  return {
    read(relPath) {
      if (!relPath || isAbsolute(relPath)) return null;
      const joined = resolve(base, normalize(relPath));
      if (!existsSync(joined)) return null;
      // Resolve symlinks BEFORE the containment check: a link inside the folder that points outside must not be followed.
      const full = realpathSync(joined);
      const rel = relative(base, full);
      if (rel.startsWith("..") || isAbsolute(rel) || !statSync(full).isFile()) return null;
      return readFileSync(full);
    },
  };
}

export function memoryImages(files: Record<string, Buffer>): ImageSource {
  return { read: (p) => files[p] ?? null };
}

export function sniffImage(buf: Buffer): PlannedImage["mime"] | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const CODE_RE = /^[a-z0-9_]{1,40}$/;

/** Validates the export and resolves the images. Never throws on bad data: every problem is reported. */
export function buildPlan(raw: unknown, images: ImageSource): BuiltPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (): BuiltPlan => ({ plan: null, errors, warnings });
  if (!isRecord(raw)) return { plan: null, errors: ["the export must be a JSON object"], warnings };

  const bankIn = isRecord(raw.bank) ? raw.bank : {};
  const slug = str(bankIn.slug);
  const title = str(bankIn.title);
  if (!slug || !/^[a-z0-9_-]{1,40}$/.test(slug)) errors.push("bank.slug is required (a-z, 0-9, _ or -)");
  if (!title) errors.push("bank.title is required");
  if (!Array.isArray(raw.subjects) || !raw.subjects.length) {
    errors.push("subjects must be a non-empty array");
    return fail();
  }

  const subjects: Plan["subjects"] = [];
  const questions: PlannedQuestion[] = [];
  const duplicates: Plan["duplicates"] = [];
  const refs = new Set<string>();
  const imageOwner = new Map<string, string>();
  const imageCache = new Map<string, PlannedImage | null>();

  const loadImage = (cands: string[], where: string): PlannedImage | null | undefined => {
    for (const c of cands) {
      if (imageCache.has(c)) {
        const hit = imageCache.get(c);
        if (hit) return hit;
        continue;
      }
      const buf = images.read(c);
      if (!buf) {
        imageCache.set(c, null);
        continue;
      }
      if (!buf.length || buf.length > IMAGE_MAX_BYTES) {
        errors.push(`${where}: image ${c} is empty or larger than ${IMAGE_MAX_BYTES} bytes`);
        return null;
      }
      const mime = sniffImage(buf);
      if (!mime) {
        errors.push(`${where}: ${c} is not a PNG / JPEG / WebP image`);
        return null;
      }
      const img: PlannedImage = { sha256: createHash("sha256").update(buf).digest("hex"), mime, bytes: buf };
      imageCache.set(c, img);
      return img;
    }
    return undefined;
  };

  raw.subjects.forEach((sRaw, si) => {
    const sw = `subjects[${si}]`;
    if (!isRecord(sRaw)) return void errors.push(`${sw}: must be an object`);
    const code = str(sRaw.code);
    const name = str(sRaw.name);
    if (!code || !CODE_RE.test(code)) errors.push(`${sw}: code is required (a-z, 0-9, _)`);
    if (!name) errors.push(`${sw}: name is required`);
    if (code && subjects.some((s) => s.code === code)) errors.push(`${sw}: duplicate subject code ${code}`);
    const sort = typeof sRaw.sort === "number" && Number.isInteger(sRaw.sort) ? sRaw.sort : si;
    if (code && name) subjects.push({ code, name, sort });
    if (!Array.isArray(sRaw.variants) || !sRaw.variants.length) return void errors.push(`${sw}: variants must be a non-empty array`);

    sRaw.variants.forEach((vRaw, vi) => {
      const vw = `${sw}.variants[${vi}]`;
      if (!isRecord(vRaw)) return void errors.push(`${vw}: must be an object`);
      const variant = vRaw.variant;
      if (typeof variant !== "number" || !Number.isInteger(variant) || variant < 1) errors.push(`${vw}: variant must be an integer >= 1`);
      if (!Array.isArray(vRaw.questions)) return void errors.push(`${vw}: questions must be an array`);

      vRaw.questions.forEach((qRaw, qi) => {
        const qw = `${vw}.questions[${qi}]`;
        if (!isRecord(qRaw)) return void errors.push(`${qw}: must be an object`);
        const ref = str(qRaw.legacy_ref);
        const where = `${qw}${ref ? ` (${ref})` : ""}`;
        if (!ref || ref.length > 120) return void errors.push(`${qw}: legacy_ref is required`);
        if (refs.has(ref)) return void errors.push(`${where}: duplicate legacy_ref`);
        refs.add(ref);

        const answer = parseAnswerLetter(qRaw.answer_letter);
        if (answer === null) errors.push(`${where}: answer_letter must be one of a, b, c, d (any case), got ${JSON.stringify(qRaw.answer_letter)}`);

        const text = str(qRaw.text);
        if (text && text.length > TEXT_MAX) errors.push(`${where}: text is longer than ${TEXT_MAX} characters`);
        let options: string[] | null = null;
        if (qRaw.options !== undefined && qRaw.options !== null) {
          const ok = Array.isArray(qRaw.options) && qRaw.options.length === OPTION_COUNT && qRaw.options.every((o) => typeof o === "string" && o.trim() && o.length <= 500);
          if (!ok) errors.push(`${where}: options must be exactly ${OPTION_COUNT} non-empty strings`);
          else options = (qRaw.options as string[]).map((o) => o.trim());
        }
        const explanation = str(qRaw.explanation);
        if (explanation && explanation.length > TEXT_MAX) errors.push(`${where}: explanation is longer than ${TEXT_MAX} characters`);

        const cands: string[] = [];
        const imagePath = str(qRaw.image_path);
        const fileId = str(qRaw.file_id);
        if (imagePath) cands.push(imagePath);
        if (fileId && /^[A-Za-z0-9_-]{8,200}$/.test(fileId)) for (const ext of IMAGE_EXT) cands.push(`${fileId}${ext}`);
        const image = cands.length ? loadImage(cands, where) : undefined;
        if (image === undefined && cands.length) errors.push(`${where}: image file not found (tried ${cands.slice(0, 2).join(", ")}${cands.length > 2 ? ", ..." : ""})`);
        if (!image && !text) {
          if (!cands.length) errors.push(`${where}: needs an image (image_path / file_id) or text`);
        }
        if (text && !options && !image) errors.push(`${where}: a text question needs ${OPTION_COUNT} options`);
        if (text && !options && image) warnings.push(`${where}: text without options is ignored in the options list (image question)`);

        if (answer === null || !code || !name || typeof variant !== "number") return;
        const img = image ?? null;
        if (!img && !text) return;
        if (img) {
          const key = `${code}:${img.sha256}`;
          const owner = imageOwner.get(key);
          if (owner) {
            duplicates.push({ legacyRef: ref, sameAs: owner });
            warnings.push(`${where}: duplicate of ${owner} (same image) -- skipped`);
            return;
          }
          imageOwner.set(key, ref);
        }
        questions.push({ subject: code, variant, legacyRef: ref, text, options, answer, explanation, image: img });
      });
    });
  });

  if (errors.length || !slug || !title) return fail();
  if (!questions.length) {
    errors.push("the export has no importable questions");
    return fail();
  }
  return { plan: { bank: { slug, title, source: str(bankIn.source) ?? "" }, subjects, questions, duplicates }, errors, warnings };
}

/** Reads `export.json` from disk and resolves images from `imagesDir`. */
export function loadExportFile(jsonPath: string, imagesDir: string): BuiltPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    return { plan: null, errors: [`cannot read ${jsonPath}: ${(e as Error).message}`], warnings: [] };
  }
  return buildPlan(raw, dirImages(imagesDir));
}

export type ImportSummary = {
  dryRun: boolean;
  bank: string;
  subjects: number;
  questions: { inserted: number; updated: number; unchanged: number; skippedDuplicates: number };
  assets: { inserted: number; reused: number; bytes: number };
  perSubject: Record<string, { questions: number; variants: number }>;
  /** `legacy_ref`s that already existed with a DIFFERENT answer key (a corrected key; finished attempts keep their snapshot). */
  changedAnswers: string[];
};

class DryRunRollback extends Error {
  constructor(readonly summary: ImportSummary) {
    super("dry run");
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Writes the plan in ONE transaction. Idempotent; `dryRun` rolls everything back after counting. */
export async function importPlan(plan: Plan, opts: { dryRun?: boolean } = {}): Promise<ImportSummary> {
  const summary: ImportSummary = {
    dryRun: Boolean(opts.dryRun),
    bank: plan.bank.slug,
    subjects: plan.subjects.length,
    questions: { inserted: 0, updated: 0, unchanged: 0, skippedDuplicates: plan.duplicates.length },
    assets: { inserted: 0, reused: 0, bytes: 0 },
    perSubject: {},
    changedAnswers: [],
  };
  try {
    await transaction(async (client) => {
      const bank = await client.query<{ id: string }>(
        `INSERT INTO test_banks (slug, title, source) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, source = EXCLUDED.source, updated_at = now()
         RETURNING id::text AS id`,
        [plan.bank.slug, plan.bank.title, plan.bank.source],
      );
      const bankId = bank.rows[0]!.id;
      const subjectId = new Map<string, string>();
      for (const s of plan.subjects) {
        const r = await client.query<{ id: string }>(
          `INSERT INTO test_subjects (bank_id, code, name, sort) VALUES ($1, $2, $3, $4)
           ON CONFLICT (bank_id, code) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort
           RETURNING id::text AS id`,
          [bankId, s.code, s.name, s.sort],
        );
        subjectId.set(s.code, r.rows[0]!.id);
      }

      for (const q of plan.questions) {
        let assetId: string | null = null;
        if (q.image) {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO test_assets (sha256, mime, size_bytes, bytes) VALUES ($1, $2, $3, $4)
             ON CONFLICT (sha256) DO NOTHING RETURNING id::text AS id`,
            [q.image.sha256, q.image.mime, q.image.bytes.length, q.image.bytes],
          );
          if (ins.rows[0]) {
            assetId = ins.rows[0].id;
            summary.assets.inserted++;
            summary.assets.bytes += q.image.bytes.length;
          } else {
            const ex = await client.query<{ id: string }>("SELECT id::text AS id FROM test_assets WHERE sha256 = $1", [q.image.sha256]);
            assetId = ex.rows[0]!.id;
            summary.assets.reused++;
          }
        }
        const sid = subjectId.get(q.subject)!;
        const ps = (summary.perSubject[q.subject] ??= { questions: 0, variants: 0 });
        ps.questions++;

        const cur = await client.query<{
          id: string;
          subject_id: string;
          variant: number;
          question_text: string | null;
          options: string[] | null;
          answer: number;
          explanation: string | null;
          image_asset_id: string | null;
        }>(
          `SELECT id::text AS id, subject_id::text AS subject_id, variant, question_text, options, answer, explanation, image_asset_id::text AS image_asset_id
             FROM test_questions WHERE legacy_ref = $1 FOR UPDATE`,
          [q.legacyRef],
        );
        const row = cur.rows[0];
        if (!row) {
          await client.query(
            `INSERT INTO test_questions (subject_id, variant, question_text, image_asset_id, options, answer, explanation, legacy_ref)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
            [sid, q.variant, q.text, assetId, q.options ? JSON.stringify(q.options) : null, q.answer, q.explanation, q.legacyRef],
          );
          summary.questions.inserted++;
        } else if (
          row.subject_id === sid &&
          row.variant === q.variant &&
          row.question_text === q.text &&
          row.answer === q.answer &&
          row.explanation === q.explanation &&
          row.image_asset_id === assetId &&
          same(row.options, q.options)
        ) {
          summary.questions.unchanged++;
        } else {
          // `active` is deliberately not touched: a question the admin switched off stays off after a re-import.
          if (row.answer !== q.answer) summary.changedAnswers.push(q.legacyRef);
          await client.query(
            `UPDATE test_questions SET subject_id = $2, variant = $3, question_text = $4, image_asset_id = $5, options = $6::jsonb,
                    answer = $7, explanation = $8, updated_at = now() WHERE id = $1`,
            [row.id, sid, q.variant, q.text, assetId, q.options ? JSON.stringify(q.options) : null, q.answer, q.explanation],
          );
          summary.questions.updated++;
        }
      }
      for (const code of Object.keys(summary.perSubject)) {
        summary.perSubject[code]!.variants = new Set(plan.questions.filter((q) => q.subject === code).map((q) => q.variant)).size;
      }
      if (opts.dryRun) throw new DryRunRollback(summary);
    });
  } catch (e) {
    if (e instanceof DryRunRollback) return e.summary;
    throw e;
  }
  return summary;
}

/** Human-readable summary for the CLI. */
export function formatSummary(s: ImportSummary, warnings: string[] = []): string {
  const lines = [
    `${s.dryRun ? "DRY RUN (nothing written)" : "IMPORTED"} -- bank "${s.bank}", ${s.subjects} subject(s)`,
    `  questions: ${s.questions.inserted} inserted, ${s.questions.updated} updated, ${s.questions.unchanged} unchanged, ${s.questions.skippedDuplicates} duplicate image(s) skipped`,
    `  images:    ${s.assets.inserted} stored (${s.assets.bytes} bytes), ${s.assets.reused} already present`,
    ...Object.entries(s.perSubject).map(([c, v]) => `  ${c}: ${v.questions} question(s) in ${v.variants} variant(s)`),
    ...(s.changedAnswers.length
      ? [`  ANSWER KEY CHANGED for ${s.changedAnswers.length} existing question(s) (finished attempts keep their own copy of the key):`, ...s.changedAnswers.map((r) => `    - ${r}`)]
      : []),
    ...warnings.map((w) => `  warning: ${w}`),
  ];
  return lines.join("\n");
}

