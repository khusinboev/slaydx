import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "./db";
import { chargeInTx } from "./credits";
import { refundInTx } from "./refund-tx";
import { putGenerationFile } from "./storage";
import type { PendingAsset } from "./assets";
import { toJsonb } from "./jsonb";
import { cleanText, safeSlice } from "../generation/safe-text";
import { env } from "./env";
import { log } from "./log";
import { userMessage } from "./user-error";
import {
  admissionDecision,
  queueEtaSec,
  type AdmissionDecision,
  type AdmissionLimits,
  type AdmissionReject,
} from "./admission";
import type { FormValues, Generation, JobStatus, ToolId } from "../types";
import type { AcademicDoc, CostJson, Delivered } from "../generation/types";
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
  /**
   * Eski ustun — AI bilan qayta chizish olib tashlandi (Muharrir 2 /
   * WP4b), migratsiya YO'Q, faqat o'qish uchun saqlanadi.
   */
  image_redraws?: number;
  edited_at?: Date | null;
  /** Jonli generatsiya davri (`live_json` o'zgarganda oshadi). `live_json`ning o'zi SUMMARY_COLUMNS da YO'Q. */
  live_seq?: number;
  /**
   * `doc_prev IS NOT NULL` hisoblangan ustun (014_doc_prev.sql). `doc_prev`
   * ning O'ZI bu ro'yxatga KIRMAYDI — u faqat `restoreDoc` o'qiydigan
   * og'ir JSONB, ro'yxat/detal so'rovlarini og'irlashtirmasin.
   */
  has_prev?: boolean;
  /** Bonus fayllari saqlash muddati tugab o'chirilgan payt (022_retention.sql, W2-D2). */
  files_purged_at?: Date | null;
  /** Faqat `getGeneration`: QUEUED bo'lsa navbatdagi o'rni (1 dan), aks holda NULL. */
  queue_position?: string | number | null;
};

/**
 * Ro'yxat va poll uchun YENGIL ustunlar (prod-readiness C09: BEA-06, DB-03,
 * SCALE-03, CONC-18).
 *
 * `values_json` ATAYIN yo'q: unda 200 000 belgigacha `sourceText` (~400 KB)
 * turadi, `rowToSummary` esa uni hech qachon ishlatmaydi — ilgari har 3
 * soniyalik ro'yxat va har poll uni detoast qilib, `JSON.parse` qilib,
 * tashlab yuborardi. Forma qiymatlari kerak bo'lgan joy (`claimJob`,
 * tahrir yo'llari) ularni o'z so'rovida alohida o'qiydi.
 */
const SUMMARY_COLUMNS = `
  id, user_id, tool_id, topic, status, price, format, progress, step,
  file_name, error, preview, delivered_json, created_at, started_at, finished_at, expires_at,
  doc_version, file_version, image_redraws, edited_at, live_seq, doc_prev IS NOT NULL AS has_prev,
  files_purged_at
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
  /** Asl holatga qaytarish tugmasi shu bilan ko'rsatiladi/yashiriladi (`doc_prev` mavjudmi). */
  hasPrev: boolean;
  /** Bonus fayllari saqlash muddati tugab o'chirilgan bo'lsa — qachon (UI sababini tushuntiradi). */
  filesPurgedAt: string | null;
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
    // O'qishda ham tekshiriladi (BEA-09): tuzatishdan oldin yozilgan eski
    // qatorlardagi xom pg/provayder matni API javobiga chiqmasin.
    error: r.error === null || r.error === undefined ? null : userMessage(r.error),
    delivered: r.delivered_json ?? undefined,
    docVersion: r.doc_version ?? 0,
    fileVersion: r.file_version ?? 0,
    imageRedraws: r.image_redraws ?? 0,
    editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
    liveSeq: r.live_seq ?? 0,
    hasPrev: r.has_prev ?? false,
    filesPurgedAt: r.files_purged_at ? new Date(r.files_purged_at).toISOString() : null,
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
  /**
   * Berilsa — pul yechishdan OLDIN qabul qarori (`admissionDecision`, C22).
   * `POST /api/generations` `env.queue` ni beradi; seed/test skriptlari
   * bermasa, eski xatti-harakat (cheklovsiz) saqlanadi.
   */
  admission?: AdmissionLimits;
  /**
   * Klient kaliti (`Idempotency-Key`, C34) — kichik harfli UUID. Bir
   * foydalanuvchi + bir kalit 24 soat ichida o'sha generatsiyani qaytaradi
   * (`replayed: true`), pul ikkinchi marta yechilmaydi.
   */
  idempotencyKey?: string;
};

/** Qabul qarorisiz natija (seed skriptlari shu toraygan tipga tayanadi). */
export type EnqueueChargeResult =
  | {
      ok: true;
      id: string;
      /** Yechilgan narx (takrorda — ASL so'rovniki). */
      price: number;
      /** `true` — shu kalit bilan avval yaratilgan ish qaytdi, hech narsa yechilmadi. */
      replayed: boolean;
    }
  | { ok: false; reason: "insufficient"; required: number; available: number };

export type EnqueueResult =
  | EnqueueChargeResult
  | { ok: false; reason: "admission"; decision: AdmissionReject }
  /** Kalit shu foydalanuvchida BOSHQA so'rov (vosita yoki forma qiymatlari) uchun ishlatilgan (422). */
  | { ok: false; reason: "idempotency_conflict" };

/** Idempotentlik oynasi — shundan eski kalit yangi so'rov hisoblanadi. */
export const IDEMPOTENCY_WINDOW_HOURS = 24;

/** `generations_user_idem_idx` (024_idempotency.sql) buzilishi — parallel takror. */
function isIdempotencyViolation(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string } | null;
  return err?.code === "23505" && err.constraint === "generations_user_idem_idx";
}

type IdemRow = { id: string; tool_id: string; price: string; same_values: boolean };

/**
 * Kalitli ish (24 soat oynasida) va uning TANASI shu so'rovnikiga tengmi
 * (`same_values`, W3-A review nit 4). Tana = navbatga yoziladigan aynan shu
 * `toJsonb(values)`; JSONB tengligi kalitlar tartibiga qaramaydi.
 */
async function findByIdempotencyKey(
  client: PoolClient,
  userId: string,
  key: string,
  values: FormValues,
): Promise<IdemRow | null> {
  const res = await client.query<IdemRow>(
    `SELECT id, tool_id, price, values_json = $4::jsonb AS same_values FROM generations
      WHERE user_id = $1 AND idempotency_key = $2
        AND created_at >= now() - $3::int * interval '1 hour'`,
    [userId, key, IDEMPOTENCY_WINDOW_HOURS, toJsonb(values)],
  );
  return res.rows[0] ?? null;
}

/**
 * Takror faqat AYNAN o'sha so'rov uchun: boshqa vosita yoki boshqa forma
 * qiymatlari bilan kelgan o'sha kalit — 422 (Stripe uslubi). Ilgari boshqa
 * mavzu jim holda ASL ishni qaytarardi va klient yangi hujjat buyurtma
 * qildim deb o'ylardi.
 */
function replayOf(row: IdemRow, toolId: ToolId): EnqueueResult {
  if (row.tool_id !== toolId || !row.same_values) return { ok: false, reason: "idempotency_conflict" };
  return { ok: true, id: row.id, price: Number(row.price), replayed: true };
}

/**
 * Ishni navbatga qo'yadi va pulni **bitta tranzaksiyada** yechadi.
 *
 * Ikkisini ajratib bo'lmaydi: alohida qilinsa worker to'lanmagan ishni
 * ushlab olishi yoki pul yechilib ish yaratilmay qolishi mumkin.
 *
 * `admission` va `idempotencyKey` berilmasa `"admission"`/`"idempotency_conflict"`
 * natijasi bo'lishi mumkin emas — overload buni tipda ham aytadi.
 *
 * IDEMPOTENTLIK (C34): kalit berilsa, avval foydalanuvchi qatori qulflanadi
 * (bir foydalanuvchining parallel so'rovlari navbatma-navbat), so'ng shu
 * kalitli ish qidiriladi — READ COMMITTED da qulfdan keyingi SELECT oldingi
 * tranzaksiya COMMIT qilgan qatorni ko'radi, ya'ni takroriy so'rov pul
 * yechmay o'sha ishni qaytaradi (qabul chegarasi ham qayta tekshirilmaydi —
 * ish allaqachon qabul qilingan). UNIQUE indeks — oxirgi to'siq: baribir
 * poyga bo'lsa (23505) tranzaksiya (pul ham) rollback bo'ladi va mavjud ish qaytadi.
 */
export function enqueueGeneration(
  input: EnqueueInput & { admission?: undefined; idempotencyKey?: undefined },
): Promise<EnqueueChargeResult>;
export function enqueueGeneration(input: EnqueueInput): Promise<EnqueueResult>;
export async function enqueueGeneration(input: EnqueueInput): Promise<EnqueueResult> {
  const id = randomUUID();
  const key = input.idempotencyKey;
  // NUL/yolg'iz surrogat `topic` (TEXT) va `transactions.note` ni yiqitmasin (C03).
  const topic = cleanText(input.topic);
  try {
    const res = await transaction(async (client): Promise<EnqueueResult> => {
      if (key) {
        // `admitInTx` bilan bir xil qulf (tartib o'zgarmaydi) — takrorlar navbatma-navbat.
        await client.query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE", [input.userId]);
        // 24 soatdan eski kalit — yangi so'rov: eski qatordan kalit olinadi (UNIQUE bo'shaydi).
        await client.query(
          `UPDATE generations SET idempotency_key = NULL
            WHERE user_id = $1 AND idempotency_key = $2
              AND created_at < now() - $3::int * interval '1 hour'`,
          [input.userId, key, IDEMPOTENCY_WINDOW_HOURS],
        );
        const prior = await findByIdempotencyKey(client, input.userId, key, input.values);
        if (prior) return replayOf(prior, input.toolId);
      }
      if (input.admission) {
        const decision = await admitInTx(client, input.userId, input.admission);
        if (!decision.ok) return { ok: false as const, reason: "admission" as const, decision };
      }
      const charged = await chargeInTx(
        client,
        input.userId,
        input.price,
        id,
        safeSlice(`${input.toolId}: ${topic}`, 200),
      );
      if (!charged.ok) {
        return { ok: false as const, reason: charged.reason, required: charged.required, available: charged.available };
      }
      /*
       * `expires_at` endi berilmaydi — NULL bo'lib qoladi, ya'ni
       * generatsiya va unga biriktirilgan fayl/aktiv MUDDATSIZ saqlanadi
       * (`011_no_expiry.sql`, ilgari 72 soat edi). `idempotency_key`
       * faqat kalit berilganda yoziladi — kalitsiz yo'lning SQL i o'zgarmagan.
       */
      const params = [
        id,
        input.userId,
        input.toolId,
        safeSlice(topic, 300),
        input.price,
        input.format,
        toJsonb(input.values),
        Math.round(input.budgetMs),
      ];
      if (key) {
        await client.query(
          `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Navbatga qo''yildi', $8, $9)`,
          [...params, key],
        );
      } else {
        await client.query(
          `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Navbatga qo''yildi', $8)`,
          params,
        );
      }
      return { ok: true as const, id, price: input.price, replayed: false };
    });
    logEnqueue(input, res);
    return res;
  } catch (e) {
    if (!key || !isIdempotencyViolation(e)) throw e;
    // Parallel takror bizdan oldin COMMIT qildi — butun tranzaksiya (pul ham) bekor, o'sha ish qaytadi.
    const prior = await transaction((client) => findByIdempotencyKey(client, input.userId, key, input.values));
    if (!prior) throw e;
    const res = replayOf(prior, input.toolId);
    logEnqueue(input, res);
    return res;
  }
}

/**
 * Navbatga qo'yish izi (OBS-02): so'rovning `reqId` si (kontekstdan) va
 * ish id si BITTA qatorda — «shu so'rov qaysi ishni yaratdi, qancha
 * yechildi» degan savol jurnaldan javob topadi.
 */
function logEnqueue(input: EnqueueInput, res: EnqueueResult): void {
  if (res.ok) {
    log("info", res.replayed ? "[jobs] takroriy so'rov — mavjud ish qaytarildi" : "[jobs] navbatga qo'yildi", {
      jobId: res.id,
      genId: res.id,
      userId: input.userId,
      toolId: input.toolId,
      price: res.price,
      replayed: res.replayed,
      budgetMs: Math.round(input.budgetMs),
    });
  } else {
    log("info", "[jobs] navbatga qo'yilmadi", {
      userId: input.userId,
      toolId: input.toolId,
      price: input.price,
      reason: res.reason,
      ...(res.reason === "admission" ? { code: res.decision.code } : {}),
      ...(res.reason === "insufficient" ? { required: res.required, available: res.available } : {}),
    });
  }
}

/**
 * Qabul qarori uchun sanoqlar — `enqueueGeneration` tranzaksiyasi ICHIDA,
 * pul yechishdan oldin.
 *
 * Avval foydalanuvchi qatori `FOR UPDATE` bilan qulflanadi (`chargeInTx`
 * baribir shu qatorni qulflaydi — tartib o'zgarmaydi, faqat oldinroq):
 * bir foydalanuvchining parallel so'rovlari navbatma-navbat sanaladi,
 * ya'ni 3 ta bir vaqtdagi POST chegaradan (2) oshib keta olmaydi.
 * Global navbat sanog'i esa yumshoq — ikki foydalanuvchi bir lahzada
 * chegarani bittaga oshirishi mumkin, bu zararsiz.
 *
 * Sanoqlar (`ADMISSION_COUNTS_SQL`) har biri bitta qisman indeks
 * (`generations_queued_created_idx` / `generations_running_user_idx`) bo'ylab — qabul
 * chegarasi tufayli ular kichik, tarix (COMPLETED) umuman o'qilmaydi.
 */
/**
 * Har sanoq AYNAN bitta qisman indeks predikatiga mos (`status = 'QUEUED'` →
 * `generations_queued_created_idx`, `status = 'IN_PROGRESS'` → `generations_running_user_idx`,
 * 027_queue_indexes.sql).
 * `status IN (…)` (`= ANY(array)`) ularning hech biriga mos kelmaydi va
 * butun (muddatsiz o'sadigan) jadvalni qulf ostida ketma-ket o'qirdi —
 * review W2-B R1: 200k qatorda 14.6 ms → 0.17 ms. `tests/admission.test.mts`
 * EXPLAIN bilan qulflaydi.
 */
export const ADMISSION_COUNTS_SQL = `SELECT
    (SELECT count(*) FROM generations WHERE status = 'QUEUED' AND user_id = $1)
  + (SELECT count(*) FROM generations WHERE status = 'IN_PROGRESS' AND user_id = $1) AS user_inflight,
    (SELECT count(*) FROM generations WHERE status = 'QUEUED') AS queued`;

async function admitInTx(
  client: PoolClient,
  userId: string,
  limits: AdmissionLimits,
): Promise<AdmissionDecision> {
  // `NO KEY UPDATE`: o'zi bilan va `chargeInTx` ning UPDATE i bilan to'qnashadi
  // (qabul navbatma-navbat), lekin shu foydalanuvchining bola jadvallarga
  // (transactions, sessions…) FK `KEY SHARE` yozuvlarini to'smaydi.
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE", [userId]);
  const counts = await client.query<{ user_inflight: string; queued: string }>(ADMISSION_COUNTS_SQL, [userId]);
  const row = counts.rows[0];
  return admissionDecision({
    ...limits,
    userInflight: Number(row?.user_inflight ?? 0),
    queued: Number(row?.queued ?? 0),
  });
}

/** `GET /api/generations?limit=` chegaralari (`audit/designs/w2-contracts.md`). */
export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;

/**
 * Ro'yxat kursori — oxirgi ko'rilgan qatorning `(created_at, id)` jufti.
 *
 * Vaqt MIKROSEKUND aniqligida, UTC matn sifatida saqlanadi: JS `Date` faqat
 * millisekund biladi, `created_at` esa mikrosekundli — `Date` orqali
 * aylantirilsa, bir millisekund ichidagi qatorlar sahifa chegarasida
 * yo'qolar yoki takrorlanardi. `id` — bir xil vaqtdagi qatorlar tartibi.
 * Klient uchun shaffof emas (base64url).
 */
export type ListCursor = { ts: string; id: string };

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify([c.ts, c.id]), "utf8").toString("base64url");
}

/** Noto'g'ri/soxta kursor — `null` (route 400 qaytaradi). */
export function decodeCursor(raw: string): ListCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [ts, id] = parsed as unknown[];
  if (typeof ts !== "string" || typeof id !== "string") return null;
  if (!CURSOR_TS.test(ts) || !CURSOR_ID.test(id)) return null;
  return { ts, id };
}

/** `limit` so'rov parametri: butun son 1..100, bo'lmasa standart 50. */
export function clampListLimit(raw: string | null | undefined): number {
  const n = raw == null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return LIST_LIMIT_DEFAULT;
  return Math.min(LIST_LIMIT_MAX, Math.max(1, n));
}

/**
 * Foydalanuvchining o'z ishlari, yangidan eskiga, kursor bilan sahifalab.
 * Boshqa userniki hech qachon chiqmaydi (kursor ham `user_id` predikatidan o'tadi).
 *
 * Ilgari faqat eng yangi 100 tasi qaytardi — 101-hujjatdan boshlab
 * foydalanuvchi eski (pulli, MUDDATSIZ saqlanadigan) hujjatlarini UI da
 * umuman ko'ra olmasdi (BEA-06, FE-08). `limit + 1` qator o'qiladi —
 * ortiqchasi bo'lsa keyingi sahifa bor.
 */
export async function listGenerations(
  userId: string,
  opts: { limit?: number; cursor?: ListCursor | null } = {},
): Promise<{ items: GenerationSummary[]; nextCursor: string | null }> {
  const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Math.floor(opts.limit ?? LIST_LIMIT_DEFAULT)));
  const cursor = opts.cursor ?? null;
  const rows = await query<Omit<GenerationRow, "values_json" | "doc_json" | "html"> & { cursor_ts: string }>(
    `SELECT ${SUMMARY_COLUMNS},
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_ts
       FROM generations
      WHERE user_id = $1
        AND ($2::timestamp IS NULL
             OR (created_at <= ($2::timestamp AT TIME ZONE 'UTC')
                 AND (created_at < ($2::timestamp AT TIME ZONE 'UTC') OR id < $3::uuid)))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    [userId, cursor?.ts ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? encodeCursor({ ts: last.cursor_ts, id: last.id }) : null;
  return { items: page.map(rowToSummary), nextCursor };
}

/**
 * `opts.since` — klient oxirgi ko'rgan `liveSeq`. Berilgan bo'lsa va
 * jonli deka o'sha vaqtdan beri o'zgarmagan bo'lsa, javobda `live`
 * KALITI UMUMAN YO'Q (`undefined`) — klient eskisini saqlaydi, hech
 * qachon eski qiymat qayta yuborilmaydi. `liveSeq` esa har doim bor.
 */
export type GenerationDetailRow = GenerationSummary & {
  html: string | null;
  doc: AcademicDoc | null;
  live?: unknown | null;
  /** Faqat QUEUED: navbatdagi o'rni, 1 dan (`created_at, id` bo'yicha oldindagi QUEUED ishlar + 1). */
  queuePosition?: number;
  /** Faqat QUEUED: ish BOSHLANISHIGACHA taxminiy soniya (`queueEtaSec`, qabul formulasi bilan bir xil). */
  etaSec?: number;
};

/**
 * `opts.lean` — poll rejimi (`GET /api/generations/{id}`): `doc` bor
 * bo'lsa `html` qayta YUBORILMAYDI (`null`). Ko'ruvchi `doc` dan chizadi,
 * `html` faqat `doc` siz eski qatorlar uchun zaxira — ilgari tayyor hujjat
 * javobida bir hujjat ikki marta ketardi (SCALE-12). Server ichidagi
 * chaqiruvchilar (`doc-polish` eski `html` ni qayta yozadi) `lean` siz,
 * to'liq `html` oladi.
 */
export async function getGeneration(
  id: string,
  userId: string,
  opts?: { since?: number; lean?: boolean },
): Promise<GenerationDetailRow | null> {
  const since = opts?.since ?? null;
  const html = opts?.lean ? "CASE WHEN doc_json IS NULL THEN html END AS html" : "html";
  /*
   * Navbat o'rni faqat QUEUED qatorda hisoblanadi: oldindagi (`created_at,
   * id` bo'yicha) QUEUED ishlar soni + 1. Sanoq `generations_queued_created_idx`
   * (faqat QUEUED qatorlar) bo'ylab, qabul chegarasi tufayli kichik.
   * `claimJob` adolat qoidasi tufayli haqiqiy tartib biroz farq qilishi
   * mumkin — bu taxmin, va'da emas.
   */
  const row = await queryOne<GenerationRow & { live_json_out: unknown | null }>(
    `SELECT ${SUMMARY_COLUMNS}, ${html}, doc_json,
       CASE WHEN status = 'IN_PROGRESS' AND ($3::int IS NULL OR live_seq > $3)
            THEN live_json END AS live_json_out,
       CASE WHEN status = 'QUEUED' THEN 1 + (
         SELECT count(*) FROM generations q
          WHERE q.status = 'QUEUED'
            AND (q.created_at, q.id) < (generations.created_at, generations.id)
       ) END AS queue_position
       FROM generations WHERE id = $1 AND user_id = $2`,
    [id, userId, since],
  );
  if (!row) return null;
  const base: GenerationDetailRow = { ...rowToSummary(row), html: row.html, doc: row.doc_json };
  if (row.status === "QUEUED" && row.queue_position != null) {
    base.queuePosition = Number(row.queue_position);
    base.etaSec = queueEtaSec(base.queuePosition, env.queue);
  }
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

/**
 * Egasining ishi holati (`null` — qator yo'q yoki begona). `DELETE` route
 * bekor qilish ham, o'chirish ham o'tmaganda 404 va 409 ni shu bilan
 * ajratadi (BEA-12).
 */
export async function generationStatus(id: string, userId: string): Promise<JobStatus | null> {
  const row = await queryOne<{ status: JobStatus }>(
    "SELECT status FROM generations WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return row?.status ?? null;
}

export const CANCEL_REFUND_NOTE = "Foydalanuvchi bekor qildi";

/**
 * Navbatdagi ishni bekor qiladi va pulini QAYTARADI — bitta tranzaksiyada
 * (C25 qolgani). Faqat QUEUED ishni bekor qilish mumkin.
 *
 * Ilgari REVOKED alohida COMMIT bo'lib, pul route'da keyin qaytardi: orada
 * xato (ulanish uzilishi, process o'limi) bo'lsa ish REVOKED, pul esa
 * qaytmagan qolardi — tiklash skaneri (`refund-reconcile.ts`) faqat
 * FAILED ni ko'radi, qayta DELETE esa QUEUED topolmay hech narsa qilmasdi.
 * Endi biri yiqilsa ikkalasi ham bekor: ish QUEUED qoladi va foydalanuvchi
 * qayta bekor qila oladi. Qaytarish `reference` bo'yicha idempotent.
 */
export async function cancelGeneration(id: string, userId: string): Promise<boolean> {
  return transaction(async (client) => {
    const res = await client.query<{ id: string }>(
      `UPDATE generations
          SET status = 'REVOKED', step = 'Bekor qilindi', progress = 100, finished_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'QUEUED'
        RETURNING id`,
      [id, userId],
    );
    if (!res.rows[0]) return false;
    await refundInTx(client, userId, id, CANCEL_REFUND_NOTE);
    return true;
  });
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
    [id, workerId, Math.max(0, Math.min(99, Math.round(progress))), cleanText(safeSlice(step, 200))],
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
      toJsonb(live ?? null),
      Math.max(0, Math.min(99, Math.round(progress))),
      cleanText(safeSlice(step, 200)),
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
  /**
   * Shu CLAIMning to'siq tokeni — qatorga `locked_by` sifatida yozilgan
   * qiymat (C26). Ishga oid HAR yozuv (`setProgress`, `setLive`,
   * `heartbeat`, `setCost`, `commitJobResult`, `failJob`, `releaseJobs`)
   * aynan shu qiymat bilan to'siladi.
   */
  lease: string;
  /**
   * Claim paytidagi progress (BEB-07): qayta olingan ishda — oldingi
   * yurishning erishgan qiymati. Worker bundan PAST yozmaydi
   * (`monotonicProgress`), ya'ni foydalanuvchi progress orqaga ketganini
   * ko'rmaydi. Yo'q (eski test literal'lari) — 0.
   */
  progressFloor?: number;
  /** Ish avval boshlangan va qayta olingan (bosqich «Qayta boshlandi»). */
  restarted?: boolean;
};

/** Qayta olingan ishning bosqichi — progress eski qiymatga yetguncha shu matn turadi (BEB-07). */
export const RESTART_STEP = "Qayta boshlandi";

/**
 * Progress faqat oshadi (BEB-07). Yangi yurish eski qiymatdan past bo'lsa
 * qiymat `floor` da qoladi; qayta olingan ishda bosqich ham «Qayta
 * boshlandi» bo'lib turadi (aks holda «Reja tuzilmoqda · 60%» kabi
 * aralash holat chiqardi).
 */
export function monotonicProgress(
  job: Pick<ClaimedJob, "progressFloor" | "restarted">,
  progress: number,
  step: string,
): { progress: number; step: string } {
  const floor = job.progressFloor ?? 0;
  if (progress >= floor) return { progress, step };
  return { progress: floor, step: job.restarted ? RESTART_STEP : step };
}

/**
 * Har claim uchun YANGI to'siq tokeni (C26: CONC-06).
 *
 * Ilgari token process bo'yicha edi (`WORKER_ID`): process o'z ishini
 * qayta olsa (qulf yo'qolib, housekeeping qayta navbatga qo'ygach) eski va
 * yangi yurish bir xil `locked_by` ni ko'tarardi — eski yurish yangi
 * claim ustidan ishni yakunlar, keyin yangisi natijani o'chirardi.
 * Tasodifiy qo'shimcha har claimni noyob qiladi; boshidagi `workerId`
 * jurnal va tashxis uchun (kimning claimi ekani ko'rinsin).
 */
export function newLease(workerId: string): string {
  return `${workerId}:${randomUUID()}`;
}

/**
 * Navbatdan bitta ish oladi.
 *
 * `lease` — qatorga `locked_by` sifatida yoziladigan to'siq tokeni. U HAR
 * claim uchun noyob bo'lishi SHART (`newLease`); worker aynan shunday
 * chaqiradi. Qaytgan `ClaimedJob.lease` — shu qiymat.
 *
 * `FOR UPDATE SKIP LOCKED` — bir nechta worker parallel ishlaganda
 * bir vazifani ikki marta bajarmaydi.
 *
 * ADOLAT (C16: CONC-07, SCALE-05): allaqachon ≥ `userMaxRunning` ta
 * IN_PROGRESS ishi bor foydalanuvchining navbatdagi ishlari o'tkazib
 * yuboriladi — ilgari global FIFO edi va bitta hisob ketma-ket ish tashlab
 * hamma slotni band qila olardi. Chegara YUMSHOQ: ikki worker bir lahzada
 * olsa bittaga oshishi mumkin (zararsiz). Foydalanuvchi abadiy och
 * qolmaydi — uning ishi tugashi bilan keyingisi yana navbatga kiradi,
 * bo'sh slot esa shu orada boshqalarga ketadi. Ichki sanoq
 * `generations_running_user_idx` (faqat IN_PROGRESS qatorlar, ≤ slotlar soni)
 * bo'ylab yuradi.
 *
 * PROGRESS (BEB-07): qayta olingan ish (`started_at` bor) progressini
 * YO'QOTMAYDI (`GREATEST`) va bosqichi «Qayta boshlandi» bo'ladi; qaytgan
 * `progressFloor` dan worker past yozmaydi (`monotonicProgress`).
 */
export async function claimJob(
  lease: string,
  opts: { userMaxRunning?: number } = {},
): Promise<ClaimedJob | null> {
  const cap = Math.max(1, Math.floor(opts.userMaxRunning ?? env.queue.userMaxInflight) || 1);
  const row = await queryOne<{
    id: string;
    user_id: string;
    tool_id: string;
    values_json: FormValues;
    price: string;
    attempts: number;
    budget_ms: number;
    progress: number;
    step: string;
  }>(
    `UPDATE generations g
        SET status = 'IN_PROGRESS',
            locked_by = $1,
            locked_at = now(),
            started_at = COALESCE(started_at, now()),
            attempts = attempts + 1,
            progress = GREATEST(g.progress, 5),
            step = CASE WHEN g.started_at IS NULL THEN 'Boshlandi' ELSE $3 END,
            live_json = NULL
      WHERE g.id = (
        SELECT q.id FROM generations q
         WHERE q.status = 'QUEUED' AND q.run_after <= now()
           AND (SELECT count(*) FROM generations r
                 WHERE r.status = 'IN_PROGRESS' AND r.user_id = q.user_id) < $2
         ORDER BY q.created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING g.id, g.user_id, g.tool_id, g.values_json, g.price, g.attempts, g.budget_ms, g.progress, g.step`,
    [lease, cap, RESTART_STEP],
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
    lease,
    progressFloor: Number(row.progress) || 0,
    restarted: row.step === RESTART_STEP,
  };
}

/**
 * SIGTERM (deploy): shu process ushlab turgan claimlarni DARHOL navbatga
 * qaytaradi (C14: INFRA-02, CONC-03, DB-05).
 *
 * Ilgari process 2 s dan keyin shunchaki chiqib ketardi: ish
 * `IN_PROGRESS` bo'lib, o'lik qulf bilan `budget + 30 s` (2–12.5 daqiqa)
 * turib qolardi, keyin boshidan qayta bajarilib provayderga ikki marta
 * pul to'lanardi. Endi:
 *   - faqat SHU claimlar (`locked_by = ANY(leases)`) — begona ishga tegilmaydi;
 *   - `attempts - 1`: deploy urinish hisoblanmaydi (claim uni oshirgan edi),
 *     ya'ni ikki deploy ishni «Ish vaqti tugadi» bilan yiqitmaydi;
 *   - qulf va `run_after` darhol bo'shaydi — boshqa worker shu zahoti oladi;
 *   - `live_json` tozalanadi (eski yurishning jonli dekasi ko'rinmasin).
 * Qaytaradi: qaytarilgan ishlar id si.
 */
export async function releaseJobs(leases: string[]): Promise<string[]> {
  if (!leases.length) return [];
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET status = 'QUEUED', locked_by = NULL, locked_at = NULL,
            run_after = now(), attempts = GREATEST(attempts - 1, 0),
            step = 'Qayta navbatga qo''yildi', live_json = NULL
      WHERE locked_by = ANY($1::text[]) AND status = 'IN_PROGRESS'
      RETURNING id`,
    [leases],
  );
  return rows.map((r) => r.id);
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

export type JobResult = {
  html: string;
  doc: AcademicDoc | null;
  fileName: string;
  preview: GenerationPreview | null;
  /** Va'da qilinganidan kam yetkazilgan bo'lsa (AUDIT-6 C7). */
  delivered?: Delivered;
};

export async function completeJob(id: string, workerId: string, result: JobResult): Promise<boolean> {
  const rows = await query<{ id: string }>(COMPLETE_SQL, completeParams(id, workerId, result));
  return rows.length > 0;
}

/**
 * Natijani (fayl + aktivlar + COMPLETED) BITTA tranzaksiyada yozadi —
 * FAQAT qulf hali shu claimda bo'lsa (C26: CONC-06; BEB-01 bilan bir yo'l).
 *
 * Ilgari tartib «fayl/aktiv yoz → `completeJob` → yutqazsa hammasini
 * o'chir» edi: qulfi yo'qolgan eski yurish yangi yurishning TAYYOR faylini
 * bosib yozar, keyin fayl va BARCHA aktivlarni o'chirardi — pullik,
 * COMPLETED, lekin faylsiz ish. Endi avval qator `FOR UPDATE` bilan
 * qulflanib egalik tekshiriladi; ega bo'lmasak hech narsa yozilmaydi va
 * hech narsa o'chirilmaydi (`false` — natija tashlanadi). Yozuv o'rtasida
 * xato bo'lsa rollback — yarim natija (fayl bor, holat IN_PROGRESS) qolmaydi.
 *
 * Aktivlar `putAssets` bilan bir xil SQL (`ON CONFLICT DO NOTHING`,
 * kontent-manzilli id), faqat shu tranzaksiya client'i orqali.
 */
export async function commitJobResult(
  id: string,
  lease: string,
  file: { bytes: Uint8Array; mime: string; fileName: string },
  assets: PendingAsset[],
  result: JobResult,
): Promise<boolean> {
  return transaction(async (client) => {
    const own = await client.query(
      `SELECT 1 FROM generations WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS' FOR UPDATE`,
      [id, lease],
    );
    if (!own.rows[0]) return false;
    await putGenerationFile(id, file, client);
    for (const a of assets) {
      await client.query(
        `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at)
         VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (generation_id, asset_id) DO NOTHING`,
        [id, a.assetId, a.mime, a.bytes.byteLength, a.bytes],
      );
    }
    return completeInTx(client, id, lease, result);
  });
}

const COMPLETE_SQL = `UPDATE generations
        SET status = 'COMPLETED', progress = 100, step = 'Tayyor',
            html = $3, doc_json = $4, file_name = $5, preview = $6,
            format = COALESCE($7, format), delivered_json = $8,
            finished_at = now(), locked_by = NULL, locked_at = NULL, error = NULL,
            live_json = NULL
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING id`;

function completeParams(id: string, workerId: string, result: JobResult): unknown[] {
  return [
    id,
    workerId,
    cleanText(result.html),
    result.doc ? toJsonb(result.doc) : null,
    cleanText(result.fileName),
    result.preview ? toJsonb(result.preview) : null,
    formatOf(result.fileName),
    result.delivered ? toJsonb(result.delivered) : null,
  ];
}

async function completeInTx(client: PoolClient, id: string, workerId: string, result: JobResult): Promise<boolean> {
  const res = await client.query<{ id: string }>(COMPLETE_SQL, completeParams(id, workerId, result));
  return res.rows.length > 0;
}

/**
 * LLM sarf telemetriyasini yozadi (Maqola 2 / AUDIT-17, WP4).
 *
 * `completeJob`DAN OLDIN chaqirilishi kerak — u qulfni bo'shatadi
 * (`locked_by = NULL`), shundan keyin bu yozuv «qulf boshqada» deb
 * jim o'tib ketardi. `price`/kredit ga UMUMAN tegmaydi — faqat
 * kuzatuv (`scripts/cost-report.mts`). Qulf egasi tekshiriladi
 * (`setProgress` naqshi): boshqa worker/ish ustidan yozib yubormaydi;
 * `false` — chaqiruvchi (worker.ts) buni yutib, ishni yiqitmaydi.
 */
export async function setCost(id: string, workerId: string, cost: CostJson): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE generations
        SET cost_json = $3
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING id`,
    [id, workerId, toJsonb(cost)],
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
    [id, workerId, cleanText(safeSlice(message, 500))],
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
    const requeued = await client.query<{ id: string; attempts: number; user_id: string }>(
      `UPDATE generations
          SET status = 'QUEUED', locked_by = NULL, locked_at = NULL,
              run_after = now() + interval '5 seconds',
              step = 'Qayta navbatga qo''yildi',
              live_json = NULL
        WHERE status = 'IN_PROGRESS'
          AND attempts < 2
          AND ${staleFilter}
        RETURNING id, attempts, user_id`,
      [String(timeoutSec)],
    );
    // Ish izi (OBS-08): urinish o'lik deb topildi — keyingi urinishdan oldin jurnalga.
    for (const r of requeued.rows) {
      log("warn", "[jobs] osilib qolgan ish qayta navbatga qo'yildi", {
        jobId: r.id,
        userId: String(r.user_id),
        attempt: r.attempts,
        reason: "stale_lock",
      });
    }
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
/**
 * `opts.keepPrev` — `commitDocOps` BIRINCHI tahrirda (`doc_version = 0`)
 * beradi: `doc_prev` shu paytdagi `doc_json`ga (ya'ni tahrirdan OLDINGI
 * asl dekaga) o'rnatiladi. `COALESCE(doc_prev, doc_json)` — QO'SHIMCHA
 * himoya: `commitDocOps` chaqiruv joyi buzilib har tahrirda `true`
 * bersa ham, bir marta yozilgan `doc_prev` USTIDAN yozilmaydi
 * (`014_doc_prev.sql`).
 */
export async function updateGenerationDoc(
  client: PoolClient,
  id: string,
  userId: string,
  expectedVersion: number,
  patch: { doc: AcademicDoc; html: string; preview: GenerationPreview | null },
  opts?: { keepPrev?: boolean },
): Promise<number | null> {
  const keepPrevSql = opts?.keepPrev ? ", doc_prev = COALESCE(doc_prev, doc_json)" : "";
  const res = await client.query<{ doc_version: number }>(
    `UPDATE generations
        SET doc_json = $3, html = $4, preview = $5, doc_version = doc_version + 1, edited_at = now()${keepPrevSql}
      WHERE id = $1 AND user_id = $2 AND status = 'COMPLETED' AND doc_version = $6
      RETURNING doc_version`,
    [
      id,
      userId,
      toJsonb(patch.doc),
      cleanText(patch.html),
      patch.preview ? toJsonb(patch.preview) : null,
      expectedVersion,
    ],
  );
  return res.rows[0]?.doc_version ?? null;
}

/** `POST …/doc/restore` uchun: `doc_prev` bormi, restore mumkinmi. */
export async function getGenerationForRestore(
  id: string,
  userId: string,
): Promise<{ docPrev: AcademicDoc | null; docVersion: number; status: JobStatus } | null> {
  const row = await queryOne<{ doc_prev: AcademicDoc | null; doc_version: number; status: JobStatus }>(
    `SELECT doc_prev, doc_version, status FROM generations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) return null;
  return { docPrev: row.doc_prev, docVersion: row.doc_version, status: row.status };
}

/**
 * Dekani `doc_prev`ga QAYTARADI — SQL ICHIDA (`doc_json = doc_prev`),
 * ya'ni ikkinchi o'qishga hojat yo'q va poyga (asl qiymat o'zgargan
 * bo'lishi mumkin) yo'q: yozilayotgan qiymat aynan HOZIRGI qatordan
 * olinadi. `doc_prev IS NOT NULL` predikati — bo'sh restore 0 qator
 * qaytaradi, chaqiruvchi buni 409 `no_prev`ga aylantiradi.
 */
export async function restoreGenerationDoc(
  client: PoolClient,
  id: string,
  userId: string,
  patch: { html: string; preview: GenerationPreview | null },
): Promise<number | null> {
  const res = await client.query<{ doc_version: number }>(
    `UPDATE generations
        SET doc_json = doc_prev, html = $3, preview = $4, doc_version = doc_version + 1, edited_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'COMPLETED' AND doc_prev IS NOT NULL
      RETURNING doc_version`,
    [id, userId, cleanText(patch.html), patch.preview ? toJsonb(patch.preview) : null],
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
