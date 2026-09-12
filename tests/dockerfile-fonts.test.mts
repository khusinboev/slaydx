import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tasvirdagi shriftlar (AUDIT-16 §7): Tarjimon 18 tilga o'giradi — lotin
 * (qoraqalpoq ǵ/ń, turkman ý/ž, turk ş/ğ/ı), kengaytirilgan kirill (qozoq
 * ә/ғ/қ/ң, tojik ҳ/ҷ/ӯ), arab (RTL, shakllanadigan) va CJK (zh/ko/ja).
 * PDF ko'rinishi va eskizni web konteyneridagi LibreOffice o'giradi; paket
 * yetishmasa matn «□□□» bo'lib chiqadi (yaponcha PPTX'da shunday bo'ldi).
 * 2026-09-11 da prod konteynerida 18 tilli DOCX va PPTX o'girilib ko'zdan
 * kechirildi — hammasi to'g'ri. Bu test paketlar ro'yxatini qulflaydi.
 */
test("Dockerfile: lotin/kirill (font-noto), CJK (font-noto-cjk) va arab (font-noto-arabic) shriftlari o'rnatiladi", () => {
  const df = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const apk = df.split("\n").filter((l) => /^RUN apk add/.test(l)).join("\n");
  for (const pkg of ["ttf-liberation", "font-noto", "font-noto-cjk", "font-noto-arabic"]) {
    assert.ok(new RegExp(`(^|\\s)${pkg.replace(/-/g, "\\-")}(\\s|$)`).test(apk), `${pkg} paketi Dockerfile'da yo'q`);
  }
  assert.ok(df.includes("fc-cache"), "shrift keshi (fc-cache) yangilanishi kerak");
});

/**
 * Sxema PNG (`figures/png.ts`, sharp/librsvg) WORKER konteynerida chiziladi —
 * shriftlar faqat `runner` (web) bosqichida bo'lsa, prod'da sxema yorliqlari
 * «□□□» chiqadi (2026-09-12, AUDIT-17 birinchi prod maqolasi). Har bosqich
 * o'z `apk add` qatoriga ega bo'lishi kerak.
 */
test("Dockerfile: worker bosqichida ham lotin/kirill shriftlari (ttf-liberation, font-noto) va fontconfig o'rnatiladi", () => {
  const df = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const start = df.indexOf("FROM node:22-alpine AS worker");
  assert.ok(start >= 0, "worker bosqichi yo'q");
  const worker = df.slice(start);
  const apk = worker.split("\n").filter((l) => /^RUN apk add/.test(l)).join("\n");
  for (const pkg of ["fontconfig", "ttf-liberation", "font-noto"]) {
    assert.ok(new RegExp(`(^|\\s)${pkg.replace(/-/g, "\\-")}(\\s|$)`).test(apk), `worker: ${pkg} paketi yo'q`);
  }
  assert.ok(worker.includes("fc-cache"), "worker: shrift keshi (fc-cache) yo'q");
});
