import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { WORK_FORM_FIELDS, WORK_JSON_FIELDS, WORK_PARAMS, type WorkParamImpact } from "../lib/generation/work-params.ts";
import { workInputFromValues } from "../lib/generation/work/input.ts";
import { workKindOf } from "../lib/generation/work/registry.ts";
import { SUBJECT_PROFILES } from "../lib/generation/work/subjects.ts";
import { workLabels } from "../lib/generation/work/labels.ts";
import { workWordPlan } from "../lib/generation/work/plan.ts";
import { buildWorkDoc, fallbackWorkOutline, planWorkVisuals, EMPTY_RESEARCH_STATS, type WorkResearchAsk } from "../lib/generation/work/engine.ts";
import { workConclusionPrompt, workIntroPrompt, workOutlinePrompt, workParagraphPrompt, workSystemPrompt, type WorkContext } from "../lib/generation/work/prompts.ts";
import { workJudgeSystemPrompt, workRuleChecks } from "../lib/generation/work/review.ts";
import { figureSpecFromLlm } from "../lib/generation/article/engine.ts";
import type { Figure, Reference } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * TALABA ISHI PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati
 * (mahsulot egasi qarori 5).
 *
 * `article-params.test.mts` naqshi: reyestrdagi har parametr uchun
 * `probeA`/`probeB` bilan differensial zond va e'lon qilingan HAR
 * ta'sirda A ≠ B. `layout` — WP-C `planWork` hali yo'q, shuning uchun
 * `doc.work` modeli va bo'lim sarlavhalari o'lchanadi.
 */

const tool = TOOL_BY_ID.coursework;

const BASE: FormValues = {
  topic: "Boshlang'ich sinfda o'qish ko'nikmalarini rivojlantirish",
  workKind: "theory",
  subjectProfile: "humanities",
  language: "uz",
  pages: "25-30",
  university: "Toshkent davlat universiteti",
  faculty: "Pedagogika fakulteti",
  department: "Boshlang'ich ta'lim kafedrasi",
  subjectName: "Pedagogika",
  author: "Aliyev Ali — 3-kurs, 301-guruh",
  group: "",
  course: "",
  teacher: "Rahimov B.",
  teacherDegree: "",
  city: "Toshkent",
  ministry: "oliy",
  ministryCustom: "",
  tocMethod: "ai",
  tocText: "",
  includeVisuals: true,
  figureCount: 1,
  tableCount: 1,
  figureKinds: "[]",
  userFacts: "",
  sourceText: "",
  userRefs: "[]",
  refsMin: 15,
  extra: "",
};

const REFS: Reference[] = [{ id: "W1", kind: "article", title: "Reading skills", authors: ["Smith J."], year: 2021, verified: "openalex", cited: false }];

/**
 * Zond tarmoqqa chiqmaydi: `ask` ni yozib oladi (research ta'siri shundan
 * o'lchanadi) va foydalanuvchi manbalarini reyestrga qo'shadi — shunda
 * `userRefs` ning HUJJATGA (`layout`) ta'siri ham ko'rinadi.
 */
function researchProbe(seen: { ask?: WorkResearchAsk }) {
  return async (ask: WorkResearchAsk) => {
    seen.ask = ask;
    const user: Reference[] = ask.userRefs.map((u) => ({
      id: u.id,
      title: u.title ?? u.raw ?? u.doi ?? u.id,
      authors: u.authors ?? [],
      ...(u.doi ? { doi: u.doi } : {}),
      ...(u.raw ? { raw: u.raw } : {}),
      verified: "user" as const,
      cited: false,
    }));
    return { refs: [...REFS.map((r) => ({ ...r })), ...user], stats: { ...EMPTY_RESEARCH_STATS, user: ask.userRefs.length } };
  };
}

const stubFigures = async (figs: Figure[]) => figs.map((f) => ({ ...f, url: `data:image/png;base64,stub-${f.id}` }));

const para = (i: number) => `Bu ${i}-paragraf: o‘qish ko‘nikmasi bosqichma-bosqich shakllanadi va matn tushunish bilan bog‘liq. `.repeat(6).trim();

const INTRO_JSON = {
  relevance: "Mavzuning dolzarbligi — ta'lim sifati masalasi.",
  aim: "Ishning maqsadi — usullarni aniqlash.",
  tasks: "Ish vazifalari: aniqlash, qiyoslash, tavsiya berish.",
  object: "Tadqiqot obyekti — ta'lim jarayoni.",
  subject: "Tadqiqot predmeti — ko'nikma shakllantirish.",
  methods: "Tadqiqot metodlari: tahlil va qiyoslash.",
  structure: "Ish tuzilmasi: kirish, boblar, xulosa.",
};

const stubComplete = (async (role: LlmRole, _system: string, user: string) => {
  const usage = { provider: "stub", model: "stub-1", inputTokens: 50, outputTokens: 25 };
  const reply = (text: string) => ({ text, usage });
  if (role === "judge") return reply("{}");
  if (user.startsWith("Plan the body")) {
    return reply(
      JSON.stringify({
        chapters: [
          { title: "Nazariy asoslar", paragraphs: [{ title: "Tushuncha", brief: "Ta'rif" }, { title: "Yondashuvlar", brief: "Qiyos" }] },
          { title: "Amaliy tahlil", paragraphs: [{ title: "Tashxis", brief: "Natija" }, { title: "Tavsiyalar", brief: "Yechim" }] },
        ],
        intro: INTRO_JSON,
      }),
    );
  }
  if (user.startsWith("Write the INTRODUCTION") || user.startsWith("The previous introduction")) return reply(JSON.stringify({ parts: INTRO_JSON }));
  if (user.startsWith("Write the paragraph")) {
    const body: Record<string, unknown> = { blocks: [{ kind: "p", text: `${para(1)} [W1].` }, { kind: "p", text: `${para(2)} [u1].` }] };
    if (user.includes('"table":')) body.table = { caption: "Qiyos", headers: ["A", "B"], rows: [["1", "2"]], anchorAfterBlock: 0 };
    if (user.includes('"figure":')) body.figure = { caption: "Sxema", anchorAfterBlock: 0, spec: { kind: "cycle", steps: [{ label: "Tanish" }, { label: "Mashq" }, { label: "Mustahkamlash" }] } };
    return reply(JSON.stringify(body));
  }
  if (user.startsWith("Write the CONCLUSION")) return reply(JSON.stringify({ blocks: [{ kind: "p", text: `Xulosa: ${para(3)} [W1].` }] }));
  return reply("{}");
}) as never;

function ctxOf(values: FormValues): WorkContext {
  const input = workInputFromValues(values, "coursework");
  const meta = { ...extractMeta(tool, values), language: input.language, pagesLabel: input.pages };
  const kind = workKindOf("coursework", input.kind);
  const subject = SUBJECT_PROFILES[input.subject];
  const plan = workWordPlan(meta, kind, subject, { refs: input.refsMin, figures: input.figureCount, tables: input.tableCount, pages: input.pages });
  return { input, meta, kind, subject, labels: workLabels(input.language), plan, refs: REFS };
}

type Probe = Record<WorkParamImpact, string>;

async function probe(values: FormValues): Promise<Probe> {
  const v = { ...BASE, ...values };
  const ctx = ctxOf(v);
  const outline = fallbackWorkOutline(ctx);
  const visuals = planWorkVisuals(ctx, outline);
  const mid = outline.chapters[0].paragraphs[0];
  const meta = extractMeta(tool, v);
  const seen: { ask?: WorkResearchAsk } = {};
  const built = await buildWorkDoc(meta, v, {
    deadline: Date.now() + 90_000,
    complete: stubComplete,
    research: researchProbe(seen),
    buildFigures: stubFigures,
    polish: false,
    now: new Date("2026-09-16T10:00:00Z"),
    year: 2026,
  });
  assert.ok(built, "zond: hujjat qurilishi kerak");
  const d = built.doc;
  const model = d.work!;
  return {
    prompt: [
      workSystemPrompt(ctx),
      workOutlinePrompt(ctx),
      workIntroPrompt(ctx, outline),
      workParagraphPrompt(ctx, { plan: mid, wantTable: true, wantFigure: true }),
      workConclusionPrompt(ctx, ["birinchi vazifa"], "• Bob: matn"),
    ].join("\n"),
    structure: JSON.stringify({ kind: ctx.kind.id, chapters: model.chapters.map((c) => [c.id, c.title, c.paragraphs.map((x) => x.title)]) }),
    research: JSON.stringify({
      topic: seen.ask?.topic,
      keywords: seen.ask?.keywords,
      kinds: seen.ask?.kinds,
      quota: seen.ask?.quota,
      want: seen.ask?.want,
      userRefs: seen.ask?.userRefs.map((r) => r.raw ?? r.doi ?? r.id),
      language: seen.ask?.language,
    }),
    figures: JSON.stringify({
      plan: [...visuals.entries()],
      figures: model.figures.map((f) => [f.id, f.spec.kind, f.caption]),
      tables: (d.tables ?? []).map((t) => [t.id, t.caption, t.anchor]),
      counts: [ctx.input.figureCount, ctx.input.tableCount, ctx.input.includeVisuals],
      // Oq ro'yxat: ruxsat etilmagan tur REDDIYA qilinadi (`figureKinds`).
      rejected: figureSpecFromLlm({ kind: "process", steps: ["Birinchi", "Ikkinchi", "Uchinchi"] }, { figureKinds: ctx.input.figureKinds }),
    }),
    // Hisobot = qoidalar + turning baholovchi spetsifikatsiyasi.
    review: JSON.stringify({
      rules: workRuleChecks(d).checks.map((c) => [c.id, c.level, c.detail]),
      judge: workJudgeSystemPrompt(ctx.kind, d.sections.map((s) => s.id)),
    }),
    layout: JSON.stringify({
      titul: [model.university, model.faculty, model.department, model.subjectName, model.group, model.course, model.author, model.teacher, model.teacherDegree, model.city, model.ministry, model.ministryCustom],
      language: model.language,
      title: model.title,
      sections: d.sections.map((s) => [s.id, s.title]),
      refs: model.references.map((r) => [r.id, r.n]),
      // WP-C `docx-profile.ts workProfile(subject)` shu ikkisini o'qiydi.
      subject: model.subject,
      rightMarginCm: ctx.subject.rightMarginCm,
    }),
    price: String(priceFor(tool, v)),
    language: `${ctx.input.language}/${d.meta.language}/${model.language}`,
  };
}

// ───────────────────────────────────────────── reyestr tuzilishi

test("reyestr: har parametr o'z id si bilan, JSON maydonlar mos, ta'sirlar to'liq qamrab olingan", () => {
  assert.equal(WORK_PARAMS.length, WORK_FORM_FIELDS.length);
  assert.deepEqual(WORK_FORM_FIELDS, WORK_PARAMS.map((p) => p.id));
  assert.equal(new Set(WORK_FORM_FIELDS).size, WORK_FORM_FIELDS.length, "id lar takrorlanmaydi");
  assert.deepEqual(
    WORK_PARAMS.filter((p) => p.encode === "json").map((p) => p.id).sort(),
    [...WORK_JSON_FIELDS].sort(),
  );
  const declared = new Set(WORK_PARAMS.flatMap((p) => p.impacts));
  for (const impact of ["prompt", "structure", "research", "figures", "review", "layout", "price", "language"] as WorkParamImpact[]) {
    assert.ok(declared.has(impact), `${impact}: hech bir parametr bu ta'sirni e'lon qilmagan — zond o'lik`);
  }
  // Titulning 9 majburiy maydoni + vazirlik reyestrda bor.
  for (const id of ["university", "faculty", "department", "subjectName", "author", "teacher", "city", "group", "course", "ministry", "ministryCustom"]) {
    assert.ok(WORK_FORM_FIELDS.includes(id), `titul maydoni «${id}» reyestrda yo'q`);
  }
});

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi", async () => {
  const failures: string[] = [];
  for (const p of WORK_PARAMS) {
    const base = p.probeWith ?? {};
    const a = await probe({ ...base, [p.id]: p.probeA });
    const b = await probe({ ...base, [p.id]: p.probeB });
    for (const impact of p.impacts) {
      if (a[impact] === b[impact]) failures.push(`${p.id} → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

test("narx faqat hajmdan: boshqa parametrlar narxni qimirlatmaydi", () => {
  for (const p of WORK_PARAMS) {
    if (p.impacts.includes("price")) continue;
    const base = p.probeWith ?? {};
    const a = priceFor(tool, { ...BASE, ...base, [p.id]: p.probeA });
    const b = priceFor(tool, { ...BASE, ...base, [p.id]: p.probeB });
    assert.equal(a, b, `${p.id}: narxni o'zgartirdi (${a} vs ${b})`);
  }
  // AUDIT-19 da narx O'ZGARMAYDI — mavjud jadval.
  assert.equal(priceFor(tool, { ...BASE, pages: "15-20" }), 14000);
  assert.equal(priceFor(tool, { ...BASE, pages: "30-35" }), 20000);
  assert.equal(priceFor(tool, { ...BASE, pages: "40-45" }), 24000);
  assert.equal(priceFor(TOOL_BY_ID.referat, { pages: "10-15" }), 3000);
  assert.equal(priceFor(TOOL_BY_ID["mustaqil-ish"], { pages: "25-30" }), 6000);
});
