import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/**
 * To'lov webhook autentifikatsiyasi.
 *
 * Imzo tekshiruvi buzilsa, har kim «to'ladim» deb webhook yuborib o'ziga
 * bepul kredit yozdira oladi — ya'ni bu kod bazasidagi eng qimmat
 * xatolik nuqtasi.
 *
 * Bu fayl ilgari formulani O'ZI qayta yozib, o'zi bilan solishtirardi
 * (N-10): `app/api/payments/*` dagi haqiqiy funksiyalar import
 * QILINMASDI. Route dagi formula o'zgarsa test yashil qolaverardi —
 * ya'ni izoh to'g'ri sababni yozgan, lekin kodni emas, izohni sinardi.
 *
 * Endi tekshiruv `lib/server/payments.ts` da va test AYNAN o'sha
 * funksiyani chaqiradi. Kutilgan imzo esa provayder hujjatidan
 * mustaqil hisoblanadi — aks holda test kodning o'zini takrorlab,
 * xatoni ham birga takrorlardi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const CLICK_SECRET = "click-secret-key";

/**
 * Click formulasi — provayder hujjatidan:
 *   md5(click_trans_id + service_id + SECRET + merchant_trans_id +
 *       [merchant_prepare_id] + amount + action + sign_time)
 */
function expectedClickSign(p: {
  click_trans_id: string;
  service_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: string;
  action: string;
  sign_time: string;
}): string {
  const parts = [
    p.click_trans_id,
    p.service_id,
    CLICK_SECRET,
    p.merchant_trans_id,
    ...(p.action === "1" ? [p.merchant_prepare_id ?? ""] : []),
    p.amount,
    p.action,
    p.sign_time,
  ];
  return createHash("md5").update(parts.join("")).digest("hex");
}

const PREPARE = {
  click_trans_id: "123456",
  service_id: "42",
  merchant_trans_id: "order-1",
  amount: "15000.00",
  action: "0",
  sign_time: "2026-01-01 10:00:00",
};

const COMPLETE = { ...PREPARE, action: "1", merchant_prepare_id: "77" };

test("Click: haqiqiy imzo qabul qilinadi (Prepare va Complete)", async () => {
  const { clickSignatureValid } = await import("../lib/server/payments.ts");

  assert.equal(
    clickSignatureValid({ ...PREPARE, sign_string: expectedClickSign(PREPARE) }, CLICK_SECRET),
    true,
  );
  assert.equal(
    clickSignatureValid({ ...COMPLETE, sign_string: expectedClickSign(COMPLETE) }, CLICK_SECRET),
    true,
  );
});

test("Click: prepare_id faqat Complete da imzoga kiradi", async () => {
  const { clickSignatureValid } = await import("../lib/server/payments.ts");

  /*
   * Eng oson qilinadigan xato: `merchant_prepare_id` ni ikkala bosqichda
   * ham qo'shish yoki ikkalasida ham tushirib qoldirish. Ikkalasi ham
   * HAQIQIY to'lovni rad etadi — pul o'tadi, kredit yozilmaydi.
   */

  // Prepare imzosida prepare_id YO'Q — u bilan hisoblangan imzo o'tmasligi kerak.
  const wrongPrepare = createHash("md5")
    .update(
      [
        PREPARE.click_trans_id,
        PREPARE.service_id,
        CLICK_SECRET,
        PREPARE.merchant_trans_id,
        "77", // ortiqcha
        PREPARE.amount,
        PREPARE.action,
        PREPARE.sign_time,
      ].join(""),
    )
    .digest("hex");
  assert.equal(
    clickSignatureValid({ ...PREPARE, merchant_prepare_id: "77", sign_string: wrongPrepare }, CLICK_SECRET),
    false,
    "Prepare imzosiga prepare_id qo'shilmasligi kerak",
  );

  // Complete imzosida prepare_id BOR — usiz hisoblangan imzo o'tmasligi kerak.
  const wrongComplete = createHash("md5")
    .update(
      [
        COMPLETE.click_trans_id,
        COMPLETE.service_id,
        CLICK_SECRET,
        COMPLETE.merchant_trans_id,
        COMPLETE.amount,
        COMPLETE.action,
        COMPLETE.sign_time,
      ].join(""),
    )
    .digest("hex");
  assert.equal(
    clickSignatureValid({ ...COMPLETE, sign_string: wrongComplete }, CLICK_SECRET),
    false,
    "Complete imzosi prepare_id ni o'z ichiga olishi kerak",
  );

  // Boshqa prepare_id — boshqa imzo.
  assert.equal(
    clickSignatureValid(
      { ...COMPLETE, sign_string: expectedClickSign({ ...COMPLETE, merchant_prepare_id: "78" }) },
      CLICK_SECRET,
    ),
    false,
  );
});

test("Click: qalbaki so'rov rad etiladi", async () => {
  const { clickSignatureValid } = await import("../lib/server/payments.ts");
  const good = expectedClickSign(COMPLETE);

  // Summani oshirib yuborish — imzo mos kelmaydi.
  assert.equal(
    clickSignatureValid({ ...COMPLETE, amount: "9999999.00", sign_string: good }, CLICK_SECRET),
    false,
    "summa o'zgarsa imzo buzilishi kerak",
  );

  // Boshqa sir bilan hisoblangan imzo.
  assert.equal(clickSignatureValid({ ...COMPLETE, sign_string: good }, "boshqa-sir"), false);

  // Imzosiz, bo'sh yoki chala so'rov.
  assert.equal(clickSignatureValid({ ...COMPLETE }, CLICK_SECRET), false);
  assert.equal(clickSignatureValid({ ...COMPLETE, sign_string: "" }, CLICK_SECRET), false);
  assert.equal(clickSignatureValid({}, CLICK_SECRET), false);

  /*
   * Sir sozlanmagan bo'lsa HECH NARSA o'tmasligi kerak. Bo'sh sir bilan
   * hisoblangan md5 ni hujumchi ham hisoblay oladi — ya'ni sozlanmagan
   * server ochiq kassa bo'lardi.
   */
  const emptySecretSign = createHash("md5")
    .update(
      [
        COMPLETE.click_trans_id,
        COMPLETE.service_id,
        "",
        COMPLETE.merchant_trans_id,
        COMPLETE.merchant_prepare_id,
        COMPLETE.amount,
        COMPLETE.action,
        COMPLETE.sign_time,
      ].join(""),
    )
    .digest("hex");
  assert.equal(
    clickSignatureValid({ ...COMPLETE, sign_string: emptySecretSign }, ""),
    false,
    "sir sozlanmagan bo'lsa hech qanday imzo qabul qilinmasligi kerak",
  );
});

test("Click: imzo katta-kichik harfga sezgir emas", async () => {
  const { clickSignatureValid } = await import("../lib/server/payments.ts");
  const sign = expectedClickSign(COMPLETE);
  // Provayder ba'zan bosh harfda yuboradi — bu haqiqiy to'lov.
  assert.equal(clickSignatureValid({ ...COMPLETE, sign_string: sign.toUpperCase() }, CLICK_SECRET), true);
});

const PAYME_KEY = "payme-live-key";
const PAYME_TEST_KEY = "payme:test:key";
const basic = (login: string, password: string) =>
  `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`;

test("Payme: faqat to'g'ri Basic kalit o'tadi", async () => {
  const { paymeAuthorized } = await import("../lib/server/payments.ts");
  const keys = [PAYME_KEY, PAYME_TEST_KEY];

  assert.equal(paymeAuthorized(basic("Paycom", PAYME_KEY), keys), true);
  // Test kaliti ham qabul qilinadi — sandbox shu bilan ishlaydi.
  assert.equal(paymeAuthorized(basic("Paycom", PAYME_TEST_KEY), keys), true, "kalitda ':' bo'lsa ham");

  // Login `Paycom` bo'lishi SHART.
  assert.equal(paymeAuthorized(basic("paycom", PAYME_KEY), keys), false, "login registrga sezgir");
  assert.equal(paymeAuthorized(basic("Merchant", PAYME_KEY), keys), false);

  // Noto'g'ri kalit, sxema yoki buzuq sarlavha.
  assert.equal(paymeAuthorized(basic("Paycom", "notiy-kalit"), keys), false);
  assert.equal(paymeAuthorized(`Bearer ${PAYME_KEY}`, keys), false);
  assert.equal(paymeAuthorized("Basic", keys), false);
  assert.equal(paymeAuthorized("", keys), false);
  assert.equal(paymeAuthorized(null, keys), false);
  assert.equal(paymeAuthorized(basic("Paycom", PAYME_KEY).replace("Basic ", "Basic !!!"), keys), false);

  // Ikki nuqtasiz base64 — parol yo'q.
  assert.equal(paymeAuthorized(`Basic ${Buffer.from("Paycom").toString("base64")}`, keys), false);
});

test("Payme: kalit sozlanmagan bo'lsa hech kim kira olmaydi", async () => {
  const { paymeAuthorized } = await import("../lib/server/payments.ts");

  /*
   * Bo'sh kalitlar ro'yxatida `some()` bo'sh massivda `false` qaytaradi,
   * lekin bu tasodifga tayanish bo'lardi — shart ochiq yozilgan va shu
   * yerda qayd etiladi: sozlanmagan server ochiq kassa bo'lmasligi kerak.
   */
  assert.equal(paymeAuthorized(basic("Paycom", ""), []), false);
  assert.equal(paymeAuthorized(basic("Paycom", ""), ["", ""]), false);
  assert.equal(paymeAuthorized(basic("Paycom", "istalgan"), ["", ""]), false);
});

test("Payme: summa tiyinda — so'mni 100 ga ko'paytiramiz", async () => {
  const { PRO_PLAN } = await import("../lib/server/payments.ts");
  // Payme summani TIYINDA kutadi. Xato bo'lsa 100 barobar kam yoki ko'p
  // to'lov o'tardi.
  assert.equal(PRO_PLAN.priceSoum * 100, 1_500_000);
});
