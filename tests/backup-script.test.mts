import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, utimesSync, existsSync } from "node:fs";
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

    // 3) Juda kichik shift — haqiqiy dump "buzilgan/bo'sh" deb topilib XATO berishi kerak.
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
