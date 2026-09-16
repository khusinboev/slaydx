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
    /*
     * AUDIT-19 WP-E2: kurs ishi/referat/mustaqil ish `custom: "work"`
     * ga o'tdi (`WorkComposer` — faqat KIRISH formasi almashdi), lekin
     * chiqish hali ham oddiy AcademicDoc/DOCX — «ko'rdim = oldim»
     * bo'yicha UMUMIY Word ko'ruvchisida ochiladi (CLAUDE.md: `doc.work`
     * shu bitta yagona ko'ruvchining USTIGA qo'shiladi, alohida ko'ruvchi
     * emas). Shuning uchun `custom` mavjudligi bu yerda YETARLI belgi
     * emas — faqat haqiqatan BOSHQA shaklga chiqadigan vositalar (slayd,
     * rezyume, rasm, tarjima, maqola) tekshiriladi.
     */
    if (t.custom && t.custom !== "work") assert.notEqual(viewerKind(t.id), "academic", `${t.id}: custom vosita academic ko'ruvchida`);
  }
});
