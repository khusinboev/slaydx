import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../lib/tools.ts";
import { viewerKind } from "../lib/viewers/kind.ts";

/*
 * Ko'ruvchi tanlovi vosita ro'yxatidan ajralib ketmasin.
 *
 * AUDIT-9 da `pro-slide` qo'shildi, lekin `viewerKind` da unutildi —
 * pro deka Word ko'ruvchisida ochilardi (foydalanuvchi topdi). Endi
 * chiqish FORMATI ko'ruvchini belgilaydi: PPTX → slaydlar, PNG → rasm.
 */
test("har PPTX vositasi slayd ko'ruvchisiga, har PNG vositasi rasm ko'ruvchisiga", () => {
  for (const t of TOOLS) {
    if (t.output === "pptx") assert.equal(viewerKind(t.id), "slides", `${t.id}: PPTX lekin ko'ruvchi ${viewerKind(t.id)}`);
    if (t.output === "png") assert.equal(viewerKind(t.id), "image", `${t.id}`);
  }
  assert.ok(TOOLS.some((t) => t.id === "pro-slide" && t.output === "pptx"), "pro-slide PPTX vositasi bo'lishi kerak");
});

test("maxsus (custom) vositalar umumiy Word ko'ruvchisiga tushmaydi", () => {
  for (const t of TOOLS) {
    if (t.custom) assert.notEqual(viewerKind(t.id), "academic", `${t.id}: custom vosita academic ko'ruvchida`);
  }
});
