import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { resolveSlideTemplate } from "../lib/generation/slide-templates.ts";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import { repairThinSlides, thinSlides } from "../lib/generation/slide-quality.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { OFFICIALESE_MIN, isOfficialese, officialeseScore, slideVoice } from "../lib/generation/slide-voice.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * Slide quality §C (docs/slide-quality/SPEC.md): student voice in the writer prompt and notes, a deterministic
 * officialese detector, and its slides riding the EXISTING single repair call.
 */
afterEach(() => resetBreakers());

const meta = (audience: string) => extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", slideAudience: audience });
const lecture = resolveSlideTemplate("lecture", "Fotosintez");

test("voice by resolved audience: students/pupils/auto → student; educators/management/employees → professional", () => {
  for (const a of ["auto", "students_bachelor", "students_master", "school_5_7", "center_teens", "public", "general"]) assert.equal(slideVoice(a, "lecture"), "student", a);
  for (const a of ["educators", "management", "employees"]) assert.equal(slideVoice(a, "lecture"), "professional", a);
  // «auto» on a defense deck = master students: still a student presenting.
  assert.equal(slideVoice("auto", "defense"), "student");
});

test("writer prompt: the student voice replaces the bare role line; professional decks keep a business register", () => {
  const student = slideSystem(meta("auto"), lecture);
  assert.ok(!student.includes("Siz professional taqdimot muallifisiz"), "old role line gone");
  // MUTATION: drop `voiceLines` from base.ts → these fail.
  assert.match(student, /a’lochi talaba/);
  assert.match(student, /IDORAVIY USLUB TAQIQLANADI/);
  assert.match(student, /domla iboralari YO‘Q/, "speaker notes get the voice too");
  const pro = slideSystem(meta("management"), lecture);
  assert.match(pro, /rasmiy-ishchan/);
  assert.ok(!pro.includes("a’lochi talaba"));
});

test("notes off: no notes voice line is added", () => {
  const m = extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", speakerNotes: false });
  assert.ok(!slideSystem(m, lecture).includes("domla iboralari"));
});

test("officialese score: strong phrases 2, weak 1, every occurrence counts, apostrophes unified", () => {
  assert.equal(officialeseScore("Barg quyosh nuridan qand yasaydi."), 0);
  assert.equal(officialeseScore("Fotosintez muhim ahamiyat kasb etadi."), 2 + 2, "«muhim ahamiyat kasb» and «ahamiyat kasb et» both hit");
  assert.equal(officialeseScore("Bu jarayon amalga oshiriladi va hisoblanadi."), 2);
  assert.equal(officialeseScore("Taʼkidlash joizki, mazkur usul hisoblanadi, hisoblanadi."), 2 + 1 + 2);
  assert.ok(officialeseScore("Hurmatli talabalar, bugungi ma’ruzamizda") >= 4);
  assert.equal(officialeseScore("Necessary: играет важную роль"), 2);
});

const plain = (bullets: string[]): SlideModel => ({ id: "s1", layout: "bullets", title: "Fotosintez nima", bullets, plan: 1 }) as SlideModel;
const OFFICIAL = [
  "Fotosintez jarayoni o‘simliklar hayotida muhim ahamiyat kasb etadi va barg orqali amalga oshiriladi.",
  "Mazkur jarayon tabiatdagi eng asosiy biokimyoviy hodisalardan biri hisoblanadi deb aytish mumkin.",
  "Xloroplastlar bu jarayonda alohida o‘rin tutadi va energiya almashinuvi ta’minlanadi doimiy ravishda.",
];
const NATURAL = [
  "Barg quyosh nurini ushlaydi va undan qand yasaydi, o‘simlik shu qand bilan o‘sadi.",
  "Masalan, bitta katta daraxt yoz kunida bir oila nafas oladigan kislorodni chiqaradi.",
  "Xloroplast — bargdagi kichik yashil «zavod»: nurni kimyoviy energiyaga aylantiradi.",
];

test("isOfficialese: threshold, rewritable layouts only", () => {
  assert.ok(isOfficialese(plain(OFFICIAL)));
  assert.ok(!isOfficialese(plain(NATURAL)));
  assert.ok(officialeseScore(OFFICIAL.join(" ")) >= OFFICIALESE_MIN);
  assert.ok(!isOfficialese({ id: "q", layout: "quiz", title: "x", quiz: [{ q: OFFICIAL[0], options: ["a", "b", "c", "d"], answer: 0 }] } as SlideModel), "quiz is never rewritten");
});

async function withLlm(reply: (sys: string, user: string) => unknown, fn: (calls: { system: string; user: string }[]) => Promise<void>) {
  const saved = { fetch: globalThis.fetch, gemini: process.env.GEMINI_API_KEY };
  process.env.GEMINI_API_KEY = "k";
  const calls: { system: string; user: string }[] = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const b = JSON.parse(String(init?.body ?? "{}")) as { system_instruction?: { parts?: { text?: string }[] }; contents?: { parts?: { text?: string }[] }[] };
    const call = { system: b.system_instruction?.parts?.[0]?.text ?? "", user: b.contents?.[0]?.parts?.[0]?.text ?? "" };
    calls.push(call);
    const obj = reply(call.system, call.user);
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) } as never;
  }) as unknown as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.gemini;
  }
}

const later = () => Date.now() + 120_000;

test("repair: an officialese (not thin) slide rides the single repair call and a natural rewrite is accepted", async () => {
  const m = meta("students_bachelor");
  const input = [plain(OFFICIAL)];
  assert.deepEqual(thinSlides(input, bodyRules(m, lecture.id), lecture.visual), [], "precondition: not thin");
  await withLlm(
    () => ({ slides: [{ index: 0, bullets: NATURAL }] }),
    async (calls) => {
      const out = await repairThinSlides(input, m, lecture, {}, later(), later());
      // MUTATION: drop the officialese candidates in `repairThinSlides` → no call, bullets unchanged.
      assert.equal(calls.length, 1, "exactly one LLM call");
      assert.match(calls[0].user, /idoraviy uslub/);
      assert.match(calls[0].system, /a’lochi talaba|o‘z so‘zingiz/);
      assert.deepEqual(out[0].bullets, NATURAL);
    },
  );
});

test("repair: a rewrite that is still officialese is rejected (original kept)", async () => {
  const m = meta("students_bachelor");
  const input = [plain(OFFICIAL)];
  await withLlm(
    () => ({ slides: [{ index: 0, bullets: OFFICIAL.map((b) => `${b} Bu ham muhim ahamiyat kasb etadi.`) }] }),
    async () => {
      const out = await repairThinSlides(input, m, lecture, {}, later(), later());
      // MUTATION: drop the `isOfficialese(merged)` acceptance check → the officialese rewrite is accepted.
      assert.deepEqual(out[0].bullets, OFFICIAL);
    },
  );
});

test("repair: professional voice never sends a slide for officialese", async () => {
  const m = meta("management");
  await withLlm(
    () => ({ slides: [] }),
    async (calls) => {
      await repairThinSlides([plain(OFFICIAL)], m, lecture, {}, later(), later());
      assert.equal(calls.length, 0);
    },
  );
});
