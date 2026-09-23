import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * C07 (FILE-03, CONC-01, BEA-20, FILE-06): web jarayonidagi LibreOffice.
 *
 * LibreOffice ning O'ZI ishlatilmaydi — `SOFFICE_BIN` soxta shell skriptga
 * qaratiladi. Shu bilan `toPdf` ning HAQIQIY yo'li (spawn, vaqt chegarasi,
 * vaqtinchalik papka, jarayonlar guruhi) sinaladi:
 *   - bir vaqtda ko'pi bilan N ta `soffice` (umumiy semafor);
 *   - N+1-chi kutadi, kutish muddati o'tsa «band» (503) xatosi;
 *   - xato bo'lsa ham slot bo'shaydi;
 *   - vaqt tugasa butun guruh (launcher + `soffice.bin` o'rnidagi nevara)
 *     o'ldiriladi, papka faqat jarayon tugagandan KEYIN o'chadi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { toPdf } = await import("../lib/server/pdf.ts");

const DOCX = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);

/** Soxta `soffice`: `--outdir` ga PDF yozadi; `STUB_DIR` ga iz qoldiradi. */
async function stubSoffice(t: TestContext, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "slaydx-stub-"));
  const bin = join(dir, "soffice");
  await writeFile(
    bin,
    `#!/bin/sh
out=""; prev=""
for a in "$@"; do if [ "$prev" = "--outdir" ]; then out="$a"; fi; prev="$a"; done
echo "$out" > "$STUB_DIR/outdir"
${body}
`,
  );
  await chmod(bin, 0o755);
  const prevBin = process.env.SOFFICE_BIN;
  const prevDir = process.env.STUB_DIR;
  process.env.SOFFICE_BIN = bin;
  process.env.STUB_DIR = dir;
  t.after(async () => {
    if (prevBin === undefined) delete process.env.SOFFICE_BIN;
    else process.env.SOFFICE_BIN = prevBin;
    if (prevDir === undefined) delete process.env.STUB_DIR;
    else process.env.STUB_DIR = prevDir;
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pidFrom(file: string): Promise<number> {
  return Number((await readFile(file, "utf8")).trim());
}

test("toPdf: 6 ta parallel so'rov — bir vaqtda ko'pi bilan 2 ta soffice (umumiy semafor)", async (t) => {
  const dir = await stubSoffice(
    t,
    `mark="$STUB_DIR/run.$$"; : > "$mark"
n=$(ls "$STUB_DIR" | grep -c '^run\\.'); echo "$n" >> "$STUB_DIR/log"
sleep 0.3
printf '%%PDF-1.4 stub' > "$out/manba.pdf"
rm -f "$mark"`,
  );
  const outs = await Promise.all(Array.from({ length: 6 }, () => toPdf(DOCX, "a.docx")));
  assert.ok(outs.every((b) => b && b.toString().startsWith("%PDF")), "hammasi PDF qaytarishi kerak");
  const counts = (await readFile(join(dir, "log"), "utf8")).trim().split("\n").map(Number);
  assert.equal(counts.length, 6);
  const maxInFlight = Math.max(...counts);
  assert.ok(maxInFlight <= 2, `bir vaqtda ${maxInFlight} ta soffice — ko'pi bilan 2 bo'lishi kerak`);
});

test("toPdf: launcher chiqgandan keyin qolgan nevara jarayon ham o'ldiriladi", async (t) => {
  const dir = await stubSoffice(
    t,
    `sleep 30 >/dev/null 2>&1 &
echo $! > "$STUB_DIR/gc.pid"
printf '%%PDF-1.4 stub' > "$out/manba.pdf"
exit 0`,
  );
  const pdf = await toPdf(DOCX, "a.docx");
  assert.ok(pdf, "PDF qaytishi kerak");
  const gc = await pidFrom(join(dir, "gc.pid"));
  const leaked = alive(gc);
  if (leaked) process.kill(gc, "SIGKILL");
  assert.equal(leaked, false, "soffice.bin o'rnidagi nevara jarayon yetim qolmasligi kerak");
});

test("toPdf: vaqt tugasa launcher ham, nevara ham o'ladi; papka keyin o'chadi", async (t) => {
  const { Gate } = await import("../lib/server/soffice-gate.ts");
  const dir = await stubSoffice(
    t,
    `sleep 30 >/dev/null 2>&1 &
echo $! > "$STUB_DIR/gc.pid"
echo $$ > "$STUB_DIR/c.pid"
sleep 30`,
  );
  const gate = new Gate({ max: 1, waitMs: 1000, maxWaiters: 4, retryAfterSec: 5 });
  const t0 = Date.now();
  const pdf = await toPdf(DOCX, "a.docx", { gate, timeoutMs: 400 });
  assert.equal(pdf, null, "vaqt tugashi — o'girish xatosi (null)");
  assert.ok(Date.now() - t0 < 5000, "30 s kutilmasligi kerak");
  const c = await pidFrom(join(dir, "c.pid"));
  const gc = await pidFrom(join(dir, "gc.pid"));
  const outdir = (await readFile(join(dir, "outdir"), "utf8")).trim();
  const left = [c, gc].filter(alive);
  for (const p of left) process.kill(p, "SIGKILL");
  assert.deepEqual(left, [], "launcher va nevara o'lgan bo'lishi kerak");
  assert.equal(existsSync(outdir), false, "vaqtinchalik papka o'chirilgan bo'lishi kerak");
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 }, "slot bo'shagan");
});

test("runGroup: vaqt tugashi guruhni o'ldiradi va xato tashlaydi", async (t) => {
  const { runGroup } = await import("../lib/server/soffice-gate.ts");
  const dir = await mkdtemp(join(tmpdir(), "slaydx-grp-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = `sleep 30 >/dev/null 2>&1 & echo $! > ${dir}/gc.pid; echo $$ > ${dir}/c.pid; sleep 30`;
  await assert.rejects(runGroup("/bin/sh", ["-c", script], { timeoutMs: 300 }), /vaqt/);
  const pids = [await pidFrom(join(dir, "c.pid")), await pidFrom(join(dir, "gc.pid"))];
  const left = pids.filter(alive);
  for (const p of left) process.kill(p, "SIGKILL");
  assert.deepEqual(left, []);
  // Muvaffaqiyatli chiqish — resolve; nol bo'lmagan kod — reject.
  await runGroup("/bin/sh", ["-c", "exit 0"], { timeoutMs: 2000 });
  await assert.rejects(runGroup("/bin/sh", ["-c", "echo xato >&2; exit 3"], { timeoutMs: 2000 }), /3/);
  await assert.rejects(runGroup(join(dir, "yoq"), [], { timeoutMs: 2000 }));
});

test("Gate: N+1-chi kutadi, bo'shaganda davom etadi; kutish tugasa «band»", async () => {
  const { Gate, SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
  const gate = new Gate({ max: 2, waitMs: 150, maxWaiters: 10, retryAfterSec: 7 });
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const a = gate.run(() => hold);
  const b = gate.run(() => hold);
  let cStarted = false;
  const c = gate.run(async () => {
    cStarted = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cStarted, false, "3-chi kutishi kerak");
  assert.deepEqual(gate.stats(), { active: 2, waiting: 1 });
  release();
  await Promise.all([a, b, c]);
  assert.equal(cStarted, true);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });

  // Kutish muddati: ikki slot band, uchinchisi 150 ms dan keyin «band».
  let release2!: () => void;
  const hold2 = new Promise<void>((r) => (release2 = r));
  const x = gate.run(() => hold2);
  const y = gate.run(() => hold2);
  const t0 = Date.now();
  await assert.rejects(gate.run(async () => "yo'q"), (e: unknown) => {
    assert.ok(e instanceof SofficeBusyError);
    assert.equal((e as InstanceType<typeof SofficeBusyError>).retryAfterSec, 7);
    return true;
  });
  assert.ok(Date.now() - t0 >= 140, "kutish muddati hurmat qilinadi");
  assert.deepEqual(gate.stats(), { active: 2, waiting: 0 }, "vaqti o'tgan kutuvchi navbatdan chiqadi");
  release2();
  await Promise.all([x, y]);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test("Gate: navbat to'lsa darhol «band»; xato bo'lsa ham slot bo'shaydi", async () => {
  const { Gate, SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
  const gate = new Gate({ max: 1, waitMs: 5000, maxWaiters: 1, retryAfterSec: 3 });
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const a = gate.run(() => hold);
  const b = gate.run(async () => 1);
  await assert.rejects(gate.run(async () => 2), SofficeBusyError);
  release();
  assert.equal(await b, 1);
  await a;

  await assert.rejects(gate.run(async () => {
    throw new Error("soffice yiqildi");
  }), /yiqildi/);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 }, "xatodan keyin slot qaytgan");
  assert.equal(await gate.run(async () => "ok"), "ok");
});

test("toPdf: hamma slot band va kutish tugasa SofficeBusyError (null emas)", async (t) => {
  const { Gate, SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
  await stubSoffice(t, `sleep 0.5; printf '%%PDF-1.4 stub' > "$out/manba.pdf"`);
  const gate = new Gate({ max: 1, waitMs: 100, maxWaiters: 4, retryAfterSec: 9 });
  const first = toPdf(DOCX, "a.docx", { gate });
  await assert.rejects(toPdf(DOCX, "a.docx", { gate }), SofficeBusyError);
  assert.ok(await first);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});
