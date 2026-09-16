import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/**
 * O'qituvchi vositalari 2 (AUDIT-20 R0): beshala vosita — dars rejasi,
 * texnologik xarita, glossariy, keys va TEST — bitta `teacher`
 * ko'ruvchisiga tushadi (rasmiy DOCX shakli, `planTeacher` — WP-C).
 * Ilgari ularning har biri o'z ko'ruvchisida edi va brend-muqova
 * chizardi, ya'ni sayt hech qachon fayl bilan bir xil emasdi.
 */
test("o'qituvchi guruhidagi HAR vosita `teacher` ko'ruvchisiga tushadi", () => {
  const teacherTools = TOOLS.filter((t) => t.group === "oqituvchi");
  assert.equal(teacherTools.length, 5, `o'qituvchi vositalari: ${teacherTools.map((t) => t.id).join(", ")}`);
  for (const t of teacherTools) assert.equal(viewerKind(t.id), "teacher", `${t.id}: ko'ruvchi ${viewerKind(t.id)}`);
  assert.equal(viewerKind("test"), "teacher", "yangi test vositasi unutildi");
  // MUTATSIYA: eski qiymat (`lesson`/`table`/`glossary`/`keys`) qaytsa shu yerda ko'rinadi.
  for (const old of ["lesson", "table", "glossary", "keys"]) {
    assert.ok(!TOOLS.some((t) => viewerKind(t.id) === old), `eski ko'ruvchi «${old}» hali ham ishlatilyapti`);
  }
});

test("`teacher` ko'ruvchisi `ArtifactViewer` da tahrir proplari bilan ulangan", () => {
  /*
   * Talaba ishlaridagi xato takrorlanmasin: ko'ruvchi proplarsiz
   * ulangani uchun tahrir jimgina o'chiq qolgandi. `WordViewer` R0 da
   * `doc.teacher` ni bilmaydi, lekin proplar allaqachon uzatiladi.
   */
  const src = readFileSync(new URL("../components/viewers/ArtifactViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /case "teacher":/);
  assert.match(src, /case "teacher":[\s\S]{0,1200}?<WordViewer doc=\{doc\} gen=\{detail\} onGen=\{onDetail\} onEditState=\{onEditState\} \/>/);
});
