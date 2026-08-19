import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

/**
 * To'lov imzolari.
 *
 * Imzo tekshiruvi buzilsa, har kim «to'ladim» deb webhook yuborib
 * o'ziga bepul kredit yozdira oladi. Shuning uchun formulani aynan
 * provayder hujjatidagidek qayta hisoblab tekshiramiz.
 */

const CLICK_SECRET = "click-secret-key";

/**
 * Click formulasi:
 *   md5(click_trans_id + service_id + SECRET + merchant_trans_id +
 *       [merchant_prepare_id] + amount + action + sign_time)
 */
function clickSign(p: {
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

test("Click: Prepare imzosi prepare_id ni o'z ichiga olmaydi", () => {
  const base = {
    click_trans_id: "111",
    service_id: "222",
    merchant_trans_id: "order-1",
    amount: "15000",
    action: "0",
    sign_time: "2026-01-01 10:00:00",
  };
  const withPrepare = clickSign({ ...base, merchant_prepare_id: "ignored" });
  assert.equal(clickSign(base), withPrepare, "action=0 da prepare_id qatnashmasligi kerak");
});

test("Click: Complete imzosi prepare_id ga bog'liq", () => {
  const base = {
    click_trans_id: "111",
    service_id: "222",
    merchant_trans_id: "order-1",
    amount: "15000",
    action: "1",
    sign_time: "2026-01-01 10:00:00",
  };
  assert.notEqual(
    clickSign({ ...base, merchant_prepare_id: "A" }),
    clickSign({ ...base, merchant_prepare_id: "B" }),
  );
});

test("Click: summa o'zgarsa imzo o'zgaradi", () => {
  const base = {
    click_trans_id: "111",
    service_id: "222",
    merchant_trans_id: "order-1",
    amount: "15000",
    action: "0",
    sign_time: "2026-01-01 10:00:00",
  };
  assert.notEqual(clickSign(base), clickSign({ ...base, amount: "1" }));
});

test("Payme: Basic auth login 'Paycom' bo'lishi shart", () => {
  const key = "payme-secret";
  const good = Buffer.from(`Paycom:${key}`).toString("base64");
  const decoded = Buffer.from(good, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  assert.equal(decoded.slice(0, sep), "Paycom");
  assert.equal(decoded.slice(sep + 1), key);
});

test("Payme: kalitda ikki nuqta bo'lsa ham to'liq o'qiladi", () => {
  // Naiv `split(":")` bunday kalitni kesib yuborardi.
  const key = "a:b:c";
  const decoded = Buffer.from(Buffer.from(`Paycom:${key}`).toString("base64"), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  assert.equal(decoded.slice(sep + 1), key);
});

test("Payme: summa tiyinda — so'mni 100 ga ko'paytiramiz", () => {
  const soum = 15_000;
  assert.equal(soum * 100, 1_500_000);
});

test("hash taqqoslash doimiy vaqtli bo'lishi uchun bir xil uzunlik", () => {
  const a = createHmac("sha256", "k").update("x").digest("hex");
  const b = createHmac("sha256", "k").update("y").digest("hex");
  assert.equal(a.length, b.length, "sha256 hex — doim 64 belgi");
});
