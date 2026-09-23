import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
import { env } from "./env";
import { toJsonb } from "./jsonb";
import { cleanText, safeSlice } from "../generation/safe-text";
import type { AcademicDoc } from "../generation/types";
import { isPublicGameKind, type PublicGameKind } from "../game/public";

/**
 * O'YIN SESSIYALARI VA NATIJALARI (AUDIT-22 R0) — `021_games.sql` ning
 * server yarmi.
 *
 * `source-upload.ts` naqshi: bu fayl shartnomaning SERVER qismi (SQL,
 * token, egalik), autentifikatsiya (`requireUser`, `limit`) esa
 * route'da qoladi — Next `cookies()` faqat so'rov konteksti ichida
 * ishlaydi va uni test chaqira olmaydi.
 *
 * EGALIK SQL DARAJASIDA (CLAUDE.md qoidasi): egasi uchun har so'rovda
 * `WHERE … user_id = $n` bor. Ochiq tomon (`getGameSessionByToken`,
 * `addResult`) esa TOKEN bilan ishlaydi — u yerda foydalanuvchi yo'q.
 */

/** Havola muddati — 30 kun (tarqalib ketgan havola abadiy ochiq qolmasin). */
export const SESSION_TTL_DAYS = 30;

/** Ism uzunligi — o'quvchi kiritadi, jadvalga shu ko'rinishda tushadi. */
export const PLAYER_NAME_MAX = 40;

/**
 * Token uzunligi — 22 belgi (`randomBytes(16).base64url`).
 *
 * 128 bit entropiya: havola ochiq va LOGINSIZ, ya'ni uni topish
 * mumkin bo'lmasligi kerak. Qisqa token (masalan 8 belgi) sinfdagi
 * bolalar uchun ham «taxmin qilib ko'rish» ni real qilardi.
 */
export const TOKEN_CHARS = 22;

/** Faqat `base64url` alifbosi — route regexi ham shu (`/api/o/[token]`). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type GameSession = {
  id: string;
  generationId: string;
  userId: string;
  token: string;
  kind: PublicGameKind;
  settings: Record<string, unknown>;
  expiresAt: string | null;
  createdAt: string;
};

export type GameResult = {
  id: string;
  playerName: string;
  score: number;
  total: number;
  seconds: number;
  answers: Record<string, unknown>;
  createdAt: string;
};

/** Ochiq tomon uchun sessiya + hujjat (bitta so'rovda — ikkinchi SQL kerak emas). */
export type GameSessionWithDoc = GameSession & {
  doc: AcademicDoc | null;
  topic: string;
  status: string;
};

export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * IP xeshi — manzilning O'ZI saqlanmaydi (`021_games.sql` izohi).
 *
 * Tuz (`SESSION_SECRET`) bilan: xeshning o'zi ham lug'at hujumiga
 * (IPv4 fazosi kichik) ochiq bo'lmasin.
 *
 * `env.sessionSecret` orqali (DEPS-02) — `process.env.SESSION_SECRET ?? "slaydx"`
 * EMAS: bu modul ilgari `env.ts` ni import qilmagani uchun o'zining
 * qattiq yozilgan ("slaydx" — brend nomi, ya'ni TAXMIN QILINADIGAN) zaxira
 * tuziga ega edi — `session.ts hashIp` esa allaqachon `env.sessionSecret`
 * ishlatadi va prodda kalit yo'q/qisqa bo'lsa BALAND OVOZDA yiqiladi.
 */
export function ipHash(ip: string): string {
  return createHash("sha256").update(`${env.sessionSecret}:${ip}`).digest("hex").slice(0, 32);
}

const row = (r: {
  id: string;
  generation_id: string;
  user_id: string | number;
  token: string;
  kind: string;
  settings_json: Record<string, unknown> | null;
  expires_at: Date | null;
  created_at: Date;
}): GameSession => ({
  id: r.id,
  generationId: r.generation_id,
  userId: String(r.user_id),
  token: r.token,
  kind: (isPublicGameKind(r.kind) ? r.kind : "quiz") as PublicGameKind,
  settings: r.settings_json ?? {},
  expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
});

/**
 * Havola yaratadi (egasi).
 *
 * `INSERT … SELECT … WHERE generations.user_id = $` — egalik SQL
 * darajasida: begona generatsiya id si bilan kelgan so'rov hech qanday
 * qator yozmaydi va `null` qaytadi (route uni 404 ga aylantiradi).
 * Route darajasidagi tekshiruv yetarli deb hisoblanmaydi (AUDIT-4 N-1).
 */
export async function createGameSession(
  generationId: string,
  userId: string,
  kind: PublicGameKind,
  settings: Record<string, unknown> = {},
): Promise<GameSession | null> {
  const r = await queryOne<{
    id: string;
    generation_id: string;
    user_id: string;
    token: string;
    kind: string;
    settings_json: Record<string, unknown> | null;
    expires_at: Date | null;
    created_at: Date;
  }>(
    `INSERT INTO game_sessions (id, generation_id, user_id, token, kind, settings_json, expires_at)
     SELECT $1, g.id, g.user_id, $4, $5, $6::jsonb, now() + ($7 || ' days')::interval
       FROM generations g
      WHERE g.id = $2 AND g.user_id = $3 AND g.status = 'COMPLETED'
     RETURNING id, generation_id, user_id, token, kind, settings_json, expires_at, created_at`,
    [randomUUID(), generationId, userId, newToken(), kind, toJsonb(settings ?? {}), String(SESSION_TTL_DAYS)],
  );
  return r ? row(r) : null;
}

/**
 * Token bo'yicha sessiya + hujjat (OCHIQ tomon).
 *
 * Muddati o'tgan yoki mavjud bo'lmagan token — `null` (route 404).
 * Muddat SQL da tekshiriladi: server vaqti bilan baza vaqti farq
 * qilganda ham qoida BITTA joyda qolsin.
 */
export async function getGameSessionByToken(token: string): Promise<GameSessionWithDoc | null> {
  if (!TOKEN_RE.test(token)) return null;
  const r = await queryOne<{
    id: string;
    generation_id: string;
    user_id: string;
    token: string;
    kind: string;
    settings_json: Record<string, unknown> | null;
    expires_at: Date | null;
    created_at: Date;
    doc_json: AcademicDoc | null;
    topic: string;
    status: string;
  }>(
    `SELECT s.id, s.generation_id, s.user_id, s.token, s.kind, s.settings_json, s.expires_at, s.created_at,
            g.doc_json, g.topic, g.status
       FROM game_sessions s
       JOIN generations g ON g.id = s.generation_id
      WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())`,
    [token],
  );
  if (!r) return null;
  return { ...row(r), doc: r.doc_json, topic: r.topic, status: r.status };
}

/** Egasining havolalari (natijalar paneli uchun) — eng yangisi birinchi. */
export async function listGameSessions(generationId: string, userId: string): Promise<GameSession[]> {
  const rows = await query<{
    id: string;
    generation_id: string;
    user_id: string;
    token: string;
    kind: string;
    settings_json: Record<string, unknown> | null;
    expires_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, generation_id, user_id, token, kind, settings_json, expires_at, created_at
       FROM game_sessions
      WHERE generation_id = $1 AND user_id = $2
      ORDER BY created_at DESC`,
    [generationId, userId],
  );
  return rows.map(row);
}

/**
 * `listResults` kursor sahifasi — `(created_at, id)` bo'yicha (DB-15/BEA-16).
 *
 * `createdAt` — MIKROSONIYA aniqligidagi matn (`to_char … 'US'`), KO'RSATISH
 * uchun EMAS (`GameResult.createdAt` — `toISOString()`, millisoniya, faqat
 * ekran/CSV "Sana" ustuni uchun). Ikkalasi bir xil bo'lsa (Sharh R1),
 * `timestamptz` mikrosoniya aniqlikda saqlaydi, JS `Date`/`toISOString()`
 * esa millisoniyada kesadi: bitta millisoniyaga bir nechta natija tushsa
 * (sinf bitta zumda javob yuborsa), kursor ORTIDAGI qatorlarni "avvalgi
 * sahifada edi" deb JIMGINA tashlab ketardi — 1000 qatorlik CSV
 * partiyasi chegarasida aynan shu sodir bo'lardi.
 */
export type ResultsCursor = { createdAt: string; id: string };

export type ResultsPage = {
  rows: GameResult[];
  /** Generatsiyaning BARCHA havolalari bo'yicha HAQIQIY son — `rows.length` YO'Q, sahifa kesilgan. */
  total: number;
  /** Keyingi sahifa uchun kursor; oxirgi sahifada `null`. */
  nextCursor: ResultsCursor | null;
};

const DEFAULT_RESULTS_PAGE = 500;
const MAX_RESULTS_PAGE = 2000;

type ResultRow = {
  id: string;
  player_name: string;
  score: number;
  total: number;
  seconds: number;
  answers_json: Record<string, unknown> | null;
  created_at: Date;
  /** Mikrosoniya aniqlikdagi matn — FAQAT kursor uchun (`ResultsCursor` izohi). */
  cursor_at: string;
};

const toResult = (r: ResultRow): GameResult => ({
  id: r.id,
  playerName: r.player_name,
  score: Number(r.score),
  total: Number(r.total),
  seconds: Number(r.seconds),
  answers: r.answers_json ?? {},
  createdAt: r.created_at.toISOString(),
});

/**
 * Natijalar (EGASI), SAHIFALAB — DB-15/BEA-16.
 *
 * Ilgari standart `LIMIT 500` bilan JIMGINA kesilardi va `count` shu
 * kesilgan ro'yxatning uzunligi edi — bir nechta havolaga tarqalgan
 * test 500 dan ortiq natija yig'sa, eng ESKI qatorlar (va eksportdagi
 * "haqiqiy son") jimgina yo'qolardi. Endi `total` — HAQIQIY
 * `count(*)`, `nextCursor` esa keyingi sahifani so'rash uchun.
 *
 * Egalik yana SQL da: `JOIN game_sessions … WHERE s.user_id = $2`.
 * Sessiya id sini bilgan begona foydalanuvchi natijalarni ololmaydi.
 */
export async function listResults(
  generationId: string,
  userId: string,
  opts: { limit?: number; before?: ResultsCursor } = {},
): Promise<ResultsPage> {
  /*
   * `Math.floor` — `?limit=1.5` kabi butun bo'lmagan qiymat Postgres'ga
   * `LIMIT` sifatida ketsa, tur mos kelmasligidan 500 qaytarardi
   * (Sharh nit 1). `Number.isFinite` — `NaN`/`Infinity` standartga tushadi.
   */
  const rawLimit = Math.floor(opts.limit ?? DEFAULT_RESULTS_PAGE);
  const limit = Math.max(1, Math.min(MAX_RESULTS_PAGE, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_RESULTS_PAGE));
  const cursor = opts.before;
  /*
   * `to_char(… 'US')` — MIKROSONIYA aniqlikda (`ResultsCursor` izohi,
   * Sharh R1). Kursor qiyoslash ham shu ustunga emas, xom `r.created_at`
   * ga qarshi ($4 matn `::timestamptz` ga o'giriladi) — aniqlik
   * yo'qolmaydi, chunki `to_char` chiqargan matn `timestamptz`ning O'ZIGA
   * bir ma'noli mos keladi (millisoniyaga emas).
   */
  const CURSOR_COL = `to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`;
  const rows = await query<ResultRow>(
    cursor
      ? `SELECT r.id, r.player_name, r.score, r.total, r.seconds, r.answers_json, r.created_at, ${CURSOR_COL}
           FROM game_results r
           JOIN game_sessions s ON s.id = r.session_id
          WHERE s.generation_id = $1 AND s.user_id = $2
            AND (r.created_at, r.id) < ($4::timestamptz, $5)
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT $3`
      : `SELECT r.id, r.player_name, r.score, r.total, r.seconds, r.answers_json, r.created_at, ${CURSOR_COL}
           FROM game_results r
           JOIN game_sessions s ON s.id = r.session_id
          WHERE s.generation_id = $1 AND s.user_id = $2
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT $3`,
    cursor ? [generationId, userId, limit, cursor.createdAt, cursor.id] : [generationId, userId, limit],
  );
  const totalRow = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM game_results r
       JOIN game_sessions s ON s.id = r.session_id
      WHERE s.generation_id = $1 AND s.user_id = $2`,
    [generationId, userId],
  );
  const mapped = rows.map(toResult);
  const lastRaw = rows[rows.length - 1];
  return {
    rows: mapped,
    total: totalRow ? Number(totalRow.n) : mapped.length,
    // Sahifa TO'LIQ kelgan bo'lsagina keyingi bor deb taxmin qilamiz — bo'sh
    // yoki chala sahifa oxirni bildiradi (bitta ortiqcha `count` so'rovsiz).
    // MUTATSIYA: `lastRaw.cursor_at` o'rniga `mapped[…].createdAt` (millisoniya)
    // ishlatilsa — bir millisoniyaga tushgan qatorlar tashlab ketilardi (R1).
    nextCursor: rows.length === limit && lastRaw ? { createdAt: lastRaw.cursor_at, id: lastRaw.id } : null,
  };
}

/**
 * CSV eksporti uchun: BARCHA qatorlarni, kursor bo'yicha PARTIYALAB
 * (DB-15) — bitta katta massivni xotirada tutmasdan, route buni
 * to'g'ridan-to'g'ri `ReadableStream`ga yozadi.
 */
export async function* iterateAllResults(generationId: string, userId: string, batchSize = 1000): AsyncGenerator<GameResult[]> {
  let cursor: ResultsCursor | undefined;
  for (;;) {
    const page = await listResults(generationId, userId, { limit: batchSize, before: cursor });
    if (!page.rows.length) return;
    yield page.rows;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

/**
 * `iterateAllResults` ni BITTA-BITTA QATOR bilan tekislaydi — CSV route
 * `ReadableStream.pull()` ichida har chaqiruvda ANIQ bitta qator
 * so'raydi (Sharh R2): shu tarzda oqim ISTE'MOLCHI tayyor bo'lgandagina
 * navbatdagi natijani bazadan oladi (haqiqiy backpressure — `start()`da
 * hammasini bir yo'la navbatga qo'yish xotirani chegarasiz shishirardi).
 * Partiyalash (`batchSize`) ICHKARIDA qoladi — SQL so'rovlar soni
 * o'zgarmaydi, faqat iste'molchiga BERISH tezligi cheklanadi.
 */
export async function* iterateAllResultRows(generationId: string, userId: string, batchSize = 1000): AsyncGenerator<GameResult> {
  for await (const batch of iterateAllResults(generationId, userId, batchSize)) {
    for (const r of batch) yield r;
  }
}

/** Bitta havolaga (sessiyaga) qancha natija yozilishi mumkin — ABUSE-04. */
export const RESULT_CAP_PER_SESSION = 500;

/** Klient yuboradigan urinish id si (`crypto.randomUUID()`) — shakli. */
export const SUBMISSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `addResult` sessiya cheklamasiga yetganda otiladi — route buni 409 ga aylantiradi. */
export class ResultCapError extends Error {}

/**
 * Natijani yozadi (OCHIQ tomon).
 *
 * `sessionId` — `getGameSessionByToken` qaytargan qator, ya'ni token
 * allaqachon tekshirilgan. Ism bu yerda KESILADI: chegara ikki joyda
 * (route va baza) bo'lsa, ular ajralib ketardi.
 *
 * `submissionId` — IXTIYORIY (UX-06/ABUSE-04). Berilsa:
 *   1. AYNI `(session_id, submission_id)` bilan natija allaqachon
 *      yozilgan bo'lsa — YANGI qator YOZILMAYDI, o'sha (BIRINCHI)
 *      qator qaytadi: tarmoq uzilib "Qayta yuborish" bosilganda ikkinchi
 *      qator paydo bo'lmaydi va javob ikkala safar ham BIR XIL bo'ladi.
 *   2. Sessiyadagi natijalar soni `RESULT_CAP_PER_SESSION` ga yetgan
 *      bo'lsa — `ResultCapError` (yangi urinish, chegara).
 * Berilmasa (`jsonb-writes.test.mts` kabi eski chaqiruvchilar) — eski
 * xulq: cheklovsiz, shartsiz INSERT.
 */
export async function addResult(input: {
  sessionId: string;
  submissionId?: string;
  playerName: string;
  score: number;
  total: number;
  seconds: number;
  answers: Record<string, unknown>;
  ipHash?: string;
}): Promise<GameResult> {
  // `cleanText`: NUL (TEXT 22021) va yolg'iz surrogat ochiq endpoint'da 500 bermasin (C03, BEA-02).
  const name = cleanText(safeSlice(String(input.playerName ?? "").replace(/\s+/g, " ").trim(), PLAYER_NAME_MAX)) || "Noma'lum";
  const score = Math.max(0, Math.round(Number(input.score) || 0));
  const total = Math.max(0, Math.round(Number(input.total) || 0));
  const seconds = Math.max(0, Math.min(86_400, Math.round(Number(input.seconds) || 0)));
  const answersJsonb = toJsonb(input.answers ?? {});
  // Kichik harfga (Sharh R3): `SUBMISSION_ID_RE` `/i` bilan tekshiradi, lekin
  // UNIQUE indeks TEXT ustida REGISTRga SEZGIR — «bir xil» id turli holatda
  // (masalan zaxira generator katta harf bilan) ikkita QATOR yozardi.
  const submissionId = input.submissionId ? input.submissionId.trim().toLowerCase() : undefined;

  if (submissionId) {
    const bySubmission = `SELECT id, player_name, score, total, seconds, answers_json, created_at
                             FROM game_results WHERE session_id = $1 AND submission_id = $2`;
    const existing = await queryOne<ResultRow>(bySubmission, [input.sessionId, submissionId]);
    if (existing) return toResult(existing);

    const capRow = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM game_results WHERE session_id = $1`, [input.sessionId]);
    if (Number(capRow?.n ?? 0) >= RESULT_CAP_PER_SESSION) {
      throw new ResultCapError("Bu havola orqali natijalar soni chegarasiga yetdi");
    }

    const inserted = await queryOne<ResultRow>(
      `INSERT INTO game_results (id, session_id, player_name, score, total, answers_json, seconds, ip_hash, submission_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (session_id, submission_id) DO NOTHING
       RETURNING id, player_name, score, total, seconds, answers_json, created_at`,
      [randomUUID(), input.sessionId, name, score, total, answersJsonb, seconds, input.ipHash ?? null, submissionId],
    );
    if (inserted) return toResult(inserted);

    // Poyga: parallel so'rov BIZDAN OLDIN xuddi shu submissionId bilan yozdi
    // (`ON CONFLICT DO NOTHING` shuning uchun qator qaytarmadi) — o'sha qatorni
    // qaytaramiz, ikkinchisini YOZMAYMIZ (bir xil javob, C36 UX-06).
    const raced = await queryOne<ResultRow>(bySubmission, [input.sessionId, submissionId]);
    if (raced) return toResult(raced);
    /*
     * Amalda yetib bo'lmaydi (conflict bor demak qator ham bor edi, ikki
     * marta qayta o'qildi). `ResultCapError` EMAS (Sharh nit 4) — bu
     * chegara emas, kutilmagan ichki holat; `ResultCapError` bo'lsa route
     * uni 409 "chegaraga yetdi" deb noto'g'ri ko'rsatardi.
     */
    throw new Error("addResult: ON CONFLICT qator qaytarmadi, lekin qayta o'qishda ham topilmadi");
  }

  const r = await queryOne<ResultRow>(
    `INSERT INTO game_results (id, session_id, player_name, score, total, answers_json, seconds, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id, player_name, score, total, seconds, answers_json, created_at`,
    [randomUUID(), input.sessionId, name, score, total, answersJsonb, seconds, input.ipHash ?? null],
  );
  return {
    id: r?.id ?? "",
    playerName: name,
    score,
    total,
    seconds,
    answers: r?.answers_json ?? {},
    createdAt: r?.created_at ? r.created_at.toISOString() : new Date().toISOString(),
  };
}

/**
 * Muddati o'tgan havolalarni tozalaydi (worker `housekeeping`) — BEA-08.
 *
 * Ilgari SHARTSIZ o'chirardi, `game_results.session_id … ON DELETE
 * CASCADE` (`021_games.sql`) esa har o'quvchining natijasini sessiya
 * bilan birga olib tashlardi: havola MUDDATLI bo'lishi kerak edi,
 * NATIJALAR emas (ular o'qituvchiga — generatsiya o'zi muddatsiz,
 * `011_no_expiry.sql`). Shuning uchun endi NATIJASI BOR sessiya
 * o'chirilmaydi — faqat token endi ishlamaydi (`getGameSessionByToken`
 * dagi `expires_at > now()` sharti), natijalar esa generatsiya
 * o'chirilmaguncha turadi. Natijasiz (hech kim o'ynamagan) muddati
 * o'tgan havolalar — oldingidek tozalanadi.
 */
export async function purgeExpiredSessions(): Promise<void> {
  await query(
    `DELETE FROM game_sessions
      WHERE expires_at IS NOT NULL AND expires_at < now()
        AND NOT EXISTS (SELECT 1 FROM game_results r WHERE r.session_id = game_sessions.id)`,
  );
}
