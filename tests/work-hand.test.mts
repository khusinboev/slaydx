import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { WORK_HAND_PARAMS } from "../lib/generation/work-params.ts";
import { workInputFromValues, encodeWorkValues } from "../lib/generation/work/input.ts";
import { buildWorkDoc, EMPTY_RESEARCH_STATS } from "../lib/generation/work/engine.ts";
import { planWork } from "../lib/generation/work/layout.ts";
import { workFlow } from "../lib/viewers/flow.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { pageGateApplies } from "../lib/generation/index.ts";
import { sampleWorkDoc } from "../lib/generation/work/samples.ts";
import {
  HAND_FONTS,
  HAND_FONT_IDS,
  HAND_INK_HEX,
  HAND_PAGE,
  HAND_PAPER_SPECS,
  handCoverLines,
  handCssVars,
  handFaceOf,
  handFaces,
  handFontFaceCss,
  handCapsOf,
  handFormulaText,
  HAND_FIELD_OF,
  HAND_PARAM_IDS,
  restrictHand,
  type HandParamId,
  handPageMargins,
  handPageVars,
  handRedSide,
  HAND_PAGE_A5,
  twToPx,
  handGeometry,
  handSegments,
  handTitleSegments,
  handStyleOf,
  handToneHex,
  handWordJitter,
  handWordPieces,
  handText,
  normalizeHand,
  twToMm,
  type WorkHand,
} from "../lib/generation/work/handwriting.ts";
import { HAND_REQUIRED_ALL, HAND_REQUIRED_TEXT } from "../lib/generation/work/handwriting-coverage.ts";
import { fontCodepoints, fontMetrics, fontTableTags } from "../lib/generation/work/font-cmap.ts";
import { paperPng, paperPx, PAPER_PX } from "../lib/generation/work/paper-png.ts";
import type { AcademicDoc, Figure, Reference } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * QO'LYOZMA MUSTAQIL ISH (Program 17 band 10) — shartnoma testlari:
 * shrift qamrovi + `ʻ` o'rinbosari, forma → model → reja uslubi → DOCX →
 * ko'ruvchi oqimi, har parametr uchun differensial zond, varaq PNG si.
 */

const tool = TOOL_BY_ID["mustaqil-ish"];
const FONT_DIR = new URL("../public/fonts/handwriting/", import.meta.url);
const fontBytes = (file: string) => new Uint8Array(readFileSync(new URL(file, FONT_DIR)));

/* ───────────────────────────── shrift qamrovi ───────────────────────────── */

test("shrift qamrovi: har belgi o'z yuzida bor; yuz yopmaydigan belgi FAQAT fallback jadvalida (va o'rinbosar bor)", () => {
  for (const id of HAND_FONT_IDS) {
    const spec = HAND_FONTS[id];
    const cmaps = new Map(handFaces(id).map((f) => [f.file, fontCodepoints(fontBytes(f.file))]));
    for (const ch of HAND_REQUIRED_ALL) {
      const cp = ch.codePointAt(0)!;
      const face = handFaceOf(id, cp);
      const has = cmaps.get(face.file)!.has(cp);
      if (spec.fallback[cp] === undefined) {
        assert.ok(has, `${spec.label}: «${ch}» (U+${cp.toString(16)}) ${face.family} da yo'q, fallback ham yo'q`);
      } else {
        // fallback ro'yxati eskirmasin: yuz haqiqatan yopmaydi, o'rinbosarni esa yuz yopadi.
        assert.ok(!has, `${spec.label}: «${ch}» yuzda bor — fallback keraksiz`);
        const to = spec.fallback[cp]!;
        assert.ok(cmaps.get(handFaceOf(id, to).file)!.has(to), `${spec.label}: o'rinbosar U+${to.toString(16)} yuzda yo'q`);
      }
    }
    // o'zbek kirill va lotin harflari fallback'siz yopiladi.
    for (const group of ["uzbekCyrillic", "cyrillic", "latin"] as const) {
      for (const ch of HAND_REQUIRED_TEXT[group]) assert.equal(spec.fallback[ch.codePointAt(0)!], undefined, `${spec.label}: ${group} «${ch}» fallback'ga tushmasligi kerak`);
    }
  }
});

test("shrift fayllari STATIK (o'zgaruvchan emas): LibreOffice PDF eksporti `fvar` shriftni buzadi (matn tushib qoladi, harflar oralig'i yoriladi)", () => {
  for (const id of HAND_FONT_IDS) {
    for (const f of handFaces(id)) assert.ok(!fontTableTags(fontBytes(f.file)).includes("fvar"), `${f.file}: o'zgaruvchan shrift — statik Regular nusxa kerak (fonttools varLib.instancer wght=400)`);
  }
  assert.ok(!fontTableTags(fontBytes(HAND_FONTS.school.title!.file)).includes("fvar"));
});

test("shrift o'lchamlari (`hhea`) reyestrdagi qiymatlarga teng — ko'ruvchi asosi shundan hisoblanadi", () => {
  for (const id of HAND_FONT_IDS) {
    const spec = HAND_FONTS[id];
    const m = fontMetrics(fontBytes(spec.file));
    assert.equal(m.unitsPerEm, 1000);
    assert.ok(Math.abs(m.ascent / m.unitsPerEm - spec.ascent) < 0.001, `${spec.label}: ascent`);
    assert.ok(Math.abs(m.descent / m.unitsPerEm - spec.descent) < 0.001, `${spec.label}: descent`);
  }
});

test("o'rinbosar: `ʻ`/`ʼ` faqat shrift yopmasa almashadi (maktab/qalam: `‘`/`’`), boshqa belgilarga tegmaydi", () => {
  for (const id of HAND_FONT_IDS) {
    const fb = HAND_FONTS[id].fallback;
    assert.equal(handText(id, "oʻzbek gʻoya"), "o‘zbek g‘oya");
    const apostrophe = fb[0x2bc] === undefined ? "ʼ" : "’";
    assert.equal(handText(id, `maʼno o‘ 'x' ўқув`), `ma${apostrophe}no o‘ 'x' ўқув`, `${id}: ʼ, ‘, ' va kirill`);
  }
});

test("yuzlar: maktab = lotin Playwrite + kirill Marck (+ Қ Ғ Ҳ Bad Script), qalam = Marck + Bad Script; o'zbek harflari to'g'ri yuzga tushadi", () => {
  const fam = (id: "school" | "pen" | "badscript", ch: string) => handFaceOf(id, ch.codePointAt(0)!).family;
  assert.equal(fam("school", "a"), "Playwrite US Trad");
  assert.equal(fam("school", "ў"), "Marck Script");
  assert.equal(fam("school", "№"), "Marck Script", "Playwrite № ni yopmaydi");
  for (const ch of "ҚқҒғҲҳ") assert.equal(fam("school", ch), "Bad Script", ch);
  assert.equal(fam("pen", "a"), "Marck Script");
  assert.equal(fam("pen", "қ"), "Bad Script");
  assert.equal(fam("badscript", "қ"), "Bad Script");
  // Bo'laklash: bo'shliq oldingi harf yuzida, matn birlashtirilganda o'zgarmaydi, o'rinbosar qo'llangan.
  const segs = handSegments("school", "Sana: бугун, қалам 12 oʻ");
  assert.equal(segs.map((x) => x.text).join(""), "Sana: бугун, қалам 12 o‘");
  assert.deepEqual(segs.map((x) => x.face.family), ["Playwrite US Trad", "Marck Script", "Playwrite US Trad", "Bad Script", "Marck Script", "Playwrite US Trad"]);
  assert.deepEqual(handSegments("badscript", "abc қ").map((x) => x.face.family), ["Bad Script"], "yo'ldoshsiz shrift — bitta bo'lak");
  assert.deepEqual(handSegments("school", ""), []);
});

test("muqova sarlavhasi: Great Vibes faqat o'zi yopgan belgilarda (haqiqiy `cmap` bilan), Қ Ғ Ҳ va ‘ oddiy yuzda; yo'ldoshsiz/sarlavhasiz shriftda oddiy", () => {
  for (const id of ["school", "pen"] as const) {
    const t = HAND_FONTS[id].title!;
    const cps = fontCodepoints(fontBytes(t.file));
    for (const [lo, hi] of t.ranges) for (let cp = lo; cp <= hi; cp++) assert.ok(cps.has(cp), `${id}: Great Vibes U+${cp.toString(16)} yo'q, lekin diapazonda`);
    // talab qilingan harflardan Қ Ғ Ҳ dan tashqari hammasi sarlavha yuzida.
    for (const ch of HAND_REQUIRED_TEXT.latin + HAND_REQUIRED_TEXT.cyrillic + "ЎўЁё") assert.ok(t.ranges.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi), `${id}: «${ch}»`);
  }
  const segs = handTitleSegments("school", "Мустақил иш oʻ");
  assert.equal(segs.map((x) => x.text).join(""), "Мустақил иш o‘");
  assert.deepEqual(segs.map((x) => [x.face.family, x.title]), [["Great Vibes", true], ["Bad Script", false], ["Great Vibes", true]], "қ — Bad Script, qolgani Great Vibes");
  assert.ok(handTitleSegments("badscript", "Mustaqil ish").every((x) => !x.title && x.face.family === "Bad Script"));
  assert.equal(HAND_FONTS.caveat.title, undefined);
});

test("DOCX muqovasi: sarlavha qatori Great Vibes (embed ham), matn Playwrite; ko'ruvchi CSS: --hand-title-family faqat sarlavhali shriftda", async () => {
  const doc = sampleWorkDoc({ topic: "Qo‘lyozma sinovi", workLabel: "Mustaqil ish", language: "uz", toolId: "mustaqil-ish" } as never, { genre: "independent", kind: "written" });
  doc.work!.hand = { ink: "blue", paper: "lined", font: "school", cover: "calligraphy" };
  const x = await unzip(await renderDocx(doc));
  assert.match(x.document, /w:rFonts w:ascii="Great Vibes"/, "muqova sarlavhasi Great Vibes");
  doc.work!.hand = { ink: "blue", paper: "lined", font: "school" };
  assert.doesNotMatch((await unzip(await renderDocx(doc))).document, /Great Vibes/, "standart muqova oddiy shriftda");
  doc.work!.hand = { ink: "blue", paper: "lined", font: "school", cover: "calligraphy" };
  assert.match(x.document, /w:rFonts w:ascii="Playwrite US Trad"/);
  const zip = await JSZip.loadAsync(await renderDocx(doc));
  const embedded = Object.keys(zip.files).filter((f) => /^word\/fonts\/.+\.odttf$/.test(f));
  assert.equal(embedded.length, 4, `4 yuz joylanadi: ${embedded.join(", ")}`);
  assert.equal(handCssVars(handStyleOf({ ink: "blue", paper: "lined", font: "school", cover: "calligraphy" }))["--hand-title-family"], '"SlaydX Title Maktab", "SlaydX Maktab"');
  assert.equal(handCssVars(handStyleOf({ ink: "blue", paper: "lined", font: "school" }))["--hand-title-family"], undefined, "standart: sarlavha yuzi yo'q");
  assert.equal(handCssVars(handStyleOf({ ink: "blue", paper: "lined", font: "caveat" }))["--hand-title-family"], undefined);
});

test("jonli yozuv: deterministik, chegaralangan (±1 pt, ≤16 % oqarish), birlashtirilsa matn tiklanadi; `lively` faqat yoqilganda modelda", () => {
  for (let i = 0; i < 200; i++) {
    const a = handWordJitter(i, "salom");
    assert.deepEqual(a, handWordJitter(i, "salom "), "oxiridagi bo'shliq ta'sir qilmaydi");
    assert.ok(Math.abs(a.dyHalfPt) <= 2 && Number.isInteger(a.dyHalfPt) && a.tonePct >= 0 && a.tonePct <= 16);
  }
  const spread = new Set(Array.from({ length: 200 }, (_, i) => handWordJitter(i, "so'z").dyHalfPt));
  assert.ok(spread.size >= 4, "siljishlar xilma-xil");
  const text = "  Mustaqil  ish — qo‘lyozma\n namuna ";
  assert.equal(handWordPieces(text).join(""), text);
  assert.equal(handToneHex("1B3AA6", 0), "1B3AA6");
  assert.equal(handToneHex("1B3AA6", 100), "FFFFFF");
  assert.deepEqual(normalizeHand({ lively: "on" }), { ink: "blue", paper: "lined", font: "school", lively: true });
  assert.deepEqual(normalizeHand({ lively: "off" }), { ink: "blue", paper: "lined", font: "school" });
  assert.deepEqual(normalizeHand({ lively: true }).lively, true);
});

test("qo'shimcha tanlovlar: normalizeHand faqat eski xulqdan farqlisini saqlaydi; sarlavhasiz shriftda `cover` tashlanadi", () => {
  assert.deepEqual(normalizeHand({ headings: "plain", underline: "off", cover: "calligraphy" }), { ink: "blue", paper: "lined", font: "school", headings: "plain", cover: "calligraphy", underline: false });
  assert.deepEqual(normalizeHand({ headings: "caps", underline: "on", cover: "plain" }), { ink: "blue", paper: "lined", font: "school" });
  assert.equal(normalizeHand({ font: "caveat", cover: "calligraphy" }).cover, undefined, "Caveat da kalligrafik sarlavha yuzi yo'q");
});

test("sarlavha harf shakli: oddiy — «Kirish», «1-bob. …», «Mundarija» (modelning o'z sarlavhasi o'zgarmaydi); BOSH HARFLI — eski; mundarija = tana", () => {
  const mk = (hand: WorkHand) => {
    const doc = sampleWorkDoc({ topic: "Qo‘lyozma sinovi", workLabel: "Mustaqil ish", language: "uz", toolId: "mustaqil-ish" } as never, { genre: "independent", kind: "written" });
    doc.work!.hand = hand;
    return planWork(doc);
  };
  const base = { ink: "blue", paper: "lined", font: "school" } as const;
  const caps = mk(base);
  const plain = mk({ ...base, headings: "plain" });
  const heads = (p: ReturnType<typeof planWork>) => p.body.filter((b) => b.k === "h1").map((b) => (b as { text: string }).text);
  assert.ok(heads(caps).includes("KIRISH") && heads(caps).some((t) => /^1-BOB\. [A-Z‘’' ,.-]+$/.test(t)), heads(caps).join(" | "));
  assert.ok(heads(plain).includes("Kirish") && heads(plain).includes("Xulosa"), heads(plain).join(" | "));
  assert.ok(heads(plain).some((t) => /^1-bob\. [A-Z][a-z]/.test(t)), heads(plain).join(" | "));
  assert.equal(plain.labels.toc, "Mundarija");
  assert.equal(plain.refsLabel, "Foydalanilgan adabiyotlar");
  assert.equal(caps.labels.toc, caps.labels.toc.toUpperCase());
  // mundarija qatorlari tanadagi sarlavhalar bilan AYNAN bir xil.
  const bodyHeads = new Set(plain.body.filter((b) => b.k === "h1" || b.k === "h2").map((b) => (b as { text: string }).text));
  for (const r of plain.toc.filter((r) => r.level === 1 || r.level === 2)) assert.ok(bodyHeads.has(r.text) || r.text === plain.refsLabel || /^\d-ilova/i.test(r.text), `mundarija: ${r.text}`);
});

test("shrift fayllari va OFL litsenziyalari repoda; ko'ruvchi URL i fayl nomiga mos; globals.css @font-face lar `handFontFaceCss` bilan bir xil", () => {
  for (const id of HAND_FONT_IDS) {
    for (const f of handFaces(id)) {
      assert.equal(f.url, `/fonts/handwriting/${f.file}`);
      assert.ok(fontBytes(f.file).length > 50_000, f.file);
    }
  }
  for (const f of ["OFL-Caveat.txt", "OFL-BadScript.txt", "OFL-MarckScript.txt", "OFL-PlaywriteUSTrad.txt", "OFL-GreatVibes.txt"]) {
    assert.match(readFileSync(new URL(f, FONT_DIR), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i, f);
  }
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/\s+/g, " ");
  // Har `@font-face{...}` ni normallashtiramiz va globals.css da AYNAN shunday blok borligini tekshiramiz.
  const norm = (b: string) => b.replace(/\s+/g, "").replace(/;font-display:swap/, "").replace(/format\("truetype"\)/, "").replace(/;$/, "");
  const inCss = new Set([...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => norm(m[1]!)));
  for (const block of handFontFaceCss().split("\n")) {
    const body = /@font-face\{(.*)\}$/.exec(block)![1]!;
    assert.ok(inCss.has(norm(body)), `globals.css da yo'q: ${block}`);
  }
});

/* ───────────────────────────── geometriya ───────────────────────────── */

test("layout: legacy geometry is untouched; 1-cell rows, A5, two-up and margin modes derive from one place", () => {
  // Legacy (no layout) is byte-identical to what existing jobs were rendered with.
  const legacy = handGeometry("grid", "school");
  assert.equal(legacy.pitchTw, 567);
  assert.equal(legacy.margins.top, HAND_PAGE.topTw);
  assert.equal(legacy.pageFormat, "a4");
  assert.equal(legacy.marginMode, "left");
  // 1 cell per row: 5 mm rows, first ruling on a whole 5 mm from the sheet edge.
  const one = handGeometry("grid", "school", { cells: 1 });
  assert.equal(one.pitchTw, 283);
  assert.equal(one.cellsPerRow, 1);
  assert.ok(one.lines > legacy.lines * 1.9, `${one.lines} rows vs ${legacy.lines}`);
  assert.ok(Math.abs(one.docxRuleY0Mm / 5 - Math.round(one.docxRuleY0Mm / 5)) < 0.04, `first ruling ${one.docxRuleY0Mm} mm is not on the 5 mm grid`);
  assert.equal(handGeometry("lined", "school", { cells: 1 }).pitchTw, 510, "lined paper has no cells");
  // A5 is exactly half of the A4 landscape sheet; two-up only changes the export sheet.
  const a5 = handGeometry("grid", "school", { format: "a5", cells: 1 });
  const two = handGeometry("grid", "school", { format: "a5x2", cells: 1 });
  assert.equal(a5.page.widthTw, HAND_PAGE_A5.widthTw);
  assert.equal(a5.sheetTw.width, a5.page.widthTw);
  assert.deepEqual(two.sheetTw, { width: 2 * HAND_PAGE_A5.widthTw, height: HAND_PAGE_A5.heightTw });
  assert.equal(two.pageFormat, "a5");
  assert.equal(two.lines, a5.lines);
  // Blank / print: nothing is drawn, margins are the symmetric printing margins.
  for (const paper of ["blank", "print"] as const) {
    const g = handGeometry(paper, "school", { cells: 1 });
    assert.equal(g.marginMode, "none");
    assert.equal(handRedSide(g, 0), null);
    assert.equal(g.margins.left, g.page.plainLeftTw);
    assert.ok(Math.abs(g.docxRuleY0Mm / 5 - Math.round(g.docxRuleY0Mm / 5)) < 0.04, `${paper} rows must sit on the 5 mm grid`);
  }
});

test("margin line: alternate swaps the text margins and the line side on even pages, width stays equal; none draws nothing", () => {
  const g = handGeometry("grid", "school", { margin: "alternate", cells: 1 });
  assert.deepEqual(handPageMargins(g, 0), { left: g.page.leftTw, right: g.page.rightTw });
  assert.deepEqual(handPageMargins(g, 1), { left: g.page.rightTw, right: g.page.leftTw });
  assert.equal(handRedSide(g, 0), "left");
  assert.equal(handRedSide(g, 1), "right");
  assert.equal(handRedSide(g, 2), "left");
  assert.equal(g.contentTw, g.page.widthTw - g.page.leftTw - g.page.rightTw);
  const style = handStyleOf({ ink: "blue", paper: "grid", font: "school", margin: "alternate", cells: 1 });
  const odd = handPageVars(style, 0);
  const even = handPageVars(style, 1);
  const pageW = twToPx(g.page.widthTw);
  assert.ok(Number.parseFloat(odd["--hand-red-x"]!) < 100, "odd: line at the left");
  assert.ok(Math.abs(Number.parseFloat(even["--hand-red-x"]!) - (pageW - 20 * 96 / 25.4 - Number.parseFloat(even["--hand-red-w"]!))) < 0.01, "even: line 20 mm from the right edge");
  assert.notEqual(odd["--hand-pad"], even["--hand-pad"]);
  // `left` keeps both pages identical; `none` has no line width.
  const left = handStyleOf({ ink: "blue", paper: "grid", font: "school" });
  assert.deepEqual(handPageVars(left, 0), handPageVars(left, 1));
  const none = handStyleOf({ ink: "blue", paper: "grid", font: "school", margin: "none" });
  assert.equal(handPageVars(none, 0)["--hand-red-w"], "0px");
  // The normalised choice never stores what the paper cannot use.
  assert.equal(normalizeHand({ paper: "blank", margin: "alternate" }).margin, undefined);
  assert.equal(normalizeHand({ paper: "lined", cells: 1 }).cells, undefined);
  assert.deepEqual(normalizeHand({ paper: "grid", cells: "1", format: "a5x2", margin: "alternate" }), { ink: "blue", paper: "grid", font: "school", cells: 1, format: "a5x2", margin: "alternate" });
});

test("geometriya: butun qatorlar sahifaga sig'adi, pastki chegara yetarli, matn asosi qator balandligining 80 %", () => {
  for (const paper of ["lined", "grid"] as const) {
    for (const font of HAND_FONT_IDS) {
      const g = handGeometry(paper, font);
      assert.equal(g.pitchTw, HAND_PAPER_SPECS[paper].pitchTw);
      assert.ok(g.margins.bottom >= HAND_PAGE.bottomMinTw - 20, `${paper}: pastki chegara`);
      const body = HAND_PAGE.heightTw - g.margins.top - g.margins.bottom;
      assert.ok(body >= g.lines * g.pitchTw && body < (g.lines + 1) * g.pitchTw, `${paper}: ${g.lines} qator sig'adi, ${g.lines + 1} sig'maydi`);
      assert.ok(Math.abs(g.docxRuleY0Mm - twToMm(g.margins.top + 0.8 * g.pitchTw)) < 1e-9);
    }
  }
  assert.equal(handGeometry("lined", "badscript").lines, 29);
  assert.equal(handGeometry("grid", "badscript").lines, 26);
});

/* ───────────────────────────── forma → kirish ───────────────────────────── */

test("workInputFromValues: only services with capabilities (independent, referat), only workView=hand; noma'lum qiymat standartga tushadi", () => {
  const v: FormValues = { topic: "T", workView: "hand", handInk: "purple", handPaper: "grid", handFont: "caveat" };
  assert.deepEqual(workInputFromValues(v, "independent").hand, { ink: "purple", paper: "grid", font: "caveat" });
  assert.equal(workInputFromValues({ ...v, workView: "plain" }, "independent").hand, undefined);
  assert.equal(workInputFromValues(v, "coursework").hand, undefined, "kurs ishi daftarga ko'chirilmaydi");
  assert.deepEqual(workInputFromValues(v, "referat").hand, { ink: "purple", paper: "grid", font: "caveat" }, "referat offers handwriting too");
  assert.deepEqual(workInputFromValues({ workView: "hand", handInk: "red", handPaper: "x", handFont: "comic" }, "independent").hand, { ink: "blue", paper: "lined", font: "school" });
  assert.deepEqual(normalizeHand({}), { ink: "blue", paper: "lined", font: "school" });
});

test("encodeWorkValues ↔ workInputFromValues: qo'lyozma tanlovi aylanib keladi", () => {
  const input = workInputFromValues({ topic: "T", workView: "hand", handInk: "black", handPaper: "grid", handFont: "caveat" }, "independent");
  const back = workInputFromValues(encodeWorkValues(input), "independent");
  assert.deepEqual(back.hand, input.hand);
  const plain = workInputFromValues({ topic: "T" }, "independent");
  assert.equal(encodeWorkValues(plain).workView, "plain");
  assert.ok(!("handInk" in encodeWorkValues(plain)));
});

/* ───────────────────────────── hujjat quruvchi (engine) ───────────────────────────── */

const BASE: FormValues = {
  topic: "Suv resurslarini muhofaza qilish",
  workKind: "written",
  subjectProfile: "natural",
  language: "uz",
  pages: "10-15",
  university: "Toshkent davlat universiteti",
  author: "Aliyev Ali — 3-kurs, 301-guruh",
  teacher: "Rahimov B.",
  city: "Toshkent",
  ministry: "oliy",
  includeVisuals: false,
  figureCount: 0,
  tableCount: 0,
  refsMin: 5,
};
const REFS: Reference[] = [{ id: "W1", kind: "article", title: "Water", authors: ["Smith J."], year: 2021, verified: "openalex", cited: false }];
const para = (i: number) => `Bu ${i}-paragraf: suv resurslari oʻzbek hududida gʻoyat muhim, ya’ni oʻqish va oʻrganish kerak. `.repeat(5).trim();
const INTRO = { relevance: "Dolzarblik.", aim: "Maqsad.", tasks: "Vazifalar.", structure: "Tuzilma." };
const stubComplete = (async (role: LlmRole, _system: string, user: string) => {
  const usage = { provider: "stub", model: "stub-1", inputTokens: 5, outputTokens: 5 };
  const reply = (text: string) => ({ text, usage });
  if (role === "judge") return reply("{}");
  if (user.startsWith("Plan the body")) {
    return reply(JSON.stringify({ chapters: [{ title: "Nazariy asoslar", paragraphs: [{ title: "Tushuncha", brief: "x" }, { title: "Tahlil", brief: "y" }] }], intro: INTRO }));
  }
  if (user.startsWith("Write the INTRODUCTION") || user.startsWith("The previous introduction")) return reply(JSON.stringify({ parts: INTRO }));
  if (user.startsWith("Write the paragraph")) return reply(JSON.stringify({ blocks: [{ kind: "p", text: `${para(1)} [W1].` }] }));
  if (user.startsWith("Write the CONCLUSION")) return reply(JSON.stringify({ blocks: [{ kind: "p", text: `Xulosa: ${para(3)} [W1].` }] }));
  return reply("{}");
}) as never;

async function build(values: FormValues): Promise<AcademicDoc> {
  const v = { ...BASE, ...values };
  const built = await buildWorkDoc(extractMeta(tool, v), v, {
    deadline: Date.now() + 90_000,
    complete: stubComplete,
    research: async () => ({ refs: REFS.map((r) => ({ ...r })), stats: { ...EMPTY_RESEARCH_STATS } }),
    buildFigures: async (figs: Figure[]) => figs,
    polish: false,
    now: new Date("2026-10-24T10:00:00Z"),
    year: 2026,
  });
  assert.ok(built, "hujjat qurilishi kerak");
  return built.doc;
}

type Docx = { document: string; header: string; styles: string; fontTable: string; media: string[]; names: string[] };
async function unzip(bytes: Uint8Array): Promise<Docx> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const read = async (n: string) => (zip.file(n) ? zip.file(n)!.async("string") : "");
  const headers = await Promise.all(names.filter((n) => /^word\/header\d*\.xml$/.test(n)).sort().map(read));
  const media = await Promise.all(names.filter((n) => n.startsWith("word/media/")).sort().map(async (n) => `${n}:${(await zip.file(n)!.async("nodebuffer")).length}:${(await zip.file(n)!.async("nodebuffer")).subarray(0, 64).toString("hex")}`));
  return { document: await read("word/document.xml"), header: headers.join("\n"), styles: await read("word/styles.xml"), fontTable: await read("word/fontTable.xml"), media, names };
}

/** Bir parametr → to'rtta kuzatiladigan qatlam: model, reja uslubi, DOCX, ko'ruvchi. */
async function layers(values: FormValues) {
  const doc = await build(values);
  const plan = planWork(doc);
  const docx = await unzip(await renderDocx(doc));
  return {
    model: JSON.stringify(doc.work!.hand ?? null),
    plan: JSON.stringify(plan.style ?? null),
    docx: JSON.stringify({ document: docx.document, header: docx.header, styles: docx.styles, media: docx.media }),
    viewer: JSON.stringify(plan.style ? handCssVars(plan.style) : null),
  };
}

test("differensial zond: workView/handInk/handPaper/handFont HAR BIRI model, reja, DOCX va ko'ruvchini o'zgartiradi", async () => {
  const failures: string[] = [];
  for (const p of WORK_HAND_PARAMS) {
    const base = p.probeWith ?? {};
    const a = await layers({ ...base, [p.id]: p.probeA });
    const b = await layers({ ...base, [p.id]: p.probeB });
    for (const layer of ["model", "plan", "docx", "viewer"] as const) {
      if (a[layer] === b[layer]) failures.push(`${p.id} → ${layer}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar:\n  ${failures.join("\n  ")}`);
});

test("narx qo'lyozma tanloviga bog'liq emas (oddiy mustaqil ish bilan bir xil)", () => {
  for (const p of WORK_HAND_PARAMS) {
    const base = { ...BASE, ...(p.probeWith ?? {}) };
    assert.equal(priceFor(tool, { ...base, [p.id]: p.probeA }), priceFor(tool, { ...base, [p.id]: p.probeB }), p.id);
  }
});

/* ───────────────────────────── reja uslubi ───────────────────────────── */

test("planWork: `doc.work.hand` → `style` (siyoh HEX, oila, fayl); oddiy hujjatda `style` YO'Q va tartib bir xil", async () => {
  const hand: WorkHand = { ink: "purple", paper: "grid", font: "caveat" };
  const doc = await build({ workView: "hand", handInk: hand.ink, handPaper: hand.paper, handFont: hand.font });
  assert.deepEqual(doc.work!.hand, hand, "forma qiymati modelga yetib keldi");
  const plan = planWork(doc);
  assert.equal(plan.style?.kind, "handwritten");
  assert.equal(plan.style?.inkHex, HAND_INK_HEX.purple);
  assert.equal(plan.style?.family, "Caveat");
  assert.equal(plan.style?.fontFile, "Caveat-Regular.ttf");
  assert.equal(plan.style?.paper, "grid");
  const plain = await build({});
  assert.equal(plain.work!.hand, undefined);
  assert.equal(planWork(plain).style, undefined);
  // MAZMUN va TARTIB o'zgarmaydi: oddiy va qo'lyozma reja bir xil bandlar/raqamlar beradi.
  const strip = (p: ReturnType<typeof planWork>) => JSON.stringify({ toc: p.toc, body: p.body, refs: p.refs, numbers: p.numbers });
  assert.equal(strip(plan), strip(planWork(plain)));
});

/* ───────────────────────────── DOCX ───────────────────────────── */

const DOC_HAND = (): AcademicDoc => {
  const doc = sampleWorkDoc({ topic: "Qo‘lyozma sinovi", workLabel: "Mustaqil ish", language: "uz", toolId: "mustaqil-ish" } as never, { genre: "independent", kind: "written" });
  doc.work!.hand = { ink: "blue", paper: "lined", font: "badscript" };
  return doc;
};

test("DOCX: qo'lyozma shrifti, siyoh rangi, aniq qator balandligi, varaq foni (header rasmi, matn ORQASIDA), chegaralar", async () => {
  const x = await unzip(await renderDocx(DOC_HAND()));
  const g = handGeometry("lined", "badscript");
  assert.match(x.document, /w:rFonts w:ascii="Bad Script"/, "matn qo'lyozma shriftida");
  assert.ok(!/w:rFonts w:ascii="Times New Roman"/.test(x.document), "Times New Roman qolmagan");
  // HAR matnli run qo'lyozma shriftida va siyoh rangida (bittasi tushib qolsa Word uni boshqa shriftda chizadi).
  const textRuns = [...x.document.matchAll(/<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:t[ >](?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g)].map((m) => m[0]);
  assert.ok(textRuns.length > 40, `matnli run'lar soni: ${textRuns.length}`);
  const noFont = textRuns.filter((r) => !r.includes('w:rFonts w:ascii="Bad Script"'));
  const noInk = textRuns.filter((r) => !r.includes(`w:color w:val="${HAND_INK_HEX.blue}"`));
  assert.deepEqual([noFont.length, noInk.length], [0, 0], `shriftsiz run: ${noFont[0] ?? ""} | rangsiz run: ${noInk[0] ?? ""}`);
  assert.match(x.document, new RegExp(`w:color w:val="${HAND_INK_HEX.blue}"`), "siyoh rangi");
  assert.match(x.document, new RegExp(`w:sz w:val="${g.sizePt * 2}"`), "yozuv o'lchami");
  assert.match(x.document, new RegExp(`w:spacing[^>]*w:line="${g.pitchTw}"[^>]*w:lineRule="exact"|w:spacing[^>]*w:lineRule="exact"[^>]*w:line="${g.pitchTw}"`), "qator = daftar oralig'i, EXACT");
  assert.ok(!/w:lineRule="auto"/.test(x.document), "qo'lyozmada auto interval yo'q");
  assert.match(x.styles, new RegExp(`w:lineRule="exact"`), "standart abzats uslubi ham exact");
  // Barcha before/after — qator oralig'ining butun karrasi (matn chiziqda qoladi).
  for (const m of x.document.matchAll(/w:(?:before|after)="(\d+)"/g)) assert.equal(Number(m[1]) % g.pitchTw, 0, `bo'shliq ${m[1]} qator karrasi emas`);
  // Varaq foni: header'dagi langarlangan, matn ORQASIDAGI rasm.
  assert.match(x.header, /<wp:anchor[^>]*behindDoc="1"/, "rasm matn orqasida");
  assert.match(x.header, /relativeFrom="page"/, "sahifaga nisbatan");
  assert.ok(x.media.some((m) => m.startsWith("word/media/")), "PNG ilova qilingan");
  assert.match(x.document, new RegExp(`w:pgMar[^>]*w:top="${g.margins.top}"`), "tepa chegara");
  assert.match(x.document, new RegExp(`w:pgMar[^>]*w:left="${g.margins.left}"`), "chap chegara");
  assert.match(x.fontTable, /Bad Script/, "shrift jadvalda");
});

test("DOCX: oddiy mustaqil ish O'ZGARMAGAN — Times New Roman, lineRule=auto, varaq foni YO'Q", async () => {
  const doc = DOC_HAND();
  delete doc.work!.hand;
  const x = await unzip(await renderDocx(doc));
  assert.match(x.document, /w:lineRule="auto"/);
  assert.ok(!/w:lineRule="exact"/.test(x.document));
  assert.ok(!/Bad Script/.test(x.document));
  assert.ok(!/behindDoc/.test(x.header));
});

test("DOCX: rasm chizilmaydi (bo'sh ramka «[…-rasm]»), jadval — siyoh chegarasi, formula — oddiy matn, titul — daftar muqovasi", async () => {
  const doc = DOC_HAND();
  // PNG bor hujjat ham rasmni DOCXga solmaydi.
  doc.work!.figures[0]!.url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const x = await unzip(await renderDocx(doc));
  assert.equal(x.document.includes("<w:drawing"), false, "asosiy matnda rasm yo'q");
  assert.ok(x.document.includes("[2.1-rasm]"), "rasm o'rnida o'rinbosar");
  assert.match(x.document, new RegExp(`<w:tblBorders>|<w:top w:val="single"[^>]*w:color="${HAND_INK_HEX.blue}"`), "jadval chegarasi — siyoh rangida");
  assert.ok(x.document.includes("Δ = (x̄₂ - x̄₁)/(x̄₁) · 100%"), "formula oddiy matn");
  assert.ok(!x.document.includes("<m:oMath"), "OMML yo'q");
  const T = (await import("../lib/generation/title-model.ts")).titleModel(doc);
  assert.equal(T.kind, "gost");
  if (T.kind === "gost") {
    const covers = handCoverLines(T).filter((l) => l.role !== "gap");
    assert.ok(covers.length >= 5);
    for (const l of covers) assert.ok(x.document.includes(l.role === "field" ? l.text : l.text.replace(/&/g, "&amp;")) || l.role === "center", `muqova qatori DOCX da: ${JSON.stringify(l)}`);
    assert.ok(!x.document.includes(T.ministry[0]!), "rasmiy titulning vazirlik qatori yo'q");
  }
});

test("DOCX: `ʻ` (U+02BB) shrift yopmagani uchun `‘` ga almashadi — butun hujjatda (matn, mundarija, muqova)", async () => {
  const doc = DOC_HAND();
  doc.work!.title = "Oʻzbekiston gʻoyasi";
  doc.meta.topic = "Oʻzbekiston gʻoyasi";
  doc.sections.find((s) => s.id === "ch1.1")!.title = "Oʻqish va gʻoya";
  doc.sections.find((s) => s.id === "ch1.1")!.blocks.push({ kind: "p", text: "Bu oʻzbek gʻururi [u1]." });
  const x = await unzip(await renderDocx(doc));
  assert.ok(!x.document.includes("ʻ"), "DOCX da U+02BB qolmagan");
  assert.ok(x.document.includes("O‘zbekiston g‘oyasi") && x.document.includes("o‘zbek g‘ururi"), "‘ ga almashgan");
  // Oddiy ko'rinishda matn O'ZGARMAYDI.
  delete doc.work!.hand;
  const plain = await unzip(await renderDocx(doc));
  assert.ok(plain.document.includes("oʻzbek gʻururi"), "oddiy hujjatda ʻ saqlanadi");
});

/* ───────────────────────────── ko'ruvchi oqimi ───────────────────────────── */

test("workFlow: qo'lyozma uslubi — rasm URL i tushadi, formula `plain`, `ʻ` almashadi; oddiy oqim o'zgarmaydi", () => {
  const doc = DOC_HAND();
  doc.work!.figures[0]!.url = "data:image/png;base64,AAAA";
  doc.sections.find((s) => s.id === "ch1.1")!.blocks.push({ kind: "p", text: "Oʻzbek gʻoyasi." });
  const hand = workFlow(planWork(doc), doc);
  const fig = hand.find((i) => i.type === "figure");
  assert.ok(fig && fig.type === "figure" && fig.url === undefined && fig.placeholder.includes("2.1-rasm"));
  const eq = hand.find((i) => i.type === "formula");
  assert.ok(eq && eq.type === "formula" && eq.plain === "Δ = (x̄₂ - x̄₁)/(x̄₁) · 100%");
  assert.ok(hand.some((i) => i.type === "p" && i.text.includes("O‘zbek g‘oyasi")));
  assert.ok(!hand.some((i) => i.type === "p" && i.text.includes("ʻ")));
  delete doc.work!.hand;
  const plain = workFlow(planWork(doc), doc);
  const pfig = plain.find((i) => i.type === "figure");
  assert.ok(pfig && pfig.type === "figure" && pfig.url === "data:image/png;base64,AAAA");
  assert.ok(plain.find((i) => i.type === "formula" && i.plain === undefined));
  assert.ok(plain.some((i) => i.type === "p" && i.text.includes("Oʻzbek")));
  // Tuzilma BIR XIL: bandlar turi/tartibi.
  assert.deepEqual(hand.map((i) => i.type), plain.map((i) => i.type));
});

test("handFormulaText: kasr, daraja, indeks, ustki chiziq, yunon harflari, `%`", () => {
  assert.equal(handFormulaText("E = mc^{2}"), "E = mc²");
  assert.equal(handFormulaText("\\frac{a+b}{c}"), "(a+b)/(c)");
  assert.equal(handFormulaText("\\sqrt{a^2+b^2}"), "√(a²+b²)");
  assert.equal(handFormulaText("x_1 + \\alpha \\cdot 50\\%"), "x₁ + α · 50%");
  assert.equal(handFormulaText("\\Delta = \\frac{\\bar{x}_2 - \\bar{x}_1}{\\bar{x}_1} \\cdot 100\\%"), "Δ = (x̄₂ - x̄₁)/(x̄₁) · 100%");
});

test("muqova: tashqi qatorlar va bo'sh joylar (vazirlik/fakultet yo'q, mavzu va bajardi/tekshirdi bor)", () => {
  const lines = handCoverLines({
    university: "TDPU", workLabel: "Mustaqil ish", subjectLine: "«Pedagogika» fanidan", topic: "Mavzu", topicLabel: "Mavzu:", author: "Aliyev A.",
    authorLabel: "Bajardi", courseLine: "3-kurs", teacher: "Rahimov B.", teacherLabel: "Tekshirdi", cityYear: "Toshkent — 2026",
  });
  assert.deepEqual(lines.filter((l) => l.role === "field").map((l) => (l.role === "field" ? l.label : "")), ["Bajardi", "", "Tekshirdi"]);
  assert.ok(lines.some((l) => l.role === "center" && l.big && l.text === "Mustaqil ish"));
});

/* ───────────────────────────── yetkazish ───────────────────────────── */

test("bet darvozasi: qo'lyozma hujjatda qo'llanmaydi (betlar soni boshqa), oddiy mustaqil ishda qoladi", () => {
  const doc = DOC_HAND();
  assert.equal(pageGateApplies("mustaqil-ish", doc), false);
  delete doc.work!.hand;
  assert.equal(pageGateApplies("mustaqil-ish", doc), true);
});

/* ───────────────────────────── varaq PNG ───────────────────────────── */

function decodePng(png: Buffer): { w: number; h: number; rows: Buffer[]; plte: number[][] } {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  const plte: number[][] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 3, "indexed");
    }
    if (type === "PLTE") for (let i = 0; i < data.length; i += 3) plte.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w + 1)], 0, `${y}-qator filtri None bo'lishi kerak`);
    rows.push(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)));
  }
  return { w, h, rows, plte };
}

test("varaq PNG: A4 254 dpi, chiziqlar MATN ASOSIGA tushadi (pitch oralig'ida), qizil chegara 20 mm, katakli varaqda vertikal chiziqlar", () => {
  for (const paper of ["lined", "grid"] as const) {
    const png = paperPng(paper, "badscript");
    assert.equal(paperPng(paper, "badscript"), png, "keshlanadi");
    const { w, h, rows, plte } = decodePng(png);
    assert.deepEqual([w, h], [PAPER_PX.w, PAPER_PX.h]);
    assert.ok(png.length < 120_000, `${paper}: PNG ${png.length} bayt`);
    const g = handGeometry(paper, "badscript");
    const hex = (c: number[]) => c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    assert.equal(hex(plte[1]!), HAND_PAPER_SPECS[paper].ruleHex);
    assert.equal(hex(plte[2]!), HAND_PAGE.redHex);
    const redX = Math.round(HAND_PAGE.redLineMm * 10);
    const mid = 1013; // katak chizig'i (50 px qadam) ustiga tushmasin
    // Birinchi matn qatori (yuqori chegara + 0.8 oraliq) chizig'i.
    const y0 = Math.round(g.docxRuleY0Mm * 10);
    const lineRows = (rowIdx: number) => rows[rowIdx]![mid] === 1;
    assert.ok(lineRows(y0), `${paper}: matn asosida chiziq bor`);
    assert.ok(!lineRows(y0 - 3) && !lineRows(y0 + 6), `${paper}: chiziq yupqa`);
    // Har qator oralig'ida (pitch) chiziq — 10 ta qator oldinga.
    for (let k = 0; k < 10; k++) {
      const y = Math.round((g.docxRuleY0Mm + k * twToMm(g.pitchTw)) * 10);
      assert.ok(lineRows(y), `${paper}: ${k}-qator chizig'i ${y} da`);
    }
    // Qizil chegara har qatorda.
    for (const y of [5, 700, 1500, 2900]) assert.equal(rows[y]![redX], 2, `${paper}: qizil chiziq ${y}-qatorda`);
    // Katakli: vertikal chiziq (5 mm = 50 px) chiziqlar ORASIDAGI qatorda ham bor; chiziqlida yo'q.
    const between = Math.round((g.docxRuleY0Mm + twToMm(g.pitchTw) / 2) * 10) + 7;
    const vertical = rows[between]![redX + 150] === 1;
    assert.equal(vertical, paper === "grid", `${paper}: vertikal katak chizig'i`);
  }
  assert.notEqual(paperPng("lined", "badscript"), paperPng("grid", "badscript"));
});

test("form values <-> model: format/margin/cells round-trip, blank paper drops the margin line, legacy values (absent fields) keep old behaviour", () => {
  const v = { topic: "T", workView: "hand", handPaper: "grid", handFormat: "a5x2", handMargin: "alternate", handCells: "1" } as FormValues;
  const input = workInputFromValues(v, "independent");
  assert.deepEqual(input.hand, { ink: "blue", paper: "grid", font: "school", format: "a5x2", margin: "alternate", cells: 1 });
  assert.deepEqual(workInputFromValues(encodeWorkValues(input), "independent").hand, input.hand);
  const blank = workInputFromValues({ ...v, handPaper: "blank" }, "independent").hand!;
  assert.equal(blank.margin, undefined, "no margin line on blank paper");
  assert.equal(blank.cells, 1);
  const legacy = workInputFromValues({ topic: "T", workView: "hand", handPaper: "grid" } as FormValues, "independent").hand!;
  assert.deepEqual(legacy, { ink: "blue", paper: "grid", font: "school" }, "absent fields = a4 / margin left / 2 cells");
  assert.deepEqual(handGeometry("grid", "school", legacy).lines, handGeometry("grid", "school").lines);
});

test("service capabilities: independent work and referat expose every parameter, coursework none; restrictHand resets what a service does not expose", () => {
  assert.deepEqual([...handCapsOf("independent")!].sort(), [...HAND_PARAM_IDS].sort());
  assert.deepEqual([...handCapsOf("referat")!].sort(), [...HAND_PARAM_IDS].sort());
  assert.equal(handCapsOf("coursework"), null);
  assert.deepEqual([...handCapsOf("essay")!].sort(), ["cells", "font", "format", "ink", "lively", "margin", "paper"], "essay: no cover/headings/underline");
  assert.deepEqual([...handCapsOf("konspekt")!].sort(), [...handCapsOf("essay")!].sort());
  // Every capability maps to a registry parameter (no orphan ids), and every registry param belongs to a capability.
  const registry = new Set(WORK_HAND_PARAMS.map((p) => p.id));
  for (const id of HAND_PARAM_IDS) assert.ok(registry.has(HAND_FIELD_OF[id]), `${id} → ${HAND_FIELD_OF[id]} is not in WORK_HAND_PARAMS`);
  const fields = new Set(Object.values(HAND_FIELD_OF));
  for (const p of WORK_HAND_PARAMS) assert.ok(p.id === "workView" || fields.has(p.id), `${p.id} has no capability id`);
  const full = { ink: "purple", paper: "grid", font: "pen", lively: true, headings: "plain", cover: "calligraphy", underline: false, format: "a5x2", margin: "alternate", cells: 1 } as const satisfies WorkHand;
  assert.deepEqual(restrictHand(full, new Set(HAND_PARAM_IDS)), full);
  // A service without cover/underline/headings/margin keeps only what it exposes; the rest is the legacy default.
  assert.deepEqual(restrictHand(full, new Set<HandParamId>(["font", "ink", "lively", "paper", "format", "cells"])), { ink: "purple", paper: "grid", font: "pen", lively: true, format: "a5x2", cells: 1 });
  assert.deepEqual(restrictHand(full, new Set<HandParamId>()), { ink: "blue", paper: "lined", font: "school" });
});

test("referat: every handwriting parameter changes the DOCX through the real form path (workInputFromValues → model → render)", async () => {
  const failures: string[] = [];
  const docxOf = async (values: FormValues) => {
    const hand = workInputFromValues({ topic: "T", ...values }, "referat").hand;
    assert.ok(hand, "referat accepts the hand view");
    const doc = sampleWorkDoc({ topic: "Referat", workLabel: "Referat", language: "uz", toolId: "referat" } as never, { genre: "referat", kind: "informative" });
    doc.work!.hand = hand;
    const x = await unzip(await renderDocx(doc));
    return JSON.stringify({ document: x.document, header: x.header, styles: x.styles, media: x.media });
  };
  for (const p of WORK_HAND_PARAMS.filter((q) => q.id !== "workView")) {
    const base = { ...(p.probeWith ?? {}), workView: "hand" };
    const [a, b] = [await docxOf({ ...base, [p.id]: p.probeA }), await docxOf({ ...base, [p.id]: p.probeB })];
    if (a === b) failures.push(p.id);
  }
  assert.deepEqual(failures, [], `referat: parameters without a DOCX effect: ${failures.join(", ")}`);
});

test("DOCX layouts: A5 page size, alternate → mirrored margins + odd/even background, two-up → A4 landscape with two columns and ONE sheet image, blank/print → no background", async () => {
  const mk = async (hand: WorkHand) => {
    const doc = sampleWorkDoc({ topic: "Layout", workLabel: "Mustaqil ish", language: "uz", toolId: "mustaqil-ish" } as never, { genre: "independent", kind: "written" });
    doc.titlePage = false as never;
    doc.work!.hand = hand;
    const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(doc)));
    const text = async (f: string) => (await zip.file(f)?.async("string")) ?? "";
    return { zip, document: await text("word/document.xml"), settings: await text("word/settings.xml"), names: Object.keys(zip.files) };
  };
  const base = { ink: "blue", font: "school", paper: "grid" } as const;
  // A5, margin line on the left for every page: no mirroring, one background.
  const a5 = await mk({ ...base, format: "a5", cells: 1 });
  assert.match(a5.document, /<w:pgSz w:w="8419" w:h="11906"/);
  assert.ok(!a5.settings.includes("mirrorMargins") && !/<w:evenAndOddHeaders\s*\/>/.test(a5.settings), "no mirroring without alternate");
  assert.equal(a5.names.filter((n) => /^word\/media\/.*\.png$/.test(n)).length, 1);
  // A5, alternate: mirrored margins, odd + even background images (two different PNGs).
  const alt = await mk({ ...base, format: "a5", margin: "alternate", cells: 1 });
  assert.ok(alt.settings.includes("<w:mirrorMargins/><w:evenAndOddHeaders/>"), "settings.xml");
  assert.match(alt.document, /<w:headerReference w:type="even"/);
  const pngs = alt.names.filter((n) => /^word\/media\/.*\.png$/.test(n));
  assert.equal(pngs.length, 2);
  assert.notDeepEqual(await alt.zip.file(pngs[0]!)!.async("uint8array"), await alt.zip.file(pngs[1]!)!.async("uint8array"));
  const g = handGeometry("grid", "school", { format: "a5", margin: "alternate", cells: 1 });
  assert.match(alt.document, new RegExp(`w:left="${g.margins.left}"`));
  assert.match(alt.document, new RegExp(`w:right="${g.margins.right}"`));
  // Two-up: A4 landscape, two columns (page width each), one sheet image, no page-number footer.
  const two = await mk({ ...base, format: "a5x2", margin: "alternate", cells: 1 });
  const g2 = handGeometry("grid", "school", { format: "a5x2", margin: "alternate", cells: 1 });
  assert.match(two.document, /<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/);
  assert.match(two.document, /<w:cols [^>]*w:num="2"/);
  assert.equal([...two.document.matchAll(/<w:col w:w="(\d+)"/g)].map((m) => Number(m[1])).join(","), `${g2.contentTw},${g2.contentTw}`);
  assert.ok(!two.settings.includes("mirrorMargins"), "two-up places the margins itself");
  assert.equal(two.names.filter((n) => /^word\/media\/.*\.png$/.test(n)).length, 1);
  assert.ok(!two.names.some((n) => /footer/.test(n) && n.endsWith(".xml") && !n.includes("rels")) || !two.document.includes("footerReference"), "no footers");
  // Blank / print: nothing drawn behind the text.
  for (const paper of ["blank", "print"] as const) {
    const r = await mk({ ink: "blue", font: "school", paper, cells: 1, format: "a5" });
    assert.ok(!r.names.some((n) => /^word\/media\//.test(n)), `${paper}: no background image`);
    assert.ok(!r.document.includes("headerReference"), `${paper}: no header`);
  }
});

test("paper PNG layouts: A5 page, margin-line side by page parity, two-up A4 landscape sheet with two pages, blank/print have nothing to draw", () => {
  const a5 = { format: "a5", margin: "alternate", cells: 1 } as const;
  const g = handGeometry("grid", "school", a5);
  const odd = decodePng(paperPng("grid", "school", a5, 0));
  const even = decodePng(paperPng("grid", "school", a5, 1));
  assert.deepEqual([odd.w, odd.h], [1485, 2100]);
  assert.deepEqual(paperPx(g), { w: 1485, h: 2100 });
  assert.equal(odd.rows[5]![200], 2, "odd page: margin line 20 mm from the left");
  assert.equal(even.rows[5]![1485 - 200 - 4], 2, "even page: margin line 20 mm from the right");
  assert.notEqual(even.rows[5]![200], 2, "even page: nothing at the left");
  // 1-cell rows: a horizontal ruling under EVERY text row (not every other one), on the 5 mm grid.
  const mid = 700;
  for (let k = 0; k < 20; k++) {
    const y = Math.round((g.docxRuleY0Mm + k * twToMm(g.pitchTw)) * 10);
    assert.equal(odd.rows[y]![mid], 1, `row ${k} ruling at ${y}`);
  }
  // Two-up: A4 landscape, both pages drawn, verticals stay inside their page.
  const two = { format: "a5x2", margin: "alternate", cells: 1 } as const;
  const sheet = decodePng(paperPng("grid", "school", two));
  assert.deepEqual([sheet.w, sheet.h], [2970, 2100]);
  assert.equal(sheet.rows[5]![200], 2, "left page: line at its left edge");
  assert.equal(sheet.rows[5]![1485 + 1485 - 200 - 4], 2, "right page: line at the sheet's right edge");
  assert.notEqual(sheet.rows[5]![1485 + 200], 2);
  const plainSheet = decodePng(paperPng("lined", "school", { format: "a5x2" }));
  assert.equal(plainSheet.rows[5]![200], 2);
  assert.equal(plainSheet.rows[5]![1485 + 200], 2, "margin: left → each page has its own left line");
  // Cached by layout; different layouts differ; unruled paper has no PNG.
  assert.equal(paperPng("grid", "school", two), paperPng("grid", "school", two));
  assert.notEqual(paperPng("grid", "school", two), paperPng("grid", "school", { ...two, margin: "none" }));
  assert.throws(() => paperPng("blank", "school"), /no ruling/);
  assert.throws(() => paperPng("print", "school"), /no ruling/);
});

test("ko'ruvchi o'zgaruvchilari: siyoh/qog'oz/shrift/qator oralig'i handGeometry bilan bir xil manbadan", () => {
  const s = handStyleOf({ ink: "black", paper: "grid", font: "caveat" });
  const v = handCssVars(s);
  const g = handGeometry("grid", "caveat");
  assert.equal(v["--hand-ink"], `#${HAND_INK_HEX.black}`);
  assert.equal(v["--hand-family"], '"Caveat"');
  assert.equal(v["--hand-pitch"], `${g.pitchPx}px`);
  assert.equal(Number.parseFloat(v["--hand-cell"]!) * 2, g.pitchPx, "katakli: bir qator = ikki katak");
  const lined = handCssVars(handStyleOf({ ink: "black", paper: "lined", font: "caveat" }));
  assert.equal(Number.parseFloat(lined["--hand-cell"]!), handGeometry("lined", "caveat").pitchPx, "chiziqli: chiziq = qator");
  // Chiziq fazasi: birinchi chiziq matn asosiga (marja + asos) tushadi.
  const phase = (g.viewerRuleY0Px % Number.parseFloat(v["--hand-cell"]!));
  assert.ok(Math.abs(Number.parseFloat(v["--hand-phase"]!) - phase) < 0.01);
});
