import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { buildInfographicArtifact, retryProblems, PREVIEW_DPI } from "../lib/generation/infographic/engine.ts";
import { normalizeSpec, infographicInputFromValues, infographicUserFacts, encodeInfographicValues } from "../lib/generation/infographic/input.ts";
import { infographicCtx, infographicPrompt, infographicRetryPrompt, infographicSystemPrompt } from "../lib/generation/infographic/prompts.ts";
import { infographicTypeOf } from "../lib/generation/infographic/registry.ts";
import { ICONS, INFOGRAPHIC_LIMITS, type InfographicSpec } from "../lib/generation/infographic/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";

/**
 * INFOGRAFIKA DVIGATELI (AUDIT-21 WP-C) — `buildInfographicArtifact`.
 *
 * Model MOCK: `opts.complete` stub'i. Tekshiriladigan narsa —
 * QUVUR (kirish → spetsifikatsiya → maket → PNG → hisobot) va uning
 * chegaraviy xulqi: model javob bermasa `null`, maket rad etsa BIR
 * MARTA qayta so'rov, so'ralganidan kam blok chiqsa `delivered`.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `normalizeSpec` modeldan `type` ni oldi (forma o'rniga) —
 *      «tur FORMADAN» testi;
 *   2. qayta so'rov shoxi olib tashlandi — «sig'magan matn qayta
 *      so'raladi» testi;
 *   3. `delivered` hisobi olib tashlandi — «kam blok → farq qaytadi»;
 *   4. eskiz 300 dpi da chizildi — «`doc.images` eskizi kichik» testi;
 *   5. sayqaldan keyin qayta chizish olib tashlandi — «qabul qilingan
 *      sayqal FAYLGA ham tushadi» testi.
 */

const tool = TOOL_BY_ID.infographic;

const BASE: FormValues = {
  topic: "Suv aylanishi",
  infographicType: "list",
  blockCount: 4,
  palette: "indigo",
  size: "A4",
  language: "uz",
  extra: "",
};

/* ────────────────────────── stub ────────────────────────── */

type BlockJson = Record<string, unknown>;

const blockJson = (i: number, over: BlockJson = {}): BlockJson => ({
  icon: ICONS[i % ICONS.length],
  heading: `Bosqich ${i + 1}`,
  text: `Bu bosqichda aniq bir jarayon sodir bo'ladi va uning natijasi keyingi bosqichga o'tadi.`,
  ...over,
});

const specJson = (n = 4, over: Record<string, unknown> = {}, block: (i: number) => BlockJson = blockJson) => ({
  title: "Suv aylanishi",
  subtitle: "Quyosh boshqaradigan jarayon",
  blocks: Array.from({ length: n }, (_, i) => block(i)),
  ...over,
});

/** `complete` stub'i: javoblarni navbat bilan qaytaradi; `judge` — null. */
function stub(...answers: unknown[]) {
  const calls: { role: LlmRole; system: string; user: string }[] = [];
  let i = 0;
  const complete = (async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") return null;
    const a = answers[Math.min(i++, answers.length - 1)];
    return a === null ? null : { text: JSON.stringify(a) };
  }) as never;
  return { complete, calls };
}

const build = (values: FormValues, complete: unknown, extra: Record<string, unknown> = {}) =>
  buildInfographicArtifact(tool, values, { deadline: Date.now() + 180_000, complete: complete as never, judge: false, polish: false, ...extra });

/* ══════════════════════════ 1. baxtli yo'l ══════════════════════════ */

test("dvigatel: PNG fayl, `doc.infographic` modeli va hisobot qaytaradi", async () => {
  const { complete } = stub(specJson(4, { source: "6-sinf darsligi" }));
  const built = await build({ ...BASE, extra: "6-sinf darsligidan" }, complete);
  assert.ok(built, "dvigatel `null` qaytardi");
  assert.equal(built!.mime, "image/png");
  assert.ok(built!.fileName.endsWith(".png"));
  assert.ok(built!.bytes.byteLength > 20_000, `PNG ${built!.bytes.byteLength} bayt — juda kichik`);

  const model = built!.doc.infographic;
  assert.ok(model, "`doc.infographic` yo'q");
  assert.equal(model!.v, 1);
  assert.equal(model!.spec.blocks.length, 4);
  assert.ok(model!.review, "hisobot yozilmagan");
  assert.ok(model!.review!.checks.some((c) => c.id === "noOverflow"));
  assert.ok(!built!.delivered, "to'liq yetkazilganda `delivered` bo'lmasligi kerak");
  assert.ok(built!.cost, "sarf telemetriyasi yo'q");
});

test("dvigatel: ko'ruvchi uchun ESKIZ `doc.images` da, fayl esa 300 dpi", async () => {
  const { complete } = stub(specJson(4));
  const built = await build(BASE, complete);
  const img = built!.doc.images?.[0];
  assert.ok(img, "`doc.images` bo'sh — ImageViewer hech narsa chizmaydi");
  assert.ok(img!.url.startsWith("data:image/png;base64,"), "eskiz `data:` URL bo'lishi kerak");
  assert.ok(img!.w! < 1200, `eskiz kengligi ${img!.w} — 300 dpi li nusxa \`doc_json\` ga tushib qolgan`);
  assert.ok(img!.w! > 700, `eskiz kengligi ${img!.w} — juda kichik`);
  assert.ok(PREVIEW_DPI < INFOGRAPHIC_LIMITS.dpi);
  // Eskiz base64 i hujjat JSON iga tushadi — u FAYLDAN ancha kichik bo'lsin.
  assert.ok(img!.url.length < built!.bytes.byteLength, "eskiz fayldan kichik bo'lishi kerak");
  assert.ok(built!.html.includes("<img"), "HTML eskizda rasm bo'lishi kerak");
});

test("dvigatel: hujjat bo'limida plakat MATNI saqlanadi (panel va qidiruv uchun)", async () => {
  const { complete } = stub(specJson(3, { source: "Darslik" }));
  const built = await build({ ...BASE, blockCount: 3, extra: "Darslik" }, complete);
  const section = built!.doc.sections[0];
  assert.equal(section.title, "Suv aylanishi");
  const text = section.blocks.map((b) => b.text).join("\n");
  assert.ok(text.includes("Bosqich 1"), "blok sarlavhalari bo'limga tushmagan");
  assert.ok(text.includes("Manba: Darslik"));
  assert.equal(built!.doc.titlePage, false, "plakatda titul sahifasi yo'q");
});

/* ══════════════════════════ 2. forma parametrlari ══════════════════════════ */

test("kirish: tur, palitra, o'lcham va til FORMADAN — model ularni o'zgartira olmaydi", () => {
  const meta = extractMeta(tool, { ...BASE, infographicType: "timeline", palette: "forest", size: "A3", language: "ru" });
  const input = infographicInputFromValues(meta, { ...BASE, infographicType: "timeline", palette: "forest", size: "A3", language: "ru" });
  const s = normalizeSpec({ ...specJson(4), type: "list", palette: "berry", size: "A4", language: "en" }, input)!;
  assert.equal(s.type, "timeline", "model tanlagan tur formani bosib ketdi");
  assert.equal(s.palette, "forest");
  assert.equal(s.size, "A3");
  assert.equal(s.language, "ru");
});

test("kirish: blok soni TUR chegarasiga siqiladi, noma'lum qiymat standartga", () => {
  const meta = extractMeta(tool, BASE);
  // `process` da maks 6 — 8 so'ralsa 6 ga kesiladi.
  assert.equal(infographicInputFromValues(meta, { ...BASE, infographicType: "process", blockCount: 8 }).blockCount, infographicTypeOf("process").limits.blocks[1]);
  assert.equal(infographicInputFromValues(meta, { ...BASE, blockCount: 7 }).blockCount, INFOGRAPHIC_LIMITS.blocksDefault, "ro'yxatda yo'q qiymat standartga tushadi");
  const enc = encodeInfographicValues(infographicInputFromValues(meta, BASE));
  assert.equal(enc.infographicType, "list");
  assert.equal(enc.size, "A4");
});

test("kirish: buzuq/qisman model javobi tushunarli tarzda normallashadi", () => {
  const meta = extractMeta(tool, BASE);
  const input = infographicInputFromValues(meta, BASE);
  assert.equal(normalizeSpec(null, input), null);
  assert.equal(normalizeSpec({ blocks: [] }, input), null, "bo'sh ro'yxat — spetsifikatsiya yo'q");
  // `stat` SATR sifatida (hisobot §3 sxemasi) ham qabul qilinadi.
  const s = normalizeSpec({ blocks: [{ heading: "A", text: "B", stat: "73%", icon: "yo'q-ikon", parent: "1" }] }, input)!;
  assert.equal(s.blocks[0].stat?.value, "73%");
  assert.equal(s.blocks[0].icon, "bulb", "noma'lum ikon standartga tushishi kerak");
  assert.equal(s.blocks[0].parent, "b1", "raqamli `parent` blok id siga o'giriladi");
  assert.equal(s.title, "Suv aylanishi", "sarlavhasiz javobda mavzu ishlatiladi");
});

test("halollik: `userFacts` mavzu + qo'shimcha + manba matnidan yig'iladi", () => {
  const meta = extractMeta(tool, BASE);
  const input = infographicInputFromValues(meta, { ...BASE, extra: "71% suv" });
  input.sourceText = "darslikdan parcha";
  const facts = infographicUserFacts(input);
  assert.ok(facts.includes("71% suv") && facts.includes("darslikdan parcha") && facts.includes("Suv aylanishi"));
});

/* ══════════════════════════ 3. promptlar ══════════════════════════ */

test("prompt: tur qoidalari, chegaralar, ikon ro'yxati va HALOLLIK taqiqi ichida", () => {
  const meta = extractMeta(tool, BASE);
  const input = infographicInputFromValues(meta, { ...BASE, infographicType: "stat", extra: "" });
  const ctx = infographicCtx(infographicTypeOf("stat"), input);
  const sys = infographicSystemPrompt(ctx);
  assert.ok(sys.includes("OUTPUT LANGUAGE"), "til ko'rsatmasi birinchi qatorda bo'lishi kerak");
  for (const g of infographicTypeOf("stat").guidance) assert.ok(sys.includes(g), "tur qoidasi promptga tushmagan");
  assert.ok(sys.includes(String(INFOGRAPHIC_LIMITS.blockTextWordsMax)), "blok matni chegarasi yo'q");
  assert.ok(sys.includes(ICONS[0]) && sys.includes(ICONS[ICONS.length - 1]), "ikon ro'yxati to'liq emas");
  assert.ok(/NO block may carry a "stat"/.test(sys), "raqamsiz kirishda `stat` TAQIQLANISHI kerak");

  const withFacts = infographicCtx(infographicTypeOf("stat"), { ...input, extra: "71% suv" });
  assert.ok(/write FEWER blocks/.test(infographicSystemPrompt(withFacts)), "raqam yetmasa kamroq blok yozish ko'rsatilishi kerak");
  assert.ok(infographicPrompt(withFacts).includes("71% suv"), "foydalanuvchi ma'lumoti prompt tanasida bo'lishi kerak");
  assert.ok(infographicPrompt(ctx).includes("USER DATA: none"), "ma'lumot yo'qligi AYTILISHI kerak");
});

test("prompt: taqqoslash turida ost sarlavha ikki ustun nomi deb so'raladi", () => {
  const meta = extractMeta(tool, BASE);
  const input = infographicInputFromValues(meta, { ...BASE, infographicType: "compare" });
  const sys = infographicSystemPrompt(infographicCtx(infographicTypeOf("compare"), input));
  assert.ok(/em dash/.test(sys), "maket ustun nomlarini ost sarlavhadan oladi — prompt buni aytishi kerak");
  assert.ok(sys.includes('"side"'), "majburiy maydon reyestrdan olinishi kerak");
});

/* ══════════════════════════ 4. qayta so'rov ══════════════════════════ */

test("qayta so'rov: sig'magan matn BIR MARTA qayta so'raladi va qisqasi qabul qilinadi", async () => {
  const longText = "so'z ".repeat(300).trim();
  const bad = specJson(4, {}, (i) => blockJson(i, { text: longText }));
  const good = specJson(4);
  const { complete, calls } = stub(bad, good);
  const built = await build(BASE, complete);
  assert.equal(calls.filter((c) => c.role === "writer").length, 2, "aynan ikkita chaqiruv bo'lishi kerak (asosiy + qayta so'rov)");
  assert.ok(calls[1].user.includes("do not fit their printed card"), "qayta so'rovda AYNIQ muammo aytilishi kerak");
  assert.deepEqual(built!.doc.infographic!.review!.checks.find((c) => c.id === "noOverflow")?.level, "green");
});

test("qayta so'rov: javob YOMONLASHSA eski spetsifikatsiya qoladi", async () => {
  const longText = "so'z ".repeat(300).trim();
  const bad = specJson(4, {}, (i) => blockJson(i, { text: longText }));
  const worse = specJson(4, {}, (i) => blockJson(i, { text: "so'z ".repeat(600).trim() }));
  const { complete } = stub(bad, worse);
  const built = await build(BASE, complete);
  const words = built!.doc.infographic!.spec.blocks[0].text.split(/\s+/).length;
  assert.ok(words < 400, `yomonlashgan javob qabul qilindi (${words} so'z)`);
});

test("qayta so'rov: muammo yo'q bo'lsa IKKINCHI chaqiruv qilinmaydi", async () => {
  const { complete, calls } = stub(specJson(4));
  await build(BASE, complete);
  assert.equal(calls.filter((c) => c.role === "writer").length, 1, "keraksiz chaqiruv puli sarflandi");
});

test("`retryProblems`: sig'maslik, blok soni va umumiy hajm sanaladi", () => {
  const meta = extractMeta(tool, BASE);
  const input = infographicInputFromValues(meta, BASE);
  const ok = normalizeSpec(specJson(4), input)!;
  assert.deepEqual(retryProblems(ok, 4), []);
  assert.equal(retryProblems(ok, 6).length, 1, "blok soni farqi aytilishi kerak");
  const heavy = normalizeSpec(specJson(4, {}, (i) => blockJson(i, { text: "so'z ".repeat(120).trim() })), input)!;
  const problems = retryProblems(heavy, 4);
  assert.ok(problems.some((p) => /do not fit/.test(p)));
  assert.ok(problems.some((p) => /the limit is/.test(p)));
  assert.ok(infographicRetryPrompt(infographicCtx(infographicTypeOf("list"), input), heavy, problems).includes("same block ids"));
});

/* ══════════════════════════ 5. chegaraviy holatlar ══════════════════════════ */

test("dvigatel: model javob bermasa `null` (kredit qaytadi)", async () => {
  const { complete } = stub(null);
  assert.equal(await build(BASE, complete), null);
  const empty = stub({ blocks: [] });
  assert.equal(await build(BASE, empty.complete), null);
});

test("dvigatel: mavzusiz so'rov `null` (LLM chaqirilmaydi)", async () => {
  const { complete, calls } = stub(specJson(4));
  assert.equal(await build({ ...BASE, topic: "" }, complete), null);
  assert.equal(calls.length, 0, "bo'sh mavzu uchun pul sarflanmasin");
});

test("`delivered`: so'ralganidan kam blok chiqsa farq qaytariladi", async () => {
  const { complete } = stub(specJson(3));
  const built = await build({ ...BASE, blockCount: 5 }, complete);
  assert.deepEqual(built!.delivered, { got: 3, want: 5 });
});

test("o'lcham: A3 so'ralsa PNG kattaroq chiqadi", async () => {
  const a4 = await build(BASE, stub(specJson(4)).complete);
  const a3 = await build({ ...BASE, size: "A3" }, stub(specJson(4)).complete);
  assert.equal(a3!.doc.infographic!.spec.size, "A3");
  assert.ok(a3!.doc.images![0].w! > a4!.doc.images![0].w!, "A3 eskizi A4 dan kattaroq bo'lishi kerak");
});

/* ══════════════════════════ 6. sayqal ══════════════════════════ */

test("sayqal: qabul qilingan spetsifikatsiya FAYLGA ham, modelga ham tushadi", async () => {
  /*
   * Birinchi javob — sig'magan matn (qizil `noOverflow`), qayta so'rov
   * ham o'sha, sayqal esa TO'G'RI javob beradi: ball oshadi, plakat
   * QAYTA chiziladi. Mutatsiya (qayta chizmaslik) bu testda «ekranda
   * bitta xil, faylda boshqa xil» holatini qoldiradi.
   */
  const longText = "so'z ".repeat(200).trim();
  const bad = specJson(4, {}, (i) => blockJson(i, { text: longText }));
  const good = specJson(4, { title: "Suv aylanishi bosqichlari" });
  const { complete } = stub(bad, bad, good);
  const built = await buildInfographicArtifact(tool, BASE, { deadline: Date.now() + 300_000, complete: complete as never, judge: false, polish: true });
  assert.ok(built);
  const model = built!.doc.infographic!;
  assert.equal(model.spec.title, "Suv aylanishi bosqichlari", "sayqal natijasi modelga tushmagan");
  assert.ok(model.polish, "sayqal jurnali yo'q");
  assert.equal(model.polish!.accepted, true, `sayqal qabul qilinmadi (${model.polish!.before} → ${model.polish!.after})`);
  assert.equal(model.review!.checks.find((c) => c.id === "noOverflow")?.level, "green");
  assert.ok(built!.html.includes("Suv aylanishi bosqichlari"), "HTML eskiz eski sarlavha bilan qolgan");
  assert.ok(built!.doc.sections[0].title === "Suv aylanishi bosqichlari", "hujjat bo'limi eski matn bilan qolgan");
});

test("sayqal: `polish: false` bo'lsa o'tkazib yuboriladi", async () => {
  const { complete, calls } = stub(specJson(4));
  const built = await build(BASE, complete);
  assert.ok(!built!.doc.infographic!.polish, "sayqal o'chirilgan bo'lsa jurnal bo'lmasligi kerak");
  assert.equal(calls.filter((c) => c.role === "writer").length, 1);
});
