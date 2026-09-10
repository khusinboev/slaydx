import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { ResumePage } from "../../components/viewers/resume/ResumePage.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { planResume } from "../../lib/generation/resume/layout.ts";
import { legacyResumeModel } from "../../lib/generation/resume/model.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * ESKI hujjatlar (B-8) — Rezyume 2 dan oldin yaratilgan `doc_json`.
 *
 * Bazadagi minglab qator `doc.resume` ni BILMAYDI: ularda faqat to'rtta
 * bo'lim (`summary`/`exp`/`edu`/`skills`) va kontakt satri bor. Ko'ruvchi
 * ham, DOCX ham ularni `legacyResumeModel` orqali o'qiydi — bu test
 * aynan shu yo'lning yiqilmasligini va matnning yo'qolmasligini
 * qulflaydi. Yiqilsa foydalanuvchi eski rezyumesini umuman ocholmaydi.
 */

const META: DocMeta = {
  topic: "Moliya tahlilchisi",
  author: "Karimova Dilnoza",
  workLabel: "Rezyume",
  language: "uz",
  toolId: "resume",
  city: "Toshkent",
} as unknown as DocMeta;

function legacyDoc(over: Partial<AcademicDoc> = {}): AcademicDoc {
  return {
    meta: META,
    titlePage: false,
    toc: false,
    sections: [
      {
        id: "summary",
        title: "Qisqacha",
        blocks: [
          { kind: "p", text: "Moliya tahlili bo‘yicha 5 yillik tajriba." },
          { kind: "p", text: "Toshkent · dilnoza@mail.uz · +998 90 123 45 67" },
        ],
      },
      {
        id: "exp",
        title: "Ish tajribasi",
        blocks: [
          { kind: "h3", text: "2022–hozir — Yetakchi tahlilchi, Artel" },
          { kind: "li", text: "Byudjet modelini tuzdi." },
          { kind: "li", text: "Xarajatni 12 % ga qisqartirdi." },
          { kind: "h3", text: "2019–2022 — Tahlilchi, Korzinka" },
          { kind: "li", text: "Haftalik hisobot tayyorladi." },
        ],
      },
      { id: "edu", title: "Ta’lim", blocks: [{ kind: "p", text: "TDIU, bakalavr, Moliya" }] },
      { id: "skills", title: "Ko‘nikmalar", blocks: [{ kind: "li", text: "Excel" }, { kind: "li", text: "1C, Power BI" }] },
    ],
    ...over,
  } as unknown as AcademicDoc;
}

test("eski hujjat modelga xatosiz o'giriladi", () => {
  const m = legacyResumeModel(legacyDoc());
  assert.equal(m.identity.fullName, META.author);
  assert.equal(m.identity.headline, META.topic);
  assert.equal(m.contact.email, "dilnoza@mail.uz");
  assert.equal(m.contact.phone, "+998 90 123 45 67");
  assert.equal(m.contact.location, "Toshkent");
  assert.equal(m.experience.length, 2, "ikki ish joyi kutilgan edi");
  assert.equal(m.experience[0].bullets.length, 2);
  assert.equal(m.education.length, 1);
  // `li` bloki BUTUNICHA bitta ko'nikma bo'ladi (vergul bo'yicha faqat
  // `p` bloklari bo'linadi — `legacyResumeModel`); shu holat qulflanadi.
  assert.deepEqual(m.skills.map((s) => s.text), ["Excel", "1C, Power BI"]);
});

test("eski hujjat ko'ruvchida xatosiz chiziladi va matni yo'qolmaydi", () => {
  const m = legacyResumeModel(legacyDoc());
  const layout = planResume(m);
  const main = layout.zones.find((z) => z.id === "main")?.items ?? [];
  const html = renderToStaticMarkup(h(ResumePage, { layout, pageItems: main, pageIndex: 0, total: 1 }));
  for (const want of ["Karimova Dilnoza", "Byudjet modelini tuzdi.", "TDIU, bakalavr, Moliya", "Excel"]) {
    assert.ok(html.includes(want), `«${want}» ko'ruvchida yo'q`);
  }
});

test("eski hujjat DOCX ga xatosiz chiziladi", async () => {
  const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(legacyDoc())));
  const xml = await zip.file("word/document.xml")!.async("string");
  for (const want of ["Karimova Dilnoza", "Byudjet modelini tuzdi.", "Excel"]) {
    assert.ok(xml.includes(want), `«${want}» DOCX da yo'q`);
  }
});

test("bo'sh/nuqsonli eski hujjat ham yiqilmaydi", async () => {
  const empty = legacyDoc({ sections: [] });
  const m = legacyResumeModel(empty);
  const layout = planResume(m);
  assert.doesNotThrow(() =>
    renderToStaticMarkup(h(ResumePage, { layout, pageItems: layout.zones.find((z) => z.id === "main")?.items ?? [], pageIndex: 0, total: 1 })),
  );
  await assert.doesNotReject(renderDocx(empty));
});

test("eski hujjatning yorliqlari (bo'lim nomlari) saqlanadi", () => {
  const m = legacyResumeModel(legacyDoc());
  assert.equal(m.labels.summary, "Qisqacha");
  assert.equal(m.labels.experience, "Ish tajribasi");
  assert.equal(m.labels.skills, "Ko‘nikmalar");
});
