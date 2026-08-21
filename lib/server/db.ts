import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

/**
 * Postgres ulanish hovuzi va migratsiya yurituvchi.
 *
 * Next.js dev rejimida modul qayta yuklanadi, shuning uchun hovuz
 * `globalThis` da saqlanadi — aks holda har HMR da yangi hovuz ochilib,
 * Postgres ulanish limitiga urilamiz.
 */

type Globals = typeof globalThis & {
  __slaydxPool?: Pool;
  __slaydxMigrated?: Promise<void>;
};

const g = globalThis as Globals;

export function pool(): Pool {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL sozlanmagan — .env faylini tekshiring");
  }
  if (!g.__slaydxPool) {
    g.__slaydxPool = new Pool({
      connectionString: env.databaseUrl,
      max: env.databasePoolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Bitta so'rov butun hovuzni band qilib qo'ymasin. Katta BYTEA
      // o'qish ham 30 soniyaga bemalol sig'adi.
      statement_timeout: 30_000,
      query_timeout: 35_000,
      // Kutib qolgan tranzaksiya qulflarni ushlab turmasin.
      idle_in_transaction_session_timeout: 60_000,
      application_name: "slaydx",
      // Boshqarilgan Postgres (Neon, Supabase, DO) odatda TLS talab qiladi,
      // lekin o'z sertifikati bilan. `sslmode` ni URL belgilaydi.
      ssl: /sslmode=(require|verify)/.test(env.databaseUrl)
        ? { rejectUnauthorized: false }
        : undefined,
    });
    // Bo'sh ulanishdagi xato butun processni yiqitmasin.
    g.__slaydxPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return g.__slaydxPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool().query<T>(text, params as never[]);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Tranzaksiya. Callback xato tashlasa ROLLBACK qilinadi.
 *
 * Kredit yechish/qaytarish shu yerdan o'tishi shart — aks holda
 * balans yangilanib, jurnal yozilmay qolishi mumkin.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ulanish allaqachon uzilgan bo'lishi mumkin — asosiy xatoni yashirmaymiz.
    }
    throw e;
  } finally {
    client.release();
  }
}

const MIGRATIONS_DIR = path.join(process.cwd(), "lib", "server", "migrations");

/**
 * Migratsiyalarni ketma-ket qo'llaydi.
 *
 * Bir nechta instansiya bir vaqtda ko'tarilishi mumkin, shuning uchun
 * advisory lock olinadi — ikkita process bir xil faylni qo'llamaydi.
 */
export async function migrate(): Promise<void> {
  const client = await pool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [727_000_001]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[db] migratsiya qo'llandi: ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migratsiya xatosi (${file}): ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [727_000_001]).catch(() => {});
    client.release();
  }
}

/** Har so'rovda emas, process boshiga bir marta migratsiya qiladi. */
export function ensureMigrated(): Promise<void> {
  if (!g.__slaydxMigrated) {
    g.__slaydxMigrated = migrate().catch((e) => {
      // Keyingi so'rov qayta urinsin — muzlatib qo'ymaymiz.
      g.__slaydxMigrated = undefined;
      throw e;
    });
  }
  return g.__slaydxMigrated;
}
