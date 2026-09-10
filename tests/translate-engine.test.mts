import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_CHARS,
  checkVerbatim,
  glossarySample,
  mergeGlossary,
  parseUserGlossary,
  planBatches,
  translateSegments,
  validateItems,
  type TranslateOpts,
} from "../lib/generation/translate/engine.ts";
import type { Segment } from "../lib/generation/translate/index.ts";
import { translationSystem } from "../lib/generation/translate/prompts.ts";
import type { llmComplete } from "../lib/generation/llm.ts";

/**
 * Tarjima dvigateli (Tarjimon 2, WP3) — LLM stub bilan.
 *
 * Stub `complete(system, user, …)` foydalanuvchi promptidan JSON
 * `items` ni o'qib, har matnni `[T]` prefiksi bilan qaytaradi; testlar
 * uni buzib (id tushirish, JSON buzish, raqam yo'qotish) dvigatel
 * xatti-harakatini tekshiradi. Glossariy so'rovi (`"detected"` so'zi
 * tizim promptida) alohida javob oladi.
 */

type Call = { system: string; user: string; maxTokens: number; opts: Record<string, unknown> };

function itemsOf(user: string): { id: string; text: string; kind: string }[] {
  const m = user.match(/Items \(JSON\): (\[[\s\S]*\])\nReturn/);
  return m ? (JSON.parse(m[1]) as { id: string; text: string; kind: string }[]) : [];
}

function stub(
  behave: (items: { id: string; text: string }[], call: Call, n: number) => unknown | null = (items) => ({
    items: items.map((i) => ({ id: i.id, text: `[T]${i.text}` })),
  }),
  glossary: unknown = { detected: "uz", domain: "biology", glossary: [{ src: "fotosintez", dst: "photosynthesis" }] },
) {
  const calls: Call[] = [];
  const complete: typeof llmComplete = async (system, user, maxTokens = 0, opts = {}) => {
    const call = { system, user, maxTokens, opts: opts as Record<string, unknown> };
    calls.push(call);
    if (system.includes('"detected"')) return glossary === null ? null : JSON.stringify(glossary);
    const out = behave(itemsOf(user), call, calls.length);
    return out === null ? null : typeof out === "string" ? out : JSON.stringify(out);
  };
  return { calls, complete };
}

function seg(id: string, text: string, kind: Segment["kind"] = "p", extra: Partial<Segment> = {}): Segment {
  return { id, text, kind, part: "text", ...extra };
}

function opts(over: Partial<TranslateOpts> = {}): TranslateOpts {
  return { target: "en", sourceLang: "avto", style: "formal", userGlossary: [], deadline: Date.now() + 600_000, sourceKind: "text", ...over };
}

const many = (n: number, len = 60) => Array.from({ length: n }, (_, i) => seg(`t:${i}`, `Fotosintez jarayoni ${i} haqida ${"matn ".repeat(Math.ceil(len / 5))}`.trim()));

test("planBatches: segment bo'linmaydi, chegara saqlanadi, tartib o'zgarmaydi", () => {
  const segs = many(40, 300);
  const batches = planBatches(segs, 1000);
  assert.ok(batches.length > 1);
  for (const b of batches) assert.ok(b.reduce((n, s) => n + s.text.length, 0) <= 1000 || b.length === 1);
  assert.deepEqual(batches.flat().map((s) => s.id), segs.map((s) => s.id));
  // Bitta ulkan segment — o'z partiyasida.
  const big = [seg("a", "x".repeat(2000)), seg("b", "y".repeat(2000))];
  assert.equal(planBatches(big, 1000).length, 2);
});

test("checkVerbatim: raqam ajratgichsiz, URL, email, placeholder, akronim; so'z bilan yozilgan raqam — yo'q deb hisoblanadi", () => {
  assert.equal(checkVerbatim("2024-yilda 1 250 ta maktab", "In 2024, 1,250 schools").ok, true);
  assert.equal(checkVerbatim("Narxi 3 000 so'm", "Price is three thousand").ok, false);
  assert.deepEqual(checkVerbatim("Sayt: https://slaydxx.uz va info@slaydxx.uz", "Site: https://slaydxx.uz and info@slaydxx.uz").missing, []);
  assert.ok(checkVerbatim("Sayt: https://slaydxx.uz", "Sayt: slaydxx").missing.includes("https://slaydxx.uz"));
  assert.ok(checkVerbatim("Salom {{name}}, %s", "Hello {{ism}}, %s").missing.includes("{{name}}"));
  assert.equal(checkVerbatim("UNESCO va GOST 7.32", "UNESCO and GOST 7.32").ok, true);
  assert.ok(checkVerbatim("UNESCO qarori", "ЮНЕСКО qarori").missing.includes("UNESCO"));
});

test("parseUserGlossary: =, —, :, → ajratgichlar; takror va bo'sh qatorlar tashlanadi; mergeGlossary foydalanuvchini ustun qo'yadi", () => {
  const g = parseUserGlossary("fotosintez = photosynthesis\n xloroplast — chloroplast \n\nbarg: leaf\nfotosintez = DUPLICATE\nno-separator line\n");
  assert.deepEqual(g, [
    { src: "fotosintez", dst: "photosynthesis" },
    { src: "xloroplast", dst: "chloroplast" },
    { src: "barg", dst: "leaf" },
  ]);
  const merged = mergeGlossary([{ src: "Fotosintez", dst: "MODEL" }, { src: "yorug‘lik", dst: "light" }], g);
  assert.equal(merged.find((x) => x.src.toLowerCase() === "fotosintez")?.dst, "photosynthesis", "foydalanuvchi ustun");
  assert.ok(merged.some((x) => x.src === "yorug‘lik"));
});

test("glossarySample: kichik hujjat to'liq, katta hujjat tekis oynalar bilan (oxiri ham kiradi)", () => {
  const small = glossarySample([seg("a", "Salom dunyo")]);
  assert.equal(small.sample, "Salom dunyo");
  const segs = Array.from({ length: 200 }, (_, i) => seg(`s${i}`, `BOLIM${i} ${"a".repeat(200)}`));
  const big = glossarySample(segs, 6000);
  assert.ok(big.sample.length <= 6000 + 20 * 5);
  assert.ok(big.sample.includes("BOLIM0") && big.sample.includes("BOLIM19"), "boshi va oxiri namunada");
});

test("validateItems: yo'q id, bo'sh, aynan bir xil, token mos kelmasa — muvaffaqiyatsiz; verbatim — qabul + nomzod", () => {
  const batch = [seg("1", "Salom ⟦br⟧ dunyo 2024"), seg("2", "Matn ikki"), seg("3", "Uch"), seg("4", "Xayr")];
  const r = validateItems(
    batch,
    { items: [{ id: "1", text: "Hello ⟦br⟧ world 2024" }, { id: "2", text: "Matn ikki" }, { id: "3", text: "" }] },
    { sameLang: false },
  );
  assert.equal(r.ok.get("1"), "Hello ⟦br⟧ world 2024");
  assert.deepEqual(r.fails.map((f) => `${f.id}:${f.reason}`), ["2:same", "3:empty", "4:missing"]);
  const tok = validateItems([seg("1", "A ⟦tab⟧ B ⟦r1⟧C⟦/r1⟧")], { items: [{ id: "1", text: "A B ⟦r1⟧C⟦/r1⟧" }] }, { sameLang: false });
  assert.equal(tok.fails[0]?.reason, "tokens");
  const vb = validateItems([seg("1", "Narx 3000 so'm")], { items: [{ id: "1", text: "Price is unknown" }] }, { sameLang: false });
  assert.equal(vb.ok.get("1"), "Price is unknown", "verbatim xatosi tarjimani tashlamaydi");
  assert.equal(vb.fails[0]?.reason, "verbatim");
});

test("to'liq oqim: glossariy + aniqlangan til tizim promptiga tushadi, hamma segment tarjima qilinadi, progress 8→90, dublikat bir marta", async () => {
  const { calls, complete } = stub();
  const segs = [...many(6, 40), seg("dupA", "Bir xil sarlavha", "h"), seg("dupB", "Bir xil sarlavha", "h")];
  const stages: number[] = [];
  const res = await translateSegments(segs, opts({ onStage: (e: { progress: number }) => stages.push(e.progress) }), { complete });
  assert.equal(res.report.detected, "uz");
  assert.equal(res.report.domain, "biology");
  assert.deepEqual(res.report.glossary, [{ src: "fotosintez", dst: "photosynthesis" }]);
  const sys = calls.find((c) => !c.system.includes('"detected"'))!.system;
  assert.ok(sys.includes("«fotosintez» → «photosynthesis»"), "glossariy promptda");
  assert.ok(sys.includes("Uzbek (Latin script) (auto-detected)"), "aniqlangan til promptda");
  for (const s of segs) assert.equal(res.map.get(s.id), `[T]${s.text}`);
  assert.equal(res.report.translated, segs.length);
  assert.equal(res.delivered, undefined);
  assert.ok(stages[0] === 8 && stages.at(-1)! >= 90 && stages.every((v, i) => i === 0 || v >= stages[i - 1]), `progress: ${stages}`);
  // Dublikat: modelga bitta marta yuborilgan.
  const sent = calls.filter((c) => !c.system.includes('"detected"')).flatMap((c) => itemsOf(c.user).map((i) => i.id));
  assert.ok(sent.includes("dupA") && !sent.includes("dupB"));
  assert.equal(res.report.pairs.find((p) => p.id === "dupB")?.dst, "[T]Bir xil sarlavha");
  assert.ok(sys.includes("formal academic"));
});

test("yo'q id → faqat shu id bilan qat'iy qayta urinish; uzun segment bo'linib qayta yig'iladi", async () => {
  let dropped = false;
  const { calls, complete } = stub((items, call) => {
    if (!dropped && items.length > 1) {
      dropped = true;
      return { items: items.slice(1).map((i) => ({ id: i.id, text: `[T]${i.text}` })) };
    }
    if (call.user.includes("Previous attempt failed")) assert.equal(items.length, 1, "qayta urinishda faqat muvaffaqiyatsiz id");
    return { items: items.map((i) => ({ id: i.id, text: `[T]${i.text}` })) };
  });
  const sentences = Array.from({ length: 120 }, (_, i) => `Bu ${i}-jumla fotosintez haqida ma'lumot beradi.`).join(" ");
  const segs = [...many(3, 40), seg("long", sentences)];
  assert.ok(sentences.length > BATCH_CHARS);
  const res = await translateSegments(segs, opts(), { complete });
  assert.ok(calls.some((c) => c.user.includes("Previous attempt failed")), "qat'iy retry bo'ldi");
  assert.equal(res.delivered, undefined);
  const long = res.map.get("long")!;
  /*
   * `splitOversize` JUMLA chegarasida va `max` ga qadar bo'ladi, ya'ni
   * oxirgi bo'lak qayerdan boshlanishi matn uzunligiga bog'liq (bu yerda
   * 5 649 belgi / 3 500 → ikki bo'lak, ikkinchisi 74-jumladan). Shuning
   * uchun aniq jumla raqamiga emas, QAYTA YIG'ILISH faktiga tayanamiz:
   * bir nechta bo'lak tarjima qilingan va matnning OXIRI joyida.
   */
  assert.ok(long.startsWith("[T]"), "birinchi bo'lak tarjimasi boshda");
  assert.ok((long.match(/\[T\]/g) ?? []).length >= 2, `uzun segment bo'lingan bo'lishi kerak: ${long.slice(0, 80)}`);
  assert.ok(long.trimEnd().endsWith("Bu 119-jumla fotosintez haqida ma'lumot beradi."), "oxirgi jumla saqlandi");
  assert.ok(!res.map.has("long#0"), "bola idlar xaritada qolmaydi");
  assert.equal(res.report.pairs.find((p) => p.id === "long")?.dst, long);
});

test("buzuq JSON → partiya ikkiga bo'linib qayta so'raladi", async () => {
  let first = true;
  const { calls, complete } = stub((items) => {
    if (first && items.length > 5) {
      first = false;
      return "{not json";
    }
    return { items: items.map((i) => ({ id: i.id, text: `[T]${i.text}` })) };
  });
  const res = await translateSegments(many(10, 40), opts(), { complete });
  const batchCalls = calls.filter((c) => !c.system.includes('"detected"'));
  assert.ok(batchCalls.length >= 3, `yarim partiyalar: ${batchCalls.length}`);
  assert.equal(res.report.translated, 10);
});

test("qisman qoida: 2/100 tarjima qilinmasa asl matn qoladi + ogohlantirish + delivered; 5/100 → xato (to'liq qaytarish)", async () => {
  const drop = (ids: Set<string>) => (items: { id: string; text: string }[]) => ({
    items: items.filter((i) => !ids.has(i.id)).map((i) => ({ id: i.id, text: `[T]${i.text}` })),
  });
  const two = stub(drop(new Set(["t:3", "t:40"])));
  const res = await translateSegments(many(100, 30), opts(), { complete: two.complete });
  assert.deepEqual(res.delivered, { got: 98, want: 100, unit: "band", refundShare: 1 });
  assert.equal(res.map.get("t:3"), many(100, 30)[3].text, "asl matn qoldi");
  assert.equal(res.report.warnings.filter((w) => w.code === "untranslated").length, 2);
  assert.equal(res.report.pairs.find((p) => p.id === "t:3")?.warn, true);
  const five = stub(drop(new Set(["t:1", "t:2", "t:3", "t:4", "t:5"])));
  await assert.rejects(translateSegments(many(100, 30), opts(), { complete: five.complete }), /100 banddan 5 tasi/);
});

test("verbatim xatosi: qayta urinishdan keyin ham raqam yo'q — tarjima qabul, `numbers` ogohlantirishi, pul qaytarilmaydi", async () => {
  const { complete } = stub((items) => ({ items: items.map((i) => ({ id: i.id, text: `[T]${i.text.replace(/\d+/g, "N")}` })) }));
  const res = await translateSegments([seg("a", "Bu yerda 2024 yil"), seg("b", "Raqamsiz matn")], opts(), { complete });
  assert.equal(res.delivered, undefined);
  assert.ok(res.map.get("a")!.startsWith("[T]"));
  assert.equal(res.report.warnings.filter((w) => w.code === "numbers" && w.id === "a").length, 1);
  assert.equal(res.report.pairs.find((p) => p.id === "a")?.warn, true);
});

test("token mos kelmasa qayta so'raladi; ikkinchi urinishda to'g'ri kelsa ogohlantirishsiz", async () => {
  let n = 0;
  const { complete } = stub((items) => {
    n++;
    return { items: items.map((i) => ({ id: i.id, text: n === 1 ? `[T]${i.text.replace("⟦br⟧", "")}` : `[T]${i.text}` })) };
  });
  const res = await translateSegments([seg("a", "Birinchi ⟦br⟧ ikkinchi")], opts(), { complete });
  assert.equal(res.map.get("a"), "[T]Birinchi ⟦br⟧ ikkinchi");
  assert.equal(res.report.warnings.length, 0);
});

test("deadline tugagan: qolgan partiyalar chaqirilmaydi → 3% dan ko'p bo'lsa xato", async () => {
  let t = 0;
  const now = () => t;
  const { calls, complete } = stub((items) => {
    t += 100_000; // har chaqiruv 100 s «oladi»
    return { items: items.map((i) => ({ id: i.id, text: `[T]${i.text}` })) };
  });
  await assert.rejects(translateSegments(many(200, 100), opts({ deadline: 250_000 }), { complete, now }), /tarjima qilinmadi/);
  assert.ok(calls.length < 10, `vaqt tugagach chaqiruvlar to'xtaydi: ${calls.length}`);
});

test("manba tili tanlangan, aniqlangani boshqa → `detected` ogohlantirishi; manba=maqsad bo'lsa aynan matn qabul qilinadi", async () => {
  const { complete } = stub(undefined, { detected: "ru", glossary: [] });
  const res = await translateSegments([seg("a", "Salom dunyo")], opts({ sourceLang: "uz" }), { complete });
  assert.equal(res.report.detected, "uz", "tanlangan til ustun");
  assert.ok(res.report.warnings.some((w) => w.code === "detected"));
  const same = stub((items) => ({ items: items.map((i) => ({ id: i.id, text: i.text })) }), { detected: "en", glossary: [] });
  const r2 = await translateSegments([seg("a", "Already English text")], opts({ sourceLang: "en", target: "en" }), { complete: same.complete });
  assert.equal(r2.map.get("a"), "Already English text");
  assert.equal(r2.delivered, undefined);
});

test("glossariy chaqiruvi yiqilsa — lug'atsiz davom; adapter ogohlantirishi hisobotga tushadi; ar → rtl", async () => {
  const { complete } = stub(undefined, null);
  const res = await translateSegments([seg("a", "Salom")], opts({ target: "ar", extractWarnings: ["2 ta SmartArt tarjima qilinmadi"] }), { complete });
  assert.equal(res.report.detected, "avto");
  assert.deepEqual(res.report.glossary, []);
  assert.ok(res.report.warnings.some((w) => w.code === "skipped-part"));
  assert.ok(res.report.warnings.some((w) => w.code === "rtl"));
});

test("translationSystem: uslub qatori, glossariysiz izchillik qoidasi, chiqish tili birinchi qatorda", () => {
  const s = translationSystem("ru", "avto", undefined, "business", [], "IT");
  assert.ok(s.startsWith("OUTPUT LANGUAGE: Russian"));
  assert.ok(s.includes("business register"));
  assert.ok(s.includes("detect it from the text"));
  assert.ok(s.includes("Domain: IT."));
  assert.ok(s.includes("keep every recurring term translated the same way"));
});
