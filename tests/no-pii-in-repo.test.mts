import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/**
 * Repo gigienasi (C05 / DEPS-01, DEPS-08, INFRA-10, audit/production-readiness).
 *
 * Bu repo PUBLIC. Prod server IP'si va egasining telefon raqami bir marta
 * (`.claude/deploy.md` force-add, `README.md`/`docs/`/`scripts/`da qo'lda)
 * ochiq repo'ga tushib qolgan edi. Bu test SHU IKKI naqshni qayta
 * qo'shilishdan saqlaydi: `git ls-files`dagi HAR bir tracked faylni
 * `git grep` bilan tekshiradi.
 *
 * DIQQAT — raqamlarni HECH QACHON konsolga chiqarmang (audit qoidasi):
 * xato xabarlarida faqat `fayl:qator` ko'rsatiladi, mos qator matni EMAS.
 *
 * `audit/` chiqarib tashlangan — u auditning o'zi (topilmalar, sharhlar),
 * masalan `audit/findings/*.md` haqiqiy qiymatlarni `…`/`<IP>` bilan
 * MASKALAYDI (brief qoidasi), lekin BU YOZILGANDA tekshirilganda
 * `audit/findings/infra-devops.md` va `audit/reviews/W1-A.md` da HALI
 * ham maskalanmagan IP/telefon topildi — bu boshqa fixer paketi
 * egaligidagi fayllar, shu sabab bu yerda TUZATILMAYDI, faqat
 * hisobotda bayon qilinadi.
 */
const isGitRepo = (() => {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Ishlab chiqarish server IP manzili (194.163.x.x) — real qism.
 * Bironta tracked faylda (audit'dan tashqari) HECH QACHON bo'lmasligi
 * kerak — hammasi `<SERVER_IP>` placeholder bilan almashtirilgan.
 */
const IP_PATTERN = "194\\.163\\.[0-9]{1,3}\\.[0-9]{1,3}";

/** 998 bilan boshlanuvchi 12 xonali (E.164 formatidagi O'zbekiston) raqam. */
const PHONE_PATTERN = "998[0-9]{9}";

/**
 * Ruxsat etilgan joylar — "fixtures": test fayllari o'zbek telefon
 * formatlash/validatsiya mantig'ini haqiqiy shakldagi (garchi ko'pi
 * o'ylab topilgan) raqamlar bilan sinaydi, shuning uchun BUTUN `tests/`
 * papkasi ruxsat etilgan. Undan tashqarida faqat aniq, izohlangan
 * fayllar — har biri NEGA xavfsizligi tushuntirilgan.
 */
const ALLOWLIST_PREFIXES = ["tests/"];

const ALLOWLIST_FILES = new Set([
  // Admin ro'yxati ATAYLAB hardcode (lib/server/admin-phones.ts o'zi) —
  // DEPS-08 hali yopilmagan: ADMIN_PHONES env o'rnatilsa buni almashtiradi,
  // lekin prod deploy buzilmasligi uchun hardcode hozircha qoladi.
  "lib/server/admin-phones.ts",
  // Faqat FORMAT namunasi (izoh/placeholder) — o'ylab topilgan raqam,
  // haqiqiy foydalanuvchi/admin bilan bog'liq emas.
  "components/forms/PhoneInput.tsx",
  "components/overlays/LoginModal.tsx",
  "lib/generation/resume/input.ts",
  "lib/phone.ts",
  "docs/AUDIT-15.md",
  // Demo/sinov skriptlari — kirish uchun ENDI majburiy env talab qiladi
  // (SMOKE_USER/EVAL_USER), qolgan literal raqamlar esa o'ylab topilgan
  // namuna ma'lumot (masalan seed-demo.mts'dagi rezyume DEMO kontenti).
  "scripts/eval-services.mjs",
  "scripts/live-engine.mts",
  "scripts/run-build.mts",
  "scripts/seed-demo.mts",
]);

function isAllowlisted(file: string): boolean {
  if (ALLOWLIST_FILES.has(file)) return true;
  return ALLOWLIST_PREFIXES.some((p) => file.startsWith(p));
}

/**
 * `git grep -I -n -E <pattern>` — `-I` binary fayllarni o'tkazib
 * yuboradi. Mos qator YO'Q bo'lsa `git grep` 1 bilan chiqadi (xato
 * emas), shu sabab try/catch bilan ushlanadi.
 */
function findMatches(pattern: string): { file: string; line: string }[] {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-I", "-n", "-E", pattern, "--", ".", ":!audit/**"], {
      encoding: "utf8",
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return []; // hech qanday moslik yo'q
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const idx1 = row.indexOf(":");
      const idx2 = row.indexOf(":", idx1 + 1);
      return { file: row.slice(0, idx1), line: row.slice(idx1 + 1, idx2) };
    });
}

test("tracked fayllarda prod server IP manzili yo'q (audit/ va allowlist'dan tashqari)", { skip: isGitRepo ? false : "git repo emas" }, () => {
  const hits = findMatches(IP_PATTERN).filter((h) => !isAllowlisted(h.file));
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}`),
    [],
    "IP manzili topildi (fayl:qator yuqorida) — <SERVER_IP> bilan almashtiring",
  );
});

test("tracked fayllarda 998-prefiksli 12 xonali raqam faqat allowlist'da (audit/ bundan mustasno)", { skip: isGitRepo ? false : "git repo emas" }, () => {
  const hits = findMatches(PHONE_PATTERN).filter((h) => !isAllowlisted(h.file));
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}`),
    [],
    "Telefon raqami topildi (fayl:qator yuqorida) — <ADMIN_PHONE> bilan almashtiring yoki allowlist'ga qo'shing (fixture bo'lsa)",
  );
});
