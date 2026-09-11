import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { TranslationViewer } from "../../components/viewers/TranslationViewer.tsx";
import { fileUrl } from "../../lib/api-client.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { TranslationReport } from "../../lib/generation/translate/report.ts";

/**
 * Tarjimon «Fayl» tabi (AUDIT-16 tuzatish): iframe PDF'ni `inline=1` bilan
 * so'raydi — `attachment` bo'lsa Chrome iframe'da ko'rsatmay yuklab olishga
 * o'tardi; sayt CSP'sida `frame-src 'self'` bo'lmagani esa «content blocked»
 * berardi (u `next.config.ts` da; bu test URL shartnomasini qulflaydi).
 */
afterEach(() => cleanup());

const report: TranslationReport = {
  sourceLang: "uz",
  detected: "uz",
  target: "ja",
  style: "formal",
  domain: "",
  glossary: [],
  warnings: [],
  pairs: [{ id: "s1", src: "Salom", dst: "こんにちは", kind: "p" }],
  segments: 1,
  translated: 1,
  chars: 5,
  sourceKind: "pptx",
} as TranslationReport;
const doc = { meta: { toolId: "translation", language: "ja", topic: "x" }, titlePage: false, toc: false, sections: [], translation: report } as unknown as AcademicDoc;
const GEN = "11111111-1111-4111-8111-111111111111";

test("«Fayl» tabi: iframe manzili format=pdf&inline=1, yangi oyna havolasi ham inline", () => {
  render(h(TranslationViewer, { doc, gen: { id: GEN, format: "pptx" }, pdf: true }));
  fireEvent.click(screen.getByRole("tab", { name: "Fayl" }));
  const frame = document.querySelector("iframe[data-file-preview]") as HTMLIFrameElement | null;
  assert.ok(frame, "iframe chizilmadi");
  assert.equal(frame!.getAttribute("src"), `/api/generations/${GEN}/file?format=pdf&inline=1`);
  const link = document.querySelector('a[target="_blank"]') as HTMLAnchorElement | null;
  assert.ok(link && link.getAttribute("href")!.includes("inline=1"), "yangi oyna havolasi inline bo'lishi kerak");
});

test("fileUrl: yuklab olish manzili o'zgarmagan (inline faqat so'ralganda)", () => {
  assert.equal(fileUrl(GEN), `/api/generations/${GEN}/file`);
  assert.equal(fileUrl(GEN, "pdf"), `/api/generations/${GEN}/file?format=pdf`);
  assert.equal(fileUrl(GEN, "pdf", { inline: true }), `/api/generations/${GEN}/file?format=pdf&inline=1`);
});
