import test from "node:test";
import assert from "node:assert/strict";
import { apkLines, hasPackage, imageText, readDockerfile, stageChain } from "./helpers/dockerfile.mts";

/**
 * Tasvirdagi shriftlar (AUDIT-16 §7): Tarjimon 18 tilga o'giradi — lotin
 * (qoraqalpoq ǵ/ń, turkman ý/ž, turk ş/ğ/ı), kengaytirilgan kirill (qozoq
 * ә/ғ/қ/ң, tojik ҳ/ҷ/ӯ), arab (RTL, shakllanadigan) va CJK (zh/ko/ja).
 * PDF ko'rinishi va eskizni web konteyneridagi LibreOffice o'giradi; paket
 * yetishmasa matn «□□□» bo'lib chiqadi (yaponcha PPTX'da shunday bo'ldi).
 * 2026-09-11 da prod konteynerida 18 tilli DOCX va PPTX o'girilib ko'zdan
 * kechirildi — hammasi to'g'ri. Bu test paketlar ro'yxatini qulflaydi.
 *
 * Ops sprint: `runner` and `worker` both start `FROM os-base` (shared font
 * layers). The packages are therefore checked in the image's whole stage
 * chain (own stage + bases, `tests/helpers/dockerfile.mts`) — stricter than
 * the old whole-file scan, which also counted unrelated stages.
 */
test("Dockerfile: web (`runner`) image has latin/cyrillic (font-noto), CJK (font-noto-cjk) and arabic (font-noto-arabic) fonts", () => {
  const df = readDockerfile();
  const text = imageText(df, "runner");
  const apk = apkLines(text);
  for (const pkg of ["fontconfig", "ttf-liberation", "font-noto", "font-noto-cjk", "font-noto-arabic"]) {
    assert.ok(hasPackage(apk, pkg), `runner: ${pkg} paketi Dockerfile'da yo'q`);
  }
  assert.ok(text.includes("fc-cache"), "shrift keshi (fc-cache) yangilanishi kerak");
});

/**
 * Sxema PNG (`figures/png.ts`, sharp/librsvg) WORKER konteynerida chiziladi —
 * shriftlar faqat `runner` (web) bosqichida bo'lsa, prod'da sxema yorliqlari
 * «□□□» chiqadi (2026-09-12, AUDIT-17 birinchi prod maqolasi). Worker image
 * (o'z bosqichi + `os-base`) shriftlarni o'zi o'rnatishi kerak.
 */
test("Dockerfile: worker image also installs latin/cyrillic fonts (ttf-liberation, font-noto) and fontconfig", () => {
  const df = readDockerfile();
  const chain = stageChain(df, "worker");
  assert.equal(chain[0].name, "worker", "worker bosqichi yo'q");
  assert.ok(
    chain.every((s) => s.name !== "runner"),
    "worker must not be built on the web stage (it would inherit LibreOffice, ~1 GB)",
  );
  const text = imageText(df, "worker");
  const apk = apkLines(text);
  for (const pkg of ["fontconfig", "ttf-liberation", "font-noto"]) {
    assert.ok(hasPackage(apk, pkg), `worker: ${pkg} paketi yo'q`);
  }
  assert.ok(text.includes("fc-cache"), "worker: shrift keshi (fc-cache) yo'q");
});
