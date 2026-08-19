import "server-only";
import { randomUUID } from "node:crypto";
import { query, queryOne, transaction } from "./db";
import { chargeInTx } from "./credits";
import { env } from "./env";
import type { FormValues, Generation, JobStatus, ToolId } from "../types";
import type { AcademicDoc } from "../generation/types";

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
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  expires_at: Date | null;
};

const ROW_COLUMNS = `
  id, user_id, tool_id, topic, status, price, format, progress, step,
  values_json, file_name, error, preview, created_at, started_at, finished_at, expires_at
`;

/** Ro'yxat kartochkasi uchun yengil ko'rinish. */
export type GenerationPreview = { url?: string; lines?: string[] };

export type GenerationSummary = Omit<Generation, "values" | "doc" | "html"> & {
  expiresAt: string | null;
  error: string | null;
  preview: GenerationPreview | null;
};

export function rowToSummary(r: Omit<GenerationRow, "values_json" | "doc_json" | "html">): GenerationSummary {
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
  };
}

export type EnqueueInput = {
  userId: string;
  toolId: ToolId;
  topic: string;
  price: number;
  format: string;
  values: FormValues;
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
    await client.query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Navbatga qo''yildi', now() + ($8 || ' hours')::interval)`,
      [
        id,
        input.userId,
        input.toolId,
        input.topic.slice(0, 300),
        input.price,
        input.format,
        JSON.stringify(input.values),
        String(env.fileTtlHours),
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

export async function getGeneration(
  id: string,
  userId: string,
): Promise<(GenerationSummary & { html: string | null; doc: AcademicDoc | null }) | null> {
  const row = await queryOne<GenerationRow>(
    `SELECT ${ROW_COLUMNS}, html, doc_json FROM generations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) return null;
  return { ...rowToSummary(row), html: row.html, doc: row.doc_json };
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

export type ClaimedJob = {
  id: string;
  userId: string;
  toolId: string;
  values: FormValues;
  price: number;
  attempts: number;
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
  }>(
    `UPDATE generations g
        SET status = 'IN_PROGRESS',
            locked_by = $1,
            locked_at = now(),
            started_at = COALESCE(started_at, now()),
            attempts = attempts + 1,
            progress = 5,
            step = 'Boshlandi'
      WHERE g.id = (
        SELECT id FROM generations
         WHERE status = 'QUEUED' AND run_after <= now()
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING g.id, g.user_id, g.tool_id, g.values_json, g.price, g.attempts`,
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
export async function completeJob(
  id: string,
  workerId: string,
  result: {
    html: string;
    doc: AcademicDoc | null;
    fileName: string;
    preview: GenerationPreview | null;
  },
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET status = 'COMPLETED', progress = 100, step = 'Tayyor',
            html = $3, doc_json = $4, file_name = $5, preview = $6,
            finished_at = now(), locked_by = NULL, locked_at = NULL, error = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING id`,
    [
      id,
      workerId,
      result.html,
      result.doc ? JSON.stringify(result.doc) : null,
      result.fileName,
      result.preview ? JSON.stringify(result.preview) : null,
    ],
  );
  return rows.length > 0;
}

/** Xato bilan yakunlaydi. `false` — qulf boshqada, pul qaytarilmasin. */
export async function failJob(id: string, workerId: string, message: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET status = 'FAILED', progress = 100, step = 'Xatolik',
            error = $3, finished_at = now(), locked_by = NULL, locked_at = NULL
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
  return transaction(async (client) => {
    // Yana urinib ko'rish mumkin bo'lganlari navbatga qaytadi.
    await client.query(
      `UPDATE generations
          SET status = 'QUEUED', locked_by = NULL, locked_at = NULL,
              run_after = now() + interval '5 seconds',
              step = 'Qayta navbatga qo''yildi'
        WHERE status = 'IN_PROGRESS'
          AND attempts < 2
          AND locked_at < now() - ($1 || ' seconds')::interval`,
      [String(timeoutSec)],
    );
    // Ikki marta uringanlari — yakuniy xato (pul chaqiruvchi tomonda qaytariladi).
    const dead = await client.query<{ id: string }>(
      `UPDATE generations
          SET status = 'FAILED', progress = 100, step = 'Xatolik',
              error = 'Ish vaqti tugadi', finished_at = now(),
              locked_by = NULL, locked_at = NULL
        WHERE status = 'IN_PROGRESS'
          AND attempts >= 2
          AND locked_at < now() - ($1 || ' seconds')::interval
        RETURNING id`,
      [String(timeoutSec)],
    );
    return dead.rows.map((r) => r.id);
  });
}

/**
 * Eskirgan generatsiya qatorlarini o'chiradi.
 *
 * Fayl va aktivlar TTL bo'yicha o'chardi, lekin `generations` qatori
 * (`html` + `doc_json` bilan, ba'zan megabaytlab) abadiy qolardi —
 * baza vaqt o'tishi bilan cheksiz o'sardi.
 *
 * Muddati o'tgan yozuvda avval og'ir maydonlar tozalanadi, ancha
 * eskilari esa butunlay o'chadi (foydalanuvchi tarixi biroz saqlansin).
 */
export async function purgeExpiredGenerations(): Promise<number> {
  // 1-bosqich: muddati tugagan — kontentni tashlaymiz, qator qoladi.
  await query(
    `UPDATE generations
        SET html = NULL, doc_json = NULL, preview = NULL
      WHERE expires_at IS NOT NULL
        AND expires_at < now()
        AND (html IS NOT NULL OR doc_json IS NOT NULL)`,
  );
  // 2-bosqich: 90 kundan eski yozuvlar butunlay o'chadi.
  const rows = await query<{ count: string }>(
    `WITH gone AS (
       DELETE FROM generations WHERE created_at < now() - interval '90 days' RETURNING 1
     )
     SELECT count(*)::text AS count FROM gone`,
  );
  return Number(rows[0]?.count ?? 0);
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
