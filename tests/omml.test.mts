import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { omml } from "../lib/generation/omml.ts";

/*
 * `docx` ni `require` bilan olamiz — `omml.ts` (tsx ostida CJS, chunki
 * package.json da `type: module` yo'q) ham aynan shu nusxani (`index.cjs`)
 * ishlatadi. `.mts` dan `import "docx"` ESM nusxasini (`index.mjs`) berardi
 * va boshqa nusxaning `XmlComponent` lari `<rootKey>` bo'lib serializatsiya
 * qilinardi (sinf `instanceof` mos kelmaydi). Ishlab chiqarishda muammo yo'q:
 * `render-docx.ts` va `omml.ts` bitta nusxadan.
 */
const { Document, Math: DocxMath, Packer, Paragraph } = createRequire(import.meta.url)("docx") as typeof import("docx");

/**
 * LaTeX → OMML (Maqola 2, WP2). Har konstruksiya DOCX XML da o'z tegi
 * bilan chiqishi kerak: `m:f` (kasr), `m:sSup`/`m:sSub`/`m:sSubSup`,
 * `m:rad` (ildiz), `m:nary` (yig'indi/integral), `m:func`. Qoplanmagan
 * buyruq — xom matn (`m:r`/`m:t`), hujjat BUZILMAYDI. XML ning o'zi
 * o'qiladi (`docx` obyekt daraxti emas), chunki foydalanuvchi aynan
 * shuni oladi.
 */

async function xmlOf(latex: string): Promise<string> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new DocxMath({ children: omml(latex) })] })] }],
  });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const xml = await zip.file("word/document.xml")!.async("string");
  const a = xml.indexOf("<m:oMath>");
  const b = xml.indexOf("</m:oMath>");
  assert.ok(a >= 0 && b > a, "oMath topilmadi");
  return xml.slice(a, b + "</m:oMath>".length);
}

const texts = (xml: string) => [...xml.matchAll(/<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g)].map((m) => m[1]);
const count = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length;

test("\\frac → m:f (num/den), namunaviy Δ formulasi", async () => {
  const xml = await xmlOf("\\Delta = \\frac{\\bar{x}_2 - \\bar{x}_1}{\\bar{x}_1} \\cdot 100\\%");
  assert.equal(count(xml, "m:f"), 1);
  assert.equal(count(xml, "m:num"), 1);
  assert.equal(count(xml, "m:den"), 1);
  assert.equal(count(xml, "m:sSub"), 3, "x̄₂, x̄₁, x̄₁ — uchta pastki indeks");
  const t = texts(xml).join("");
  assert.ok(t.includes("Δ="), t);
  assert.ok(t.includes("x̄"), "\\bar{x} → x + makron");
  assert.ok(t.includes("·100%"), t);
});

test("^ va _ → m:sSup / m:sSub / m:sSubSup", async () => {
  assert.equal(count(await xmlOf("x^{2}"), "m:sSup"), 1);
  assert.equal(count(await xmlOf("x_{i}"), "m:sSub"), 1);
  const both = await xmlOf("x_{i}^{2}");
  assert.equal(count(both, "m:sSubSup"), 1);
  assert.equal(count(both, "m:sSup"), 0);
  // Qavssiz bitta belgi ham ishlaydi: x^2
  assert.equal(count(await xmlOf("x^2 + y_1"), "m:sSup"), 1);
  assert.equal(count(await xmlOf("x^2 + y_1"), "m:sSub"), 1);
});

test("\\sqrt → m:rad; \\sqrt[3]{x} darajasi bilan", async () => {
  const xml = await xmlOf("\\sqrt{a^2 + b^2}");
  assert.equal(count(xml, "m:rad"), 1);
  assert.ok(xml.includes("<m:degHide"), "darajasiz ildizda degHide");
  const cube = await xmlOf("\\sqrt[3]{x}");
  assert.equal(count(cube, "m:rad"), 1);
  assert.ok(cube.includes("<m:deg><m:r><m:t>3</m:t></m:r></m:deg>"), cube);
});

test("\\sum va \\int → m:nary chegaralari bilan; tana `=` gacha", async () => {
  const sum = await xmlOf("S = \\sum_{i=1}^{n} x_i = 10");
  assert.equal(count(sum, "m:nary"), 1);
  assert.ok(sum.includes("<m:sub>") && sum.includes("<m:sup>"), "chegaralar yo'q");
  assert.ok(sum.includes('<m:chr m:val="∑"/>') || sum.includes("∑"), "yig'indi belgisi");
  // Tana: x_i (=10 tashqarida)
  const t = texts(sum);
  assert.ok(t.includes("=10") || t.join("").includes("=10"), t.join("|"));
  const int = await xmlOf("\\int_{0}^{1} f(x)\\,dx");
  assert.equal(count(int, "m:nary"), 1);
  // OMML da `m:chr` BERILMASA nary belgisi standart ∫ — `docx` `MathIntegral` aynan shunday yozadi.
  assert.ok(!int.includes("<m:chr"), "integralda `m:chr` bo'lmasligi kerak (standart ∫)");
  assert.ok(int.includes('<m:limLoc m:val="subSup"/>'), "integral chegaralari subSup");
});

test("yunon harflari va belgilar → matn", async () => {
  const t = texts(await xmlOf("\\alpha + \\beta \\leq \\gamma \\times \\pi \\pm \\Omega \\geq \\infty \\rightarrow \\neq \\approx")).join("");
  for (const ch of ["α", "β", "≤", "γ", "×", "π", "±", "Ω", "≥", "∞", "→", "≠", "≈"]) assert.ok(t.includes(ch), `${ch} yo'q: ${t}`);
});

test("funksiyalar → m:func; \\text/\\mathrm xom matn; \\left \\right tushadi", async () => {
  const f = await xmlOf("y = \\sin(x) + \\ln{x}");
  assert.equal(count(f, "m:func"), 2);
  assert.ok(f.includes("<m:fName>"), "funksiya nomi yo'q");
  const t = texts(await xmlOf("\\text{ball} = \\left( a \\right)")).join("");
  assert.ok(t.includes("ball"), t);
  assert.ok(t.includes("(a)") || t.includes("(") && t.includes(")"), t);
  assert.ok(!t.includes("left") && !t.includes("right"), t);
});

test("qoplanmagan buyruq → MathRun(xom), hujjat buzilmaydi", async () => {
  const xml = await xmlOf("\\mathfrak{A} + \\unknowncmd{x}");
  assert.ok(texts(xml).join("").includes("\\mathfrak"), "xom matn kutilgan edi");
  assert.ok(texts(xml).join("").includes("\\unknowncmd"));
  assert.equal(count(xml, "m:f"), 0);
});

test("bo'sh va buzuq kirish ham yiqilmaydi", async () => {
  assert.ok(omml("").length >= 1);
  assert.ok(omml("\\frac{a}{").length >= 1, "yopilmagan qavs");
  assert.ok(omml("a } b { c").length >= 1, "ortiqcha yopuvchi qavs");
  const t = texts(await xmlOf("a } b")).join("");
  assert.ok(t.includes("a") && t.includes("b"), t);
});

test("ketma-ket oddiy belgilar bitta m:r ga qo'shiladi (ixcham XML)", async () => {
  const xml = await xmlOf("a+b=c");
  assert.equal(count(xml, "m:r"), 1, xml);
  assert.deepEqual(texts(xml), ["a+b=c"]);
});
