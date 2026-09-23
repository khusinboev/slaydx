import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * C24 (`audit/designs/backups.md`): `scripts/backup.sh` / `restore-check.sh`.
 * Ilgari zaxira faqat qo'lda, deploy oldidan olinardi va tiklash hech qachon
 * sinalmagan edi (INFRA-05). Bu test skriptlarni (1) sintaksis darajasida
 * va (2) HAQIQIY, tashlab yuboriladigan Postgres konteynerga qarshi tekshiradi.
 *
 * Docker'ning o'zi shu muhitda ishlaydi (`docker version` bilan tekshiriladi);
 * bo'lmasa DB testlari o'tkazib yuboriladi. Konteynerlar `slaydx-backup-test-*`
 * nomi bilan, HAR DOIM `t.after`da o'chiriladi — boshqa (`slaydx-*` prod yoki
 * qo'shni loyiha) konteynerlariga UMUMAN tegilmaydi.
 */

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerAvailable();

test("backup.sh: bash -n sintaksis xato bermaydi", () => {
  execFileSync("bash", ["-n", "scripts/backup.sh"], { stdio: "pipe" });
});

test("restore-check.sh: bash -n sintaksis xato bermaydi", () => {
  execFileSync("bash", ["-n", "scripts/restore-check.sh"], { stdio: "pipe" });
});

test(
  "backup.sh: haqiqiy Postgres'dan tasdiqlangan dump yaratadi, aylanish eskirgan faylni o'chiradi, juda kichik dump XATO beradi",
  { skip: hasDocker ? false : "docker mavjud emas" },
  async (t: TestContext) => {
    const container = `slaydx-backup-test-${process.pid}`;
    t.after(() => {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch {
        // konteyner allaqachon yo'q bo'lishi mumkin — muammo emas
      }
    });

    execFileSync("docker", [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=test",
      "-e",
      "POSTGRES_USER=slaydx",
      "-e",
      "POSTGRES_DB=slaydx",
      "postgres:16-alpine",
    ]);

    // Postgres tayyor bo'lguncha kutamiz.
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try {
        execFileSync("docker", ["exec", container, "pg_isready", "-U", "slaydx"], { stdio: "ignore" });
        ready = true;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    assert.ok(ready, "Postgres 30 soniyada tayyor bo'lmadi");

    // Ozgina ma'lumot — bo'sh dump o'lchami shift bilan aralashib ketmasin.
    execFileSync("docker", [
      "exec",
      container,
      "psql",
      "-U",
      "slaydx",
      "-d",
      "slaydx",
      "-c",
      "CREATE TABLE t (id serial primary key, v text); INSERT INTO t(v) SELECT repeat('x', 200) FROM generate_series(1, 5000);",
    ]);

    const backupDir = mkdtempSync(path.join(tmpdir(), "slaydx-backup-test-"));
    t.after(() => rmSync(backupDir, { recursive: true, force: true }));

    const baseEnv = {
      ...process.env,
      PG_CONTAINER: container,
      PG_USER: "slaydx",
      PG_DB: "slaydx",
      BACKUP_DIR: backupDir,
      BACKUP_MIN_SIZE_BYTES: "1000",
      BACKUP_KEEP_DAYS: "7",
    };

    // 1) Muvaffaqiyatli dump — tasdiqlangan (`pg_restore --list` skript ICHIDA tekshiradi).
    execFileSync("bash", ["scripts/backup.sh"], { env: baseEnv, stdio: "pipe", timeout: 60_000 });
    let dumps = readdirSync(backupDir).filter((f) => f.endsWith(".dump"));
    assert.equal(dumps.length, 1, "bitta dump yaratilishi kerak");
    assert.ok(existsSync(path.join(backupDir, "backup.log")), "backup.log yozilishi kerak");

    // 2) Aylanish: eskirgan (10 kunlik) soxta faylni qo'shamiz — keyingi
    // muvaffaqiyatli run uni o'chirishi kerak (BACKUP_KEEP_DAYS=7).
    const oldFile = path.join(backupDir, "slaydx-fakeold.dump");
    writeFileSync(oldFile, "x");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    // Fayl nomi `date +%Y%m%d-%H%M%S` (soniya aniqligi) — ikkinchi run
    // birinchisi bilan BIR XIL soniyada bo'lsa, xuddi shu nomga yozib
    // yuboradi. Test uchun bitta soniya kutamiz (haqiqiy backup.sh
    // kunda bir marta ishlaydi, bu faqat testning o'zi tez ketma-ket
    // chaqirgani uchun kerak).
    await new Promise((r) => setTimeout(r, 1100));
    execFileSync("bash", ["scripts/backup.sh"], { env: baseEnv, stdio: "pipe", timeout: 60_000 });
    dumps = readdirSync(backupDir).filter((f) => f.endsWith(".dump"));
    assert.ok(!dumps.includes("slaydx-fakeold.dump"), "eskirgan (10 kunlik) dump aylanishda o'chishi kerak (KEEP_DAYS=7)");
    assert.equal(dumps.length, 2, `ikkita YANGI dump qolishi kerak, keldi: ${dumps.join(", ")}`);

    // 3) Juda kichik shift — haqiqiy dump "buzilgan/bo'sh" deb topilib XATO berishi kerak,
    // VA (reviewer topilmasi) to'liq hajmli `.tmp` qoldirmasligi kerak (EXIT trap).
    assert.throws(
      () =>
        execFileSync("bash", ["scripts/backup.sh"], {
          env: { ...baseEnv, BACKUP_MIN_SIZE_BYTES: "999999999" },
          stdio: "pipe",
          timeout: 60_000,
        }),
      /Command failed/,
      "juda katta shift bilan skript XATO (non-zero) berishi kerak",
    );
    const leftoverTmp = readdirSync(backupDir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftoverTmp, [], `.tmp fayl qolmasligi kerak (EXIT trap), qoldi: ${leftoverTmp.join(", ")}`);
  },
);

/**
 * Reviewer topilmasi (W2-D1 review): ilgari faqat `pg_dump` va hajm
 * tekshiruvi `fail()`ni chaqirardi — `mkdir`, `mv`, `docker cp` kabi
 * boshqa YO'Ldagi kutilmagan xatolar `backup.log`ga yozuvsiz, alertsiz
 * jim ketardi. Endi `trap ... ERR` HAR qanday ushlanmagan xatoni ham
 * `fail()`ga yo'naltiradi. `BACKUP_DIR`ni ATAYLAB o'qish/yozish huquqi
 * yo'q joyga (`/root/...`, biz root emasmiz) qo'yib, `mkdir -p` xatosini
 * ERR trap orqali ushlanishini tekshiramiz — bu ilgari umuman
 * `fail()`dan o'tmasdi.
 */
test(
  "backup.sh: ERR trap ilgari ushlanmagan xatoni (masalan mkdir) ham fail() orqali aniq xabar bilan to'xtatadi",
  { skip: process.getuid && process.getuid() === 0 ? "root sifatida ishlayapti — /root cheklovi ishlamaydi" : false },
  () => {
    let threw = false;
    let stderr = "";
    try {
      execFileSync("bash", ["scripts/backup.sh"], {
        env: { ...process.env, PG_CONTAINER: "irrelevant", BACKUP_DIR: "/root/slaydx-no-permission-test" },
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch (e) {
      threw = true;
      stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
    }
    assert.ok(threw, "yozib bo'lmaydigan BACKUP_DIR bilan skript XATO berishi kerak");
    // MUTATSIYA: `trap ... ERR` qatori olib tashlansa, skript baribir
    // (`set -e` orqali) XATO beradi, LEKIN quyidagi ikki satr chiqmaydi —
    // ya'ni ERR trap ANIQ ishlaganini shu ikki matn isbotlaydi.
    assert.match(stderr, /kutilmagan xato/, `ERR trap orqali "kutilmagan xato" xabari kutilgan edi:\n${stderr}`);
    assert.match(stderr, /backup: XATO —/, `fail() ning o'z xabari kutilgan edi:\n${stderr}`);
  },
);

/**
 * C24 review §2: cron BO'SH muhitda ishga tushadi va `.env`ni o'qimaydi —
 * `BACKUP_REMOTE`/`BACKUP_TG_CHAT`/`TELEGRAM_BOT_TOKEN` faqat `BACKUP_ENV_FILE`
 * orqali yetib borishi kerak. Bu test: (1) fayl haqiqatan SOURCE qilinishini
 * (2) muvaffaqiyatsiz off-box nusxalash ENDI FATAL (alert + non-zero exit,
 * ilgari faqat stderr ogohlantirishi bo'lib, umumiy natija "ok" edi).
 */
test(
  "backup.sh: BACKUP_ENV_FILE orqali BACKUP_REMOTE yetib boradi, muvaffaqiyatsiz off-box nusxa FATAL",
  { skip: hasDocker ? false : "docker mavjud emas" },
  async (t: TestContext) => {
    const container = `slaydx-backup-test-envfile-${process.pid}`;
    t.after(() => {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch {
        // konteyner allaqachon yo'q bo'lishi mumkin
      }
    });
    execFileSync("docker", [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=test",
      "-e",
      "POSTGRES_USER=slaydx",
      "-e",
      "POSTGRES_DB=slaydx",
      "postgres:16-alpine",
    ]);
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try {
        execFileSync("docker", ["exec", container, "pg_isready", "-U", "slaydx"], { stdio: "ignore" });
        ready = true;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    assert.ok(ready, "Postgres 30 soniyada tayyor bo'lmadi");

    const dir = mkdtempSync(path.join(tmpdir(), "slaydx-backup-envfile-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const envFile = path.join(dir, ".backup.env");
    // Atayin YARAMAS rclone masofaviy nomi — konfiguratsiyada bo'lmagan
    // bo'lim, nusxalash ANIQ muvaffaqiyatsiz bo'lishi kerak.
    writeFileSync(envFile, "BACKUP_REMOTE=nonexistent-remote-for-test-xyz:some/path\n", { mode: 0o600 });

    const backupDir = mkdtempSync(path.join(tmpdir(), "slaydx-backup-envfile-dir-"));
    t.after(() => rmSync(backupDir, { recursive: true, force: true }));

    const env = {
      ...process.env,
      PG_CONTAINER: container,
      PG_USER: "slaydx",
      PG_DB: "slaydx",
      BACKUP_DIR: backupDir,
      BACKUP_MIN_SIZE_BYTES: "10",
      BACKUP_ENV_FILE: envFile,
    };

    let threw = false;
    let stderr = "";
    try {
      execFileSync("bash", ["scripts/backup.sh"], { env, stdio: "pipe", timeout: 60_000 });
    } catch (e) {
      threw = true;
      stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
    }
    assert.ok(threw, "BACKUP_ENV_FILE orqali yomon BACKUP_REMOTE bilan skript XATO (non-zero) berishi kerak");
    assert.match(stderr, /box tashqarisiga nusxalash muvaffaqiyatsiz/, `remote xatosi xabari kutilgan edi:\n${stderr}`);

    // Lokal dump baribir YARATILGAN va SAQLANGAN bo'lishi kerak — faqat
    // off-box nusxa yo'q, bu esa "hech narsa qolmadi" degani emas.
    const dumps = readdirSync(backupDir).filter((f) => f.endsWith(".dump"));
    assert.equal(dumps.length, 1, "off-box muvaffaqiyatsiz bo'lsa ham lokal dump saqlanishi kerak");

    const log = readdirSync(backupDir).includes("backup.log");
    assert.ok(log, "backup.log yozilishi kerak");
  },
);

test(
  "restore-check.sh: buzilgan dump bilan XATO (non-zero) beradi",
  { skip: hasDocker ? false : "docker mavjud emas" },
  async (t: TestContext) => {
    const dir = mkdtempSync(path.join(tmpdir(), "slaydx-restore-check-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const badDump = path.join(dir, "slaydx-corrupt.dump");
    writeFileSync(badDump, "bu haqiqiy pg_dump chiqishi emas");

    assert.throws(
      () => execFileSync("bash", ["scripts/restore-check.sh", badDump], { stdio: "pipe", timeout: 60_000 }),
      /Command failed/,
      "buzilgan dump bilan restore-check.sh XATO berishi kerak",
    );
  },
);

/**
 * Review nit (endi yopilgan): oldin bu skriptning HECH qanday to'g'ri-yo'l
 * (happy-path) testi yo'q edi — faqat qo'lda sinalgan. `backup.sh` haqiqiy
 * dump yaratadi, keyin `restore-check.sh` shu dumpni tiklab, jadval
 * qatorlari va balans invariantini tekshirib, exit 0 bilan chiqishini
 * to'liq avtomatik tasdiqlaydi.
 */
test(
  "restore-check.sh: to'g'ri dump bilan muvaffaqiyatli tiklaydi va exit 0 beradi",
  { skip: hasDocker ? false : "docker mavjud emas" },
  async (t: TestContext) => {
    const container = `slaydx-backup-test-happy-${process.pid}`;
    t.after(() => {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch {
        // konteyner allaqachon yo'q bo'lishi mumkin
      }
    });
    execFileSync("docker", [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=test",
      "-e",
      "POSTGRES_USER=slaydx",
      "-e",
      "POSTGRES_DB=slaydx",
      "postgres:16-alpine",
    ]);
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try {
        execFileSync("docker", ["exec", container, "pg_isready", "-U", "slaydx"], { stdio: "ignore" });
        ready = true;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    assert.ok(ready, "Postgres 30 soniyada tayyor bo'lmadi");
    // Skript qidiradigan minimal sxema (`users`/`generations`/`transactions`).
    execFileSync("docker", [
      "exec",
      container,
      "psql",
      "-U",
      "slaydx",
      "-d",
      "slaydx",
      "-c",
      `CREATE TABLE users (id serial primary key, balance bigint not null default 0);
       CREATE TABLE generations (id uuid primary key default gen_random_uuid());
       CREATE TABLE transactions (id serial primary key, user_id int references users(id), balance_delta bigint not null default 0);
       INSERT INTO users (balance) VALUES (500);
       INSERT INTO transactions (user_id, balance_delta) VALUES (1, 500);`,
    ]);

    const backupDir = mkdtempSync(path.join(tmpdir(), "slaydx-backup-happy-"));
    t.after(() => rmSync(backupDir, { recursive: true, force: true }));

    execFileSync("bash", ["scripts/backup.sh"], {
      env: { ...process.env, PG_CONTAINER: container, PG_USER: "slaydx", PG_DB: "slaydx", BACKUP_DIR: backupDir, BACKUP_MIN_SIZE_BYTES: "10" },
      stdio: "pipe",
      timeout: 60_000,
    });

    const stdout = execFileSync("bash", ["scripts/restore-check.sh"], {
      env: { ...process.env, BACKUP_DIR: backupDir },
      timeout: 90_000,
      encoding: "utf8",
    });
    assert.match(stdout, /restore-check: OK/, `exit 0 va "OK" chiqishi kerak edi:\n${stdout}`);
    assert.match(stdout, /users=1/);
    assert.match(stdout, /transactions=1/);
  },
);

/**
 * Review §3: konteyner `--network none --memory 1g` bilan ishga tushishi
 * (umumiy box'da chegarasiz bo'lmasligi) va tayyorlik `-h 127.0.0.1` orqali
 * (haqiqiy, tarmoqqa quloq soluvchi serverga, vaqtinchalik unix-socket
 * serveriga emas) tekshirilishi SHART — soxta signal muammosi.
 */
test("restore-check.sh: --network none, --memory 1g va -h 127.0.0.1 orqali tayyorlik tekshiruvi bor", () => {
  const src = readFileSync("scripts/restore-check.sh", "utf8");
  assert.match(src, /docker run -d --name "\$container" \\\s*\n\s*--network none \\\s*\n\s*--memory 1g/, "docker run --network none --memory 1g yo'q");
  assert.match(src, /pg_isready -h 127\.0\.0\.1 -U postgres/, "pg_isready -h 127.0.0.1 yo'q — unix-socket orqali soxta tayyorlik signali berishi mumkin");
  assert.match(src, /psql -h 127\.0\.0\.1 -U postgres -d "\$PG_DB" -tAc "SELECT 1"/, "haqiqiy SELECT 1 tekshiruvi yo'q");
});
