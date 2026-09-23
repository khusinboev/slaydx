import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * MIGRATSIYALAR (AUDIT-22 R0).
 *
 * Migratsiyalar `db.ts migrate()` bilan NOMI bo'yicha tartiblanib
 * qo'llanadi va bir marta qo'llangan fayl QAYTA o'zgartirilmasligi
 * kerak. Shu ikki qoida buzilganda xato faqat PRODDA ko'rinadi
 * («column does not exist»), shuning uchun ular shu yerda qulflanadi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `021_games.sql` fayl nomi `21_games.sql` qilindi (nol yo'qoldi) —
 *      «raqamlash ketma-ket va uch xonali» testi;
 *   2. `game_results` dan `ON DELETE CASCADE` olib tashlandi —
 *      «generatsiya o'chsa natijalar ham o'chadi» testi;
 *   3. `game_sessions.token` dan `UNIQUE` tushdi — «token noyob» testi;
 *   4. `021` da `CREATE TABLE` `IF NOT EXISTS` siz yozildi — «qayta
 *      qo'llash xavfsiz» testi.
 */

const DIR = path.resolve(new URL("../lib/server/migrations", import.meta.url).pathname);
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => readFileSync(path.join(DIR, f), "utf8");

test("fayl nomlari: uch xonali raqam + tavsif, ketma-ket va takrorsiz", () => {
  assert.ok(FILES.length >= 21, `migratsiyalar soni: ${FILES.length}`);
  const nums = FILES.map((f) => {
    const m = f.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
    assert.ok(m, `fayl nomi shakli buzilgan: ${f}`);
    return Number(m![1]);
  });
  assert.equal(new Set(nums).size, nums.length, "takroriy raqam — qo'llash tartibi noaniq bo'lardi");
  for (let i = 1; i < nums.length; i++) {
    assert.equal(nums[i], nums[i - 1] + 1, `raqamlashda uzilish: ${FILES[i - 1]} → ${FILES[i]}`);
  }
  // Tartib LEKSIKOGRAFIK — `migrate()` aynan shunday saralaydi.
  assert.deepEqual(FILES, [...FILES].sort());
});

test("AUDIT-22: `021_games.sql` ro'yxatda", () => {
  assert.ok(FILES.includes("021_games.sql"), "021_games.sql yo'q");
  // Oldingi sprintning oxirgisi joyida (eski fayl o'chirilmagan).
  assert.ok(FILES.includes("020_article.sql"));
});

test("C34: `024_idempotency.sql` oxirgisi — NULL-li kalit, (user_id, kalit) qisman UNIQUE, rollback izohda", () => {
  assert.equal(FILES[FILES.length - 1], "024_idempotency.sql", "yangi migratsiya oxirgi bo'lishi kerak");
  const sql = sqlOf("024_idempotency.sql");
  // Faqat NULL-li, standartsiz ustun — eski kod uni bilmasa ham ishlaydi, jadval qayta yozilmaydi.
  assert.match(sql, /ALTER TABLE generations ADD COLUMN IF NOT EXISTS idempotency_key UUID;/);
  // MUTATSIYA: UNIQUE tushsa — parallel takror ikkinchi pullik ish yaratardi.
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS generations_user_idem_idx\s+ON generations \(user_id, idempotency_key\)\s+WHERE idempotency_key IS NOT NULL;/,
  );
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
  assert.match(sql, /--\s+DROP INDEX IF EXISTS generations_user_idem_idx;/);
  assert.match(sql, /--\s+ALTER TABLE generations DROP COLUMN IF EXISTS idempotency_key;/);
  // `jobs.ts` 23505 ni aynan shu indeks nomi bilan taniydi.
  const jobs = readFileSync(path.resolve(DIR, "../jobs.ts"), "utf8");
  assert.match(jobs, /err\.constraint === "generations_user_idem_idx"/);
});

test("C23: `022_retention.sql` orqaga mos va qayta qo'llash xavfsiz", () => {
  assert.ok(FILES.includes("022_retention.sql"));
  const sql = sqlOf("022_retention.sql");
  // Faqat NULL-li ustun qo'shiladi — eski kod uni bilmasa ham ishlaydi.
  assert.match(sql, /ALTER TABLE generations ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ;/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS generations_retention_idx/);
  assert.match(sql, /WHERE status = 'COMPLETED' AND files_purged_at IS NULL/);
  // Pulni tiklash skaneri uchun indeks (review N3).
  assert.match(sql, /CREATE INDEX IF NOT EXISTS generations_failed_idx\s+ON generations \(finished_at\)\s+WHERE status = 'FAILED';/);
  // Uzoq tranzaksiya ACCESS EXCLUSIVE navbati bilan butun trafikni to'xtatmasin (review N4).
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
  // Rollback izohda yozilgan.
  assert.match(sql, /--\s+ALTER TABLE generations DROP COLUMN IF EXISTS files_purged_at;/);
  assert.match(sql, /--\s+DROP INDEX IF EXISTS generations_failed_idx;/);
});

test("021: ikkala jadval, ustunlar va indekslar to'liq", () => {
  const sql = sqlOf("021_games.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS game_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS game_results/);

  // `game_sessions` shartnomasi (AUDIT-22 §1).
  for (const col of ["id", "generation_id", "user_id", "token", "kind", "settings_json", "expires_at", "created_at"]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `game_sessions.${col} yo'q`);
  }
  // `game_results` shartnomasi.
  for (const col of ["session_id", "player_name", "score", "total", "answers_json", "seconds", "ip_hash"]) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `game_results.${col} yo'q`);
  }
  // MUTATSIYA: `UNIQUE` tushsa — ikki havola bitta tokenga ega bo'lardi.
  assert.match(sql, /token\s+TEXT NOT NULL UNIQUE/, "token noyob emas");
  // Indekslar: natijalar va havolalar DOIM bitta kalit bo'yicha o'qiladi.
  assert.match(sql, /CREATE INDEX IF NOT EXISTS game_sessions_generation_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS game_results_session_idx/);
});

test("021: kaskad o'chirish — hujjat o'chsa havola ham, natija ham qolmaydi", () => {
  const sql = sqlOf("021_games.sql");
  assert.match(sql, /generation_id\s+UUID NOT NULL REFERENCES generations\(id\) ON DELETE CASCADE/);
  assert.match(sql, /user_id\s+BIGINT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  // MUTATSIYA: natijalar sessiyaga kaskadsiz bog'lansa — o'chirilgan
  // havolaning natijalari «osilib» qolardi.
  assert.match(sql, /session_id\s+UUID NOT NULL REFERENCES game_sessions\(id\) ON DELETE CASCADE/);
});

test("021: qayta qo'llash xavfsiz va kengaytma talab qilmaydi", () => {
  const sql = sqlOf("021_games.sql");
  const creates = sql.match(/CREATE (TABLE|INDEX)[^;]*/g) ?? [];
  assert.ok(creates.length >= 4);
  for (const c of creates) assert.match(c, /IF NOT EXISTS/, `«IF NOT EXISTS» yo'q: ${c.slice(0, 60)}…`);
  /*
   * MUTATSIYA: `gen_random_uuid()` — Postgres versiyasiga/kengaytmaga
   * bog'liq; loyihada id ni DASTUR beradi (`generations` bilan bir xil).
   */
  // Izohlar tashlanadi: sabab AYNAN izohda tushuntirilgan bo'lishi mumkin.
  const code = sql.replace(/^\s*--.*$/gm, "");
  assert.ok(!/gen_random_uuid|uuid_generate_v4|CREATE EXTENSION/.test(code), "migratsiya kengaytmaga bog'lanib qoldi");
});

test("barcha migratsiyalar: bo'sh emas, izohli va `IF NOT EXISTS` bilan", () => {
  for (const f of FILES) {
    const sql = sqlOf(f);
    assert.ok(sql.trim().length > 40, `${f}: bo'sh`);
    assert.match(sql, /^--/m, `${f}: izoh yo'q — nega kerakligi yozilmagan`);
    for (const c of sql.match(/CREATE TABLE[^;]*/g) ?? []) {
      assert.match(c, /IF NOT EXISTS/, `${f}: «${c.slice(0, 40)}…» qayta qo'llashda yiqilardi`);
    }
  }
});
