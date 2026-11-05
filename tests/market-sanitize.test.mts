import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues, ToolId } from "../lib/types.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { deckFooter } from "../lib/generation/slide-identity.ts";
import { sampleWorkDoc } from "../lib/generation/work/samples.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import { normalizeText } from "../lib/market/normalize.ts";
import { MARKET_ASSET_PREFIX } from "../lib/market/types.ts";
import { MARKET_TOOL_IDS } from "../lib/market/registry.ts";
import { SCRUB_MARK, collectPlaceholders, dropMissingAssets, identityOf, resanitizeStored, sanitizeForMarket, type SanitizeInput } from "../lib/market/sanitize.ts";
import { adapterFor } from "../lib/server/edit-adapters.ts";

/**
 * The market sanitiser (docs/market/PLAN.md §1.4): an adversarial proof, per tool, that NO personal data survives. Every
 * fixture plants canaries in every place the product can hold them: title-page fields, form values, the account profile,
 * footers, the PPTX core properties, teacher signatures, co-authors, body text in both scripts and in inflected forms.
 * The check runs twice: over the sanitised JSON and over the XML of the file really rendered from it (`docProps` too).
 *
 * Mutations (each turned the named test red, then restored from a byte copy):
 *   1. `w[k] = ""` skips "teacher" in `structure`                  -> «every tool» (work tools);
 *   2. phone regexes removed from PATTERNS                         -> «body text»;
 *   3. `delete w.userFacts` removed                                -> «user material»;
 *   4. `delete t.approver` semantic: approver kept in school       -> «every tool» (lesson-plan);
 *   5. article `authors: []` removed                               -> «every tool» (thesis);
 *   6. footer not recomputed (`{ ...slide }`)                      -> «every tool» (slide, pro-slide);
 *   7. `if (s.imageOrig) s.image = s.imageOrig` removed            -> «uploaded image»;
 *   8. "slideLogo" added to DOC_KEEP                               -> «logo and custom template»;
 *   9. NAME_SUFFIX emptied                                         -> «inflected names»;
 *  10. meta allow-list: `else if (typeof value === "string") out[key] = ""` → keep value -> «unknown meta key»;
 *  11. phrase scrub loop removed                                   -> «institution in the body»;
 *  12. references `names: false` child mode removed                -> «no false positives» (cited author);
 *  13. topic-word protection removed in `nameWords`                -> «no false positives» (topic word);
 *  14. foreign-URL branch keeps the URL                            -> «asset URLs».
 */

const AUTHOR = "Zulfiqorov Mirjalol Rustamovich";
const TEACHER = "Xudoyberdiyeva Nargiza";
const APPROVER = "Turdimurodov Bahrom";
const COAUTHOR = "Sharipova Gulbahor";
const PROFILE_NAME = "Abdusamatov Javlonbek";
const UNIVERSITY = "Qashqadaryo Muhandislik Akademiyasi";
const FACULTY = "Geodeziya fakulteti";
const DEPARTMENT = "Kartografiya kafedrasi";
const ORGANIZATION = "Nurafshon Innovatsiya Markazi";
const POSITION = "Yetakchi kartograf mutaxassis";
const GROUP = "KG-77-A";
const EMAIL = "canary.user@example.com";
const USERNAME = "canary_user77";
const PHONE = "+998901234567";
const UDK = "UDK-528.9";

/** Lowercased, Latin, no punctuation: a leak in any script or case is found by one `includes`. */
const CANARIES = [
  "zulfiqorov", "mirjalol", "rustamovich", "xudoyberdiyeva", "nargiza", "turdimurodov", "bahrom", "sharipova", "gulbahor", "abdusamatov", "javlonbek",
  "qashqadaryo muhandislik", "geodeziya fakulteti", "kartografiya kafedrasi", "nurafshon innovatsiya", "yetakchi kartograf", "kg 77 a",
  "canary user", "canary_user77", "example com", "901234567", "90 123 45 67", "90 111 22 33", "udk 528",
];

function assertClean(text: string, where: string): void {
  const norm = normalizeText(text);
  for (const c of CANARIES) assert.ok(!norm.includes(c), `«${c}» survived in ${where}`);
}

const VALUES: FormValues = {
  topic: "Issiqlik elektr stansiyalarida energiya tejamkorligi",
  author: `${AUTHOR} — 3-kurs, ${GROUP}-guruh`,
  teacher: TEACHER,
  approver: APPROVER,
  university: UNIVERSITY,
  faculty: FACULTY,
  department: DEPARTMENT,
  organization: ORGANIZATION,
  position: POSITION,
  group: GROUP,
  course: "3",
  city: "Qarshi",
  email: EMAIL,
  udk: UDK,
  degree: "PhD",
  extra: `Muallif ${AUTHOR} iltimos qiladi`,
  keyIdeas: `${AUTHOR} g'oyasi`,
  tocText: `1. ${TEACHER} rejasi`,
  language: "uz",
  pages: "15-20",
  slideCount: 8,
  slideTheme: "atlas",
};

const PROFILE: SanitizeInput["profile"] = { name: PROFILE_NAME, username: USERNAME, phone: PHONE, email: EMAIL, teacher: TEACHER, university: UNIVERSITY };

const metaFor = (toolId: ToolId): DocMeta => extractMeta(TOOL_BY_ID[toolId], VALUES);

/** Every way a person shows up in a text. */
const LEAKY_TEXTS = [
  `Men, ${AUTHOR}, bu ishni o'zim yozdim.`,
  "Zulfiqorovning fikricha natija yaxshi. Zulfiqorovga rahmat.",
  "ЗУЛФИҚОРОВ МИРЖАЛОЛ РУСТАМОВИЧ томонидан ёзилган.",
  "Қашқадарё Муҳандислик Академияси талабаси.",
  `Tekshirdi: ${TEACHER} (imzo ______).`,
  `Tasdiqlayman: ${APPROVER}.`,
  `Ilmiy maslahat: ${PROFILE_NAME} ishtirokida.`,
  `Bog'lanish: ${PHONE}, +998 90 123 45 67, 90-111-22-33, 90 111 22 33.`,
  `Pochta: ${EMAIL}, telegram: @${USERNAME}, https://t.me/${USERNAME}, t.me/canary_user77`,
  `${UNIVERSITY}, ${FACULTY}, ${DEPARTMENT}, ${ORGANIZATION}, ${POSITION}, guruh ${GROUP}.`,
];

const plantBody = (doc: AcademicDoc): AcademicDoc => ({
  ...doc,
  sections: [
    { id: "intro", title: "Kirish", blocks: LEAKY_TEXTS.map((text) => ({ kind: "p" as const, text })) },
    ...doc.sections,
  ],
  tables: [{ caption: `Jadval: ${AUTHOR}`, headers: ["Ism", TEACHER], rows: [[AUTHOR, PHONE]] }],
  abstracts: [{ lang: "uz", label: "Annotatsiya", text: LEAKY_TEXTS[0]!, keywords: `${AUTHOR}, energiya` }],
  referencesNote: `${AUTHOR} tekshirsin`,
});

function slideDoc(toolId: ToolId): AcademicDoc {
  const meta = metaFor(toolId);
  const footer = deckFooter(meta);
  const slides: SlideModel[] = [
    { id: "s0", layout: "title", title: meta.topic, subtitle: `${AUTHOR}, ${UNIVERSITY}`, footer },
    { id: "s1", layout: "bullets", title: "Asosiy tushunchalar", bullets: LEAKY_TEXTS.slice(0, 3), footer, notes: `Notiq: ${AUTHOR}, ${PHONE}` },
    { id: "s2", layout: "quote", title: "Iqtibos", quote: "Bilim — kuch", quoteBy: AUTHOR, footer },
    { id: "s3", layout: "table", title: "Jadval", table: { headers: ["Ism"], rows: [[TEACHER]] }, footer },
    { id: "s4", layout: "closing", title: `Rahmat! ${AUTHOR}`, footer },
  ];
  return { meta: { ...meta, topic: VALUES.topic as string }, titlePage: true, toc: false, sections: [], slides, slideTheme: "atlas", slideTemplate: "auto" as AcademicDoc["slideTemplate"] };
}

function workDoc(toolId: ToolId): AcademicDoc {
  const genre = toolId === "coursework" ? "coursework" : toolId === "referat" ? "referat" : toolId === "konspekt" ? "konspekt" : "independent";
  const meta = metaFor(toolId);
  const doc = sampleWorkDoc(meta, genre === "konspekt" ? { genre: "referat" } : { genre });
  const work = {
    ...doc.work!,
    genre,
    university: UNIVERSITY,
    faculty: FACULTY,
    department: DEPARTMENT,
    group: GROUP,
    course: "3",
    author: AUTHOR,
    teacher: TEACHER,
    teacherDegree: "Yetakchi kartograf mutaxassis",
    city: "Qarshi",
    ministry: "custom",
    ministryCustom: `${UNIVERSITY} vazirligi`,
    references: doc.work!.references.map((r) => ({ ...r, verified: "crossref" as const })),
    review: { score: 90, checks: [{ id: "x", level: "green", label: AUTHOR }], judgeNotes: [AUTHOR], verifiedShare: 1, recentShare: 1, builtAt: "2026-11-01" },
  } as AcademicDoc["work"];
  return plantBody({ ...doc, work, references: [] });
}

function essayDoc(): AcademicDoc {
  const meta = metaFor("essay");
  return plantBody({
    meta,
    titlePage: true,
    toc: false,
    sections: [{ id: "essay", title: "Insho", blocks: [{ kind: "p", text: `Mening ismim ${AUTHOR}. Men ${UNIVERSITY}da o'qiyman.` }] }],
    essay: {
      v: 1,
      context: "academic",
      kind: "argumentative",
      language: "uz",
      words: { min: 100, max: 300, aim: 200 },
      paragraphs: [{ id: "p1", role: "intro", topicSentence: `${AUTHOR} fikri` }],
      thesisStatement: `${AUTHOR} shunday deydi`,
      rubric: "academic100",
      review: { score: 88, checks: [], judgeNotes: [TEACHER], verifiedShare: 1, recentShare: 1, builtAt: "2026-11-01" },
    } as AcademicDoc["essay"],
  });
}

function thesisDoc(): AcademicDoc {
  const doc = sampleArticleDoc(metaFor("thesis"), { type: "conference_thesis" });
  const article = {
    ...doc.article!,
    udk: UDK,
    authors: [
      { name: AUTHOR, degree: "PhD", org: UNIVERSITY, email: EMAIL, orcid: "0000-0001-2345-6789" },
      { name: COAUTHOR, org: ORGANIZATION },
    ],
    references: doc.article!.references.map((r) => ({ ...r, verified: "crossref" as const })),
    review: { score: 91, checks: [], judgeNotes: [AUTHOR], verifiedShare: 1, recentShare: 1, builtAt: "2026-11-01" },
  } as AcademicDoc["article"];
  const planted = plantBody({ ...doc, article });
  planted.sections[0]!.blocks.push({ kind: "p", text: `${COAUTHOR} bilan birga yozildi.` });
  return planted;
}

function lessonDoc(): AcademicDoc {
  const doc = sampleTeacherDoc("lesson", { ...metaFor("lesson-plan"), toolId: "lesson-plan" });
  const teacher = {
    ...doc.teacher!,
    school: { ...doc.teacher!.school, institution: UNIVERSITY, author: AUTHOR, approver: APPROVER, date: "2026-10-01", gradeLetter: "A" },
    review: { score: 85, checks: [], judgeNotes: [AUTHOR], verifiedShare: 1, recentShare: 1, builtAt: "2026-11-01" },
    userNeeds: [{ id: "x", label: AUTHOR, hint: PHONE }],
  } as AcademicDoc["teacher"];
  return plantBody({ ...doc, teacher });
}

function fixture(toolId: ToolId): AcademicDoc {
  if (toolId === "slide" || toolId === "pro-slide") return slideDoc(toolId);
  if (toolId === "essay") return essayDoc();
  if (toolId === "thesis") return thesisDoc();
  if (toolId === "lesson-plan") return lessonDoc();
  return workDoc(toolId);
}

const run = (toolId: ToolId, doc = fixture(toolId), values: Record<string, unknown> = VALUES) =>
  sanitizeForMarket({ toolId, doc, values, sourceId: "src-gen", profile: PROFILE });

/** The text of every XML part of a DOCX / PPTX, `docProps` included. */
async function xmlOf(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|rels)$/.test(name)) parts.push((await zip.file(name)!.async("string")).replace(/<[^>]+>/g, " "));
  }
  return parts.join("\n");
}

for (const toolId of MARKET_TOOL_IDS) {
  test(`every tool: ${toolId} — no canary in the sanitised document or its rendered file`, async () => {
    const before = fixture(toolId);
    assert.ok(JSON.stringify(before).toLowerCase().includes("zulfiqorov"), "the fixture really holds the canary");
    const { doc, params } = run(toolId, before);
    assertClean(JSON.stringify(doc), `${toolId} doc`);
    assertClean(JSON.stringify(params), `${toolId} params`);
    const adapter = adapterFor(toolId)!;
    assert.ok(adapter, `${toolId} has an adapter: the copy pipeline needs one`);
    assert.ok(adapter.hasModel(doc), `${toolId}: the sanitised document still has its model`);
    const file = await adapter.render({ id: "i", userId: "0", doc, fileName: "ish.docx", resolveImage: async () => null }, {});
    assertClean(await xmlOf(file.bytes), `${toolId} file`);
  });
}

test("title-page fields: exact paths are empty", () => {
  const m = run("coursework").doc.meta;
  for (const k of ["author", "university", "faculty", "department", "teacher", "city", "group", "course", "email", "organization", "position", "degree", "udk", "extra", "tocText", "sourceText", "logoAssetId", "templateAssetId", "photoAssetId"] as const) {
    assert.equal(m[k], "", `meta.${k}`);
  }
  assert.deepEqual(m.keyIdeas, []);
  const w = run("coursework").doc.work!;
  for (const k of ["university", "faculty", "department", "group", "course", "author", "teacher", "city"] as const) assert.equal(w[k], "", `work.${k}`);
  assert.equal(w.teacherDegree, undefined);
  assert.equal(w.ministryCustom, undefined);
  assert.equal(w.ministry, "oliy", "custom ministry falls back to the official line");
  const s = run("lesson-plan").doc.teacher!.school;
  assert.deepEqual([s.institution, s.author, s.approver, s.date, s.gradeLetter], ["", "", "", "", undefined]);
  const a = run("thesis").doc.article!;
  assert.deepEqual(a.authors, []);
  assert.equal(a.udk, "");
});

test("footers: every slide footer is the empty footer of the sanitised meta; a title subtitle other than the work label goes", () => {
  const { doc } = run("slide");
  assert.deepEqual(doc.slides!.map((s) => s.footer), Array(5).fill(""));
  assert.equal(doc.slides![0]!.subtitle, undefined);
  const withLabel = slideDoc("slide");
  withLabel.slides![0]!.subtitle = withLabel.meta.workLabel;
  assert.equal(run("slide", withLabel).doc.slides![0]!.subtitle, withLabel.meta.workLabel, "the work label is no person");
});

test("PPTX core properties: the author line of a sanitised deck is the brand, not a person", async () => {
  const before = await adapterFor("slide")!.render({ id: "i", userId: "0", doc: slideDoc("slide"), fileName: "d.pptx", resolveImage: async () => null }, {});
  const beforeCore = await (await JSZip.loadAsync(before.bytes)).file("docProps/core.xml")!.async("string");
  assert.match(beforeCore, /Zulfiqorov/, "an unsanitised deck really carries the author in core.xml");
  const after = await adapterFor("slide")!.render({ id: "i", userId: "0", doc: run("slide").doc, fileName: "d.pptx", resolveImage: async () => null }, {});
  const core = await (await JSZip.loadAsync(after.bytes)).file("docProps/core.xml")!.async("string");
  assert.ok(!/Zulfiqorov/i.test(core));
  assert.match(core, /<dc:creator>[^<]+<\/dc:creator>/);
});

test("body text: phones, e-mails, usernames and t.me links are gone and flagged with paths, never with the value", () => {
  const { doc, flags } = run("referat");
  const kinds = new Set(flags.map((f) => f.kind));
  for (const k of ["name", "institution", "phone", "email", "username", "telegram"]) assert.ok(kinds.has(k as never), `kind ${k} flagged`);
  assert.ok(flags.every((f) => /^sections\.0\.|^tables|^abstracts|^referencesNote|^meta/.test(f.path)), JSON.stringify(flags.slice(0, 3)));
  assertClean(JSON.stringify(flags), "flags");
  const text = doc.sections[0]!.blocks.map((b) => b.text).join("\n");
  assert.ok(text.includes(SCRUB_MARK));
  assert.ok(!/\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2}/.test(text));
});

test("inflected names: Uzbek suffixes, Russian surname cases, both scripts, all caps", () => {
  const clean = (text: string) => {
    const doc = workDoc("referat");
    doc.sections[0]!.blocks = [{ kind: "p", text }];
    return run("referat", doc).doc.sections[0]!.blocks[0]!.text;
  };
  for (const v of ["Zulfiqorovning", "Zulfiqorovga", "Zulfiqorovdan", "ZULFIQOROV", "Зулфиқоров", "Зулфиқорова", "Зулфиқоровым", "zulfiqorov", "Mirjalolni"]) {
    assert.equal(clean(`${v} keldi`), `${SCRUB_MARK} keldi`, v);
  }
});

test("institution in the body: whole phrases are scrubbed in Latin and Cyrillic, any spacing and case", () => {
  const doc = workDoc("referat");
  doc.sections[0]!.blocks = [{ kind: "p", text: "QASHQADARYO   muhandislik AKADEMIYASI va Қашқадарё Муҳандислик Академияси" }];
  assert.equal(run("referat", doc).doc.sections[0]!.blocks[0]!.text, `${SCRUB_MARK} va ${SCRUB_MARK}`);
});

test("user material: facts, own sources and file text are dropped and the result says so", () => {
  const doc = workDoc("referat");
  doc.work!.userFacts = `Mening tajribam: ${AUTHOR}`;
  doc.work!.references = [{ id: "u1", title: "Mening qo'lyozmam", authors: [AUTHOR], verified: "user", cited: true, raw: `${AUTHOR}. Mening qo'lyozmam` }, ...doc.work!.references];
  doc.references = [`${AUTHOR}. Mening qo'lyozmam`, "Haqiqiy manba"];
  const r = run("referat", doc);
  assert.equal(r.doc.work!.userFacts, undefined);
  assert.ok(r.doc.work!.references.every((x) => x.verified !== "user"));
  assert.deepEqual(r.doc.references, ["Haqiqiy manba"]);
  assert.equal(r.userMaterial, true);

  const essay = essayDoc();
  essay.essay!.userFacts = `Mening fikrlarim: ${AUTHOR}`;
  const e = run("essay", essay);
  assert.equal(e.doc.essay!.userFacts, undefined);
  assert.equal(e.userMaterial, true);

  const thesis = thesisDoc();
  thesis.article!.userFacts = `Tajriba: ${AUTHOR}`;
  assert.equal(run("thesis", thesis).doc.article!.userFacts, undefined);

  const file = workDoc("referat");
  file.meta = { ...file.meta, sourceText: `Yuklangan fayl: ${AUTHOR}` };
  const f = run("referat", file);
  assert.equal(f.doc.meta.sourceText, "");
  assert.equal(f.userMaterial, true);
  assert.equal(run("referat").userMaterial, false, "a plain AI work is not user material");
});

test("logo and custom template: deleted, and they mark the work as user material", () => {
  const doc = slideDoc("pro-slide");
  doc.slideLogo = { url: "/api/generations/src-gen/assets/ab12" };
  doc.customTemplate = { assetId: "c0ffee", previews: {} } as unknown as AcademicDoc["customTemplate"];
  const r = run("pro-slide", doc);
  assert.equal(r.doc.slideLogo, undefined);
  assert.equal(r.doc.customTemplate, undefined);
  assert.equal(r.userMaterial, true);
  assert.ok(!r.assetIds.includes("ab12"), "the logo's bytes are not copied");
});

test("uploaded image: a slide whose picture the user replaced gets the AI original back; the upload's id never travels", () => {
  const doc = slideDoc("slide");
  doc.slides![1]!.image = { url: "/api/generations/src-gen/assets/face01", alt: `${AUTHOR} surati` };
  doc.slides![1]!.imageOrig = { url: "/api/generations/src-gen/assets/a10a10" };
  doc.slides![2]!.imageOrig = { url: "/api/generations/src-gen/assets/b20b20" };
  const r = run("slide", doc);
  assert.equal(r.doc.slides![1]!.image!.url, `${MARKET_ASSET_PREFIX}a10a10`);
  assert.equal(r.doc.slides![1]!.imageOrig, undefined);
  assert.equal(r.doc.slides![2]!.image!.url, `${MARKET_ASSET_PREFIX}b20b20`, "«Rasmsiz» picture restored");
  assert.deepEqual(r.assetIds.sort(), ["a10a10", "b20b20"]);
  assertClean(JSON.stringify(r.doc.slides), "slides");
});

test("asset URLs: own → placeholder (figures keep their asset id), foreign → gone with its frame; placeholders collect; missing bytes drop", () => {
  const doc = slideDoc("slide");
  doc.slides![1]!.image = { url: "/api/generations/src-gen/assets/aa11" };
  doc.slides![2]!.image = { url: "/api/generations/other-gen/assets/bb22" };
  const work = workDoc("referat");
  work.work!.figures = [{ id: "f1", kind: "scheme", caption: `Sxema: ${AUTHOR}`, spec: { kind: "process", steps: ["a", "b"] }, url: "/api/generations/src-gen/assets/cc33", assetId: "cc33", w: 10, h: 10 }];
  const r = run("slide", doc);
  assert.equal(r.doc.slides![1]!.image!.url, `${MARKET_ASSET_PREFIX}aa11`);
  assert.equal(r.doc.slides![2]!.image, undefined);
  assert.deepEqual(r.assetIds, ["aa11"]);
  assert.ok(!JSON.stringify(r.doc).includes("/api/generations/"), "nothing references a live generation");

  const w = run("referat", work);
  const fig = w.doc.work!.figures[0]!;
  assert.equal(fig.url, `${MARKET_ASSET_PREFIX}cc33`);
  assert.equal(fig.assetId, "cc33");
  assert.ok(!JSON.stringify(fig).toLowerCase().includes("zulfiqorov"));
  assert.deepEqual(collectPlaceholders(w.doc), ["cc33"]);

  const gone = dropMissingAssets(w.doc, ["cc33"]);
  assert.equal(gone.work!.figures[0]!.url, undefined);
  assert.equal(gone.work!.figures[0]!.assetId, undefined);
  assert.deepEqual(collectPlaceholders(gone), []);
});

test("allow-list: an unknown meta key is blanked, an unknown document key never passes, person-shaped fields of other tools neither", () => {
  const doc = workDoc("referat") as AcademicDoc & Record<string, unknown>;
  (doc.meta as unknown as Record<string, unknown>).futureSecret = `Kelajak maydoni ${AUTHOR}`;
  doc.futureDocField = { author: AUTHOR };
  doc.resume = { fullName: AUTHOR } as never;
  doc.images = [{ id: "i", url: "x", w: 1, h: 1 }];
  doc.translation = { source: AUTHOR } as never;
  doc.game = { title: AUTHOR } as never;
  doc.audio = { script: AUTHOR } as never;
  doc.infographic = { title: AUTHOR } as never;
  doc.speech = { lines: [AUTHOR] } as never;
  const r = run("referat", doc);
  assert.equal((r.doc.meta as unknown as Record<string, unknown>).futureSecret, "");
  for (const k of ["futureDocField", "resume", "images", "translation", "game", "audio", "infographic", "speech"]) {
    assert.equal((r.doc as unknown as Record<string, unknown>)[k], undefined, k);
  }
  assertClean(JSON.stringify(r.doc), "doc");
});

test("reports with free text go: the buyer does not inherit the author's readiness report", () => {
  assert.equal(run("referat").doc.work!.review, undefined);
  assert.equal(run("essay").doc.essay!.review, undefined);
  assert.equal(run("lesson-plan").doc.teacher!.review, undefined);
  assert.equal(run("lesson-plan").doc.teacher!.userNeeds, undefined);
  assert.equal(run("thesis").doc.article!.review, undefined);
});

test("no false positives: words of the topic, common lowercase words, cited authors, code and formulas stay", () => {
  const doc = workDoc("referat");
  doc.meta = { ...doc.meta, topic: "Amir Temur davlati tarixi" };
  doc.meta.author = "Temur Olim Aliyev";
  doc.work!.author = "Temur Olim Aliyev";
  doc.sections = [
    {
      id: "intro",
      title: "Kirish",
      blocks: [
        { kind: "p", text: "Amir Temur davlati. Bu olim katta kashfiyot qildi. Aliyev keldi." },
        { kind: "code", text: "@Override public void run() { /* ok */ }", lang: "java" },
        { kind: "formula", text: "\\frac{Aliyev}{2}" },
        { kind: "p", text: "2023 2024 2025 2026 yillarda 1 234 567 so'm." },
      ],
    },
  ];
  doc.work!.references = [{ id: "W1", title: "Tarix", authors: ["Aliyev B. T."], verified: "crossref", cited: true }];
  doc.references = ["Aliyev B. T. Tarix. 2020."];
  const r = sanitizeForMarket({ toolId: "referat", doc, values: {}, sourceId: "src-gen" });
  const [p, code, formula, nums] = r.doc.sections[0]!.blocks;
  assert.equal(p!.text, `Amir Temur davlati. Bu olim katta kashfiyot qildi. ${SCRUB_MARK} keldi.`);
  assert.equal(code!.text, "@Override public void run() { /* ok */ }");
  assert.equal(formula!.text, "\\frac{Aliyev}{2}");
  assert.equal(nums!.text, "2023 2024 2025 2026 yillarda 1 234 567 so'm.");
  assert.deepEqual(r.doc.work!.references[0]!.authors, ["Aliyev B. T."], "a same-named cited author stays");
  assert.deepEqual(r.doc.references, ["Aliyev B. T. Tarix. 2020."]);
});

test("the author's whole name in the topic is not protected: title, file hint and subject are scrubbed too", () => {
  const doc = workDoc("referat");
  doc.meta = { ...doc.meta, topic: `Zulfiqorov Mirjalol Rustamovich ${PHONE} issiqlik`, fileNameHint: `Zulfiqorov ${PHONE}`, subject: `${AUTHOR} fani` };
  doc.work!.subjectName = `${AUTHOR} fani`;
  const { doc: clean } = run("referat", doc);
  assertClean(clean.meta.topic, "topic");
  assert.match(clean.meta.topic, /issiqlik/);
  assertClean(clean.meta.fileNameHint, "file hint");
  assertClean(clean.meta.subject, "subject");
  assertClean(clean.work!.subjectName, "subject name");
});

test("a title line's markers name nobody: patronymic words and course text are not name words", () => {
  const id = identityOf({ doc: { meta: { author: "Aliyev Vali o'g'li — 3-kurs, 301-guruh" } } as unknown as AcademicDoc, values: {} });
  const doc = workDoc("referat");
  doc.meta = { ...doc.meta, topic: "Mavzu", author: id.names[0]! };
  doc.work!.author = id.names[0]!;
  doc.sections[0]!.blocks = [{ kind: "p", text: "O'g'li otasiga aytdi, kurs ishi tayyor. Vali keldi." }];
  const out = sanitizeForMarket({ toolId: "referat", doc, values: {}, sourceId: "s" }).doc.sections[0]!.blocks[0]!.text;
  assert.equal(out, `O'g'li otasiga aytdi, kurs ishi tayyor. ${SCRUB_MARK} keldi.`);
});

test("params: the form values are never copied, only the allow-list passes", () => {
  const { params } = run("referat");
  assert.deepEqual(Object.keys(params).sort(), ["language", "pages"]);
  assert.deepEqual(Object.keys(run("slide").params).sort(), ["language", "slideCount", "slideTheme"]);
});

test("resanitizeStored: the pattern layer runs over a stored document, placeholders survive, nothing throws on a clean one", () => {
  const { doc } = run("referat");
  doc.sections[0]!.blocks = [{ kind: "p", text: `Yangi qoidalar: ${PHONE}` }];
  doc.work!.figures = [{ id: "f", kind: "scheme", caption: "c", spec: { kind: "process", steps: ["a"] }, url: `${MARKET_ASSET_PREFIX}dd44`, assetId: "dd44", w: 1, h: 1 }];
  const r = resanitizeStored("referat", doc, { pages: "15-20", author: AUTHOR });
  assert.equal(r.doc.sections[0]!.blocks[0]!.text, `Yangi qoidalar: ${SCRUB_MARK}`);
  assert.equal(r.flags.length, 1);
  assert.deepEqual(r.assetIds, ["dd44"]);
  assert.equal(r.doc.work!.figures[0]!.url, `${MARKET_ASSET_PREFIX}dd44`);
  assert.deepEqual(r.params, { pages: "15-20" });
});

test("a document without meta fails loudly: the scan records sanitize_error instead of listing garbage", () => {
  assert.throws(() => sanitizeForMarket({ toolId: "referat", doc: {} as AcademicDoc, values: {}, sourceId: "s" }), /no meta/);
});
