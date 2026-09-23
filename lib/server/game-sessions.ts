import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, queryOne } from "./db";
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
 */
export function ipHash(ip: string): string {
  return createHash("sha256").update(`${process.env.SESSION_SECRET ?? "slaydx"}:${ip}`).digest("hex").slice(0, 32);
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
 * Natijalar (EGASI).
 *
 * Egalik yana SQL da: `JOIN game_sessions … WHERE s.user_id = $2`.
 * Sessiya id sini bilgan begona foydalanuvchi natijalarni ololmaydi.
 */
export async function listResults(generationId: string, userId: string, limit = 500): Promise<GameResult[]> {
  const rows = await query<{
    id: string;
    player_name: string;
    score: number;
    total: number;
    seconds: number;
    answers_json: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `SELECT r.id, r.player_name, r.score, r.total, r.seconds, r.answers_json, r.created_at
       FROM game_results r
       JOIN game_sessions s ON s.id = r.session_id
      WHERE s.generation_id = $1 AND s.user_id = $2
      ORDER BY r.created_at DESC
      LIMIT $3`,
    [generationId, userId, Math.max(1, Math.min(2000, limit))],
  );
  return rows.map((r) => ({
    id: r.id,
    playerName: r.player_name,
    score: Number(r.score),
    total: Number(r.total),
    seconds: Number(r.seconds),
    answers: r.answers_json ?? {},
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Natijani yozadi (OCHIQ tomon).
 *
 * `sessionId` — `getGameSessionByToken` qaytargan qator, ya'ni token
 * allaqachon tekshirilgan. Ism bu yerda KESILADI: chegara ikki joyda
 * (route va baza) bo'lsa, ular ajralib ketardi.
 */
export async function addResult(input: {
  sessionId: string;
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
  const r = await queryOne<{
    id: string;
    player_name: string;
    score: number;
    total: number;
    seconds: number;
    answers_json: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `INSERT INTO game_results (id, session_id, player_name, score, total, answers_json, seconds, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id, player_name, score, total, seconds, answers_json, created_at`,
    [randomUUID(), input.sessionId, name, score, total, toJsonb(input.answers ?? {}), seconds, input.ipHash ?? null],
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

/** Muddati o'tgan havolalarni tozalaydi (worker `housekeeping`). */
export async function purgeExpiredSessions(): Promise<void> {
  await query(`DELETE FROM game_sessions WHERE expires_at IS NOT NULL AND expires_at < now()`);
}
