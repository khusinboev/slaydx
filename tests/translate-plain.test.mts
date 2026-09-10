import test from "node:test";
import assert from "node:assert/strict";
import {
  applySegments,
  extractSegments,
  isTranslatable,
  joinSubsegments,
  markDuplicates,
  outputFileName,
  splitOversize,
  stripTokens,
  textToSegments,
  tokenMultiset,
  tokensBalanced,
  OUTPUT_MIME,
  type Segment,
  type SourceKind,
} from "../lib/generation/translate/index.ts";
import { fakeTranslate } from "./helpers/office-fixtures.ts";

/**
 * Matnli formatlar (TXT / Markdown / CSV) va segment modelining
 * format-neytral qismi.
 */
const enc = new TextEncoder();
// `ignoreBOM` — aks holda dekoderning O'ZI BOM ni yeb qo'yadi va test
// adapter uni saqlaganini ko'ra olmaydi.
const dec = new TextDecoder("utf-8", { ignoreBOM: true });

async function roundTrip(kind: "txt" | "md" | "csv", text: string) {
  const bytes = enc.encode(text);
  const ex = await extractSegments(kind, bytes);
  const map = new Map(ex.segments.map((s) => [s.id, fakeTranslate(s.text)]));
  return {
    ex,
    out: dec.decode(await applySegments(kind, bytes, map)),
    identity: dec.decode(await applySegments(kind, bytes, new Map())),
  };
}

test("TXT: bo'sh qatorli paragraflar va ⟦br⟧", async () => {
  const src = "Birinchi paragraf.\nIkkinchi qator.\n\nUchinchi paragraf bu yerda.\n";
  const { ex, out, identity } = await roundTrip("txt", src);

  assert.deepEqual(
    ex.segments.map((s) => [s.id, s.text]),
    [
      ["t:0", "Birinchi paragraf.⟦br⟧Ikkinchi qator."],
      ["t:1", "Uchinchi paragraf bu yerda."],
    ],
  );
  assert.equal(ex.chars, ex.segments.reduce((n, s) => n + s.text.length, 0));
  assert.equal(out, "[T]Birinchi paragraf.\n[T]Ikkinchi qator.\n\n[T]Uchinchi paragraf bu yerda.\n");
  assert.equal(identity, src, "tarjimasiz — bayt-ba-bayt asl fayl");

  // `textToSegments` (matn rejimi) TXT yo'li bilan bir xil.
  assert.deepEqual(textToSegments(src).segments.map((s) => s.text), ex.segments.map((s) => s.text));
});

test("TXT: CRLF va BOM saqlanadi", async () => {
  const src = "﻿Birinchi qator.\r\n\r\nIkkinchi paragraf.\r\n";
  const { out, identity } = await roundTrip("txt", src);
  assert.equal(identity, src);
  assert.ok(out.startsWith("﻿"), "BOM joyida");
  assert.ok(out.includes("\r\n\r\n"), "CRLF saqlanadi");
});

const MD = [
  "# Sarlavha bir",
  "",
  "Oddiy **qalin** matn va `kod` hamda [havola](https://example.com) bor.",
  "",
  "- Birinchi band",
  "- Ikkinchi band",
  "",
  "| Ustun A | Ustun B |",
  "| --- | --- |",
  "| Katak bir | Katak ikki |",
  "",
  "```js",
  "const x = 'tegilmasin';",
  "```",
  "",
  "> Iqtibos matni",
  "",
].join("\n");

test("MD: prefikslar, kod bloklari va ichki belgilar", async () => {
  const { ex, out, identity } = await roundTrip("md", MD);
  const by = new Map(ex.segments.map((s) => [s.id, s]));

  assert.equal(by.get("m:0")?.kind, "h");
  assert.equal(by.get("m:0")?.text, "Sarlavha bir", "`# ` prefiksi segmentga kirmaydi");
  assert.equal(by.get("m:4")?.kind, "li");
  assert.equal(by.get("m:7:1")?.kind, "cell");

  // Ta'kid → ⟦rK⟧, kod → opaque, havola → ⟦lK⟧ (URL segmentda yo'q).
  assert.equal(by.get("m:2")?.text, "Oddiy ⟦r1⟧qalin⟦/r1⟧ matn va ⟦1⟧ hamda ⟦l1⟧havola⟦/l1⟧ bor.");

  // Kod bloki umuman segment bermaydi.
  assert.ok(!ex.segments.some((s) => s.text.includes("tegilmasin")), "```-blok o'tkaziladi");
  assert.ok(out.includes("const x = 'tegilmasin';"), "kod bloki o'z holicha");

  assert.ok(out.startsWith("# [T]Sarlavha bir"), "sarlavha prefiksi qoladi");
  assert.ok(out.includes("**[T]qalin**"), "qalin belgilari qaytariladi");
  assert.ok(out.includes("`kod`"), "kod spani o'zgarmaydi");
  assert.ok(out.includes("](https://example.com)"), "havola URL i saqlanadi");
  assert.ok(out.includes("| --- | --- |"), "jadval ajratgichi tegilmaydi");
  assert.ok(out.includes("- [T]Birinchi band"), "ro'yxat markeri qoladi");
  assert.ok(out.includes("> [T]Iqtibos matni"), "iqtibos prefiksi qoladi");
  assert.equal(identity, MD, "tarjimasiz — asl fayl");
});

test("CSV: ajratgich, qo'shtirnoq va raqamlar saqlanadi", async () => {
  const src = 'Nomi;Izoh;Soni\r\n"Birinchi mahsulot";"Uzun, vergulli izoh";12\r\nIkkinchi;Oddiy izoh;7\r\n';
  const { ex, out, identity } = await roundTrip("csv", src);

  assert.equal(ex.segments[0].ctx, "header", "birinchi qator — sarlavha");
  assert.equal(ex.segments[0].id, "c:0:0");
  assert.ok(!ex.segments.some((s) => s.text === "12"), "raqamli katak tarjima qilinmaydi");

  assert.ok(out.startsWith("[T]Nomi;[T]Izoh;[T]Soni\r\n"), `chiqish: ${JSON.stringify(out.slice(0, 40))}`);
  assert.ok(out.includes('"[T]Uzun, vergulli izoh"'), "vergulli katak qo'shtirnoqda qoladi");
  assert.ok(out.endsWith(";7\r\n"), "raqam va qator yakuni o'z holicha");
  assert.equal(identity, src);
});

test("CSV: vergulli ajratgich va yangi qo'shtirnoq ehtiyoji", async () => {
  const src = "a,b\nbir,ikki\n";
  const bytes = enc.encode(src);
  const ex = await extractSegments("csv", bytes);
  const out = dec.decode(await applySegments("csv", bytes, new Map([[ex.segments[2].id, "bir, vergul bilan"]])));
  assert.ok(out.includes('"bir, vergul bilan"'), `qo'shtirnoq qo'shilsin: ${out}`);
});

test("chiqish nomi va MIME turi", () => {
  assert.equal(outputFileName("hisobot.docx", "docx", "uz"), "hisobot-uz.docx");
  assert.equal(outputFileName("hisobot.pdf", "pdf", "uz"), "hisobot-uz.docx", "PDF → DOCX");
  assert.equal(outputFileName("deka.pptx", "pptx", "en"), "deka-en.pptx");
  assert.equal(outputFileName("jadval", "xlsx", "ru"), "jadval-ru.xlsx");
  assert.equal(OUTPUT_MIME.pdf, OUTPUT_MIME.docx, "PDF natijasi DOCX bo'lib qaytadi");
  for (const kind of ["docx", "pptx", "xlsx", "pdf", "txt", "md", "csv"] as SourceKind[]) {
    assert.ok(OUTPUT_MIME[kind], kind);
  }
});

test("isTranslatable: nima modelga bormaydi", () => {
  for (const yes of ["Salom dunyo", "12 ta olma", "Bo'lim 3.1 — kirish", "A. Ismoilov"]) {
    assert.equal(isTranslatable(yes), true, yes);
  }
  for (const no of ["", "   ", "12 345", "—", "https://example.com", "info@slaydx.uz", "ISO-9001", "12 kg", "3.5 GHz", "⟦1⟧"]) {
    assert.equal(isTranslatable(no), false, no);
  }
});

test("tokenlar: tozalash, multiset va muvozanat", () => {
  assert.equal(stripTokens("a⟦tab⟧b⟦br⟧c⟦1⟧d⟦r1⟧e⟦/r1⟧"), "a\tb\ncde");
  assert.deepEqual(tokenMultiset("b⟦r1⟧a⟦/r1⟧⟦tab⟧"), ["⟦/r1⟧", "⟦r1⟧", "⟦tab⟧"]);
  assert.deepEqual(tokenMultiset("⟦tab⟧⟦r1⟧x⟦/r1⟧"), tokenMultiset("⟦r1⟧x⟦/r1⟧⟦tab⟧"), "tartib ahamiyatsiz");

  assert.equal(tokensBalanced("⟦r1⟧a⟦/r1⟧⟦l2⟧b⟦/l2⟧"), true);
  assert.equal(tokensBalanced("⟦r1⟧a⟦l2⟧b⟦/l2⟧⟦/r1⟧"), true, "ichma-ich ruxsat");
  assert.equal(tokensBalanced("⟦r1⟧a"), false, "yopilmagan");
  assert.equal(tokensBalanced("⟦r1⟧a⟦/r2⟧"), false, "boshqa juft");
  assert.equal(tokensBalanced("⟦r1⟧a⟦l2⟧b⟦/r1⟧⟦/l2⟧"), false, "tartib buzilgan");
  assert.equal(tokensBalanced("a⟦1⟧b⟦tab⟧"), true, "opaque va tab juft talab qilmaydi");
});

test("splitOversize: jumla chegarasi bo'yicha, tokenni kesmasdan", () => {
  const sentence = "Bu juda uzun jumla va u takrorlanadi. ";
  const seg: Segment = { id: "d0:p1", text: sentence.repeat(10), kind: "p", part: "word/document.xml" };
  const parts = splitOversize(seg, 120);

  assert.ok(parts.length > 1, `bo'laklar: ${parts.length}`);
  assert.deepEqual(parts.map((p) => p.id).slice(0, 3), ["d0:p1#0", "d0:p1#1", "d0:p1#2"]);
  assert.equal(parts.map((p) => p.text).join(""), seg.text, "bo'laklar aynan asl matnni beradi");
  for (const p of parts) assert.ok(p.text.trimEnd().endsWith("."), `jumla chegarasi: ${p.text}`);

  // Token hech qachon ikkiga bo'linmaydi.
  const withTokens: Segment = { id: "x", text: `${"So'z ".repeat(40)}⟦r1⟧qalin⟦/r1⟧ oxiri.`, kind: "p", part: "text" };
  for (const p of splitOversize(withTokens, 60)) {
    assert.equal(tokensBalanced(p.text) || p.text.includes("⟦"), true);
    assert.ok(!/⟦[^⟧]*$/.test(p.text), `yarim token: ${p.text}`);
  }

  // Chegaradan kichik segment tegilmaydi.
  assert.deepEqual(splitOversize({ ...seg, text: "Qisqa." }, 120), [{ ...seg, text: "Qisqa." }]);
});

test("joinSubsegments: bo'laklar qayta yopishadi", () => {
  assert.equal(joinSubsegments(["Birinchi jumla.", "Ikkinchi jumla."]), "Birinchi jumla. Ikkinchi jumla.");
  assert.equal(joinSubsegments(["Birinchi jumla. ", "Ikkinchi."]), "Birinchi jumla. Ikkinchi.");
  assert.equal(joinSubsegments(["a⟦br⟧", "b"]), "a⟦br⟧b", "token chegarasida probel qo'shilmaydi");
  assert.equal(joinSubsegments(["yagona"]), "yagona");
});

test("markDuplicates: takror matn birinchisiga ishora qiladi", () => {
  const segs: Segment[] = [
    { id: "a", text: "Jami summa", kind: "cell", part: "p" },
    { id: "b", text: "  jami   SUMMA ", kind: "cell", part: "p" },
    { id: "c", text: "Boshqa matn", kind: "cell", part: "p" },
    { id: "d", text: "Jami summa", kind: "cell", part: "p" },
  ];
  markDuplicates(segs);
  assert.equal(segs[0].dup, undefined);
  assert.equal(segs[1].dup, "a", "registr va bo'shliq ahamiyatsiz");
  assert.equal(segs[2].dup, undefined);
  assert.equal(segs[3].dup, "a");
});
