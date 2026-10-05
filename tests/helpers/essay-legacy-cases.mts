/**
 * Legacy essay outputs (mobile sprint, package G — essay level).
 *
 * Documents written BEFORE the CEFR level existed carry no `doc.essay.level`;
 * IELTS never carries one. For both, every prompt, judge prompt and review
 * rule must stay byte-identical to the pre-level code. `legacyOutputs()`
 * renders all of them; `tests/essay-legacy-snapshot.json` was generated from
 * the code BEFORE the level was introduced (commit "test(essay): legacy
 * prompt snapshot") and `tests/essay-level-wiring.test.mts` compares.
 *
 * Only APIs that existed before the change are called here, with the same
 * arguments — the snapshot must not depend on new parameters.
 */
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { FormValues } from "../../lib/types.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { extractMeta } from "../../lib/generation/meta.ts";
import { essayInputFromValues } from "../../lib/generation/essay/input.ts";
import { essayCtx, essayPrompt, essaySystemPrompt, outlinePrompt, rewritePrompt, wordRangePrompt, type EssayCtx } from "../../lib/generation/essay/prompts.ts";
import { fallbackOutline } from "../../lib/generation/essay/engine.ts";
import { contextOf } from "../../lib/generation/essay/polish.ts";
import { essayJudgeSystemPrompt, essayModelOf, essayTextOf, judgeUserPrompt, reviewEssay, ruleChecks } from "../../lib/generation/essay/review.ts";
import { essayKindSpec, essayWords } from "../../lib/generation/essay/registry.ts";

const UZ = [
  "Ona tili — xalqning qalbi. Har bir bola dastlabki so‘zlarini onasidan eshitadi. Shu so‘zlar bilan u dunyoni taniy boshlaydi. Men ham ona tilimni ana shunday sevaman.",
  "Birinchidan, til bizni bir-birimizga bog‘laydi. Qishloqdagi buvim bilan shahardagi do‘stim bir tilda gaplashadi. Bu meni quvontiradi.",
  "Ikkinchidan, adabiyotimiz tilimiz orqali yashaydi. Navoiy, Qodiriy, Cho‘lpon asarlarini o‘qiganimda so‘zning kuchini his qilaman.",
  "Uchinchidan, tilni asrash har birimizning burchimiz. Biz ko‘chada, maktabda va uyda sof gapirishimiz kerak.",
  "Men uchun ona tilim — g‘ururim. Uni asrash va boyitish mening ham vazifam deb bilaman.",
];

const EN = [
  "Digital literacy has become a basic condition of civic life. Citizens read news, sign contracts and talk to public offices through screens. Universities should therefore teach the critical evaluation of online sources as a core skill rather than as an optional extra.",
  "The first reason is that misinformation spreads faster than corrections. A student who cannot check a claim will repeat it, and the error travels further with every share.",
  "Second, employers increasingly expect graduates to judge the reliability of data. A report built on a weak source can mislead an entire team and waste months of work.",
  "Critics argue that such skills belong to schools, not universities. However, the volume and complexity of academic information require a deeper, discipline-specific training.",
  "In short, critical digital literacy is not a luxury but a foundation of higher education, and it deserves a place in every curriculum.",
];

function doc(values: FormValues, paragraphs: string[], essay: Record<string, unknown> | null): AcademicDoc {
  const meta = extractMeta(TOOL_BY_ID.essay, values);
  return {
    meta: { ...meta },
    titlePage: false,
    toc: false,
    sections: [{ id: "essay", title: "Ona tilim — g‘ururim", blocks: paragraphs.map((text) => ({ kind: "p" as const, text })) }],
    ...(essay ? { essay: essay as unknown as AcademicDoc["essay"] } : {}),
  };
}

/** Legacy fixtures: docs without `essay.level` (as saved before the level existed). */
export function legacyDocs(): Record<string, AcademicDoc> {
  const school: FormValues = { topic: "Ona tilim — g‘ururim", pages: "2", essayContext: "school_dtm", essayKind: "reflective", language: "uz", extra: "Uzun jumlalar bilan, boy tilda yozing." };
  const descriptive: FormValues = { topic: "Kuzgi bog‘", pages: "1", essayContext: "school_dtm", essayKind: "descriptive", language: "uz" };
  const academic: FormValues = { topic: "Digital literacy at university", essayContext: "academic", essayKind: "argumentative", language: "en", wordTarget: "500", pages: "2" };
  const ielts: FormValues = { topic: "Some people think universities should teach practical skills", essayContext: "ielts_task2", essayKind: "opinion", language: "en" };
  return {
    school: doc(school, UZ, { v: 1, context: "school_dtm", kind: "reflective", language: "uz", words: essayWords("school_dtm", { pages: 2 }), paragraphs: [], person: "first", design: "iris", rubric: "dtm24" }),
    descriptive: doc(descriptive, UZ, { v: 1, context: "school_dtm", kind: "descriptive", language: "uz", words: essayWords("school_dtm", { pages: 1 }), paragraphs: [], person: "first", rubric: "dtm24" }),
    academic: doc(academic, EN, {
      v: 1,
      context: "academic",
      kind: "argumentative",
      language: "en",
      words: essayWords("academic", { wordTarget: 500 }),
      thesisStatement: "Universities should therefore teach the critical evaluation of online sources as a core skill rather than as an optional extra.",
      paragraphs: [
        { id: "p1", role: "intro" },
        { id: "p2", role: "body" },
        { id: "p3", role: "body" },
        { id: "p4", role: "body" },
        { id: "p5", role: "conclusion" },
      ],
      person: "third",
      rubric: "academic100",
    }),
    ielts: doc(ielts, EN, { v: 1, context: "ielts_task2", kind: "opinion", language: "en", words: essayWords("ielts_task2"), paragraphs: [], person: "first", rubric: "ielts_band" }),
    // Pre-AUDIT-19 document: no `doc.essay` at all.
    bare: doc({ topic: "Kitob — do‘st", pages: "2" }, UZ, null),
  };
}

/** IELTS from form values: the level never applies there (even a stale `essayLevel`). */
export function ieltsValues(): FormValues {
  return { topic: "Some people think universities should teach practical skills", essayContext: "ielts_task2", essayKind: "discussion", language: "en", essayLevel: "A1" };
}

function promptsOf(ctx: EssayCtx): Record<string, string> {
  const plans = fallbackOutline(ctx);
  return {
    system: essaySystemPrompt(ctx),
    outline: outlinePrompt(ctx),
    essay: essayPrompt(ctx, plans, { thesisStatement: "T", title: "X" }),
    tail: essayPrompt(ctx, plans.slice(2), { part: "tail", thesisStatement: "T", title: "X", written: "W" }),
    wordRange: wordRangePrompt(ctx, 120, [ctx.words.min, ctx.words.max], "CURRENT"),
    rewrite: rewritePrompt(ctx, "essay", "Make it better.", "CURRENT"),
    rewriteIntro: rewritePrompt(ctx, "intro", "Sharpen the thesis.", "CURRENT"),
  };
}

export async function legacyOutputs(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, d] of Object.entries(legacyDocs())) {
    const model = essayModelOf(d);
    const kind = essayKindSpec(model.context, model.kind);
    const review = await reviewEssay(d, { judge: false, now: new Date("2026-10-04T00:00:00.000Z") });
    out[name] = {
      prompts: promptsOf(contextOf(d)),
      judgeSystem: essayJudgeSystemPrompt(model.context, kind.label.en),
      judgeUser: judgeUserPrompt(d, model),
      rules: ruleChecks({ doc: d, model, text: essayTextOf(d, model) }),
      score: review.score,
    };
  }
  const values = ieltsValues();
  const input = essayInputFromValues(values);
  const meta = extractMeta(TOOL_BY_ID.essay, values);
  out.ieltsValues = promptsOf(essayCtx({ ...meta, language: input.language, design: input.design }, input));
  return out;
}
