import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { articleProfile, CM, profileFor } from "../lib/generation/docx-profile.ts";
import { PUBLICATION_PROFILES } from "../lib/generation/article/profiles.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { ArticleTypeId, PublicationProfileId } from "../lib/generation/article/types.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import type { ImageBytes } from "../lib/generation/slide-images.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * Maqola DOCX (Maqola 2, AUDIT-17 WP2).
 *
 * XML NING O'ZI o'qiladi (`word/document.xml`) — foydalanuvchi aynan
 * shuni oladi. Joylashuv qoidalari (mahsulot egasi): rasm sarlavhasi
 * PASTDA, jadval sarlavhasi TEPADA, formula OMML (`<m:oMath>`), titul va
 * mundarija YO'Q, chegaralar/shrift nashr profilidan, OAK da REFERENCES.
 */

const META: DocMeta = {
  topic: "Sun’iy intellektning oliy ta’limdagi o‘rni",
  author: "Karimova Dilnoza",
  workLabel: "Maqola",
  language: "uz",
  toolId: "article",
} as unknown as DocMeta;

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_1X1}`;

function docFor(type: ArticleTypeId = "imrad_oak", profile: PublicationProfileId = "oak", opts: { png?: string } = {}): AcademicDoc {
  const doc = sampleArticleDoc(META, { type, profile });
  if (opts.png) doc.article!.figures = doc.article!.figures.map((f) => ({ ...f, url: opts.png }));
  return doc;
}

async function xmlOf(doc: AcademicDoc, opts?: Parameters<typeof renderDocx>[1]) {
  const bytes = await renderDocx(doc, opts);
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/") && !zip.files[n].dir);
  return { xml, media, bytes };
}

function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim())
    .filter(Boolean);
}

/** `needle` matnli `<w:t>` ning XML dagi o'rni. */
function posOf(xml: string, needle: string): number {
  const i = xml.indexOf(`>${needle}<`);
  assert.ok(i >= 0, `«${needle}» topilmadi`);
  return i;
}

/* ══════════════════════════════ bosh blok ══════════════════════════════ */

test("UDK, sarlavha, mualliflar (unvon, tashkilot, email, ORCID), annotatsiya ×3 — matnda", async () => {
  const { xml } = await xmlOf(docFor());
  const t = textNodes(xml);
  assert.ok(t.includes("UDK 004.8:37.02"), "UDK yo'q");
  assert.ok(t.includes(META.topic), "sarlavha yo'q");
  assert.ok(t.includes("Karimova Dilnoza Baxtiyorovna, PhD, dotsent"));
  assert.ok(t.includes("Toshkent davlat iqtisodiyot universiteti, d.karimova@tsue.uz, ORCID: 0000-0002-1825-0097"));
  assert.ok(t.includes("Aliyev Ali Valiyevich, magistrant"));
  for (const label of ["Annotatsiya.", "Аннотация.", "Abstract.", "Kalit so‘zlar:", "Ключевые слова:", "Keywords:"]) {
    assert.ok(t.includes(label), `«${label}» yo'q`);
  }
  /*
   * Yorliq bilan matn orasidagi BO'SHLIQ saqlanadi: `cleanText` chetdagi
   * bo'shliqni kesadi va LibreOffice ko'zdan kechiruvida «Annotatsiya.Maqolada»
   * yopishib chiqqan edi.
   */
  assert.ok(xml.includes('<w:t xml:space="preserve"> Maqolada sun’iy intellekt'), "annotatsiya matni oldida bo'shliq yo'q");
  assert.ok(xml.includes('<w:t xml:space="preserve"> sun’iy intellekt, adaptiv o‘qitish, oliy ta’lim</w:t>'), "kalit so'zlar oldida bo'shliq yo'q");
  // Tartib: UDK < sarlavha < muallif < annotatsiya < Kirish.
  const order = ["UDK 004.8:37.02", META.topic, "Karimova Dilnoza Baxtiyorovna, PhD, dotsent", "Annotatsiya.", "Kirish"].map((s) => posOf(xml, s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "bosh blok tartibi buzilgan");
});

test("titul ham, mundarija ham YO'Q — `doc.toc`/`doc.titlePage` e'tiborsiz", async () => {
  const doc = docFor();
  doc.toc = true;
  doc.titlePage = true;
  const { xml } = await xmlOf(doc);
  assert.ok(!xml.includes("TOC \\o"), "mundarija maydoni chiqdi");
  assert.ok(!textNodes(xml).includes("MUNDARIJA"), "mundarija sarlavhasi chiqdi");
  assert.ok(!xml.includes("<w:pageBreakBefore/>"), "titul/mundarija sahifa uzilishi chiqdi");
  assert.ok(!xml.includes('<w:titlePg/>'), "titul sahifasi belgisi chiqdi");
  const t = textNodes(xml);
  assert.ok(!t.some((s) => /Toshkent — \d{4}/.test(s)), "titul «shahar — yil» qatori chiqdi");
  assert.equal(t[0], "UDK 004.8:37.02", "hujjat UDK bilan boshlanishi kerak");
});

/* ══════════════════════════════ formula, jadval, rasm ══════════════════════════════ */

test("formula → `<m:oMath>` (kasr `m:f`), raqami «(1)» o'ng tab-stopda", async () => {
  const { xml } = await xmlOf(docFor());
  assert.equal((xml.match(/<m:oMath>/g) ?? []).length, 1);
  assert.ok(xml.includes("<m:f>"), "kasr yo'q");
  const p = xml.slice(xml.lastIndexOf("<w:p>", xml.indexOf("<m:oMath>")), xml.indexOf("</w:p>", xml.indexOf("<m:oMath>")));
  assert.ok(p.includes('w:val="center"') && p.includes('w:val="right"'), "markaz/o'ng tab-stop yo'q");
  assert.ok(p.includes(">(1)<"), "formula raqami yo'q");
  assert.ok(p.indexOf("<m:oMath>") < p.indexOf(">(1)<"), "raqam formuladan keyin bo'lishi kerak");
});

test("jadval sarlavhasi jadvaldan OLDIN («1-jadval. …» TEPADA), jadval `tableRef` joyida, bitta marta", async () => {
  const { xml } = await xmlOf(docFor());
  const cap = posOf(xml, "1-jadval. Guruhlar bo‘yicha o‘zlashtirish ko‘rsatkichlari");
  const tbl = xml.indexOf("<w:tbl>");
  assert.ok(tbl > 0 && cap < tbl, "sarlavha jadvaldan keyin");
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1, "jadval takrorlangan (langar + tableRef)");
  // Jadval «Natijalar» bo'limi ichida, «Muhokama» dan oldin.
  assert.ok(posOf(xml, "Natijalar") < cap && tbl < posOf(xml, "Muhokama"));
  // Eski markaz/kursiv sarlavha emas: paragraf o'ngga tekislangan (GOST), keepNext bilan.
  const capP = xml.slice(xml.lastIndexOf("<w:p>", cap), cap);
  assert.ok(capP.includes('<w:jc w:val="right"/>'), "jadval sarlavhasi o'ngda emas");
  assert.ok(capP.includes("<w:keepNext/>"), "jadval sarlavhasi jadval bilan birga emas");
});

test("apa/ieee da jadval sarlavhasi CHAPDA", async () => {
  const { xml } = await xmlOf(docFor("imrad_classic", "apa"));
  const cap = posOf(xml, "Table 1. Guruhlar bo‘yicha o‘zlashtirish ko‘rsatkichlari".replace("Table 1.", "1-jadval."));
  const capP = xml.slice(xml.lastIndexOf("<w:p>", cap), cap);
  assert.ok(capP.includes('<w:jc w:val="left"/>'), "APA da sarlavha chapda bo'lishi kerak");
});

test("rasm sarlavhasi rasmdan KEYIN («1-rasm. …» PASTDA): o'rinbosar ham, PNG ham", async () => {
  // O'rinbosar (PNG hali yo'q — WP3 beradi).
  const ph = await xmlOf(docFor());
  const box = posOf(ph.xml, "[1-rasm — sxema]");
  const cap = posOf(ph.xml, "1-rasm. Adaptiv o‘qitish tizimining umumiy tuzilmasi");
  assert.ok(box < cap, "o'rinbosar sarlavhadan keyin");
  const boxP = ph.xml.slice(ph.xml.lastIndexOf("<w:p>", box), box);
  assert.ok(boxP.includes("<w:pBdr>"), "o'rinbosar ramkasiz");
  assert.ok(boxP.includes("<w:keepNext/>"), "o'rinbosar sarlavha bilan birga emas");
  assert.equal(ph.media.length, 0);
  // «Manba: …» sarlavhadan KEYIN (OAK: rasm ostida manba).
  assert.ok(cap < posOf(ph.xml, "Manba: muallif tomonidan tuzilgan"), "manba satri sarlavhadan oldin/yo'q");
  // PNG (`data:` fikstura).
  const png = await xmlOf(docFor("imrad_oak", "oak", { png: PNG_URL }));
  assert.equal((png.xml.match(/<w:drawing>/g) ?? []).length, 1);
  assert.equal(png.media.length, 1);
  assert.ok(png.media[0].endsWith(".png"));
  const draw = png.xml.indexOf("<w:drawing>");
  assert.ok(draw < posOf(png.xml, "1-rasm. Adaptiv o‘qitish tizimining umumiy tuzilmasi"), "sarlavha rasmdan oldin");
  assert.ok(!textNodes(png.xml).includes("[1-rasm — sxema]"), "PNG bor, lekin o'rinbosar ham chiqdi");
  // Rasm foydali kenglikdan oshmaydi: 160 mm = 5 760 000 EMU.
  const cx = Number(/<wp:extent cx="(\d+)"/.exec(png.xml)?.[1] ?? 0);
  assert.ok(cx > 0 && cx <= 160 * 36000, `rasm kengligi ${cx} EMU`);
});

test("saqlangan aktiv `resolveImage` orqali; `null` qaytarsa o'rinbosar", async () => {
  const url = "/api/generations/gen-1/assets/f1";
  const calls: string[] = [];
  const resolveImage = async (u: string): Promise<ImageBytes | null> => {
    calls.push(u);
    return { data: `image/png;base64,${PNG_1X1}`, type: "png" };
  };
  const ok = await xmlOf(docFor("imrad_oak", "oak", { png: url }), { resolveImage });
  assert.deepEqual(calls, [url]);
  assert.equal((ok.xml.match(/<w:drawing>/g) ?? []).length, 1);
  const miss = await xmlOf(docFor("imrad_oak", "oak", { png: url }), { resolveImage: async () => null });
  assert.equal((miss.xml.match(/<w:drawing>/g) ?? []).length, 0);
  assert.ok(textNodes(miss.xml).includes("[1-rasm — sxema]"), "bayt yo'q — o'rinbosar bo'lishi kerak");
  // Tashqi https yuklanmaydi.
  const ext = await xmlOf(docFor("imrad_oak", "oak", { png: "https://example.com/a.png" }));
  assert.equal((ext.xml.match(/<w:drawing>/g) ?? []).length, 0);
});

/* ══════════════════════════════ profil ══════════════════════════════ */

test("chegaralar (`w:pgMar`) va shrift (`w:sz`) nashr profiliga mos: oak 2/2/3/1.5 sm 14 pt, ieee 2.5/2 sm 12 pt", async () => {
  for (const [type, id] of [
    ["imrad_oak", "oak"],
    ["elsevier_ieee_style", "ieee"],
    ["imrad_classic", "apa"],
    ["three_part_uz", "university"],
    ["conference_thesis", "conference"],
  ] as [ArticleTypeId, PublicationProfileId][]) {
    const p = PUBLICATION_PROFILES[id];
    const { xml } = await xmlOf(docFor(type, id));
    const m = /<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)"/.exec(xml);
    assert.ok(m, `${id}: pgMar yo'q`);
    assert.deepEqual(m!.slice(1, 5).map(Number), [p.marginsCm.top, p.marginsCm.right, p.marginsCm.bottom, p.marginsCm.left].map((v) => Math.round(v * CM)), `${id}: chegara`);
    // Tana matni o'lchami — ma'lum paragrafning run'i.
    const at = posOf(xml, "Maqolaning maqsadi — adaptiv o‘qitish tizimining o‘zlashtirishga ta’sirini empirik baholash.");
    const para = xml.slice(xml.lastIndexOf("<w:p>", at), at);
    const sz = /<w:sz w:val="(\d+)"\/>/.exec(para);
    assert.equal(Number(sz?.[1]), p.sizePt * 2, `${id}: tana shrifti`);
    // Jadval shrifti.
    const tbl = xml.slice(xml.indexOf("<w:tbl>"));
    assert.ok(tbl.includes(`<w:sz w:val="${p.tableSizePt * 2}"/>`), `${id}: jadval shrifti ${p.tableSizePt} pt emas`);
    // Interval.
    assert.ok(xml.includes(`w:line="${Math.round(240 * p.line)}"`), `${id}: interval`);
    // Shrift oilasi.
    assert.ok(xml.includes(`w:ascii="${p.font}"`), `${id}: shrift oilasi`);
  }
});

test("`articleProfile` — titul yo'q, jadval langarli, sarlavha BOSH HARFSIZ; `profileFor` eski maqola profilini saqlaydi", () => {
  const P = articleProfile("oak");
  assert.equal(P.id, "article");
  assert.equal(P.titlePage, "none");
  assert.equal(P.tablePlacement, "anchored");
  assert.equal(P.heading.upper, false);
  assert.equal(P.heading.align, "center");
  assert.equal(articleProfile("ieee").heading.align, "left");
  assert.equal(articleProfile("oak", { headingAlign: "left" }).heading.align, "left");
  // Eski maqola (`pubProfile` yo'q) — titul sahifali eski profil.
  assert.equal(profileFor(META).titlePage, "article");
  assert.equal(profileFor({ ...META, pubProfile: "apa" }).titlePage, "none");
});

test("bo'lim sarlavhalari BOSH HARFGA o'tkazilmaydi; ieee da «1. Kirish», «2. …» va chapda", async () => {
  const oak = await xmlOf(docFor());
  const t = textNodes(oak.xml);
  assert.ok(t.includes("Kirish") && !t.includes("KIRISH"));
  const ieee = await xmlOf(docFor("elsevier_ieee_style", "ieee"));
  const ti = textNodes(ieee.xml);
  assert.ok(ti.includes("1. Kirish"), ti.filter((s) => /^\d\./.test(s)).join(" | "));
  assert.ok(ti.includes("2. Adabiyotlar tahlili va metodlar"));
  const hp = ieee.xml.slice(ieee.xml.lastIndexOf("<w:p>", posOf(ieee.xml, "1. Kirish")), posOf(ieee.xml, "1. Kirish"));
  assert.ok(hp.includes('<w:jc w:val="left"/>'), "ieee sarlavhasi chapda emas");
  const ho = oak.xml.slice(oak.xml.lastIndexOf("<w:p>", posOf(oak.xml, "Kirish")), posOf(oak.xml, "Kirish"));
  assert.ok(ho.includes('<w:jc w:val="center"/>'), "oak sarlavhasi markazda emas");
});

/* ══════════════════════════════ adabiyotlar ══════════════════════════════ */

test("OAK: «Foydalanilgan adabiyotlar» + ikkinchi «REFERENCES» ro'yxati; apa da REFERENCES yo'q va raqamsiz", async () => {
  const oak = await xmlOf(docFor());
  const t = textNodes(oak.xml);
  assert.ok(t.includes("Foydalanilgan adabiyotlar"));
  assert.ok(t.includes("REFERENCES"), "OAK ikkinchi ro'yxati yo'q");
  assert.ok(posOf(oak.xml, "Foydalanilgan adabiyotlar") < posOf(oak.xml, "REFERENCES"));
  assert.ok(t.some((s) => s.startsWith("1. Lin C.")), "raqamli satr yo'q");
  // REFERENCES — APA 7 inglizcha («Lin, C., Huang, A., & Lu, O. (2023)…»), raqamsiz (WP5 `cite/translit`).
  assert.equal(t.filter((s) => /^Lin, C\., Huang, A\., & Lu, O\. \(2023\)/.test(s)).length, 1, "REFERENCES satri raqamsiz, bitta");
  const apa = await xmlOf(docFor("imrad_classic", "apa"));
  const ta = textNodes(apa.xml);
  assert.ok(!ta.includes("REFERENCES"), "APA da REFERENCES chiqdi");
  assert.ok(ta.includes("Foydalanilgan adabiyotlar"));
  assert.ok(!ta.some((s) => /^\d+\. (Lin|Ahmad|Karimov)/.test(s)), "APA ro'yxati raqamlangan");
  // APA — osilgan chekinish.
  assert.ok(apa.xml.includes(`w:hanging="${Math.round(1.25 * CM)}"`), "APA osilgan chekinish yo'q");
});

test("iqtiboslar uslubga ko'ra: gost [1] / [1, 2], apa (Lin va b., 2023)", async () => {
  const gost = textNodes((await xmlOf(docFor())).xml);
  assert.ok(gost.includes("[1, 2]") && gost.includes("[1]") && gost.includes("[3]"));
  const apa = textNodes((await xmlOf(docFor("imrad_classic", "apa"))).xml);
  assert.ok(apa.includes("(Lin va b., 2023)"), apa.filter((s) => s.startsWith("(")).join(" | "));
  assert.ok(apa.includes("(Karimov, 2022)"));
});

/* ══════════════════════════════ eski maqola (regressiya) ══════════════════════════════ */

test("eski maqola (`doc.article` yo'q): titul + mundarija + jadval oxirida — avvalgidek", async () => {
  const legacy: AcademicDoc = {
    meta: { ...META, kind: "standard", organization: "TDIU", email: "a@b.uz", degree: "PhD", city: "Toshkent", year: 2026 },
    titlePage: true,
    toc: true,
    sections: [
      { id: "s1", title: "Kirish", blocks: [{ kind: "p", text: "Eski matn [1]." }] },
      { id: "s2", title: "Xulosa", blocks: [{ kind: "p", text: "Tamom." }] },
    ],
    tables: [{ caption: "Eski jadval", headers: ["A"], rows: [["1"]], anchor: "s1" }],
    references: ["Birinchi manba. — T., 2020."],
    abstracts: [{ lang: "uz", label: "Annotatsiya", text: "Qisqa.", keywords: "a, b" }],
  } as unknown as AcademicDoc;
  const { xml } = await xmlOf(legacy);
  const t = textNodes(xml);
  assert.ok(t.includes("MAQOLA"), "titul sarlavhasi yo'q");
  assert.ok(t.includes("Toshkent — 2026"), "titul «shahar — yil» yo'q");
  assert.ok(t.includes("MUNDARIJA"), "mundarija yo'q");
  assert.ok(t.includes("KIRISH"), "bo'lim sarlavhasi BOSH HARFDA bo'lishi kerak (eski profil)");
  assert.ok(t.includes("FOYDALANILGAN ADABIYOTLAR"));
  assert.ok(t.includes("1. Birinchi manba. — T., 2020."));
  assert.ok(!t.includes("UDK"), "eski maqolada UDK chiqmasligi kerak");
  // Jadval hujjat oxirida (adabiyotlardan oldin), langar e'tiborsiz (`tablePlacement: end`).
  assert.ok(xml.indexOf("<w:tbl>") > posOf(xml, "Tamom."), "eski maqolada jadval oxirida bo'lishi kerak");
  assert.ok(xml.includes("<w:titlePg/>"), "titul sahifasi belgisi yo'q");
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

test("LibreOffice namunani ≤3 varaqda chizadi (oak va ieee)", { skip: !hasSoffice() }, async () => {
  for (const [type, id] of [
    ["imrad_oak", "oak"],
    ["elsevier_ieee_style", "ieee"],
  ] as [ArticleTypeId, PublicationProfileId][]) {
    const dir = mkdtempSync(join(tmpdir(), "article-docx-"));
    const { bytes } = await xmlOf(docFor(type, id, { png: PNG_URL }));
    const src = join(dir, `article-${id}.docx`);
    writeFileSync(src, bytes);
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src], { timeout: 240_000, stdio: "ignore" });
    const pdf = readdirSync(dir).find((f) => f.endsWith(".pdf"));
    assert.ok(pdf, `${id}: PDF yaratilmadi`);
    const out = execFileSync("pdfinfo", [join(dir, pdf!)], { encoding: "utf8", timeout: 60_000 });
    const pages = Number(/Pages:\s+(\d+)/.exec(out)?.[1] ?? 0);
    assert.ok(pages >= 1 && pages <= 3, `${id}: namuna ${pages} varaqqa yoyildi`);
  }
});
