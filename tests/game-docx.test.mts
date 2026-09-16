import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { gameProfile, CM } from "../lib/generation/docx-profile.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { GAME_MARGINS_CM, cardCellMm, planGame } from "../lib/generation/games/layout.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * BOSMA O'YIN DOCX (AUDIT-21 WP-B).
 *
 * XML NING O'ZI o'qiladi (`word/document.xml`) — foydalanuvchi aynan
 * shuni oladi. Qulflanadigan qarorlar: titul beti YO'Q, kartalar
 * panjarasi MILLIMETRDA (qator balandligi `exact`), har varaq o'z
 * betida, javoblar varag'i yangi betdan, `lineRule="auto"` hamma joyda.
 *
 * Oxirgi ikki sinov — LibreOffice «ko'zi»: bet soni va old/orqa
 * betlarning KESISH CHIZIQLARI ustma-ust tushishi. Ikkinchisi bu
 * vositaning eng qimmat nuqsonini ushlaydi: chiziqlar siljisa,
 * kesilgan kartaning orqasida qo'shnisining ta'rifi qoladi va buni
 * foydalanuvchi faqat qaychidan keyin bilib qoladi.
 */

async function xmlOf(doc: AcademicDoc) {
  const bytes = await renderDocx(doc);
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  return { xml: await zip.file("word/document.xml")!.async("string"), bytes };
}

function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim(),
    )
    .filter(Boolean);
}

function posOf(xml: string, needle: string): number {
  const i = xml.indexOf(`>${needle}<`);
  assert.ok(i >= 0, `«${needle}» topilmadi`);
  return i;
}

/** `needle` matnini o'z ichiga olgan `<w:p>` paragrafi. */
function paraOf(xml: string, needle: string): string {
  const at = posOf(xml, needle);
  const from = Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at));
  const to = xml.indexOf("</w:p>", at);
  assert.ok(from >= 0 && to > from, `«${needle}» paragrafi topilmadi`);
  return xml.slice(from, to);
}

const mm = (v: number) => Math.round(v * 56.7);

/* ══════════════════════════ titul va shapka ══════════════════════════ */

test("TITUL BETI YO'Q: kartalar hujjati VARAQ SHAPKASIDAN boshlanadi", async () => {
  const { xml } = await xmlOf(sampleGameDoc("flashcards"));
  const t = textNodes(xml);
  assert.equal(gameProfile("flashcards").titlePage, "none");
  assert.ok(!t.some((x) => /VAZIRLIGI|МИНИСТЕРСТВО|MINISTRY/.test(x)), "titul betidagi vazirlik qatori qoldi");
  assert.ok(!/<w:titlePg\s*\/>/.test(xml), "titul beti kolontituli e'lon qilingan");
  assert.ok(t[0].includes("1/2-varaq"), `birinchi tugun varaq shapkasi bo'lishi kerak: «${t[0]}»`);
  // HUJJAT SARLAVHASI kartalar betida umuman chizilmaydi (old/orqa siljimasin).
  assert.ok(!t.includes("FLESH KARTALAR"), "kartalar betiga hujjat sarlavhasi tushdi");
});

test("krossvord shapkasi: nomi MARKAZDA QALIN, turi kursiv, mavzu qatori", async () => {
  const { xml } = await xmlOf(sampleGameDoc("crossword"));
  const t = textNodes(xml);
  assert.equal(t[0], "KROSSVORD");
  const p = paraOf(xml, "KROSSVORD");
  assert.ok(p.includes('<w:jc w:val="center"/>'), "hujjat nomi markazda emas");
  assert.ok(p.includes("<w:b/>"), "hujjat nomi qalin emas");
  assert.ok(paraOf(xml, "Klassik").includes("<w:i/>"), "tur nomi kursiv emas");
  const i = t.indexOf("Mavzu:");
  assert.ok(i >= 0, "mavzu qatori yo'q");
  assert.ok(t[i + 1].includes("Fotosintez"), `mavzu qiymati: ${t[i + 1]}`);
});

/* ══════════════════════════ karta panjarasi ══════════════════════════ */

test("kartalar jadvali: katak kengligi va qator balandligi MILLIMETRDA (`exact`)", async () => {
  const { xml } = await xmlOf(sampleGameDoc("flashcards"));
  const cell = cardCellMm();
  const w = mm(cell.wMm);
  const h = mm(cell.hMm);

  const grids = [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map((m) => m[1]);
  assert.equal(grids.length, 4, "10 karta → 4 ta panjara jadvali (2 old + 2 orqa)");
  for (const g of grids) {
    const cols = [...g.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(cols, [w, w], `katak kengligi ${w} twip (${cell.wMm} mm) bo'lishi kerak`);
  }

  const heights = [...xml.matchAll(/<w:trHeight w:val="(\d+)" w:hRule="(\w+)"\/>/g)].map((m) => [Number(m[1]), m[2]] as const);
  assert.equal(heights.length, 16, "4 varaq × 4 qator");
  for (const [value, rule] of heights) {
    assert.equal(value, h, `qator balandligi ${h} twip (${cell.hMm} mm)`);
    assert.equal(rule, "exact", "balandlik QAT'IY bo'lishi kerak — aks holda uzun ta'rif panjarani siljitardi");
  }
});

test("har varaq O'Z BETIDA: birinchisidan boshqa hammasida `pageBreakBefore`", async () => {
  const { xml } = await xmlOf(sampleGameDoc("flashcards"));
  const breaks = [...xml.matchAll(/<w:pageBreakBefore\s*\/>/g)].length;
  assert.equal(breaks, 3, "4 betdan 3 tasi uzilish bilan boshlanadi (birinchisi — yo'q)");
  // Uzilish aynan VARAQ SHAPKASI paragrafida.
  assert.ok(paraOf(xml, "«Fotosintez atamalari» · 1/2-varaq · orqa yuzlar").includes("<w:pageBreakBefore/>"));
  assert.ok(!paraOf(xml, "«Fotosintez atamalari» · 1/2-varaq · old yuzlar").includes("<w:pageBreakBefore/>"), "birinchi bet bo'sh varaq qoldirardi");
});

test("ORQA bet OYNALI: DOCX katak matnlari ham teskari tartibda", async () => {
  const { xml } = await xmlOf(sampleGameDoc("flashcards"));
  const t = textNodes(xml);
  // Old bet: 1-qator «Fotosintez», «Xlorofill» — shu tartibda.
  assert.ok(t.indexOf("Fotosintez") < t.indexOf("Xlorofill"), "old betda tartib buzilgan");
  // Orqa bet: AVVAL «Xlorofill» ta'rifi, keyin «Fotosintez» niki.
  const defChlorophyll = t.findIndex((x) => x.startsWith("Xloroplastdagi yashil pigment"));
  const defPhoto = t.findIndex((x) => x.startsWith("Yashil o‘simlik bargida"));
  assert.ok(defChlorophyll >= 0 && defPhoto >= 0, "ta'riflar topilmadi");
  assert.ok(defChlorophyll < defPhoto, "orqa bet oynalanmagan — ustunlar almashmadi");
});

test("varaq shapkasi HAR betda bir xil balandlikda: 2 qator, kichik shrift", async () => {
  const { xml } = await xmlOf(sampleGameDoc("flashcards"));
  const plan = planGame(sampleGameDoc("flashcards"));
  const small = plan.page.smallPt * 2;
  const hint = "Ikki tomonlama chop eting va varaqni UZUN chekka bo‘ylab aylantiring; so‘ng chiziqlar bo‘yicha kesing.";
  const hints = textNodes(xml).filter((x) => x === hint);
  assert.equal(hints.length, 4, "ko'rsatma har betda bo'lishi kerak (balandlik o'zgarmasin)");
  const p = paraOf(xml, hint);
  assert.ok(p.includes(`<w:sz w:val="${small}"/>`), `ko'rsatma ${plan.page.smallPt} pt bo'lishi kerak`);
  assert.ok(p.includes("<w:i/>"), "ko'rsatma kursiv emas");
});

/* ══════════════════════════ krossvord ══════════════════════════ */

test("savollar CHEGARASIZ ikki ustunli jadvalda; javoblar YANGI BETDAN", async () => {
  const { xml } = await xmlOf(sampleGameDoc("crossword"));
  const grids = [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)];
  assert.equal(grids.length, 1, "krossvordda faqat savollar jadvali bo'lishi kerak");
  const cols = [...grids[0][1].matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(cols.length, 2, "ikki ustun");
  const tbl = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
  assert.ok(!/w:val="single"/.test(tbl.slice(0, tbl.indexOf("Gorizontal"))), "savollar jadvalida chegara chizig'i qoldi");
  /*
   * Sarlavhalar DVIGATEL bo'limlaridan («Krossvord» / «Javoblar» —
   * `crosswordLabels`), maketning o'z lug'atidan emas; shuning uchun
   * sinov ham rejadan o'qiydi.
   */
  const plan = planGame(sampleGameDoc("crossword"));
  const h1 = plan.body.filter((b): b is Extract<(typeof plan.body)[number], { k: "h1" }> => b.k === "h1");
  assert.equal(h1.length, 2, "to'r va javoblar sarlavhalari");
  assert.ok(paraOf(xml, h1[1].text).includes("<w:pageBreakBefore/>"), "javoblar varag'i yangi betdan boshlanmadi");
  assert.ok(!paraOf(xml, h1[0].text).includes("<w:pageBreakBefore/>"), "to'r birinchi betda qolishi kerak");
});

test("sahifa chegarasi va shrifti PROFILDAN — reja bilan BITTA manbadan", async () => {
  for (const kind of ["crossword", "flashcards"] as const) {
    const plan = planGame(sampleGameDoc(kind));
    const p = gameProfile(kind);
    const m = GAME_MARGINS_CM[kind];
    assert.deepEqual(plan.page.marginsCm, m);
    assert.equal(p.page.margin.left, Math.round(m.left * CM), `${kind}: chap chegara ajralib ketdi`);
    assert.equal(p.page.margin.top, Math.round(m.top * CM), `${kind}: yuqori chegara ajralib ketdi`);
    assert.equal(p.type.size, plan.page.sizePt * 2, `${kind}: shrift o'lchami ajralib ketdi`);
    assert.equal(p.type.line, Math.round(240 * plan.page.line), `${kind}: qator oralig'i ajralib ketdi`);
    assert.equal(p.page.landscape, false, `${kind}: portret bo'lishi kerak`);
  }
});

test("`lineRule=\"auto\"` HAMMA joyda (LibreOffice qatorni qat'iy punkt deb o'qimasin)", async () => {
  for (const kind of ["crossword", "flashcards"] as const) {
    const { xml } = await xmlOf(sampleGameDoc(kind));
    const spacings = [...xml.matchAll(/<w:spacing[^/]*w:line="\d+"[^/]*\/>/g)].map((m) => m[0]);
    assert.ok(spacings.length > 3, `${kind}: qator oralig'i yozilmagan`);
    for (const s of spacings) assert.ok(s.includes('w:lineRule="auto"'), `${kind}: lineRule yo'q — ${s}`);
  }
});

/* ══════════════════════════ LibreOffice (ixtiyoriy) ══════════════════════════ */

function sofficeReady(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 20_000 });
    return existsSync("/usr/bin/pdfinfo");
  } catch {
    return false;
  }
}

const SKIP = sofficeReady() ? false : "LibreOffice yo'q";

async function toPdf(dir: string, name: string, doc: AcademicDoc): Promise<string> {
  const src = join(dir, `${name}.docx`);
  writeFileSync(src, Buffer.from(await renderDocx(doc)));
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src], { stdio: "ignore", timeout: 180_000 });
  const pdf = readdirSync(dir).find((f) => f === `${name}.pdf`);
  assert.ok(pdf, `${name}: PDF yaratilmadi`);
  return join(dir, pdf!);
}

test("LibreOffice: 10 karta → AYNAN 4 bet (2 old + 2 orqa), krossvord ≥ 2 bet, ikkalasi ham PORTRET", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "game-docx-"));
  for (const [kind, min, max] of [
    ["flashcards", 4, 4],
    ["crossword", 2, 3],
  ] as const) {
    const pdf = await toPdf(dir, kind, sampleGameDoc(kind));
    const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8", timeout: 30_000 });
    const pages = Number(/Pages:\s*(\d+)/.exec(info)?.[1] ?? 0);
    assert.ok(pages >= min && pages <= max, `${kind}: ${min}–${max} bet kutilgan, chiqdi ${pages}`);
    const size = /Page size:\s*([\d.]+) x ([\d.]+)/.exec(info);
    assert.ok(size, `${kind}: bet o'lchami topilmadi`);
    assert.ok(Number(size![1]) < Number(size![2]), `${kind}: portret emas (${size![1]} × ${size![2]})`);
  }
});

test(
  "LibreOffice KO'ZI: old va orqa betlarning KESISH CHIZIQLARI ustma-ust tushadi",
  { skip: SKIP || (existsSync("/usr/bin/pdftoppm") ? false : "pdftoppm yo'q") },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "game-eye-"));
    const pdf = await toPdf(dir, "cards", sampleGameDoc("flashcards"));
    execFileSync("pdftoppm", ["-png", "-gray", "-r", "70", pdf, join(dir, "p")], { stdio: "ignore", timeout: 120_000 });

    const sharp = (await import("sharp")).default;
    /** Betdagi GORIZONTAL chiziqlar: qora piksellari ko'p bo'lgan qator indekslari. */
    const lineRows = async (file: string): Promise<number[]> => {
      const img = sharp(readFileSync(file)).greyscale();
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      const rows: number[] = [];
      for (let y = 0; y < info.height; y++) {
        let dark = 0;
        for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 200) dark++;
        /*
         * Nuqtali kesish chizig'i butun panjara eni bo'ylab ketadi va
         * bet kengligining 0,67 ini qoplaydi; eng zich MATN qatori
         * (ikki ustunda to'liq ta'rif) 0,55 da to'xtaydi — o'lchangan
         * raqamlar, 70 dpi da.
         */
        if (dark > info.width * 0.6) rows.push(y);
      }
      return rows;
    };

    const front = await lineRows(join(dir, "p-1.png"));
    const back = await lineRows(join(dir, "p-2.png"));
    assert.ok(front.length >= 5, `old betda kesish chiziqlari topilmadi (${front.length})`);
    /*
     * Chiziq qalinligi 1–2 px bo'lgani uchun qo'shni indekslar guruhga
     * yig'iladi — solishtiriladigan narsa CHIZIQ O'RNI, piksel emas.
     */
    const group = (ys: number[]): number[] => {
      const out: number[] = [];
      for (const y of ys) if (!out.length || y - out[out.length - 1] > 3) out.push(y);
      return out;
    };
    const f = group(front);
    const b = group(back);
    assert.equal(f.length, b.length, `chiziq soni farq qildi: old ${f.length}, orqa ${b.length}`);
    for (let i = 0; i < f.length; i++) {
      assert.ok(Math.abs(f[i] - b[i]) <= 1, `${i}-chiziq siljidi: old ${f[i]} px, orqa ${b[i]} px (kesilgan karta qo'shnisining ta'rifini olardi)`);
    }
  },
);
