import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { resumeProfile } from "../lib/generation/docx-profile.ts";
import { docFromResume, resumeLabels } from "../lib/generation/resume/model.ts";
import { sampleResume } from "../lib/generation/resume/samples.ts";
import {
  PHOTOLESS_TEMPLATE_IDS,
  PHOTO_TEMPLATE_IDS,
  RESUME_PALETTES,
  RESUME_TEMPLATE_IDS,
  RESUME_TEMPLATES,
} from "../lib/generation/resume/templates.ts";
import type { ImageBytes } from "../lib/generation/slide-images.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * Rezyume DOCX (Rezyume 2, AUDIT-15).
 *
 * Bu yerda XML NING O'ZI o'qiladi (`word/document.xml`), chunki
 * `renderDocx` obyekt daraxti qaytarmaydi — u ZIP qaytaradi va
 * foydalanuvchi ham aynan shuni oladi. «Surat bor» degan gap faqat
 * `word/media/` da haqiqiy fayl va `<w:drawing>` bo'lganda rost.
 */

const META: DocMeta = {
  topic: "Moliya tahlilchisi",
  author: "Karimova Dilnoza",
  workLabel: "Rezyume",
  language: "uz",
  toolId: "resume",
} as unknown as DocMeta;

/** 1×1 shaffof PNG — doira niqobi allaqachon qo'llangan surat o'rniga. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_1X1}`;
const JPG_1X1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function docFor(templateId: (typeof RESUME_TEMPLATE_IDS)[number], opts: { photo?: string | null } = {}): AcademicDoc {
  const m = sampleResume(templateId, undefined, false);
  if (opts.photo && RESUME_TEMPLATES[templateId].photo) {
    m.photo = { url: opts.photo, shape: RESUME_TEMPLATES[templateId].photo!.shape, assetId: "" };
  }
  return docFromResume(m, META);
}

async function xmlOf(doc: AcademicDoc, opts?: Parameters<typeof renderDocx>[1]) {
  const bytes = await renderDocx(doc, opts);
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  // ZIP da papka yozuvi ham bor (`word/media/`) — u fayl emas.
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir);
  return { xml, media, bytes };
}

/** `<w:t>` matnlari — ko'ruvchi bilan solishtirish uchun ham shu funksiya. */
export function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim())
    .filter(Boolean);
}

const drawings = (xml: string) => (xml.match(/<w:drawing>/g) ?? []).length;

/* ══════════════════════════════ surat ══════════════════════════════ */

test("SURATLI shablon aynan bitta `<w:drawing>` va bitta media fayl beradi", async () => {
  for (const id of PHOTO_TEMPLATE_IDS) {
    const { xml, media } = await xmlOf(docFor(id, { photo: PNG_URL }));
    assert.equal(drawings(xml), 1, `${id}: drawing soni`);
    assert.equal(media.length, 1, `${id}: media fayl soni`);
  }
  assert.equal(PHOTO_TEMPLATE_IDS.length, 6, "suratli shablonlar soni");
});

test("SURATSIZ shablon yuklangan suratni ham chizmaydi", async () => {
  /*
   * Mahsulot qarori (AUDIT-16): 4 shablon ataylab suratsiz (ATS va
   * rasmiy hujjat uchun). Foydalanuvchi surat yuklab, keyin shunday
   * shablonni tanlasa — surat CHIZILMAYDI, forma buni ogohlantiradi.
   */
  for (const id of PHOTOLESS_TEMPLATE_IDS) {
    const { xml, media } = await xmlOf(docFor(id, { photo: PNG_URL }));
    assert.equal(drawings(xml), 0, `${id}: suratsiz shablonda drawing chiqdi`);
    assert.equal(media.length, 0, `${id}: suratsiz shablonda media chiqdi`);
  }
  assert.equal(PHOTOLESS_TEMPLATE_IDS.length, 4, "suratsiz shablonlar soni");
});

test("suratsiz rezyumeda drawing ham, media ham yo'q", async () => {
  for (const id of RESUME_TEMPLATE_IDS) {
    const { xml, media } = await xmlOf(docFor(id));
    assert.equal(drawings(xml), 0, `${id}: kutilmagan drawing`);
    assert.equal(media.length, 0, `${id}: kutilmagan media`);
  }
});

test("doira surat PNG bo'lib qoladi (niqob klientda qo'llangan)", async () => {
  const { media } = await xmlOf(docFor("modern", { photo: PNG_URL }));
  assert.ok(media[0].endsWith(".png"), `PNG kutilgan edi: ${media[0]}`);
});

test("JPEG surat `.jpg` bo'lib tushadi", async () => {
  const { media } = await xmlOf(docFor("card", { photo: `data:image/jpeg;base64,${JPG_1X1}` }));
  assert.ok(/\.jpe?g$/.test(media[0]), `JPEG kutilgan edi: ${media[0]}`);
});

test("surat o'lchami EMU da mm × 36 000 (±1%)", async () => {
  const id = "modern";
  const { xml } = await xmlOf(docFor(id, { photo: PNG_URL }));
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml);
  assert.ok(m, "`wp:extent` topilmadi");
  const want = RESUME_TEMPLATES[id].photo!.sizeMm * 36000;
  for (const v of [Number(m![1]), Number(m![2])]) {
    assert.ok(Math.abs(v - want) / want < 0.01, `EMU ${v}, kutilgan ~${want}`);
  }
});

test("saqlangan aktiv `resolveImage` orqali o'qiladi", async () => {
  const url = "/api/generations/gen-1/assets/abc123";
  const calls: string[] = [];
  const resolveImage = async (u: string): Promise<ImageBytes | null> => {
    calls.push(u);
    return { data: `image/png;base64,${PNG_1X1}`, type: "png" };
  };
  const { xml, media } = await xmlOf(docFor("twocol", { photo: url }), { resolveImage });
  assert.deepEqual(calls, [url]);
  assert.equal(drawings(xml), 1);
  assert.equal(media.length, 1);
});

test("`resolveImage` `null` qaytarsa — drawing ham, XATO ham yo'q", async () => {
  const url = "/api/generations/gen-1/assets/abc123";
  const { xml, media } = await xmlOf(docFor("modern", { photo: url }), { resolveImage: async () => null });
  assert.equal(drawings(xml), 0, "bayt yo'q, lekin drawing chizildi");
  assert.equal(media.length, 0);
  // Rezyume rasm tufayli yiqilmasligi kerak — matn o'z joyida.
  assert.ok(textNodes(xml).includes("Karimova Dilnoza"));
});

test("tashqi `https:` surat yuklanmaydi (`resolveImage` siz)", async () => {
  const { xml } = await xmlOf(docFor("modern", { photo: "https://example.com/a.png" }));
  assert.equal(drawings(xml), 0);
});

/* ══════════════════════════════ palitra va shablon ══════════════════════════════ */

test("panel foni palitra hexi bilan bo'yaladi", async () => {
  for (const id of ["modern", "twocol"] as const) {
    const m = sampleResume(id, "plum", false);
    const { xml } = await xmlOf(docFromResume(m, META));
    const t = RESUME_TEMPLATES[id];
    const want = t.darkAside ? RESUME_PALETTES.plum.dark : RESUME_PALETTES.plum.panel;
    assert.ok(xml.includes(`w:fill="${want}"`), `${id}: «${want}» foni topilmadi`);
  }
});

test("banner shabloni bo'yalgan bosh blok chizadi", async () => {
  const m = sampleResume("banner", "forest", false);
  const { xml } = await xmlOf(docFromResume(m, META));
  assert.ok(xml.includes(`w:fill="${RESUME_PALETTES.forest.dark}"`), "banner foni yo'q");
  assert.ok(xml.includes("<w:tbl>"), "banner jadvali yo'q");
});

test("oddiy oqimli shablonlarda jadval yo'q; taymlayn har qator uchun jadval yasaydi", async () => {
  // `ats`/`letter`/`portrait` — sof paragraf oqimi.
  for (const id of ["ats", "letter", "portrait"] as const) {
    const { xml } = await xmlOf(docFor(id));
    assert.ok(!xml.includes("<w:tbl>"), `${id}: kutilmagan jadval`);
  }
  /*
   * `timeline` da sana CHAP ustunda — DOCX da buni faqat jadval beradi
   * (paragraf ichida ikkinchi ustun yo'q). Har ish joyi/ta'lim/sertifikat
   * qatori bitta jadval: namunada 2 ish + 1 ta'lim + 1 sertifikat = 4.
   */
  const { xml: rail } = await xmlOf(docFor("timeline"));
  assert.equal((rail.match(/<w:tbl>/g) ?? []).length, 4, "taymlayn jadvallari soni");
  // `card`/`banner` — sarlavha bloki bitta jadval, mazmun oqimda.
  const { xml: card } = await xmlOf(docFor("card"));
  assert.equal((card.match(/<w:tbl>/g) ?? []).length, 1, "karta sarlavhasi bitta jadval");
});

test("`card` sarlavhasi bo'yalgan blok + chap aksent chizig'i", async () => {
  const { xml } = await xmlOf(docFromResume(sampleResume("card", "plum", false), META));
  assert.ok(xml.includes(`w:fill="${RESUME_PALETTES.plum.panel}"`), "sarlavha foni yo'q");
  assert.ok(/<w:left w:val="single" w:color="[0-9A-Fa-f]{6}"/.test(xml), "chap chegara yo'q");
});

test("`timeline` sarlavhasi ingichka pastki chiziq bilan", async () => {
  const { xml } = await xmlOf(docFor("timeline"));
  assert.ok(/<w:bottom w:val="single" w:color="[0-9A-Fa-f]{6}" w:sz="2"/.test(xml), "hairline chizig'i topilmadi");
});

test("BOSH HARF `allCaps` bilan beriladi — `<w:t>` matni o'zgarmaydi", async () => {
  const { xml } = await xmlOf(docFor("ats"));
  assert.ok(xml.includes("<w:caps/>"), "`allCaps` yo'q");
  const labels = docFor("ats").resume!.labels;
  assert.ok(textNodes(xml).includes(labels.experience), "sarlavha matni o'zgargan (toUpperCase ishlatilgan?)");
});

test("shablon profili chegara va shriftni `RESUME_TEMPLATES` dan oladi", () => {
  for (const id of RESUME_TEMPLATE_IDS) {
    const P = resumeProfile(id);
    const t = RESUME_TEMPLATES[id];
    assert.equal(P.id, "resume", `${id}: profil id o'zgarib ketdi`);
    assert.equal(P.type.font, t.type.font, `${id}: shrift`);
    assert.equal(P.type.size, Math.round(t.type.body * 2), `${id}: o'lcham`);
    if (t.columns === "sidebar-left" || t.columns === "sidebar-right" || t.header === "banner") {
      // Panel ham, banner ham varaq CHETIGA tegadi — chegara 0, chekinish ichkarida.
      assert.equal(P.page.margin.left, 0, `${id}: varaq chetiga tegishi kerak`);
    } else if (t.columns === "single") {
      assert.equal(P.page.margin.left, Math.round(t.marginsMm.left * 56.7), `${id}: chap chegara`);
    }
  }
});

/* ══════════════════════════════ til ══════════════════════════════ */

test("yorliqlar HUJJAT tilida chiqadi (interfeys tilida emas)", async () => {
  for (const [lang, word] of [["ru", "Опыт работы"], ["en", "Work experience"]] as const) {
    const m = { ...sampleResume("ats", undefined, false), language: lang, labels: resumeLabels(lang) };
    const doc = docFromResume(m, { ...META, language: lang });
    const { xml } = await xmlOf(doc);
    assert.ok(textNodes(xml).includes(word), `${lang}: «${word}» topilmadi`);
  }
});

/* ══════════════════════════════ ai bandi ══════════════════════════════ */

test("`ai` band oddiy banddek chiziladi (nishon faqat ko'ruvchida)", async () => {
  const m = sampleResume("ats", undefined, false);
  m.experience = m.experience.map((e, i) =>
    i === 0 ? { ...e, bullets: e.bullets.map((b, j) => (j === 0 ? { ...b, ai: true as const } : b)) } : e,
  );
  const { xml } = await xmlOf(docFromResume(m, META));
  const nodes = textNodes(xml);
  assert.ok(nodes.includes(m.experience[0].bullets[0].text));
  assert.ok(!nodes.some((t) => /\bAI\b/.test(t)), "DOCX ga «AI» nishoni sizib chiqdi");
});

/* ══════════════════════════════ eski hujjat ══════════════════════════════ */

test("eski (4 bo'limli) rezyume hujjati ham chiziladi", async () => {
  const legacy: AcademicDoc = {
    meta: { ...META, city: "Toshkent · a@b.uz" },
    titlePage: false,
    toc: false,
    sections: [
      { id: "summary", title: "Qisqacha", blocks: [{ kind: "p", text: "Tajribali mutaxassis." }, { kind: "p", text: "Toshkent · a@b.uz · +998 90 000 00 00" }] },
      { id: "exp", title: "Tajriba", blocks: [{ kind: "h3", text: "2020–2023 — Tahlilchi" }, { kind: "li", text: "Hisobot tayyorladi." }] },
      { id: "edu", title: "Ta'lim", blocks: [{ kind: "p", text: "TDIU, bakalavr" }] },
      { id: "skills", title: "Ko'nikmalar", blocks: [{ kind: "li", text: "Excel" }, { kind: "li", text: "SQL" }] },
    ],
  } as unknown as AcademicDoc;
  const { xml } = await xmlOf(legacy);
  const nodes = textNodes(xml);
  assert.ok(nodes.includes("Tajribali mutaxassis."), "eski qisqacha yo'qoldi");
  assert.ok(nodes.includes("Excel"), "eski ko'nikmalar yo'qoldi");
});

/* ══════════════════════════════ LibreOffice (ixtiyoriy) ══════════════════════════════ */

function hasSoffice(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

test("LibreOffice namunani ≤2 varaqda chizadi", { skip: !hasSoffice() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "resume-docx-"));
  const { bytes } = await xmlOf(docFor("modern", { photo: PNG_URL }));
  const src = join(dir, "resume.docx");
  writeFileSync(src, bytes);
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src], { timeout: 240_000, stdio: "ignore" });
  const pdf = readdirSync(dir).find((f) => f.endsWith(".pdf"));
  assert.ok(pdf, "PDF yaratilmadi");
  const out = execFileSync("pdfinfo", [join(dir, pdf!)], { encoding: "utf8", timeout: 60_000 });
  const pages = Number(/Pages:\s+(\d+)/.exec(out)?.[1] ?? 0);
  assert.ok(pages >= 1 && pages <= 2, `namuna ${pages} varaqqa yoyildi`);
});
