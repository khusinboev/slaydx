import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { buildEssayDoc } from "../lib/generation/essay/engine.ts";
import { essayInputFromValues } from "../lib/generation/essay/input.ts";
import { LEVEL_REPAIR_HEADER, essayCtx, essaySystemPrompt, outlinePrompt } from "../lib/generation/essay/prompts.ts";
import { contextOf, planEssayPolish, rewriteEssayFix } from "../lib/generation/essay/polish.ts";
import { essayJudgeSystemPrompt, essayModelOf, essayTextOf, judgeUserPrompt, ruleChecks } from "../lib/generation/essay/review.ts";
import { essayWords } from "../lib/generation/essay/registry.ts";
import { measureLevel } from "../lib/generation/essay/level.ts";
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

test("legacy snapshot: docs without a level and IELTS — every prompt, judge prompt, rule and score unchanged", async () => {
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

test("engine: NO extra call when the text is on level, and none without a level (IELTS)", async () => {
  const onLevel = stub({ write: () => essayJson(5, 230) });
  await build(SCHOOL_A1, onLevel);
  assert.equal(onLevel.repairs().length, 0);

  const ielts = stub({ write: () => essayJson(30, 290) });
  const built = await build({ topic: "Universities and practical skills", essayContext: "ielts_task2", essayKind: "opinion", language: "en", essayLevel: "A1" }, ielts);
  assert.equal(ielts.repairs().length, 0, "IELTS has no level → no repair");
  assert.ok(!("level" in (built!.doc.essay ?? {})), "IELTS model keeps the old shape");
  assert.ok(!ielts.calls.some((c) => /WRITING LEVEL/.test(c.system)));
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
