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
test("`teacher` dvigatelidagi HAR vosita `teacher` ko'ruvchisiga tushadi", () => {
  /*
   * Mezon — `custom: "teacher"`, guruh EMAS: AUDIT-21 dan boshlab
   * «O'qituvchi vositalari» bo'limida boshqa dvigateldagi vosita ham bor
   * (infografika — PNG plakat, `ImageViewer`). Guruh bo'yicha tekshirish
   * yangi vositani noto'g'ri ko'ruvchiga majburlardi.
   */
  const teacherTools = TOOLS.filter((t) => t.custom === "teacher");
  assert.equal(teacherTools.length, 5, `o'qituvchi vositalari: ${teacherTools.map((t) => t.id).join(", ")}`);
  for (const t of teacherTools) assert.equal(viewerKind(t.id), "teacher", `${t.id}: ko'ruvchi ${viewerKind(t.id)}`);
  assert.equal(viewerKind("test"), "teacher", "yangi test vositasi unutildi");
  // Infografika o'qituvchi BO'LIMIDA, lekin ko'ruvchisi — rasm (chiqish PNG).
  assert.equal(viewerKind("infographic"), "image", "infografika Word ko'ruvchisiga tushdi");
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

/* ────────────────── Bosma o'yinlar + infografika (AUDIT-21 R0) ────────────────── */

/**
 * Mutatsiyalar (har biri qizardi):
 *   1. `viewerKind` dagi `crossword`/`flashcards` shoxi olib tashlandi —
 *      ikkalasi `academic` ga tushdi (umumiy Word oqimi to'r rasmini
 *      oddiy paragraf deb sahifalab yuborardi);
 *   2. `infographic` shoxi `image` dan olib tashlandi — PNG vositasi
 *      Word ko'ruvchisida ochildi (birinchi testda ham ushlanadi);
 *   3. `ArtifactViewer` dagi `case "game"` proplarsiz yozildi — tahrir
 *      jimgina o'chiq qolardi (talaba ishlaridagi xatoning aynan o'zi).
 */
test("o'yin vositalari `game` ko'ruvchisiga tushadi, boshqa hech kim tushmaydi", () => {
  const gameTools = TOOLS.filter((t) => t.group === "oyinlar");
  // AUDIT-22: saralash va tinglash qo'shildi — ularning ham bosma varag'i bor.
  assert.equal(gameTools.length, 4, `o'yin vositalari: ${gameTools.map((t) => t.id).join(", ")}`);
  assert.deepEqual(gameTools.map((t) => t.id).sort(), ["crossword", "flashcards", "listening", "sorting"]);
  for (const t of gameTools) assert.equal(viewerKind(t.id), "game", `${t.id}: ko'ruvchi ${viewerKind(t.id)}`);
  // Boshqa hech bir vosita `game` ga tushmasin (shox kengayib ketmasin).
  for (const t of TOOLS) {
    if (t.group !== "oyinlar") assert.notEqual(viewerKind(t.id), "game", `${t.id}: o'yin bo'lmagan vosita game ko'ruvchisida`);
  }
});

test("`game` ko'ruvchisi `ArtifactViewer` da tahrir proplari bilan ulangan", () => {
  const src = readFileSync(new URL("../components/viewers/ArtifactViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /case "game":/);
  assert.match(src, /case "game":[\s\S]{0,1200}?<WordViewer doc=\{doc\} gen=\{detail\} onGen=\{onDetail\} onEditState=\{onEditState\} \/>/);
});

test("har `ViewerKind` da `ArtifactViewer` shoxi bor (yangi tur unutilmasin)", () => {
  const src = readFileSync(new URL("../components/viewers/ArtifactViewer.tsx", import.meta.url), "utf8");
  const kinds = new Set(TOOLS.map((t) => viewerKind(t.id)));
  for (const k of kinds) {
    // `academic` — `default` shoxi (umumiy Word ko'ruvchisi).
    if (k === "academic") continue;
    assert.ok(src.includes(`case "${k}":`), `MUTATSIYA: «${k}» ko'ruvchisi ArtifactViewer da ulanmagan`);
  }
});

/* ══════════════ AUDIT-22: audio ko'ruvchisi ══════════════ */

/**
 * Mutatsiyalar (har biri qizardi):
 *   1. `viewerKind` dagi `podcast`/`greeting` shoxi olib tashlandi —
 *      MP3 `academic` ga tushib, Word ko'ruvchisi bo'sh varaq chizardi;
 *   2. `ArtifactViewer` da `case "audio"` yozilmadi — «har ViewerKind da
 *      shox bor» testi;
 *   3. `AudioViewer` `inline=1` siz havola berdi — Chrome pleerni
 *      o'ynatmasdan yuklab olishga o'tardi;
 *   4. `AudioViewer` transkriptni `doc.audio.script` o'rniga
 *      `doc.sections` dan chizdi — «eshitgan matnim ekranda» buzilardi.
 */

test("MP3 chiqaradigan HAR vosita `audio` ko'ruvchisiga tushadi", () => {
  const audioTools = TOOLS.filter((t) => t.output === "mp3");
  assert.equal(audioTools.length, 2, `audio vositalari: ${audioTools.map((t) => t.id).join(", ")}`);
  assert.deepEqual(audioTools.map((t) => t.id).sort(), ["greeting", "podcast"]);
  for (const t of audioTools) assert.equal(viewerKind(t.id), "audio", `${t.id}: ko'ruvchi ${viewerKind(t.id)}`);
  // Boshqa hech bir vosita `audio` ga tushmasin (shox kengayib ketmasin).
  for (const t of TOOLS) {
    if (t.output !== "mp3") assert.notEqual(viewerKind(t.id), "audio", `${t.id}: audio bo'lmagan vosita audio ko'ruvchida`);
  }
  // «Media» bo'limi = MP3 vositalari (hozircha aynan mos).
  assert.deepEqual(TOOLS.filter((t) => t.group === "media").map((t) => t.id).sort(), ["greeting", "podcast"]);
});

test("`audio` ko'ruvchisi `ArtifactViewer` da ulangan va generatsiya id sini oladi", () => {
  const src = readFileSync(new URL("../components/viewers/ArtifactViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /case "audio":/);
  /*
   * Ko'ruvchiga `gen` SHART: fayl havolasi generatsiya id sidan
   * quriladi (hujjatda audio baytlari yo'q). MUTATSIYA: `gen` propini
   * tushirib qoldirish — pleer manbasiz qolardi.
   */
  assert.match(src, /case "audio":[\s\S]{0,1400}?<AudioViewer doc=\{doc\} gen=\{\{ id: gen\.id/);
});

test("`AudioViewer` pleeri `inline=1` bilan, transkript esa `doc.audio.script` dan", () => {
  const src = readFileSync(new URL("../components/viewers/AudioViewer.tsx", import.meta.url), "utf8");
  // MUTATSIYA: `inline=1` ni olib tashlash — Chrome faylni yuklab olardi.
  assert.match(src, /file\?inline=1/, "pleer manbasi `inline=1` siz");
  assert.match(src, /<audio[\s\S]{0,200}controls/, "pleer boshqaruvlari yo'q");
  // Transkript YAGONA manbadan — model, `sections` emas.
  assert.match(src, /doc\.audio/, "transkript modeldan o'qilmayapti");
  assert.ok(!/doc\.sections/.test(src), "MUTATSIYA: transkript `sections` dan chizilyapti — audio bilan ajralib ketardi");
  // Yuklab olish havolasi `inline` SIZ (aks holda fayl tabda ochilib qolardi).
  assert.match(src, /href=\{`\/api\/generations\/\$\{gen\.id\}\/file`\}/);
});

test("MP3 fayl javobi: `Accept-Ranges` bor, `inline` esa parametrga bog'liq", () => {
  const src = readFileSync(new URL("../app/api/generations/[id]/file/route.ts", import.meta.url), "utf8");
  assert.match(src, /Accept-Ranges/, "audio uchun diapazon qo'llab-quvvatlanmaydi — pleer oldinga sakray olmasdi");
  assert.match(src, /audio\//, "audio turi aniqlanmayapti");
  // MUTATSIYA: audio uchun DOIM `inline` qilish — «MP3 yuklab olish» tugmasi
  // faylni yuklamasdan tabda ochib yuborardi.
  assert.match(src, /inline \? "inline" : "attachment"/);
});
