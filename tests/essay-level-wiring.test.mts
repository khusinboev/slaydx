import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { LEVEL_REPAIR_MIN_MS, LEVEL_REPAIR_RESERVE_MS, buildEssayDoc, levelRepairTimeout } from "../lib/generation/essay/engine.ts";
import { essayInputFromValues } from "../lib/generation/essay/input.ts";
import { LEVEL_REPAIR_HEADER, essayCtx, essaySystemPrompt, outlinePrompt } from "../lib/generation/essay/prompts.ts";
import { contextOf, planEssayPolish, rewriteEssayFix } from "../lib/generation/essay/polish.ts";
import { essayJudgeSystemPrompt, essayModelOf, essayTextOf, judgeUserPrompt, ruleChecks } from "../lib/generation/essay/review.ts";
import { IELTS_LINKERS, essayWords } from "../lib/generation/essay/registry.ts";
import { IELTS_LEVEL_JUDGE_NOTE, LEVEL_BANDS, ieltsLinkersFor, linkersFound, measureLevel } from "../lib/generation/essay/level.ts";
import type { EssayModel } from "../lib/generation/essay/types.ts";
import { legacyOutputs } from "./helpers/essay-legacy-cases.mts";

/**
 * ESSAY CEFR LEVEL — engine / prompts / review / polish wiring (R4 WP-2).
 *
 * Mutations checked (each turned a test red, then restored):
 *   1) level block injected for `level = null`             → «legacy snapshot» red;
 *   2) repair acceptance guard removed (always accept)     → «rejected: word range» and «rejected: worse» red;
 *   3) repair runs regardless of the verdict               → «no extra call when on level» red;
 *   4) `model.level` not stored                            → «doc.essay.level» + «contextOf keeps the level» red;
 *   5) thesis minimum back to fixed 8                       → «A1 thesis of 6 words is a claim» red;
 *   6) judge calibration line dropped                       → «judge is told the target» red;
 *   7) level block placed BEFORE the author's free text     → «level wins over extra» red.
 */

/* ────────────────────────── legacy: byte-identical ────────────────────────── */

test("legacy snapshot: docs without a level (IELTS ones included) — every prompt, judge prompt, rule and score unchanged", async () => {
  const golden = JSON.parse(readFileSync(new URL("./essay-legacy-snapshot.json", import.meta.url), "utf8"));
  const now = JSON.parse(JSON.stringify(await legacyOutputs()));
  for (const key of Object.keys(golden)) assert.deepEqual(now[key], golden[key], `${key}: legacy output changed`);
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
});

/* ────────────────────────── text generators ────────────────────────── */

const POOL = ["kitob", "maktab", "do‘st", "ona", "shahar", "bog‘", "daraxt", "suv", "non", "uy", "yo‘l", "bola", "qush", "gul", "tog‘", "dars", "ustoz", "oila", "bahor", "quyosh"];
const VERBS = ["o‘qiydi", "ko‘radi", "sevadi", "biladi", "yozadi", "o‘rganadi", "eshitadi", "topadi"];

/** `count` sentences of `len` words each, deterministic. */
function sentences(len: number, count: number, seed: number, tag = ""): string {
  const out: string[] = [];
  for (let s = 0; s < count; s++) {
    const w: string[] = [];
    for (let i = 0; i < len - 1; i++) w.push(POOL[(seed + s * 7 + i * 3) % POOL.length]);
    w.push(VERBS[(seed + s) % VERBS.length]);
    w[0] = (tag || w[0][0].toUpperCase() + w[0].slice(1));
    out.push(`${w.join(" ")}.`);
  }
  return out.join(" ");
}

/** Five paragraphs, ≈ `words` words, sentences of `len` words. */
function essayJson(len: number, words: number, extra = ""): string {
  const perPara = Math.max(1, Math.round(words / 5 / len));
  const blocks = Array.from({ length: 5 }, (_, p) => ({ kind: "p", text: sentences(len, perPara, p * 11) + (p === 2 && extra ? ` ${extra}` : "") }));
  return JSON.stringify({ blocks });
}

const OUTLINE = JSON.stringify({
  title: "Kitob va bola",
  paragraphs: Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, role: i === 0 ? "intro" : i === 4 ? "conclusion" : "body", brief: `Band ${i + 1}`, words: i === 0 || i === 4 ? 40 : 50 })),
});

type Call = { role: LlmRole; system: string; user: string };

function stub(o: { write: () => string; repair?: () => string; judge?: object }) {
  const calls: Call[] = [];
  const fn = (async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") return o.judge ? { text: JSON.stringify(o.judge) } : null;
    if (user.startsWith("Plan the essay")) return { text: OUTLINE };
    if (user.startsWith(LEVEL_REPAIR_HEADER)) return { text: (o.repair ?? o.write)() };
    return { text: o.write() };
  }) as never;
  return { fn, calls, repairs: () => calls.filter((c) => c.user.startsWith(LEVEL_REPAIR_HEADER)) };
}

// School essay, 1 page: 184–288 words (aim 230).
const SCHOOL_A1: FormValues = { topic: "Kitob va bola", pages: "1", essayContext: "school_dtm", essayKind: "reflective", language: "uz", essayLevel: "A1" };
const build = (values: FormValues, s: ReturnType<typeof stub>, judge = false) =>
  buildEssayDoc(extractMeta(TOOL_BY_ID.essay, values), values, { deadline: Date.now() + 180_000, complete: s.fn, judge, polish: false });
const textOf = (d: AcademicDoc) => d.sections[0].blocks.map((b) => b.text).join("\n");

/* ────────────────────────── engine: repair pass ────────────────────────── */

test("engine: off-level text → exactly ONE repair call; a closer rewrite is accepted; level stored in doc.essay", async () => {
  const s = stub({ write: () => essayJson(28, 230), repair: () => essayJson(5, 230) });
  const built = await build(SCHOOL_A1, s);
  assert.ok(built);
  assert.equal(s.repairs().length, 1, "one repair call");
  assert.match(s.repairs()[0].user, /too complex for CEFR A1/);
  assert.match(s.repairs()[0].system, /WRITING LEVEL — CEFR A1/, "repair inherits the system prompt");
  const m = measureLevel(textOf(built.doc), "uz");
  assert.ok(m.mean < 6, `accepted the A1 rewrite (mean ${m.mean})`);
  assert.equal(built.doc.essay?.level, "A1");
  assert.equal(built.doc.essay?.review?.checks.find((c) => c.id === "level")?.level, "green");
});

test("engine: repair rejected when it breaks the word range", async () => {
  const s = stub({ write: () => essayJson(28, 230), repair: () => essayJson(5, 60) });
  const built = await build(SCHOOL_A1, s);
  assert.equal(s.repairs().length, 1);
  assert.ok(measureLevel(textOf(built!.doc), "uz").mean > 20, "kept the original (in-range) text");
});

test("engine: repair rejected when it is not closer to the level, or the guard gets worse", async () => {
  const worse = stub({ write: () => essayJson(20, 230), repair: () => essayJson(34, 230) });
  const a = await build(SCHOOL_A1, worse);
  assert.equal(worse.repairs().length, 1);
  assert.ok(Math.abs(measureLevel(textOf(a!.doc), "uz").mean - 20) < 1.5, "kept the less complex original");

  const invented = stub({ write: () => essayJson(28, 230), repair: () => essayJson(5, 230, "Bolalarning 45 % i kitob o‘qiydi.") });
  const b = await build(SCHOOL_A1, invented);
  assert.equal(invented.repairs().length, 1);
  assert.ok(!textOf(b!.doc).includes("45 %"), "a rewrite with a new unsourced number is rejected");
});

test("engine: NO extra call when the text is on level", async () => {
  const onLevel = stub({ write: () => essayJson(5, 230) });
  await build(SCHOOL_A1, onLevel);
  assert.equal(onLevel.repairs().length, 0);
});

test("engine: the judge is told the target level (system calibration + TARGET LEVEL header)", async () => {
  const s = stub({ write: () => essayJson(5, 230), judge: { content: 3, structure: 3, language: 3, literacy: 3, creativity: 3, notes: [], fixes: [] } });
  await build(SCHOOL_A1, s, true);
  const judge = s.calls.find((c) => c.role === "judge");
  assert.ok(judge, "judge called");
  assert.match(judge!.system, /DELIBERATELY written at CEFR A1/);
  assert.match(judge!.system, /Never propose a fix that raises or lowers the level/);
  assert.match(judge!.user, /TARGET LEVEL: CEFR A1/);
});

/* ────────────────────────── prompts ────────────────────────── */

const ctxOf = (values: FormValues) => {
  const input = essayInputFromValues(values);
  const meta = extractMeta(TOOL_BY_ID.essay, values);
  return essayCtx({ ...meta, language: input.language, design: input.design }, input);
};

test("prompts: the level wins over the author's free text (block AFTER «Qo‘shimcha», marked), outline thesis range scaled", () => {
  const ctx = ctxOf({ ...SCHOOL_A1, essayContext: "academic", essayKind: "argumentative", language: "en", extra: "Write long, rich sentences." });
  const sys = essaySystemPrompt(ctx);
  const extraAt = sys.indexOf("Additional author requirements (they never change the WRITING LEVEL below): Write long, rich sentences.");
  const levelAt = sys.indexOf("WRITING LEVEL — CEFR A1");
  assert.ok(extraAt > 0 && levelAt > extraAt, "level block comes after the free text");
  assert.ok(!/claims are hedged where appropriate/.test(sys), "hedging wish suppressed at A1");
  assert.match(outlinePrompt(ctx), /one arguable sentence \(6–10 words\)/);
  assert.match(outlinePrompt(ctxOf({ ...SCHOOL_A1, essayContext: "academic", essayKind: "argumentative", language: "en", essayLevel: "C1" })), /one arguable sentence \(14–35 words\)/);

  const descriptive = essaySystemPrompt(ctxOf({ ...SCHOOL_A1, essayKind: "descriptive" }));
  assert.ok(!/at least once per paragraph/.test(descriptive), "figurative wish suppressed at A1");
  assert.match(descriptive, /No figurative language/);
  assert.match(essaySystemPrompt(ctxOf({ ...SCHOOL_A1, essayKind: "descriptive", essayLevel: "C1" })), /at least once per paragraph/, "kept at C1");
});

/* ────────────────────────── review rule + scaled minimums ────────────────────────── */

const EN_A1_PARAS = [
  "Fake news is a big problem. Many people read news on phones. They do not check it. Schools must teach this skill.",
  "Fake news spreads very fast. One post can reach many people. Some people believe it. Then they share it again.",
  "Teachers can help students. They can show good websites. Students can compare two sources. This is easy to learn.",
  "Some people say it is hard. But small lessons work well. Students learn step by step. They get better every week.",
  "Checking news is a basic skill. Every student needs it. Schools should teach it now. It helps all of us.",
];

function academicDoc(paragraphs: string[], level: EssayModel["level"] | undefined, thesis?: string): AcademicDoc {
  const essay: EssayModel = {
    v: 1,
    context: "academic",
    kind: "argumentative",
    language: "en",
    words: essayWords("academic", { wordTarget: 500 }),
    paragraphs: paragraphs.map((_, i) => ({ id: `p${i + 1}`, role: i === 0 ? "intro" : i === paragraphs.length - 1 ? "conclusion" : "body" })),
    person: "third",
    rubric: "academic100",
    ...(thesis ? { thesisStatement: thesis } : {}),
    ...(level ? { level } : {}),
  };
  return {
    meta: extractMeta(TOOL_BY_ID.essay, { topic: "Fake news", essayContext: "academic" }),
    titlePage: true,
    toc: false,
    sections: [{ id: "essay", title: "Fake news and schools", blocks: paragraphs.map((text) => ({ kind: "p" as const, text })) }],
    essay,
  };
}

const rules = (d: AcademicDoc) => {
  const model = essayModelOf(d);
  return ruleChecks({ doc: d, model, text: essayTextOf(d, model) });
};

test("review: «Til darajasi» rule — green on level, red off level with a level fix, skipped without a level", () => {
  const onLevel = rules(academicDoc(EN_A1_PARAS, "A1")).find((c) => c.id === "level");
  assert.equal(onLevel?.level, "green", onLevel?.detail);
  assert.match(onLevel?.detail ?? "", /^A1: o‘rtacha gap/);

  const off = rules(academicDoc(EN_A1_PARAS, "C1")).find((c) => c.id === "level");
  assert.equal(off?.level, "red", off?.detail);
  assert.match(off?.detail ?? "", /darajadan sodda/);
  assert.equal(off!.fix?.target, "essay");
  assert.match(off!.fix!.instruction, /CEFR C1/);

  assert.ok(!rules(academicDoc(EN_A1_PARAS, undefined)).some((c) => c.id === "level"), "no level → no rule");
});

test("review: at A1 a 6-word thesis and 4-word topic sentences are claims (old fixed 8/5 made them red)", () => {
  const paras = [...EN_A1_PARAS];
  paras[0] = "Fake news is a big problem. Many people read news on phones. They do not check it. Schools must teach students checking news.";
  const a1 = rules(academicDoc(paras, "A1", "Schools must teach students checking news."));
  assert.equal(a1.find((c) => c.id === "thesisStatement")?.level, "green", "A1 thesis accepted");
  assert.equal(a1.find((c) => c.id === "topicSentences")?.level, "green", "A1 topic sentences accepted");

  const legacy = rules(academicDoc(paras, undefined, "Schools must teach students checking news."));
  assert.equal(legacy.find((c) => c.id === "thesisStatement")?.level, "red", "legacy keeps the old minimum (8 words)");
  assert.notEqual(legacy.find((c) => c.id === "topicSentences")?.level, "green", "legacy keeps the old minimum (5 words)");
});

test("judge system prompt: calibration only with a level; user prompt carries TARGET LEVEL", () => {
  const plain = essayJudgeSystemPrompt("school_dtm", "Reflective essay");
  const withLevel = essayJudgeSystemPrompt("school_dtm", "Reflective essay", "A2");
  assert.equal(essayJudgeSystemPrompt("school_dtm", "Reflective essay", null), plain);
  assert.ok(!/TARGET LEVEL/.test(plain));
  assert.match(withLevel.split("\n")[1], /^TARGET LEVEL: the essay is DELIBERATELY written at CEFR A2/);
  const d = academicDoc(EN_A1_PARAS, "B1");
  assert.match(judgeUserPrompt(d, essayModelOf(d)), /\nTARGET LEVEL: CEFR B1\n/);
});

/* ────────────────────────── polish / «Tuzatish» ────────────────────────── */

test("contextOf keeps the level from the model; rewrite (polish/«Tuzatish») carries the block and the reminder", async () => {
  const d = academicDoc(EN_A1_PARAS, "A2");
  const ctx = contextOf(d);
  assert.equal(ctx.input.level, "A2");
  assert.equal(contextOf(academicDoc(EN_A1_PARAS, undefined)).input.level, null, "legacy doc → null");

  const seen = { system: "", user: "" };
  const complete = (async (_role: LlmRole, system: string, user: string) => {
    Object.assign(seen, { system, user });
    return { text: JSON.stringify({ blocks: EN_A1_PARAS.map((text) => ({ kind: "p", text })) }) };
  }) as never;
  await rewriteEssayFix(d, { op: "rewrite", target: "essay", instruction: "Add a counter-argument." }, { complete });
  assert.ok(seen.system, "writer called");
  assert.match(seen.system, /WRITING LEVEL — CEFR A2/);
  assert.match(seen.user, /LEVEL: write at CEFR A2/);
});

test("polish plan picks up the level fix (not filtered as «needs user data»)", () => {
  const d = academicDoc(EN_A1_PARAS, "C1");
  const checks = rules(d);
  const review: DocReview = { score: 60, checks, judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "2026-10-04T00:00:00.000Z" };
  const plan = planEssayPolish(review, d);
  assert.ok(plan.fixes.some((f) => /CEFR C1/.test(f.instruction)), JSON.stringify(plan));
  assert.ok(!plan.skipped.some((s) => s.id === "level"));
});

/* ────────────────────────── review G-1 / G-2 / G-3 ────────────────────────── */

/*
 * Academic A1 essay, 500 words (425–575): thesis declared in the outline,
 * one user number («120»), 5 paragraphs. Words are letter-only and unique
 * per paragraph so no rule other than the one under test can move.
 */
const ACAD_A1: FormValues = { topic: "Source checking at university", essayContext: "academic", essayKind: "argumentative", language: "en", wordTarget: "500", essayLevel: "A1", userFacts: "Exactly 120 students joined my survey." };
const THESIS = "Universities should teach source checking to students.";
const OUTLINE_ACAD = JSON.stringify({
  title: "Source checking",
  thesisStatement: THESIS,
  paragraphs: Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, role: i === 0 ? "intro" : i === 4 ? "conclusion" : "body", ...(i > 0 && i < 4 ? { topicSentence: "Claim." } : {}), brief: `Band ${i + 1}`, words: 100 })),
});
const PFX = ["q", "x", "z", "v", "k", "j"];
const letters = (n: number) => {
  let s = "";
  let k = n + 26;
  while (k > 0) {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26);
  }
  return s;
};
function enPara(p: number, len: number, count: number): string {
  let i = 0;
  const out: string[] = [];
  for (let s = 0; s < count; s++) {
    const w = Array.from({ length: len }, () => `${PFX[p]}${letters(i++)}`);
    w[0] = w[0][0].toUpperCase() + w[0].slice(1);
    out.push(`${w.join(" ")}.`);
  }
  return out.join(" ");
}
/** 5 paragraphs; intro ends with the thesis (or `thesis`), paragraph 2 carries the user number unless dropped. */
function acadJson(len: number, o: { thesis?: string; dropFact?: boolean; merge?: "two" | "four" } = {}): string {
  const count = Math.round(100 / len);
  const paras = [0, 1, 2, 3, 4].map((p) => enPara(p, len, count));
  paras[0] = `${paras[0]} ${o.thesis ?? THESIS}`;
  paras[1] = `${paras[1]} ${o.dropFact ? "Many students joined the survey." : "Exactly 120 students joined the survey."}`;
  let blocks = paras;
  if (o.merge === "two") blocks = [paras.slice(0, 2).join(" "), paras.slice(2).join(" ")];
  if (o.merge === "four") blocks = [paras[0], `${paras[1]} ${paras[2]}`, paras[3], paras[4]];
  return JSON.stringify({ blocks: blocks.map((text) => ({ kind: "p", text })) });
}
function acadStub(repair: string) {
  const calls: Call[] = [];
  const fn = (async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") return null;
    if (user.startsWith("Plan the essay")) return { text: OUTLINE_ACAD };
    if (user.startsWith(LEVEL_REPAIR_HEADER)) return { text: repair };
    return { text: acadJson(25) };
  }) as never;
  return { fn, calls, repairs: () => calls.filter((c) => c.user.startsWith(LEVEL_REPAIR_HEADER)) };
}
const buildAcad = (s: ReturnType<typeof acadStub>) =>
  buildEssayDoc(extractMeta(TOOL_BY_ID.essay, ACAD_A1), ACAD_A1, { deadline: Date.now() + 180_000, complete: s.fn, judge: false, polish: false });
const meanOf = (d: AcademicDoc) => measureLevel(textOf(d), "en").mean;

test("G-1 control: a repair that keeps thesis verbatim, the user number and 5 paragraphs is accepted; the prompt demands exactly that", async () => {
  const s = acadStub(acadJson(5));
  const built = await buildAcad(s);
  assert.equal(s.repairs().length, 1);
  assert.ok(meanOf(built!.doc) < 8, "accepted");
  const prompt = s.repairs()[0].user;
  assert.ok(prompt.includes(`VERBATIM, word for word, as the LAST sentence of the introduction: «${THESIS}»`));
  assert.match(prompt, /Return EXACTLY 5 paragraphs/);
  assert.match(prompt, /Keep every number, name and quotation from USER FACTS verbatim/);
  assert.equal(built!.doc.essay?.review?.checks.find((c) => c.id === "thesisStatement")?.level, "green");
});

test("G-1: repair rejected when it paraphrases the thesis (thesis rule would go red)", async () => {
  const s = acadStub(acadJson(5, { thesis: "Checking sources is something many people think matters today?" }));
  const built = await buildAcad(s);
  assert.equal(s.repairs().length, 1);
  assert.ok(meanOf(built!.doc) > 20, "original kept");
  assert.equal(built!.doc.essay?.review?.checks.find((c) => c.id === "thesisStatement")?.level, "green");
});

test("G-1: repair rejected when it drops the user's number («120» → «Many»)", async () => {
  const s = acadStub(acadJson(5, { dropFact: true }));
  const built = await buildAcad(s);
  assert.equal(s.repairs().length, 1);
  assert.ok(textOf(built!.doc).includes("120"), "the user's number survives");
});

test("G-1: repair rejected when paragraphs collapse (5 → 2, and 5 → 4 that the paragraph rule alone would allow)", async () => {
  for (const merge of ["two", "four"] as const) {
    const s = acadStub(acadJson(5, { merge }));
    const built = await buildAcad(s);
    assert.equal(s.repairs().length, 1, merge);
    assert.equal(built!.doc.sections[0].blocks.length, 5, `${merge}: structure kept`);
  }
});

test("G-2: amber (slightly off) → no repair; a very simple A1/A2 text is on level, never «too simple»", async () => {
  // uz A1 band 3–6 (cap 9): 7-word sentences are 17 % above → yellow, not red.
  const amber = stub({ write: () => essayJson(7, 230) });
  const built = await build(SCHOOL_A1, amber);
  assert.equal(amber.repairs().length, 0, "no paid repair on amber");
  assert.equal(built!.doc.essay?.review?.checks.find((c) => c.id === "level")?.level, "yellow", "the report still shows it");

  const tiny = stub({ write: () => essayJson(2, 230) });
  const t = await build(SCHOOL_A1, tiny);
  assert.equal(tiny.repairs().length, 0);
  assert.equal(t!.doc.essay?.review?.checks.find((c) => c.id === "level")?.level, "green", "2-word A1 sentences are fine");
  const a2 = await build({ ...SCHOOL_A1, essayLevel: "A2" }, stub({ write: () => essayJson(2, 230) }));
  assert.equal(a2!.doc.essay?.review?.checks.find((c) => c.id === "level")?.level, "green");
});

test("G-3: the repair leaves the report + polish budget; skipped when the window is too small, report still built", async () => {
  assert.equal(LEVEL_REPAIR_RESERVE_MS, 70_000 + 8_000 + 8_000);
  assert.equal(levelRepairTimeout(100_000, 60_000), 0, "100 s left − 86 s reserve < 30 s → skip");
  assert.equal(levelRepairTimeout(LEVEL_REPAIR_RESERVE_MS + LEVEL_REPAIR_MIN_MS, 90_000), LEVEL_REPAIR_MIN_MS);
  assert.equal(levelRepairTimeout(170_000, 60_000), 60_000, "write timeout when there is room");
  assert.equal(levelRepairTimeout(130_000, 90_000), 44_000, "capped so the reserve survives");

  const s = stub({ write: () => essayJson(28, 230), repair: () => essayJson(5, 230) });
  const values = SCHOOL_A1;
  const built = await buildEssayDoc(extractMeta(TOOL_BY_ID.essay, values), values, { deadline: Date.now() + 110_000, complete: s.fn, judge: false, polish: false });
  assert.equal(s.repairs().length, 0, "no repair inside a tight budget");
  assert.ok(built!.doc.essay?.review, "the readiness report is still built");
});

/* ────────────────────────── IELTS Task 2 has the level too (owner, 2026-10-07) ────────────────────────── */

const IELTS: FormValues = { topic: "Universities and practical skills", essayContext: "ielts_task2", essayKind: "opinion", language: "en" };

function ieltsDoc(paragraphs: string[], level: EssayModel["level"] | undefined): AcademicDoc {
  const essay: EssayModel = {
    v: 1,
    context: "ielts_task2",
    kind: "opinion",
    language: "en",
    words: essayWords("ielts_task2"),
    paragraphs: paragraphs.map((_, i) => ({ id: `p${i + 1}`, role: i === 0 ? "intro" : i === paragraphs.length - 1 ? "conclusion" : "body" })),
    person: "first",
    rubric: "ielts_band",
    ...(level ? { level } : {}),
  };
  return {
    meta: extractMeta(TOOL_BY_ID.essay, IELTS),
    titlePage: false,
    toc: false,
    sections: [{ id: "essay", title: "Universities and practical skills", blocks: paragraphs.map((text) => ({ kind: "p" as const, text })) }],
    essay,
  };
}

test("IELTS: default level C1 (band 8 role kept); a chosen level reaches the system prompt, the role line and the stored model", async () => {
  assert.equal(essayInputFromValues(IELTS).level, "C1", "owner: C1 default");
  const c1 = essaySystemPrompt(ctxOf(IELTS));
  assert.match(c1, /WRITING LEVEL — CEFR C1/);
  assert.match(c1, /band 8 model answers/);

  const a2 = essaySystemPrompt(ctxOf({ ...IELTS, essayLevel: "A2" }));
  assert.match(a2, /WRITING LEVEL — CEFR A2/);
  // MUTATION: role line not following the level → «band 8» would fight the A2 block.
  assert.ok(!/band 8/.test(a2), "no band 8 claim at A2");
  assert.match(a2, /written at CEFR A2/);

  const s = stub({ write: () => essayJson(LEVEL_BANDS.en.A2.target, 290) });
  const built = await build({ ...IELTS, essayLevel: "A2" }, s);
  assert.equal(built?.doc.essay?.level, "A2", "stored for polish / «Tuzatish» / judge");
  assert.ok(s.calls.some((c) => /WRITING LEVEL — CEFR A2/.test(c.system)));
  assert.equal(s.repairs().length, 0, "on-level IELTS text → no repair call");
  assert.equal(built?.doc.essay?.review?.checks.find((c) => c.id === "level")?.level, "green");
});

test("IELTS: an off-level text gets the ONE repair call, like the other contexts", async () => {
  const s = stub({ write: () => essayJson(28, 290), repair: () => essayJson(LEVEL_BANDS.en.A2.target, 290) });
  const built = await build({ ...IELTS, essayLevel: "A2" }, s);
  assert.equal(s.repairs().length, 1);
  assert.match(s.repairs()[0].user, /too complex for CEFR A2/);
  assert.ok(measureLevel(textOf(built!.doc), "en").mean < 12, "the on-level rewrite was accepted");
});

test("IELTS cohesion list follows the level: A1/A2 the level's own connectors, B1/B2 nothing above, C1+ the standard list", () => {
  const list = (l: Parameters<typeof ieltsLinkersFor>[0]) => [...ieltsLinkersFor(l, IELTS_LINKERS)];
  assert.deepEqual(list("A1"), ["and", "but", "because", "then"]);
  assert.ok(list("A2").includes("so") && list("A2").includes("finally") && list("A2").includes("because"));
  assert.ok(!list("A2").includes("however"));
  assert.ok(list("B1").includes("however") && list("B1").includes("for example") && !list("B1").includes("moreover"));
  assert.ok(list("B2").includes("moreover") && list("B2").includes("therefore") && !list("B2").includes("furthermore") && !list("B2").includes("nevertheless"));
  assert.deepEqual(list("C1"), [...IELTS_LINKERS]);
  assert.deepEqual(list("C2"), [...IELTS_LINKERS]);
  assert.deepEqual(list(null), [...IELTS_LINKERS]);

  // The prompt rule shows the list of the chosen level (MUTATION: the fixed list would demand «moreover» at A1).
  const a1 = essaySystemPrompt(ctxOf({ ...IELTS, essayLevel: "A1" }));
  assert.match(a1, /COHESION: use at least three different cohesive devices from the natural range \(and, but, because, then\)/);
  assert.match(essaySystemPrompt(ctxOf(IELTS)), /natural range \(however, moreover, furthermore/);
});

test("linkersFound: whole words only («also» is not «so»)", () => {
  assert.deepEqual(linkersFound("They also like it, but not always.", ["so", "but", "also"]), ["but", "also"]);
  assert.deepEqual(linkersFound("So it is. As a result, we win.", ["so", "as a result"]), ["so", "as a result"]);
});

const IELTS_A1_PARAS = [
  "Some people say universities must teach practical skills. I agree and I will say why. Students need real skills for work.",
  "First, practical lessons help students. They learn to use tools and they feel ready. Work is easier then.",
  "Also, companies want people who can work. They like students who know the job because they learn fast.",
  "Some people say theory is more important. But theory without practice is not enough for a job.",
  "In short, universities should teach practical skills and they should do it now.",
];

test("IELTS review: «linking» counts the level's connectors, the «level» rule runs, legacy IELTS (no level) is unchanged", () => {
  const rulesOf = (d: AcademicDoc) => {
    const m = essayModelOf(d);
    return ruleChecks({ doc: d, model: m, text: essayTextOf(d, m) });
  };
  const a1 = rulesOf(ieltsDoc(IELTS_A1_PARAS, "A1"));
  const linking = a1.find((c) => c.id === "linking");
  assert.equal(linking?.level, "green", linking?.detail);
  assert.ok(a1.some((c) => c.id === "level"), "IELTS gets the «Til darajasi» rule");

  // The same text judged at C1 would use the standard list: none of its words there → red.
  assert.equal(rulesOf(ieltsDoc(IELTS_A1_PARAS, "C1")).find((c) => c.id === "linking")?.level, "red");

  // A level-less (legacy) IELTS document: no level rule, standard list as before.
  const legacy = rulesOf(ieltsDoc(IELTS_A1_PARAS, undefined));
  assert.ok(!legacy.some((c) => c.id === "level"));
  assert.equal(legacy.find((c) => c.id === "linking")?.level, "red");

  // A fix at A2 asks for A2-level devices, not «however, moreover».
  const bare = rulesOf(ieltsDoc(IELTS_A1_PARAS.map((p) => p.replace(/\b(and|but|because|then|first|also)\b/gi, "")), "A2"));
  const fix = bare.find((c) => c.id === "linking")?.fix;
  assert.match(fix?.instruction ?? "", /\(and, but, because, then, so\)/);
});

test("IELTS judge: the target level and the IELTS calibration line are sent; other contexts do not get the IELTS line", () => {
  const ielts = essayJudgeSystemPrompt("ielts_task2", "Opinion essay", "A2");
  assert.match(ielts, /DELIBERATELY written at CEFR A2/);
  assert.ok(ielts.includes(IELTS_LEVEL_JUDGE_NOTE), "IELTS criteria are scored relative to the target level");
  assert.ok(!essayJudgeSystemPrompt("school_dtm", "Reflective essay", "A2").includes(IELTS_LEVEL_JUDGE_NOTE));
  assert.equal(essayJudgeSystemPrompt("ielts_task2", "Opinion essay", null), essayJudgeSystemPrompt("ielts_task2", "Opinion essay"), "legacy: no note");
  const d = ieltsDoc(IELTS_A1_PARAS, "B1");
  assert.match(judgeUserPrompt(d, essayModelOf(d)), /\nTARGET LEVEL: CEFR B1\n/);
});

test("IELTS: polish / «Tuzatish» rebuild the context with the stored level (no drift)", () => {
  assert.equal(contextOf(ieltsDoc(IELTS_A1_PARAS, "A2")).input.level, "A2");
  assert.equal(contextOf(ieltsDoc(IELTS_A1_PARAS, undefined)).input.level, null, "legacy IELTS doc → null");
});
