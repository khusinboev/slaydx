import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractFromBuffer } from "../lib/extract-text.ts";
import { applyMd, applyText, mdToSegments, textToSegments } from "../lib/generation/translate/plain.ts";
import { parsePptxTemplate } from "../lib/generation/pptx-template.ts";
import { makeZip, templateEntries, TEMPLATE_PARTS } from "./helpers/parse-fixtures.ts";

/**
 * SECB-01 (C04): foydalanuvchi matnidagi regexlar CHIZIQLI vaqtda ishlashi shart.
 *
 * Ilgari `tidy()` dagi `/[ \t]+\n/`, `/<[^>]+>/`, `plain.ts` dagi `/\s*$/`
 * va boshqalar uzun «yopilmagan» qatorda O(n²) edi: 40 000 belgi ≈ 1 s,
 * 1 MB ≈ 12 daqiqa — va bularning hammasi YAGONA web jarayonida. Har
 * sinov 200 KB–1 MB «yomon» kirishni 300 ms dan tez tugatishi kerak
 * (chiziqli kod bunga millisekundlarda yetadi, kvadratik — soatlarda).
 */

const N = Number(process.env.PARSE_LINEAR_N) || 200_000;
const LIMIT_MS = 300;
const enc = new TextEncoder();

function ab(s: string | Uint8Array): ArrayBuffer {
  const u = typeof s === "string" ? enc.encode(s) : s;
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function within<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const t = performance.now();
  const out = await fn();
  const ms = performance.now() - t;
  assert.ok(ms < LIMIT_MS, `${label}: ${ms.toFixed(0)} ms (chegara ${LIMIT_MS} ms)`);
  return out;
}

async function zipOf(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return ab(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

/* ─────────────── extract-text: TXT (`tidy`) ─────────────── */

test("extract TXT: 1 MB bo'shliq qatori (\\n siz) chiziqli, natija o'zgarmaydi", async () => {
  const out = await within("txt spaces 1MB", () => extractFromBuffer("a.txt", ab(" ".repeat(N * 5) + "x")));
  assert.equal(out.text, "x");
  const tabs = await within("txt tabs", () => extractFromBuffer("a.txt", ab(" \t".repeat(N / 2) + "x\n")));
  assert.equal(tabs.text, "x");
});

test("extract TXT: oddiy matn bayt-ba-bayt avvalgidek", async () => {
  const src = "  Sarlavha  \r\n\r\n\r\n\r\nBirinchi qator \t\nIkkinchi\t qator\n\n\n\nOxiri   ";
  const out = await extractFromBuffer("a.md", ab(src));
  assert.equal(out.text, "Sarlavha\n\nBirinchi qator\nIkkinchi\t qator\n\nOxiri");
});

/* ─────────────── extract-text: DOCX / PPTX / XLSX ─────────────── */

const DOC_HEAD = "<w:document><w:body><w:p><w:r><w:t>Salom</w:t></w:r></w:p>";

test("extract DOCX: yopilmagan `<w:br`, `<w:t`, `<w:tab`, `<` — chiziqli", async () => {
  for (const [label, tail] of [
    ["<w:br", "<w:br ".repeat(N / 6)],
    ["<w:tab", "<w:tab ".repeat(N / 7)],
    ["<w:t", "<w:t ".repeat(N / 5)],
    ["<", "<".repeat(N)],
    ["<w:t>…<", `<w:t>${"a".repeat(10)}<`.repeat(N / 16)],
  ] as const) {
    const buf = await zipOf({ "word/document.xml": DOC_HEAD + tail });
    const out = await within(`docx ${label}`, () => extractFromBuffer("a.docx", buf));
    assert.ok(out.text.startsWith("Salom"), `${label}: ${out.text.slice(0, 40)}`);
  }
});

test("extract DOCX: oddiy hujjat natijasi avvalgidek", async () => {
  const xml =
    '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Bir &amp; ikki </w:t></w:r><w:r><w:tab/><w:t>uch</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>to&#8217;rt</w:t><w:br/><w:t>besh</w:t><w:br w:type="page"/></w:r></w:p></w:body></w:document>';
  const out = await extractFromBuffer("a.docx", await zipOf({ "word/document.xml": xml }));
  assert.equal(out.text, "Bir & ikki \tuch\nto’rt\nbesh");
});

test("extract PPTX/XLSX: yopilmagan teglar chiziqli", async () => {
  for (const [label, tail] of [
    ["<a:br", "<a:br ".repeat(N / 6)],
    ["<a:t", "<a:t ".repeat(N / 5)],
    ["<", "<".repeat(N)],
  ] as const) {
    const buf = await zipOf({ "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>Slayd</a:t></a:r></a:p>" + tail });
    const out = await within(`pptx ${label}`, () => extractFromBuffer("a.pptx", buf));
    assert.ok(out.text.startsWith("Slayd"), `${label}: ${out.text.slice(0, 40)}`);
  }
  const xl = await zipOf({ "xl/sharedStrings.xml": "<sst><si><t>Katak</t></si>" + "<t ".repeat(N / 3) });
  const out = await within("xlsx <t", () => extractFromBuffer("a.xlsx", xl));
  assert.equal(out.text, "Katak");
});

/* ─────────────── plain.ts: TXT / Markdown ─────────────── */

test("plain TXT: uzun bo'shliq/tab qatori chiziqli (paragraf ajratgich va `\\s*$`)", async () => {
  const spaces = " ".repeat(N) + "x";
  const ex = await within("textToSegments spaces", () => textToSegments(spaces));
  assert.equal(ex.segments.length, 1);
  await within("textToSegments spaces+\\n", () => textToSegments(" \t".repeat(N / 2) + "\nx"));
  await within("applyText spaces", () => applyText(spaces, new Map()));
  // Oxirida bo'shliq bor, lekin undan oldin uzun bo'shliq-ichida-matn.
  await within("textToSegments `\\s*$`", () => textToSegments("a " + "  b".repeat(N / 3)));
});

test("plain TXT: paragraf ajratgichlari va qator yakunlari avvalgidek", () => {
  const src = "Bir\r\n  \r\n\t\r\nIkki\nuch  \n \n\n  To'rt\n\n";
  const ex = textToSegments(src);
  assert.deepEqual(
    ex.segments.map((s) => s.text),
    ["Bir", "Ikki⟦br⟧uch", "To'rt"],
  );
  const map = new Map([["t:0", "One"], ["t:1", "Two⟦br⟧three"], ["t:2", "Four"]]);
  assert.equal(applyText(src, map), "One\r\n  \r\n\t\r\nTwo\r\nthree  \n \n\n  Four\n\n");
});

test("plain MD: jadval katagi, ta'kid, havola, avtohavola, kod — chiziqli", async () => {
  await within("md cell `\\s*$`", () => mdToSegments("|" + " ".repeat(N) + "x|"));
  await within("md emphasis `_a `", () => mdToSegments("_a ".repeat(N / 3)));
  await within("md emphasis `**a `", () => mdToSegments("**a ".repeat(N / 4)));
  await within("md link `[`", () => mdToSegments("[".repeat(N)));
  await within("md link `[a](`", () => mdToSegments("[a](".repeat(N / 4)));
  await within("md autolink", () => mdToSegments("<http://a".repeat(N / 9)));
  let code = "";
  for (let k = 700; k > 0 && code.length < N; k--) code += "`".repeat(k) + "a";
  await within("md code runs", () => mdToSegments(code));
  // applyMd: tarjima qilinmagan katak ham, model javobi ham tokenlardan tiklanadi.
  await within("applyMd cell tokens", () => applyMd("| " + "⟦l1⟧".repeat(N / 4) + " | b |", new Map()));
  await within("applyMd translated tokens", () => applyMd("salom", new Map([["m:0", "⟦r1⟧".repeat(N / 4)]])));
});

test("plain MD: ichki belgilar tokenlari va qaytarilishi avvalgidek", () => {
  const src = "## Sarlavha **qalin** va `kod` [havola](http://x.uz) ![r](a.png) <https://y.uz> _qiya_ ~~o'chir~~\n| a | *b* |\n|---|---|\n";
  const ex = mdToSegments(src);
  assert.deepEqual(
    ex.segments.map((s) => s.text),
    [
      "Sarlavha ⟦r1⟧qalin⟦/r1⟧ va ⟦1⟧ ⟦l1⟧havola⟦/l1⟧ ⟦2⟧ ⟦3⟧ ⟦r2⟧qiya⟦/r2⟧ ⟦r3⟧o'chir⟦/r3⟧",
      "a",
      "⟦r1⟧b⟦/r1⟧",
    ],
  );
  const map = new Map([
    ["m:0", "Title ⟦r1⟧bold⟦/r1⟧ and ⟦1⟧ ⟦l1⟧link⟦/l1⟧ ⟦2⟧ ⟦3⟧ ⟦r2⟧it⟦/r2⟧ ⟦r3⟧del⟦/r3⟧"],
    ["m:1:2", "⟦r1⟧B⟦/r1⟧"],
  ]);
  assert.equal(
    applyMd(src, map),
    "## Title **bold** and `kod` [link](http://x.uz) ![r](a.png) <https://y.uz> _it_ ~~del~~\n| a | *B* |\n|---|---|\n",
  );
});

/* ─────────────── pptx-template: namuna XML i ─────────────── */

test("parsePptxTemplate: yopilmagan `<p:sp>`, `<a:xfrm`, `<Relationship`, tema teglari — chiziqli", async () => {
  const n = N / 8;
  const layout = TEMPLATE_PARTS.layout.replace("</p:spTree>", "<p:sp>".repeat(n) + "<a:xfrm".repeat(n / 2) + "</p:spTree>");
  const masterRels = TEMPLATE_PARTS.masterRels.replace("</Relationships>", "<Relationship ".repeat(n / 2) + "</Relationships>");
  const theme = TEMPLATE_PARTS.theme
    .replace("</a:clrScheme>", "<a:dk2>".repeat(n) + "</a:clrScheme>")
    .replace("</a:themeElements>", "<a:majorFont>".repeat(n / 2) + "</a:themeElements>");
  const bytes = await makeZip(
    templateEntries({
      "ppt/slideLayouts/slideLayout1.xml": { name: "ppt/slideLayouts/slideLayout1.xml", data: layout },
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: masterRels },
      "ppt/theme/theme1.xml": { name: "ppt/theme/theme1.xml", data: theme },
    }),
  );
  const profile = await within("pptx-template", () => parsePptxTemplate(bytes));
  assert.equal(profile.layouts.length, 1);
  assert.equal(profile.colors.dk1, "#112233");
  assert.equal(profile.fonts.major, "Georgia");
});

test("parsePptxTemplate: oddiy namuna profili avvalgidek", async () => {
  const profile = await parsePptxTemplate(await makeZip(templateEntries()));
  assert.deepEqual(profile, {
    size: { w: 13.333, h: 7.5 },
    colors: { dk1: "#112233", accent1: "#AABBCC" },
    fonts: { major: "Georgia", minor: "Arial" },
    masterPath: "ppt/slideMasters/slideMaster1.xml",
    themePath: "ppt/theme/theme1.xml",
    layouts: [
      {
        path: "ppt/slideLayouts/slideLayout1.xml",
        name: "Sarlavha va matn",
        kind: "content",
        placeholders: [
          { type: "title", idx: null, name: "Title 1", box: { x: 0.917, y: 0.399, w: 11.5, h: 1.45 } },
          { type: "body", idx: 1, name: "Content 2", box: { x: 0.917, y: 1.997, w: 11.5, h: 4.759 } },
        ],
      },
    ],
    roles: {
      cover: "ppt/slideLayouts/slideLayout1.xml",
      content: "ppt/slideLayouts/slideLayout1.xml",
      section: "ppt/slideLayouts/slideLayout1.xml",
      blank: "ppt/slideLayouts/slideLayout1.xml",
    },
  });
});
