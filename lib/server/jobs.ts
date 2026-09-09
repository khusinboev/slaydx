import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "./db";
import { chargeInTx } from "./credits";
import { env } from "./env";
import type { FormValues, Generation, JobStatus, ToolId } from "../types";
import type { AcademicDoc, Delivered } from "../generation/types";
import type { SlideModel, SlideThemeId } from "../generation/slide-types";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "../generation/slide-templates";
import type { BodyRules } from "../generation/slide-audience";

/**
 * Generatsiya navbati.
 *
 * Ilgari hujjat HTTP so'rovi ichida yaratilardi: 40 varaqli kurs ishi
 * 105 soniyalik byudjetga sig'masdi, brauzer yopilsa ish yo'qolardi va
 * progress boshqa qurilmada ko'rinmasdi. Endi so'rov faqat navbatga
 * qo'yadi, ishni worker bajaradi, klient `GET /api/generations/{id}`
 * bilan holatni so'rab turadi.
 */

export type GenerationRow = {
  id: string;
  user_id: string;
  tool_id: string;
  topic: string;
  status: JobStatus;
  price: string;
  format: string;
  progress: number;
  step: string;
  values_json: FormValues;
  doc_json: AcademicDoc | null;
  html: string | null;
  file_name: string;
  error: string | null;
  preview: GenerationPreview | null;
  delivered_json: Delivered | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  expires_at: Date | null;
  /*
   * `?` — 013_live_edit.sql dan OLDINGI test qatorlari (masalan
   * `tests/queue.test.mts` dagi qo'lda yasalgan literal'lar) bu
   * maydonlarsiz ham to'g'ri tип tekshiruvidan o'tsin. Haqiqiy SQL
   * qatorida ular HAR DOIM bor (ustunlar `NOT NULL DEFAULT`) —
   * `rowToSummary` `?? 0`/`?? null` bilan shu «eski qator» holatini
   * ham xavfsiz yopadi.
   */
  /** Tahrir optimistik qulfi (013_live_edit.sql). */
  doc_version?: number;
  /** PPTX oxirgi marta qaysi `doc_version`ga qarab yasalgan. */
  file_version?: number;
  /** Bepul qayta chizish limiti — dekaga (`IMAGE_REDRAW_LIMIT`). */
  image_redraws?: number;
  edited_at?: Date | null;
  /** Jonli generatsiya davri (`live_json` o'zgarganda oshadi). `live_json`ning o'zi ROW_COLUMNS da YO'Q. */
  live_seq?: number;
};

const ROW_COLUMNS = `
  id, user_id, tool_id, topic, status, price, format, progress, step,
  values_json, file_name, error, preview, delivered_json, created_at, started_at, finished_at, expires_at,
  doc_version, file_version, image_redraws, edited_at, live_seq
`;

/**
 * Slayd dekalari uchun BIRINCHI slaydning to'liq maket modeli — kartochka
 * uni `SlideCanvas` bilan ko'ruvchidagidek chizadi ("ko'rdim = oldim").
 * `notes` (notiq matni) qasddan YO'Q — kartochkada ishlatilmaydi, faqat
 * hajmni oshiradi (`lib/server/preview.ts` `buildPreview`).
 */
export type GenerationPreviewSlide = {
  model: Omit<SlideModel, "notes">;
  themeId: SlideThemeId;
  templateId: SlideTemplateId;
  visual: SlideVisual;
  audience: SlideAudience;
  bodyType: BodyRules;
  logo?: string;
};

/** Ro'yxat kartochkasi uchun yengil ko'rinish. */
export type GenerationPreview = { url?: string; lines?: string[]; slide?: GenerationPreviewSlide };

export type GenerationSummary = Omit<Generation, "values" | "doc" | "html"> & {
  expiresAt: string | null;
  error: string | null;
  preview: GenerationPreview | null;
  docVersion: number;
  fileVersion: number;
  imageRedraws: number;
  editedAt: string | null;
  liveSeq: number;
};

export function rowToSummary(
  r: Omit<GenerationRow, "values_json" | "doc_json" | "html" | "live_json">,
): GenerationSummary {
  return {
    preview: r.preview ?? null,
    id: r.id,
    type: r.tool_id as ToolId,
    topic: r.topic,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : undefined,
    price: Number(r.price),
    fileName: r.file_name,
    format: r.format as Generation["format"],
    progress: r.progress,
    step: r.step,
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    error: r.error,
    delivered: r.delivered_json ?? undefined,
    docVersion: r.doc_version ?? 0,
    fileVersion: r.file_version ?? 0,
    imageRedraws: r.image_redraws ?? 0,
    editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
    liveSeq: r.live_seq ?? 0,
  };
}

export type EnqueueInput = {
  userId: string;
  toolId: ToolId;
  topic: string;
  price: number;
  format: string;
  values: FormValues;
  /** Ishga ajratilgan vaqt (`budgetFor`). Worker va `reclaimStaleJobs` shundan foydalanadi. */
  budgetMs: number;
};

export type EnqueueResult =
  | { ok: true; id: string }
  | { ok: false; reason: "insufficient"; required: number; available: number };

/**
 * Ishni navbatga qo'yadi va pulni **bitta tranzaksiyada** yechadi.
 *
 * Ikkisini ajratib bo'lmaydi: alohida qilinsa worker to'lanmagan ishni
 * ushlab olishi yoki pul yechilib ish yaratilmay qolishi mumkin.
 */
export async function enqueueGeneration(input: EnqueueInput): Promise<EnqueueResult> {
  const id = randomUUID();
  return transaction(async (client) => {
    const charged = await chargeInTx(
      client,
      input.userId,
      input.price,
      id,
      `${input.toolId}: ${input.topic}`.slice(0, 200),
    );
    if (!charged.ok) {
      return { ok: false as const, reason: charged.reason, required: charged.required, available: charged.available };
    }
    /*
     * `expires_at` endi berilmaydi — NULL bo'lib qoladi, ya'ni
     * generatsiya va unga biriktirilgan fayl/aktiv MUDDATSIZ saqlanadi
     * (`011_no_expiry.sql`, ilgari 72 soat edi).
     */
    await client.query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Navbatga qo''yildi', $8)`,
      [
        id,
        input.userId,
        input.toolId,
        input.topic.slice(0, 300),
        input.price,
        input.format,
        JSON.stringify(input.values),
        Math.round(input.budgetMs),
      ],
    );
    return { ok: true as const, id };
  });
}

/** Foydalanuvchining o'z ishlari. Boshqa userniki hech qachon chiqmaydi. */
export async function listGenerations(userId: string, limit = 100): Promise<GenerationSummary[]> {
  const rows = await query<Omit<GenerationRow, "values_json" | "doc_json" | "html">>(
    `SELECT ${ROW_COLUMNS} FROM generations
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 300)],
  );
  return rows.map(rowToSummary);
}

/**
 * `opts.since` — klient oxirgi ko'rgan `liveSeq`. Berilgan bo'lsa va
 * jonli deka o'sha vaqtdan beri o'zgarmagan bo'lsa, javobda `live`
 * KALITI UMUMAN YO'Q (`undefined`) — klient eskisini saqlaydi, hech
 * qachon eski qiymat qayta yuborilmaydi. `liveSeq` esa har doim bor.
 */
export async function getGeneration(
  id: string,
  userId: string,
  opts?: { since?: number },
): Promise<
  (GenerationSummary & { html: string | null; doc: AcademicDoc | null; live?: unknown | null }) | null
> {
  const since = opts?.since ?? null;
  const row = await queryOne<GenerationRow & { live_json_out: unknown | null }>(
    `SELECT ${ROW_COLUMNS}, html, doc_json,
       CASE WHEN status = 'IN_PROGRESS' AND ($3::int IS NULL OR live_seq > $3)
            THEN live_json END AS live_json_out
       FROM generations WHERE id = $1 AND user_id = $2`,
    [id, userId, since],
  );
  if (!row) return null;
  const base = { ...rowToSummary(row), html: row.html, doc: row.doc_json };
  const changed = row.status === "IN_PROGRESS" && (since == null || (row.live_seq ?? 0) > since);
  return changed ? { ...base, live: row.live_json_out ?? null } : base;
}

export async function deleteGeneration(id: string, userId: string): Promise<boolean> {
  // Ishlayotgan vazifani o'chirish worker ni chalg'itadi — avval bekor qilish kerak.
  const rows = await query<{ id: string }>(
    `DELETE FROM generations
      WHERE id = $1 AND user_id = $2 AND status IN ('COMPLETED','FAILED','REVOKED')
      RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/** Faqat navbatdagi ishni bekor qilish mumkin. */
export async function cancelGeneration(id: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET status = 'REVOKED', step = 'Bekor qilindi', progress = 100, finished_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'QUEUED'
      RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/**
 * Progressni yangilaydi va shu bilan birga qulfni «tirik» tutadi.
 *
 * `locked_at` ni surish muhim: uzoq (lekin sog'lom) ish
 * `reclaimStaleJobs` tomonidan noto'g'ri o'lik deb hisoblanmasin.
 */
export async function setProgress(
  id: string,
  workerId: string,
  progress: number,
  step: string,
): Promise<void> {
  await query(
    `UPDATE generations
        SET progress = $3, step = $4, locked_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'`,
    [id, workerId, Math.max(0, Math.min(99, Math.round(progress))), step.slice(0, 200)],
  );
}

/**
 * Jonli dekani yozadi va shu bilan birga navbat qulfini «tirik» tutadi
 * (`locked_at`) — alohida `heartbeat` chaqirish shart emas.
 *
 * `progress`/`step` bu yerda HAQIQIY qiymat — `progressTicker`ning
 * soxta `1 − e^(−t/T)` egri chizig'i o'rnini bosadi (rejaning
 * "Progress manbasi" qarori). Qulf boshqada bo'lsa (`locked_by`
 * mos kelmasa) yoki ish `IN_PROGRESS` bo'lmasa — `null`, `live_seq`
 * OSHMAYDI.
 */
export async function setLive(
  id: string,
  workerId: string,
  live: unknown,
  progress: number,
  step: string,
): Promise<number | null> {
  const row = await queryOne<{ live_seq: number }>(
    `UPDATE generations
        SET live_json = $3, live_seq = live_seq + 1, progress = $4, step = $5, locked_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING live_seq`,
    [
      id,
      workerId,
      JSON.stringify(live ?? null),
      Math.max(0, Math.min(99, Math.round(progress))),
      step.slice(0, 200),
    ],
  );
  return row ? row.live_seq : null;
}

/**
 * `setLive` orasida uzoq tanaffus bo'lsa (masalan LLM javob kutilmoqda)
 * ham qulfni tirik tutish uchun — `reclaimStaleJobs` noto'g'ri o'lik
 * deb hisoblamasin.
 */
export async function heartbeat(id: string, workerId: string): Promise<void> {
  await query(
    `UPDATE generations
        SET locked_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'`,
    [id, workerId],
  );
}

export type ClaimedJob = {
  id: string;
  userId: string;
  toolId: string;
  values: FormValues;
  price: number;
  attempts: number;
  /** Navbatga qo'yishda hisoblangan byudjet (ms). 0 — eski qator. */
  budgetMs: number;
};

/**
 * Navbatdan bitta ish oladi.
 *
 * `FOR UPDATE SKIP LOCKED` — bir nechta worker parallel ishlaganda
 * bir vazifani ikki marta bajarmaydi.
 */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    tool_id: string;
    values_json: FormValues;
    price: string;
    attempts: number;
    budget_ms: number;
  }>(
    `UPDATE generations g
        SET status = 'IN_PROGRESS',
            locked_by = $1,
            locked_at = now(),
            started_at = COALESCE(started_at, now()),
            attempts = attempts + 1,
            progress = 5,
            step = 'Boshlandi',
            live_json = NULL
      WHERE g.id = (
        SELECT id FROM generations
         WHERE status = 'QUEUED' AND run_after <= now()
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING g.id, g.user_id, g.tool_id, g.values_json, g.price, g.attempts, g.budget_ms`,
    [workerId],
  );
  if (!row) return null;
  return {
    id: row.id,
    userId: String(row.user_id),
    toolId: row.tool_id,
    values: row.values_json,
    price: Number(row.price),
    attempts: row.attempts,
    budgetMs: Number(row.budget_ms) || 0,
  };
}

/**
 * Ishni yakunlaydi — **faqat qulf hali bizda bo'lsa**.
 *
 * Nega shart: ish juda uzoq davom etsa `reclaimStaleJobs` uni navbatga
 * qaytaradi va boshqa worker olishi mumkin. Eski worker keyin tugab,
 * yangisining natijasini bosib yozardi (yoki bekor qilingan ishni
 * «tayyor» qilib qo'yardi). `locked_by` tekshiruvi shuni to'xtatadi.
 *
 * `false` qaytsa — natija tashlab yuborilishi kerak.
 */
/**
 * Haqiqiy fayl kengaytmasi.
 *
 * `generations.format` navbatga qo'yishda `tool.output` dan olinadi, ya'ni
 * fayl hali yaratilmasdan oldin. Rasm vositasi bir nechta rasmni ZIP
 * qilib beradi va yorliq «PNG» bo'lib qolardi — foydalanuvchi PNG deb
 * bosib, `.zip` olardi. Yakunlashda yorliq haqiqiy faylga moslanadi.
 */
export function formatOf(fileName: string): string | null {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext && ext.length <= 5 ? ext : null;
}

export async function completeJob(
  id: string,
  workerId: string,
  result: {
    html: string;
    doc: AcademicDoc | null;
    fileName: string;
    preview: GenerationPreview | null;
    /** Va'da qilinganidan kam yetkazilgan bo'lsa (AUDIT-6 C7). */
    delivered?: Delivered;
  },
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET status = 'COMPLETED', progress = 100, step = 'Tayyor',
            html = $3, doc_json = $4, file_name = $5, preview = $6,
            format = COALESCE($7, format), delivered_json = $8,
            finished_at = now(), locked_by = NULL, locked_at = NULL, error = NULL,
            live_json = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING id`,
    [
      id,
      workerId,
      result.html,
      result.doc ? JSON.stringify(result.doc) : null,
      result.fileName,
      result.preview ? JSON.stringify(result.preview) : null,
      formatOf(result.fileName),
      result.delivered ? JSON.stringify(result.delivered) : null,
    ],
  );
  return rows.length > 0;
}

/** Xato bilan yakunlaydi. `false` — qulf boshqada, pul qaytarilmasin. */
export async function failJob(id: string, workerId: string, message: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET status = 'FAILED', progress = 100, step = 'Xatolik',
            error = $3, finished_at = now(), locked_by = NULL, locked_at = NULL,
            live_json = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING id`,
    [id, workerId, message.slice(0, 500)],
  );
  return rows.length > 0;
}

/**
 * Osilib qolgan ishlarni tiklaydi.
 *
 * Worker process o'lsa vazifa abadiy `IN_PROGRESS` bo'lib qolardi —
 * foydalanuvchi esa progress bar ga qarab kutaverardi.
 */
export async function reclaimStaleJobs(): Promise<string[]> {
  const timeoutSec = Math.round(env.worker.jobTimeoutMs / 1000);
  /*
   * Muddat HAR ISHNING o'z byudjetidan olinadi.
   *
   * Ilgari global `WORKER_JOB_TIMEOUT_MS` bilan solishtirilardi: 45
   * betlik kurs ishi sog'lom ishlayotgan holida ham o'lik deb belgilanib,
   * navbatga qaytarilishi mumkin edi. `budget_ms = 0` — eski qatorlar,
   * ular uchun global qiymat qoladi. Ustiga 30 s qo'shiladi: worker
   * byudjetni to'liq ishlatib, natijani yozishga ham ulgursin.
   */
  const staleFilter = `locked_at < now() - ((CASE WHEN budget_ms > 0 THEN budget_ms / 1000 ELSE $1::int END) + 30 || ' seconds')::interval`;
  return transaction(async (client) => {
    // Yana urinib ko'rish mumkin bo'lganlari navbatga qaytadi.
    await client.query(
      `UPDATE generations
          SET status = 'QUEUED', locked_by = NULL, locked_at = NULL,
              run_after = now() + interval '5 seconds',
              step = 'Qayta navbatga qo''yildi',
              live_json = NULL
        WHERE status = 'IN_PROGRESS'
          AND attempts < 2
          AND ${staleFilter}`,
      [String(timeoutSec)],
    );
    // Ikki marta uringanlari — yakuniy xato (pul chaqiruvchi tomonda qaytariladi).
    const dead = await client.query<{ id: string }>(
      `UPDATE generations
          SET status = 'FAILED', progress = 100, step = 'Xatolik',
              error = 'Ish vaqti tugadi', finished_at = now(),
              locked_by = NULL, locked_at = NULL,
              live_json = NULL
        WHERE status = 'IN_PROGRESS'
          AND attempts >= 2
          AND ${staleFilter}
        RETURNING id`,
      [String(timeoutSec)],
    );
    return dead.rows.map((r) => r.id);
  });
}

export async function queueDepth(): Promise<{ queued: number; running: number }> {
  const row = await queryOne<{ queued: string; running: string }>(
    `SELECT
       count(*) FILTER (WHERE status = 'QUEUED')::text      AS queued,
       count(*) FILTER (WHERE status = 'IN_PROGRESS')::text AS running
     FROM generations`,
  );
  return { queued: Number(row?.queued ?? 0), running: Number(row?.running ?? 0) };
}

// ---------------------------------------------------------------------------
// Ko'ruvchida tahrirlash (2-qism) — poydevor.
//
// Bu funksiyalar `PoolClient` qabul qiladi: `commitDocOps`/`rebuildFile`
// (E4/E5) doc/html/preview/file_version yozuvini BITTA tranzaksiyada
// (kerak bo'lsa advisory lock ostida) bajaradi — `query`/`transaction`
// wrapperi emas, chaqiruvchi client'ni to'g'ridan-to'g'ri ishlatadi.
// ---------------------------------------------------------------------------

/**
 * Tahrirni yozadi — **faqat** `doc_version` chaqiruvchi kutgan qiymatga
 * teng bo'lsa (optimistik qulf). Boshqa foydalanuvchi/tab parallel
 * tahrir qilgan bo'lsa `null` — chaqiruvchi 409 qaytaradi.
 *
 * `status = 'COMPLETED'` predikati: hali tayyor bo'lmagan (`doc_json`
 * yo'q) yoki jonli generatsiya davom etayotgan hujjatga tahrir tushib
 * qolmasin.
 */
export async function updateGenerationDoc(
  client: PoolClient,
  id: string,
  userId: string,
  expectedVersion: number,
  patch: { doc: AcademicDoc; html: string; preview: GenerationPreview | null },
): Promise<number | null> {
  const res = await client.query<{ doc_version: number }>(
    `UPDATE generations
        SET doc_json = $3, html = $4, preview = $5, doc_version = doc_version + 1, edited_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'COMPLETED' AND doc_version = $6
      RETURNING doc_version`,
    [
      id,
      userId,
      JSON.stringify(patch.doc),
      patch.html,
      patch.preview ? JSON.stringify(patch.preview) : null,
      expectedVersion,
    ],
  );
  return res.rows[0]?.doc_version ?? null;
}

/**
 * PPTX qayta yasalgach `file_version`ni oshiradi.
 *
 * `file_version < $v` sharti: parallel ikkita rebuild bir-birini ORQAGA
 * surmasin (eskisi keyinroq tugasa ham yangi versiyani bosib yozmaydi).
 */
export async function markFileVersion(
  client: PoolClient,
  id: string,
  userId: string,
  v: number,
): Promise<number | null> {
  const res = await client.query<{ file_version: number }>(
    `UPDATE generations
        SET file_version = $3
      WHERE id = $1 AND user_id = $2 AND file_version < $3
      RETURNING file_version`,
    [id, userId, v],
  );
  return res.rows[0]?.file_version ?? null;
}

/**
 * Rasm qayta chizishni «band qiladi» — limit va egalik BITTA `UPDATE`
 * predikatida (TOCTOU yo'q: tekshirish va oshirish bir amal).
 * `null` — limit tugagan (yoki egalik/`status` mos kelmagan).
 */
export async function reserveRedraw(id: string, userId: string, limit: number): Promise<number | null> {
  const row = await queryOne<{ image_redraws: number }>(
    `UPDATE generations
        SET image_redraws = image_redraws + 1
      WHERE id = $1 AND user_id = $2 AND status = 'COMPLETED' AND image_redraws < $3
      RETURNING image_redraws`,
    [id, userId, limit],
  );
  return row ? row.image_redraws : null;
}

/** Qayta chizish provayder xatosi bilan yiqilsa — band qilingan limitni qaytaradi. */
export async function releaseRedraw(id: string, userId: string): Promise<void> {
  await query(
    `UPDATE generations
        SET image_redraws = GREATEST(image_redraws - 1, 0)
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
}

/** `GET …/file` faylni eskirgan bermasin deb tekshiradigan yengil so'rov. */
export async function getVersions(
  id: string,
  userId: string,
): Promise<{
  docVersion: number;
  fileVersion: number;
  toolId: string;
  fileName: string;
  status: JobStatus;
} | null> {
  const row = await queryOne<{
    doc_version: number;
    file_version: number;
    tool_id: string;
    file_name: string;
    status: JobStatus;
  }>(
    `SELECT doc_version, file_version, tool_id, file_name, status
       FROM generations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) return null;
  return {
    docVersion: row.doc_version,
    fileVersion: row.file_version,
    toolId: row.tool_id,
    fileName: row.file_name,
    status: row.status,
  };
}

/**
 * `PATCH …/doc` uchun to'liq holat — `FOR UPDATE` EMAS (oddiy SELECT):
 * qulflash `updateGenerationDoc`ning `doc_version = $expected` sharti
 * bilan optimistik tarzda hal qilinadi, alohida qator qulfi kerak emas.
 */
export async function getGenerationForEdit(
  id: string,
  userId: string,
): Promise<{
  doc: AcademicDoc | null;
  docVersion: number;
  fileVersion: number;
  imageRedraws: number;
  toolId: string;
  fileName: string;
  topic: string;
  status: JobStatus;
} | null> {
  const row = await queryOne<{
    doc_json: AcademicDoc | null;
    doc_version: number;
    file_version: number;
    image_redraws: number;
    tool_id: string;
    file_name: string;
    topic: string;
    status: JobStatus;
  }>(
    `SELECT doc_json, doc_version, file_version, image_redraws, tool_id, file_name, topic, status
       FROM generations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) return null;
  return {
    doc: row.doc_json,
    docVersion: row.doc_version,
    fileVersion: row.file_version,
    imageRedraws: row.image_redraws,
    toolId: row.tool_id,
    fileName: row.file_name,
    topic: row.topic,
    status: row.status,
  };
}
