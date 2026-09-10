import test from "node:test";
import assert from "node:assert/strict";
import { planCustom } from "../lib/generation/slide-custom.ts";
import { planSlide, SLIDE_IN } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { SLIDE_LAYOUTS } from "../lib/generation/slide-types.ts";
import type { CustomTemplate } from "../lib/generation/pptx-template.ts";
import type { SlideLayout, SlideModel } from "../lib/generation/slide-types.ts";

/**
 * «O'z shablonim» — ko'ruvchi planeri (B3): fon = layout PNG, matn =
 * placeholder qutilarida, namuna shrifti/rangi; PPTX bilan bir xil rol/mazmun
 * xaritasi (`template-content.ts`).
 */
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const COVER = "ppt/slideLayouts/slideLayout1.xml";
const CONTENT = "ppt/slideLayouts/slideLayout2.xml";
const TWO = "ppt/slideLayouts/slideLayout3.xml";
const PIC = "ppt/slideLayouts/slideLayout4.xml";

function tpl(opts: { previews?: boolean; size?: { w: number; h: number }; two?: boolean; pic?: boolean } = {}): CustomTemplate {
  const size = opts.size ?? { w: 13.333, h: 7.5 };
  const k = size.w / 13.333;
  const sc = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k });
  return {
    assetId: "0123456789abcdef01234567",
    name: "namuna.pptx",
    profile: {
      size,
      colors: { dk1: "#101820", lt1: "#FFFFFF", dk2: "#334", lt2: "#EEE", accent1: "#C9A227" },
      fonts: { major: "Georgia", minor: "Verdana" },
      masterPath: "ppt/slideMasters/slideMaster1.xml",
      themePath: "ppt/theme/theme1.xml",
      layouts: [
        { path: COVER, name: "Muqova", kind: "cover", placeholders: [
          { type: "ctrTitle", idx: null, name: "t", box: sc({ x: 1, y: 2.5, w: 11.3, h: 1.5 }) },
          { type: "subTitle", idx: 1, name: "s", box: sc({ x: 1, y: 4.2, w: 11.3, h: 1 }) },
        ] },
        { path: CONTENT, name: "Mazmun", kind: "content", placeholders: [
          { type: "title", idx: null, name: "t", box: sc({ x: 0.7, y: 0.5, w: 11.9, h: 1 }) },
          { type: "body", idx: 1, name: "b", box: sc({ x: 0.7, y: 1.7, w: 11.9, h: 4.9 }) },
          { type: "sldNum", idx: 12, name: "n", box: sc({ x: 11.5, y: 6.9, w: 1.3, h: 0.4 }) },
        ] },
        ...(opts.two ? [{ path: TWO, name: "Ikki", kind: "two" as const, placeholders: [
          { type: "title" as const, idx: null, name: "t", box: sc({ x: 0.7, y: 0.5, w: 11.9, h: 1 }) },
          { type: "body" as const, idx: 1, name: "l", box: sc({ x: 0.7, y: 1.7, w: 5.8, h: 4.9 }) },
          { type: "body" as const, idx: 2, name: "r", box: sc({ x: 6.8, y: 1.7, w: 5.8, h: 4.9 }) },
        ] }] : []),
        ...(opts.pic ? [{ path: PIC, name: "Rasmli", kind: "picture" as const, placeholders: [
          { type: "title" as const, idx: null, name: "t", box: sc({ x: 0.7, y: 0.5, w: 11.9, h: 1 }) },
          { type: "body" as const, idx: 1, name: "b", box: sc({ x: 0.7, y: 1.7, w: 5.8, h: 4.9 }) },
          { type: "pic" as const, idx: 2, name: "p", box: sc({ x: 6.8, y: 1.7, w: 5.8, h: 4.9 }) },
        ] }] : []),
      ],
      roles: { cover: COVER, content: CONTENT, section: COVER, ...(opts.two ? { two: TWO } : {}), ...(opts.pic ? { picture: PIC } : {}) },
    },
    previews: opts.previews === false ? {} : { cover: { png: PNG, dark: true }, section: { png: PNG, dark: true }, content: { png: PNG + "A", dark: false }, two: { png: PNG + "A", dark: false }, picture: { png: PNG + "A", dark: false } },
  };
}

function sample(layout: SlideLayout): SlideModel {
  const base: SlideModel = { id: "s", layout, title: "Fotosintez jarayoni va uning bosqichlari", kicker: "Biologiya", subtitle: "Yorug‘lik energiyasi qanday aylanadi", image: { url: "https://x/y.jpg" } };
  const bullets = ["Quyosh nuri — energiya manbai", "Suv ildizdan, karbonat angidrid barg og‘izchalaridan", "Xlorofill — yashil pigment", "Natija: glyukoza va kislorod"];
  switch (layout) {
    case "bullets": case "agenda": return { ...base, bullets };
    case "twoCol": case "compare": return { ...base, leftTitle: "Yorug‘lik", left: bullets.slice(0, 2), rightTitle: "Qorong‘i", right: bullets.slice(2) };
    case "stats": return { ...base, stats: [{ value: "6", label: "CO₂ molekulasi" }, { value: "30%", label: "kislorod" }] };
    case "process": return { ...base, steps: [{ n: "1", title: "Nur yutilishi", text: "Xlorofill fotonni ushlaydi" }, { n: "2", title: "Suv parchalanishi" }] };
    case "quote": return { ...base, quote: "Har bir yashil barg — kichik zavod.", quoteBy: "Yan Ingenhauz" };
    case "table": return { ...base, table: { headers: ["Faza", "Joy", "Mahsulot"], rows: [["Yorug‘lik", "Tilakoid", "ATF"], ["Qorong‘i", "Stroma", "Glyukoza"]] } };
    case "quiz": return { ...base, quiz: [{ q: "Fotosintez qayerda?", options: ["Xloroplast", "Mitoxondriya", "Yadro", "Ribosoma"], answer: 0 }] };
    case "references": return { ...base, refs: [{ title: "Campbell Biology", source: "Pearson, 2020" }] };
    default: return base;
  }
}

const inside = (b: { x: number; y: number; w: number; h: number }) =>
  b.x >= -0.001 && b.y >= -0.001 && b.x + b.w <= SLIDE_IN.w + 0.01 && b.y + b.h <= SLIDE_IN.h + 0.01 && b.w > 0 && b.h > 0;

test("muqova: fon — layout PNG (to'la ekran), sarlavha ctrTitle qutisida markazda, namuna shrifti, qorong'i fon → och siyoh", () => {
  const p = planCustom(sample("title"), tpl(), 0, 9);
  const bgLayer = p.layers[0];
  assert.ok(bgLayer.t === "image" && bgLayer.url === PNG && bgLayer.box.w === SLIDE_IN.w && bgLayer.box.h === SLIDE_IN.h, "birinchi qatlam — to'la ekran PNG");
  const title = p.layers.find((l) => l.t === "text" && l.src?.f === "title");
  assert.ok(title && title.t === "text");
  assert.equal(title.font, "Georgia");
  assert.equal(title.color, "#FFFFFF", "qorong'i fon → lt1");
  assert.equal(title.align, "center");
  assert.deepEqual(title.box, { x: 1, y: 2.5, w: 11.3, h: 1.5 }, "aynan placeholder qutisi");
  const sub = p.layers.find((l) => l.t === "text" && l.src?.f === "subtitle");
  assert.ok(sub && sub.t === "text" && sub.font === "Verdana");
});

test("mazmun: och fon → to'q siyoh, bandlar body qutisida srcLines bilan (tahrirlanadi), sahifa raqami sldNum joyida", () => {
  const p = planCustom(sample("bullets"), tpl(), 3, 9);
  const body = p.layers.find((l) => l.t === "text" && l.lines);
  assert.ok(body && body.t === "text");
  assert.equal(body.color, "#101820");
  assert.equal(body.bullets, true);
  assert.deepEqual(body.srcLines?.[2], { f: "bullets", i: 2 });
  assert.deepEqual(body.box, { x: 0.7, y: 1.7, w: 11.9, h: 4.9 });
  const num = p.layers.find((l) => l.t === "text" && l.text === "4 / 9");
  assert.ok(num, "sahifa raqami");
});

test("rasm faqat pic placeholder'da: picture layout bo'lsa rasm qatlami, bo'lmasa yo'q (PPTX qoidasi bilan bir xil)", () => {
  const withPic = planCustom(sample("bullets"), tpl({ pic: true }), 3, 9);
  const img = withPic.layers.filter((l) => l.t === "image" && l.url === "https://x/y.jpg");
  assert.equal(img.length, 1);
  assert.ok(img[0].t === "image" && img[0].box.x > 6.7);
  const noPic = planCustom(sample("bullets"), tpl(), 3, 9);
  assert.equal(noPic.layers.filter((l) => l.t === "image" && l.url === "https://x/y.jpg").length, 0);
});

test("ikki ustun: two layout — ikki alohida qatlam; faqat content — birlashgan bitta qatlam", () => {
  const two = planCustom(sample("twoCol"), tpl({ two: true }), 4, 9);
  const cols = two.layers.filter((l) => l.t === "text" && l.lines);
  assert.equal(cols.length, 2);
  assert.ok(cols[0].t === "text" && cols[0].lines?.[0] === "Yorug‘lik" && cols[0].srcLines?.[0] && (cols[0].srcLines[0] as { f: string }).f === "leftTitle");
  const one = planCustom(sample("twoCol"), tpl(), 4, 9);
  const merged = one.layers.filter((l) => l.t === "text" && l.lines);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].t === "text" && merged[0].lines!.length === 6);
});

test("preview yo'q (pdftoppm bo'lmagan server): fon rangi temadan — muqova to'q, mazmun och; rasm qatlami yo'q", () => {
  const cover = planCustom(sample("title"), tpl({ previews: false }), 0, 9);
  assert.equal(cover.bg, "#334");
  assert.ok(!cover.layers.some((l) => l.t === "image"));
  const content = planCustom(sample("bullets"), tpl({ previews: false }), 1, 9);
  assert.equal(content.bg, "#FFFFFF");
});

test("4:3 namuna: placeholder qutilari 16:9 sahnaga masshtablanadi, chegaradan chiqmaydi", () => {
  const p = planCustom(sample("bullets"), tpl({ size: { w: 10, h: 7.5 } }), 1, 9);
  const title = p.layers.find((l) => l.t === "text" && l.src?.f === "title");
  assert.ok(title && title.t === "text");
  assert.ok(Math.abs(title.box.x - 0.7 * (10 / 13.333) * (13.333 / 10)) < 0.01, "x = 0.7 (namunada 0.525 × 13.333/10)");
  for (const l of p.layers) assert.ok(inside(l.box), JSON.stringify(l.box));
});

test("har maket: qatlamlar sahna ichida, sarlavha bor, matn qutilari bo'sh emas", () => {
  for (const layout of SLIDE_LAYOUTS) {
    for (const t of [tpl(), tpl({ previews: false }), tpl({ two: true, pic: true }), tpl({ size: { w: 10, h: 7.5 } })]) {
      const p = planCustom(sample(layout), t, 2, 9);
      assert.ok(p.layers.some((l) => l.t === "text" && l.src?.f === "title"), `${layout}: sarlavha`);
      for (const l of p.layers) {
        assert.ok(inside(l.box), `${layout}: ${JSON.stringify(l.box)}`);
        if (l.t === "text") assert.ok((l.text ?? "").trim() || (l.lines ?? []).some(Boolean), `${layout}: bo'sh matn`);
      }
    }
  }
});

test("planSlide(custom): tasma/logotip qo'shilmaydi, shrift ustidan yozish (s.font) ishlaydi", () => {
  const theme = getSlideTheme("atlas");
  const s: SlideModel = { ...sample("bullets"), font: { [JSON.stringify({ f: "title" })]: "times" } };
  const p = planSlide(s, theme, "academic", 1, 9, "auto", "lecture", { logo: PNG, custom: tpl() });
  const imgs = p.layers.filter((l) => l.t === "image");
  assert.equal(imgs.length, 1, "faqat fon PNG — logotip yo'q");
  const title = p.layers.find((l) => l.t === "text" && l.src?.f === "title");
  assert.ok(title && title.t === "text" && /Times/i.test(title.font ?? ""), `shrift: ${title && title.t === "text" ? title.font : ""}`);
  const plain = planSlide(sample("bullets"), theme, "academic", 1, 9, "auto", "lecture", { logo: PNG });
  assert.ok(plain.layers.some((l) => l.t === "image" && l.fit === "contain"), "custom siz — logotip bor");
});
