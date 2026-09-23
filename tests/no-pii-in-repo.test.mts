import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/**
 * Repo gigienasi (C05 / DEPS-01, DEPS-08, INFRA-10, audit/production-readiness).
 *
 * Bu repo PUBLIC. Prod server IP'si va egasining telefon raqami bir marta
 * (`.claude/deploy.md` force-add, `README.md`/`docs/`/`scripts/`da qo'lda)
 * ochiq repo'ga tushib qolgan edi. Bu test SHU IKKI naqshni butun tracked
 * daraxtda (audit/ va tests/ ham SHU JUMLADAN — qamrov chegarasi yo'q)
 * qayta qo'shilishdan saqlaydi.
 *
 * DIQQAT — raqamlar/IP HECH QACHON konsolga chiqarilmaydi: xato
 * xabarlarida faqat `fayl:qator` ko'rsatiladi. Test faylining o'zi ham
 * real qiymatni LITERAL yozmaydi — admin raqami `admin-phones.ts`dagi
 * eksport qilingan fallback konstantasidan RUNTIME'da olinadi (shu
 * sabab bu faylni grep qilish ham hech narsa bermaydi).
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
 * `git grep -P -n -o <pattern>` — faqat MOS QISMni (`-o`) qaytaradi, shu
 * bilan butun qatorni o'qib PII'ni xotiraga tashimaymiz. Mos yo'q bo'lsa
 * `git grep` 1 bilan chiqadi (xato emas).
 */
function grepMatches(pattern: string): { file: string; line: string; match: string }[] {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-P", "-n", "-o", pattern, "--", "."], { encoding: "utf8" });
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const idx1 = row.indexOf(":");
      const idx2 = row.indexOf(":", idx1 + 1);
      return { file: row.slice(0, idx1), line: row.slice(idx1 + 1, idx2), match: row.slice(idx2 + 1) };
    });
}

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

// ---------------------------------------------------------------------
// 1) Telefon: 998-prefiksli 12 xonali raqam, ajratuvchilarga (bo'shliq/
//    tire/nuqta/qavs) chidamli, chegara bilan ANGLANGAN — shunda "998"
//    boshqa uzun raqam ichida (ID/hash/timestamp) TASODIFAN uchramaydi.
// ---------------------------------------------------------------------
const PHONE_PATTERN =
  "(?<![0-9])\\+?998[ ().-]{0,3}[0-9]{2}[ ().-]{0,3}[0-9]{3}[ .-]?[0-9]{2}[ .-]?[0-9]{2}(?![0-9])";

/**
 * O'ylab topilgan (haqiqiy emas) namuna raqamlar — kod/testlarda FORMAT
 * yoki DEMO kontent sifatida ishlatiladi, repo bo'ylab qayerda uchrashidan
 * qat'i nazar ruxsat etilgan.
 */
const SYNTHETIC_FIXTURE_DIGITS = new Set([
  "998901234567",
  "998712000000",
  "998900000000",
  "998901112233",
  "998911112233",
  "998911112244",
  "998900000001",
  "998900000002",
  "998907654321",
]);

/**
 * Uchinchi tomon (Click, GLOWLEDGE MChJ) o'zining OMMAVIY sahifasida
 * e'lon qilgan raqami — raqobatchi tadqiqoti hisobotida iqtibos
 * sifatida (`docs/research/*`). SlaydX/egasining PII'si EMAS.
 */
const THIRD_PARTY_PUBLIC_DIGITS = new Set([
  "998712310880", // Click Business — click.uz/uz/faq da e'lon qilingan
  "998919652429", // GLOWLEDGE MChJ (slaydtop.uz operatori) — oferta sahifasida
]);

test(
  "tracked fayllarda 998-prefiksli telefon raqami faqat sintetik/uchinchi-tomon/hujjatlashtirilgan admin fallback",
  { skip: isGitRepo ? false : "git repo emas" },
  async () => {
    const { ADMIN_PHONES_FALLBACK_FOR_TESTS } = await import("../lib/server/admin-phones.ts");
    const realAdminDigits = digitsOf(ADMIN_PHONES_FALLBACK_FOR_TESTS);

    /**
     * Admin real raqamining HOZIRGI ma'lum joylari — faqat shu fayllarda
     * ruxsat etiladi (boshqa hech qayerda emas). `tests/admin.test.mts` va
     * `tests/admin-contact.test.mts` bu paketning egaligida EMAS (DEPS-08
     * hali yopilmagan, ular boshqa fixer paketiga tegishli) — shu sabab
     * bu yerda TUZATILMAYDI, faqat hujjatlashtirilgan ma'lum istisno.
     * `lib/server/admin-phones.ts` esa BITTA qatordagi ataylab hardcode
     * (o'zi shu faylda, o'zgartirilmaydi).
     */
    const KNOWN_ADMIN_NUMBER_FILES = new Set([
      "lib/server/admin-phones.ts",
      "tests/admin.test.mts",
      "tests/admin-contact.test.mts",
    ]);

    const hits = grepMatches(PHONE_PATTERN)
      .map((h) => ({ ...h, digits: digitsOf(h.match) }))
      .filter((h) => {
        if (SYNTHETIC_FIXTURE_DIGITS.has(h.digits)) return false;
        if (THIRD_PARTY_PUBLIC_DIGITS.has(h.digits)) return false;
        if (h.digits === realAdminDigits && KNOWN_ADMIN_NUMBER_FILES.has(h.file)) return false;
        return true; // qolgani — noma'lum 998-raqam, MUVAFFAQIYATSIZ
      });

    assert.deepEqual(
      hits.map((h) => `${h.file}:${h.line}`),
      [],
      "Kutilmagan telefon raqami topildi (fayl:qator yuqorida) — <ADMIN_PHONE>/<OWNER_PHONE> bilan almashtiring yoki sintetik namuna ishlating",
    );
  },
);

// ---------------------------------------------------------------------
// 2) IPv4: har qanday to'g'ri shakldagi IPv4 (har oktet 0-255) —
//    private/loopback/link-local/hujjat diapazonlari va repo'dagi ma'lum
//    ommaviy (uchinchi tomon) qiymatlar ruxsat etilgan, qolgan HAR QANDAY
//    ommaviy IP MUVAFFAQIYATSIZ — prod IP'ning aniq /16'sini test kodida
//    ATAYLAB yozmaymiz (shu sababning o'zi ham oldingi leak edi).
// ---------------------------------------------------------------------
const IP_OCTET = "(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
const IP_PATTERN = `(?<![0-9.])${IP_OCTET}\\.${IP_OCTET}\\.${IP_OCTET}\\.${IP_OCTET}(?![0-9.])`;

/** Repo'da uchraydigan, PII bo'lmagan ommaviy/hujjat namunalari (fixture). */
const KNOWN_PUBLIC_IP_ALLOWLIST = new Set([
  "1.2.3.4", // umumiy "misol" IP (RFC 5737 uslubidagi placeholder, test fixture)
  "1.2.3.5",
  "6.6.6.6", // test fixture placeholder
  "149.154.160.0", // Telegram'ning O'ZI e'lon qilgan webhook IP diapazoni (ommaviy ma'lumot)
  "91.108.4.0",
]);

function isReservedOrPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.2.0/24 doc (TEST-NET-1) — b===0 & c===2 tekshiruvsiz, kifoya
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast/reserved (224-255)
  return false;
}

test(
  "tracked fayllarda ommaviy (real) IPv4 manzili yo'q — faqat reserved/private/ma'lum-uchinchi-tomon",
  { skip: isGitRepo ? false : "git repo emas" },
  () => {
    const hits = grepMatches(IP_PATTERN).filter((h) => {
      if (isReservedOrPrivateIPv4(h.match)) return false;
      if (KNOWN_PUBLIC_IP_ALLOWLIST.has(h.match)) return false;
      return true;
    });

    assert.deepEqual(
      hits.map((h) => `${h.file}:${h.line}`),
      [],
      "Kutilmagan ommaviy IPv4 manzili topildi (fayl:qator yuqorida) — <SERVER_IP> bilan almashtiring",
    );
  },
);
