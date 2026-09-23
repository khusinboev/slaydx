import "server-only";
import { readFile, readdir } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { Client, Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import { env } from "./env";

/**
 * Postgres ulanish hovuzi va migratsiya yurituvchi.
 *
 * Next.js dev rejimida modul qayta yuklanadi, shuning uchun hovuz
 * `globalThis` da saqlanadi — aks holda har HMR da yangi hovuz ochilib,
 * Postgres ulanish limitiga urilamiz.
 */

type PoolPressure = { lastWarn: number; suppressed: number; peak: number };

type Globals = typeof globalThis & {
  __slaydxPool?: Pool;
  __slaydxMigrated?: Promise<void>;
  __slaydxPoolPressure?: PoolPressure;
};

const g = globalThis as Globals;

/**
 * Ixtiyoriy millisoniya sozlamasi. `env.ts` da hali yo'q — hovuz vaqt
 * chegaralari faqat shu faylda ishlatiladi (C33, DB-08).
 */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * Bu process kim: `web` (Next.js server, inline worker ham shu yerda),
 * `worker` (`scripts/worker.ts`), `migrate` (`npm run db:migrate`) yoki
 * `cli` (admin skriptlari, testlar). `pg_stat_activity.application_name`
 * shu nom bilan to'ladi — ulanishlarni kim ushlab turgani darhol ko'rinadi.
 */
export function processRole(
  argv: readonly string[] = process.argv,
  e: Record<string, string | undefined> = process.env,
): "web" | "worker" | "migrate" | "cli" {
  if (e.NEXT_RUNTIME) return "web";
  const script = path.basename(argv[1] ?? "");
  if (/worker/i.test(script)) return "worker";
  if (/migrate/i.test(script)) return "migrate";
  if (/^server\.js$|next/i.test(script)) return "web";
  return "cli";
}

/**
 * `slaydx-<rol>@<host>`. Docker'da host = konteyner id, ya'ni ikki worker
 * replikasi ham bir-biridan ajraladi. Postgres 63 belgidan keyin kesadi.
 */
function appName(suffix = ""): string {
  const host = hostname().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24);
  return `slaydx-${processRole()}${host ? `@${host}` : ""}`.slice(0, 63 - suffix.length) + suffix;
}

function sslFor(url: string): PoolConfig["ssl"] {
  // Boshqarilgan Postgres (Neon, Supabase, DO) odatda TLS talab qiladi,
  // lekin o'z sertifikati bilan. `sslmode` ni URL belgilaydi.
  return /sslmode=(require|verify)/.test(url) ? { rejectUnauthorized: false } : undefined;
}

/**
 * Hovuz sozlamasi (C33, DB-08). Hajm — `DATABASE_POOL_MAX`; vaqt
 * chegaralari — `DATABASE_STATEMENT_TIMEOUT_MS` (standart 30 s) va
 * `DATABASE_CONNECT_TIMEOUT_MS` (standart 5 s: hovuz to'lganda so'rov
 * 10 s osilib turgandan ko'ra tezroq xato qaytgani yaxshi).
 */
export function poolConfig(): PoolConfig {
  const statementTimeout = envMs("DATABASE_STATEMENT_TIMEOUT_MS", 30_000);
  return {
    connectionString: env.databaseUrl,
    max: env.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: envMs("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
    // Bitta so'rov butun hovuzni band qilib qo'ymasin. Katta BYTEA
    // o'qish ham 30 soniyaga bemalol sig'adi.
    statement_timeout: statementTimeout,
    // Mijoz tomoni chegarasi server chegarasidan biroz katta — odatda
    // server o'zi bekor qiladi, bu faqat tarmoq uzilganda ishga tushadi.
    // 0 — «chegara yo'q»: mijoz tomonida ham yo'q (aks holda 0 + 5 s = 5 s).
    query_timeout: statementTimeout > 0 ? statementTimeout + 5_000 : undefined,
    // Kutib qolgan tranzaksiya qulflarni ushlab turmasin.
    idle_in_transaction_session_timeout: 60_000,
    application_name: appName(),
    // NAT/Docker tarmog'i bo'sh ulanishni jimgina uzib qo'ymasin.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ssl: sslFor(env.databaseUrl),
  };
}

export function pool(): Pool {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL sozlanmagan — .env faylini tekshiring");
  }
  if (!g.__slaydxPool) {
    g.__slaydxPool = new Pool(poolConfig());
    // Bo'sh ulanishdagi xato butun processni yiqitmasin.
    g.__slaydxPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return g.__slaydxPool;
}

/** Hovuz to'lishi haqida ogohlantirishlar oralig'i — jurnalni to'ldirmaslik uchun. */
const POOL_WARN_EVERY_MS = 60_000;

/**
 * Hovuz to'lganini qayd etadi (C33): so'rov berilgandan keyin, `setImmediate`
 * da tekshiriladi.
 *
 * Shu lahzaning o'zida o'qish NOTO'G'RI: `pg-pool` bo'sh ulanish bo'lsa ham
 * so'rovni avval navbatga qo'yadi va ulanishni `process.nextTick` da beradi
 * — iliq, bo'sh hovuzda ham `waitingCount = 1` ko'rinardi (review R1, soxta
 * «hovuz to'lgan»); aksincha, bir zumda kelgan to'lqinda `idleCount` hali
 * kamaymagan bo'ladi va haqiqiy to'lish ko'rinmasdi. `setImmediate` —
 * barcha `nextTick` lardan keyin: hovuz berishi mumkin bo'lgan hamma
 * ulanishni bergan. Shunda ham kutayotgan bo'lsa, bo'sh ulanish yo'q va
 * yangisini ochib bo'lmasa (`totalCount >= max`) — bu haqiqiy to'lish.
 */
function schedulePoolPressureCheck(p: Pool): void {
  setImmediate(() => notePoolPressure(p));
}

/**
 * Ogohlantirish daqiqasiga ko'pi bilan bitta; oradagi holatlar soni va
 * eng katta navbat keyingisida aytiladi.
 */
function notePoolPressure(p: Pool): void {
  const waiting = p.waitingCount;
  if (waiting === 0 || p.idleCount > 0 || p.totalCount < env.databasePoolMax) return;
  const st = (g.__slaydxPoolPressure ??= { lastWarn: 0, suppressed: 0, peak: 0 });
  st.peak = Math.max(st.peak, waiting);
  const now = Date.now();
  if (now - st.lastWarn < POOL_WARN_EVERY_MS) {
    st.suppressed++;
    return;
  }
  const extra = st.suppressed
    ? `; oldingi ogohlantirishdan beri yana ${st.suppressed} marta, eng ko'pi ${st.peak}`
    : "";
  console.warn(
    `[db] hovuz to'lgan: ${waiting} so'rov ulanish kutmoqda ` +
      `(ulanishlar ${p.totalCount}/${env.databasePoolMax}, bo'sh ${p.idleCount}${extra})`,
  );
  st.lastWarn = now;
  st.suppressed = 0;
  st.peak = 0;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = pool();
  const pending = p.query<T>(text, params as never[]);
  schedulePoolPressureCheck(p);
  const res = await pending;
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
  const p = pool();
  const pending = p.connect();
  schedulePoolPressureCheck(p);
  const client = await pending;
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

/** Migratsiya advisory qulfi — web, worker va `db:migrate` uchun umumiy. */
const MIGRATION_LOCK_ID = 727_000_001;

export type MigrateOptions = {
  /** Migratsiya papkasi (standart: `<cwd>/lib/server/migrations`). */
  dir?: string;
  /**
   * Boshqa process migratsiya qilayotganda advisory qulfni qancha kutish.
   * Uzun (10 daqiqa): web va worker birga ko'tariladi, yutqazgani
   * g'olibning migratsiyasi tugashini KUTISHI kerak — yiqilishi emas.
   */
  lockWaitMs?: number;
  /**
   * Bitta migratsiya jadval qulfini qancha kutadi. Qisqa: `ALTER TABLE`
   * ACCESS EXCLUSIVE navbatida turganda shu jadvalga BARCHA so'rovlar
   * uning orqasida kutadi — trafikni uzoq to'xtatmaslik uchun tez voz
   * kechib, birozdan keyin qayta urinamiz.
   */
  lockTimeoutMs?: number;
  /** `lock_timeout` bo'lganda bitta fayl jami necha marta uriniladi. */
  lockRetries?: number;
  /** Urinishlar orasidagi kutish (har urinishda chiziqli o'sadi). */
  lockRetryDelayMs?: number;
  /** Migratsiya statement chegarasi; 0 — cheksiz (qulf kutishlari baribir chegaralangan). */
  statementTimeoutMs?: number;
};

/** Postgres `lock_not_available` — `lock_timeout` tugadi. */
const LOCK_NOT_AVAILABLE = "55P03";
const isLockTimeout = (e: unknown) => (e as { code?: string } | null)?.code === LOCK_NOT_AVAILABLE;

/**
 * Migratsiyalarni ketma-ket qo'llaydi.
 *
 * Bir nechta instansiya bir vaqtda ko'tarilishi mumkin, shuning uchun
 * advisory lock olinadi — ikkita process bir xil faylni qo'llamaydi.
 *
 * ALOHIDA ulanish, hovuzdan emas (C32: DB-07, CONC-12): hovuzning 30 s
 * `statement_timeout`/`query_timeout` i migratsiyaga tegishli emas —
 * ilgari qulf kutishi ham, uzoq indeks qurish ham 30 s da bekor qilinardi
 * va web/worker poygasida yutqazgan process ishga tushmay qolardi. Endi
 * har kutishning o'z chegarasi bor: advisory qulf — `lockWaitMs`, jadval
 * qulflari — `lockTimeoutMs` (qayta urinish bilan).
 *
 * Xato bo'lsa aniq `Error` tashlanadi; web (`instrumentation.ts`) va
 * worker prod da processdan chiqadi (W2-D1), Docker qayta ko'taradi.
 */
export async function migrate(opts: MigrateOptions = {}): Promise<void> {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL sozlanmagan — .env faylini tekshiring");
  }
  const dir = opts.dir ?? path.join(process.cwd(), "lib", "server", "migrations");
  const lockWaitMs = opts.lockWaitMs ?? 10 * 60_000;
  const lockTimeoutMs = opts.lockTimeoutMs ?? 10_000;
  const lockRetries = Math.max(1, opts.lockRetries ?? 5);
  const retryDelayMs = opts.lockRetryDelayMs ?? 3_000;
  const statementTimeoutMs = opts.statementTimeoutMs ?? 0;

  const client = new Client({
    connectionString: env.databaseUrl,
    connectionTimeoutMillis: envMs("DATABASE_CONNECT_TIMEOUT_MS", 5_000),
    application_name: appName("-migrate"),
    keepAlive: true,
    ssl: sslFor(env.databaseUrl),
  });
  // Ulanish uzilsa navbatdagi `query` xato qaytaradi; hodisa processni yiqitmasin.
  client.on("error", (err) => {
    console.error("[db] migratsiya ulanishi xatosi:", err.message);
  });
  await client.connect();
  let locked = false;
  try {
    await client.query("SELECT set_config('statement_timeout', $1, false)", [`${statementTimeoutMs}ms`]);

    const got = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [
      MIGRATION_LOCK_ID,
    ]);
    if (!got.rows[0]?.ok) {
      const t0 = Date.now();
      console.log(
        `[db] migratsiya qulfi band — boshqa process migratsiya qilmoqda, ` +
          `${Math.round(lockWaitMs / 1000)} s gacha kutamiz`,
      );
      // `lock_timeout` advisory qulf kutishini ham cheklaydi.
      await client.query("SELECT set_config('lock_timeout', $1, false)", [`${lockWaitMs}ms`]);
      try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
      } catch (e) {
        if (isLockTimeout(e)) {
          throw new Error(
            `Migratsiya qulfi ${Math.round(lockWaitMs / 1000)} s ichida bo'shamadi — boshqa process ` +
              `hali migratsiya qilmoqda yoki osilib qolgan (pg_locks: advisory, objid=${MIGRATION_LOCK_ID})`,
          );
        }
        throw e;
      }
      console.log(`[db] migratsiya qulfi olindi (${Math.round((Date.now() - t0) / 1000)} s kutildi)`);
    }
    locked = true;
    await client.query("SELECT set_config('lock_timeout', $1, false)", [`${lockTimeoutMs}ms`]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Qulf OLINGANDAN KEYIN o'qiladi: g'olib qo'llagan fayllar bu yerda
    // allaqachon bor, yutqazgan ularni qayta qo'llamaydi.
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      const t0 = Date.now();
      for (let attempt = 1; ; attempt++) {
        await client.query("BEGIN");
        try {
          // Fayl o'zi `SET LOCAL lock_timeout` bersa — o'shanisi ustun.
          await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`]);
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
          await client.query("COMMIT");
          console.log(`[db] migratsiya qo'llandi: ${file} (${Date.now() - t0} ms)`);
          break;
        } catch (e) {
          await client.query("ROLLBACK").catch((re: Error) => {
            console.error(`[db] ROLLBACK bajarilmadi (${file}):`, re.message);
          });
          if (isLockTimeout(e) && attempt < lockRetries) {
            const wait = retryDelayMs * attempt;
            console.warn(
              `[db] migratsiya ${file}: jadval qulfi band (lock_timeout), urinish ` +
                `${attempt}/${lockRetries} — ${wait} ms dan keyin qayta urinamiz`,
            );
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          throw new Error(`Migratsiya xatosi (${file}): ${(e as Error).message}`);
        }
      }
    }
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch((e: Error) => {
        // Ulanish yopilganda sessiya qulfi baribir bo'shaydi.
        console.error("[db] migratsiya qulfi qo'yib yuborilmadi:", e.message);
      });
    }
    await client.end().catch((e: Error) => {
      console.error("[db] migratsiya ulanishi yopilmadi:", e.message);
    });
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
