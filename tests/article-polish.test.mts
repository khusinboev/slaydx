import test from "node:test";
import assert from "node:assert/strict";
import {
  POLISH_JUDGE_NOTE,
  POLISH_MAX_FIXES,
  applyPolish,
  needsUserData,
  planPolish,
  runPolish,
  userNeeds,
  type ArticleFix,
} from "../lib/generation/article/polish.ts";
import { JUDGE_CRITERIA, JUDGE_NO_ANSWER, reviewArticle } from "../lib/generation/article/review.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { ArticleReview, ReviewCheck } from "../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * Avto-sayqal (Maqola 3, AUDIT-18 WP-A) — `lib/generation/article/polish.ts`.
 *
 * SOF modul, LLM stub. Qulflanadi: reja (bandlar → fix, `length`/`visuals`
 * sintezi, Q-2 filtr, bitta nishonga BITTA fix, ≤6, udk/authors doim
 * `user`), apply (bitta fix xatosi boshqalarini to'xtatmaydi, vizuallar
 * saqlanadi, noma'lum iqtibos o'chadi), run (Q-3: ball oshsa qabul /
 * oshmasa eski hujjat; baholovchi javobsiz → eski ballar; byudjet;
 * tuzatiladigan band yo'q → LLM chaqirilmaydi), userNeeds.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • Q-3 `after > before` → `>=` — «rad» testi (teng ball) yiqildi;
 *   • Q-2 filtr o'chirildi (`needsUserData` doim false) — «skipped user» testi;
 *   • birlashtirish o'chirildi (har candidate alohida fix) — «bitta nishon» testi;
 *   • `POLISH_MAX_FIXES` cheksiz — «≤6» testi;
 *   • `judgeFromReview` fallback olib tashlandi — «javobsiz baholovchi» testi;
 *   • `keepVisuals` chaqirilmadi — «rasm bloki saqlanadi» testi;
 *   • byudjet sharti olib tashlandi — «budget» testi (LLM chaqirildi).
 */

const NOW = new Date("2026-09-12T10:00:00.000Z");
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article", targetPages: 4, figureCount: 1, research: true } as unknown as DocMeta;

/** Chuqur nusxa — namuna modeli modul konstantasi bilan ulashilgan. */
function doc(userFacts = ""): AcademicDoc {
  const d = structuredClone(sampleArticleDoc(META));
  d.article!.userFacts = userFacts;
  return d;
}

const judgeCheck = (c: string, n: number): ReviewCheck => ({ id: `judge:${c}`, level: n >= 3 ? "green" : n === 2 ? "yellow" : "red", label: c, detail: `${n}/3` });
const fixCheck = (i: number, target: string, instruction: string): ReviewCheck => ({ id: `judge:fix:${i}`, level: "yellow", label: "Baholovchi tavsiyasi", detail: `${target}: ${instruction}`, fix: { op: "rewrite", target, instruction } });

/** Sun'iy hisobot: qoidalar + baholovchi (hamma mezon `j`), tavsiyalar. */
function review(rules: ReviewCheck[], j = 1, fixes: ReviewCheck[] = []): ArticleReview {
  return {
    score: 60,
    checks: [...rules, ...JUDGE_CRITERIA.map((c) => judgeCheck(c, j)), ...fixes],
    judgeNotes: [],
    verifiedShare: 1,
    recentShare: 1,
    builtAt: "2026-09-11T00:00:00.000Z",
  };
}

const rw = (target: string, instruction: string): ReviewCheck["fix"] => ({ op: "rewrite", target, instruction });

type Call = { role: LlmRole; system: string; user: string };

/** LLM stub: bo'lim/annotatsiya/kalit so'z/highlights → tayyor JSON; baholovchi → `judge` (null = javobsiz); `fail` nishoni → xato. */
function stub(o: { judge?: number | null; fail?: string; sectionText?: string; single?: boolean } = {}) {
  const calls: Call[] = [];
  const complete = (async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    const usage = { provider: "stub", model: "stub", inputTokens: 10, outputTokens: 5 };
    if (role === "judge") {
      if (o.judge === null) return null;
      const j = o.judge ?? 3;
      return { text: JSON.stringify({ novelty: j, chain: j, methods: j, comparison: j, overclaim: j, style: j, notes: ["Yaxshi"], fixes: [] }), usage };
    }
    if (user.startsWith("Write the section")) {
      const id = user.match(/\(id ([\w:-]+)\)/)?.[1] ?? "";
      if (o.fail && id === o.fail) throw new Error("tarmoq");
      const text = o.sectionText ?? `Qayta yozilgan «${id}»: adaptiv tizim o‘zlashtirishni oshiradi [W2741809807]. Uydirma manba [W99999] ham bor. Tadqiqot cheklovlari: tanlanma bitta universitet bilan chegaralangan.`;
      const blocks = o.single ? [{ kind: "p", text }] : [{ kind: "p", text }, { kind: "p", text: `${text} Ikkinchi paragraf natijalarni manbalar bilan taqqoslaydi [W4385] — 1-rasm va 1-jadval shuni ko‘rsatadi.` }];
      return { text: JSON.stringify({ blocks }), usage };
    }
    if (user.startsWith("Write the abstract")) return { text: JSON.stringify({ text: "Yangi annotatsiya. ".repeat(40), keywords: ["a", "b", "c", "d", "e"] }), usage };
    if (user.startsWith("Provide")) return { text: JSON.stringify({ uz: ["a", "b", "c", "d", "e"], ru: ["а", "б", "в", "г", "д"], en: ["one", "two", "three", "four", "five"] }), usage };
    if (user.startsWith("Write ")) return { text: JSON.stringify({ highlights: ["Birinchi", "Ikkinchi", "Uchinchi"] }), usage };
    return { text: "{}", usage };
  }) as unknown as Parameters<typeof runPolish>[2]["complete"];
  return { complete, calls };
}

/* ══════════════════════════════ Q-2 lug'at ══════════════════════════════ */

test("needsUserData: tajriba/datchik/aniqlik/tanlanma (en/uz/ru) → true; «methods/results» faqat qo'sh/keltir bilan; xavfsiz tavsiya → false", () => {
  for (const s of [
    "Add the sample size and diagnostic accuracy of the method",
    "Describe the experimental setup and sensors used",
    "Report p-values and confidence intervals",
    "Natijalar bo‘limiga tajriba ma’lumotlarini va datchik parametrlarini keltiring",
    "Aniqlik foizini ko‘rsating",
    "Опишите выборку и точность измерений",
    "Add concrete results to the results section",
    "Natijalar bo‘limiga aniq raqamli ko‘rsatkichlarni qo‘shing",
  ]) assert.ok(needsUserData(s), `natija talab qiladi: ${s}`);
  for (const s of [
    "Sharpen the aim in the introduction",
    "Compare the findings with at least three cited sources in the discussion",
    "Natijalarni manbalar bilan taqqoslang",
    "Xulosa natijadan oshmasin — da’volarni yumshating",
    "Remove filler phrases and make every sentence carry a specific claim",
    "Уточните цель во введении",
  ]) assert.ok(!needsUserData(s), `xavfsiz: ${s}`);
});

/* ══════════════════════════════ reja ══════════════════════════════ */

test("planPolish: qoidalar fix ga, udk/authors → user, fixsiz band → manual, bitta nishonga BITTA fix (birlashadi), Q-2 tavsiya → user", () => {
  const r = review(
    [
      { id: "udk", level: "yellow", label: "UDK" },
      { id: "authors", level: "yellow", label: "Mualliflar", detail: "Email yoki ORCID to‘liq emas" },
      { id: "refsCount", level: "red", label: "Manbalar soni" },
      { id: "filler", level: "yellow", label: "Suv", fix: rw("intro", "Remove filler phrases.") },
      { id: "repetition", level: "yellow", label: "Takror", fix: rw("discussion", "Do not repeat intro.") },
      { id: "limitations", level: "yellow", label: "Cheklovlar", fix: rw("discussion", "Add a limitations paragraph.") },
      { id: "abstracts", level: "yellow", label: "Annotatsiya", fix: rw("abstract:uz", "Rewrite to 150–250 words.") },
      { id: "structure", level: "green", label: "Tuzilma" },
    ],
    1,
    [fixCheck(1, "intro", "Kirishda maqsadni aniq yozing"), fixCheck(2, "results", "Add the sample size and accuracy of the method"), fixCheck(3, "nonexistent", "x")],
  );
  const p = planPolish(r, doc());
  const byTarget = new Map(p.fixes.map((f) => [f.target, f.instruction]));
  assert.deepEqual([...byTarget.keys()].sort(), ["abstract:uz", "discussion", "intro"]);
  // Birlashtirish: discussion — ikki qoida ko'rsatmasi; intro — qoida + baholovchi.
  assert.match(byTarget.get("discussion")!, /^\(1\) Do not repeat intro\. \(2\) Add a limitations paragraph\.$/);
  assert.match(byTarget.get("intro")!, /\(1\) Remove filler phrases\. \(2\) Kirishda maqsadni aniq yozing/);
  assert.equal(byTarget.get("abstract:uz"), "Rewrite to 150–250 words.");
  // Skipped: udk/authors (user), refsCount (manual), judge:fix:2 (user — Q-2), yashil band yo'q; noma'lum nishon tushib qoldi.
  const skipped = new Map(p.skipped.map((s) => [s.id, s.reason]));
  assert.equal(skipped.get("udk"), "user");
  assert.equal(skipped.get("authors"), "user");
  assert.equal(skipped.get("refsCount"), "manual");
  assert.equal(skipped.get("judge:fix:2"), "user");
  assert.ok(!skipped.has("structure"));
  assert.ok(!skipped.has("filler"));

  // userFacts bo'lsa Q-2 filtr ishlamaydi — results ham tuzatiladi.
  const p2 = planPolish(r, doc("Tajribada 120 talaba, aniqlik 92%"));
  assert.ok(p2.fixes.some((f) => f.target === "results"), "userFacts bilan natija tavsiyasi bajarilishi kerak");
  assert.ok(!p2.skipped.some((s) => s.id === "judge:fix:2"));
});

test("planPolish: `visuals` → havolasiz rasm/jadval bo'limiga [fig:]/[tab:] tokeni bilan fix; `length` → eng qisqa 2 bo'limni kengaytirish", () => {
  const d = doc();
  const p = planPolish(review([{ id: "visuals", level: "yellow", label: "Vizuallar", detail: "Matnda havola yo‘q: 1-rasm, 1-jadval" }], 3), d);
  const fig = p.fixes.find((f) => f.target === "litreview_methods");
  const tab = p.fixes.find((f) => f.target === "results");
  assert.ok(fig && /\[fig:f1\]/.test(fig.instruction), `rasm havolasi: ${JSON.stringify(p)}`);
  assert.ok(tab && /\[tab:t1\]/.test(tab.instruction), `jadval havolasi: ${JSON.stringify(p)}`);
  assert.match(fig!.instruction, /1-rasm/);
  // Havolalar bor bo'lsa — sintez yo'q, `manual`.
  const ok = doc();
  ok.sections[4].blocks.push({ kind: "p", text: "Qarang: [fig:f1] va [tab:t1]." });
  const p2 = planPolish(review([{ id: "visuals", level: "yellow", label: "Vizuallar" }], 3), ok);
  assert.equal(p2.fixes.length, 0);
  assert.deepEqual(p2.skipped, [{ id: "visuals", reason: "manual" }]);

  // Hajm: namuna bo'limlari rejadan ancha qisqa — eng katta kamomadli 2 ta bo'lim «Expand».
  const p3 = planPolish(review([{ id: "length", level: "red", label: "Hajm", detail: "80 so‘z (maqsad ≈600, 13%)" }], 3), d);
  assert.equal(p3.fixes.length, 2);
  for (const f of p3.fixes) {
    assert.match(f.instruction, /^Expand this section to about \d+ words \(it has \d+\)/);
    assert.match(f.instruction, /keep every existing sentence, citation ID and user fact/);
  }
  // Uzun bo'lsa — eng uzun bo'lim «Condense».
  const long = doc();
  long.sections[0].blocks.push({ kind: "p", text: Array.from({ length: 2000 }, (_, i) => `so‘z${i}`).join(" ") });
  const p4 = planPolish(review([{ id: "length", level: "red", label: "Hajm" }], 3), long);
  assert.equal(p4.fixes.length, 1);
  assert.equal(p4.fixes[0].target, "intro");
  assert.match(p4.fixes[0].instruction, /^Condense this section/);
});

test("planPolish: ko'pi bilan 6 fix — ortiqcha nishonlar `limit`; qizil bandlar birinchi", () => {
  const d = doc();
  // 5 bo'lim + abstract:uz/ru/en + keywords = 9 nishon.
  const rules: ReviewCheck[] = [
    { id: "keywords", level: "yellow", label: "K", fix: rw("keywords", "Adjust keywords.") },
    { id: "abstracts", level: "red", label: "A", fix: rw("abstract:ru", "Write the ru abstract.") },
    { id: "filler", level: "yellow", label: "F", fix: rw("intro", "Remove filler.") },
    { id: "repetition", level: "yellow", label: "R", fix: rw("discussion", "No repeat.") },
    { id: "limitations", level: "yellow", label: "L", fix: rw("conclusion", "Add limitations.") },
  ];
  const fixes = [fixCheck(1, "results", "Sharpen"), fixCheck(2, "litreview_methods", "Sharpen"), fixCheck(3, "abstract:en", "Sharpen"), fixCheck(4, "abstract:uz", "Sharpen")];
  const p = planPolish(review(rules, 1, fixes), d);
  assert.equal(p.fixes.length, POLISH_MAX_FIXES);
  assert.equal(p.fixes[0].target, "abstract:ru", "qizil band birinchi");
  const limited = p.skipped.filter((s) => s.reason === "limit").map((s) => s.id);
  assert.deepEqual(limited, ["litreview_methods", "abstract:en", "abstract:uz"], "oxirgi uch baholovchi nishoni chegaradan tashqarida");
  assert.deepEqual(
    p.fixes.map((f) => f.target),
    ["abstract:ru", "keywords", "intro", "discussion", "conclusion", "results"],
  );
});

/* ══════════════════════════════ apply ══════════════════════════════ */

test("applyPolish: fix lar parallel, bitta xato boshqalarini to'xtatmaydi; vizual bloklar saqlanadi; noma'lum iqtibos o'chadi", async () => {
  const s = stub({ fail: "results" });
  const fixes: ArticleFix[] = [
    { op: "rewrite", target: "litreview_methods", instruction: "Refer to [fig:f1]." },
    { op: "rewrite", target: "results", instruction: "x" },
    { op: "rewrite", target: "abstract:ru", instruction: "Rewrite." },
    { op: "rewrite", target: "keywords", instruction: "Adjust." },
  ];
  const r = await applyPolish(doc(), fixes, { complete: s.complete, deadline: Date.now() + 30_000 });
  assert.deepEqual(r.applied.map((f) => f.target), ["litreview_methods", "abstract:ru", "keywords"]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].fix.target, "results");
  assert.equal(s.calls.length, 4, "har fix uchun bitta writer chaqiruvi");
  assert.ok(s.calls.every((c) => c.role === "writer"));
  const sec = r.ops.find((o) => o.op === "setSection");
  assert.ok(sec && sec.op === "setSection");
  assert.equal(sec.sectionId, "litreview_methods");
  assert.ok(sec.blocks.some((b) => b.kind === "figure" && b.figureId === "f1"), "rasm bloki yo'qoldi");
  assert.equal(sec.blocks[1].kind, "figure", "rasm eski indeksida (1) turishi kerak");
  const txt = sec.blocks.map((b) => b.text).join(" ");
  assert.ok(!txt.includes("W99999"), "reyestrda yo'q iqtibos qoldi");
  assert.match(txt, /\[W2741809807\]/);
  assert.deepEqual(r.rewrittenSections, ["litreview_methods"]);
  assert.ok(r.unresolved.some((u) => u.id === "W99999" && u.sectionId === "litreview_methods"), "o'chirilgan iqtibos qo'riqchi hisobiga tushmadi");
  assert.ok(r.ops.some((o) => o.op === "abstract" && o.lang === "ru"));
  assert.equal(r.ops.filter((o) => o.op === "keywords").length, 3);
});

/* ══════════════════════════════ run ══════════════════════════════ */

/** Haqiqiy qoidalar + stub baholovchi (1/3) bilan boshlang'ich hisobot. */
async function baseReview(d: AcademicDoc, j = 1): Promise<ArticleReview> {
  const s = stub({ judge: j });
  const r = await reviewArticle(d, { complete: s.complete, deadline: Date.now() + 30_000, now: NOW, wordTarget: 400 });
  // Baholovchi tavsiyasi qo'lda (stub fixes bermaydi): kirishga xavfsiz ko'rsatma.
  r.checks.push(fixCheck(1, "intro", "Kirishda maqsadni aniq yozing"));
  return r;
}

test("runPolish: ball OSHSA qabul — yangi hujjat, hisobot polish jurnali bilan (before/after/applied), userNeeds, baholovchi qayta chaqirildi", async () => {
  const d = doc();
  const before = await baseReview(d, 1);
  const s = stub({ judge: 3 });
  const r = await runPolish(d, before, { complete: s.complete, deadline: Date.now() + 120_000, now: NOW });
  assert.ok(r.accepted, `qabul qilinishi kerak edi: ${JSON.stringify(r.log)}`);
  assert.ok(r.review.score > before.score, `${r.review.score} > ${before.score}`);
  assert.equal(r.log.before, before.score);
  assert.equal(r.log.after, r.review.score);
  assert.equal(r.review.polish?.accepted, true);
  assert.equal(r.review.polish?.at, NOW.toISOString());
  assert.ok(r.log.applied.length >= 1);
  assert.ok(r.log.applied.some((a) => a.target === "intro"), "kirish tuzatilmadi");
  assert.ok(s.calls.some((c) => c.role === "judge"), "baholovchi qayta chaqirilmadi");
  assert.ok(s.calls.filter((c) => c.role === "writer").length >= 1);
  // Yangi hujjat: kirish qayta yozilgan, asl hujjat o'zgarmagan.
  assert.match(r.doc.sections[0].blocks[0].text, /^Qayta yozilgan «intro»/);
  assert.match(d.sections[0].blocks[0].text, /^Oliy ta’limda/);
  assert.ok(r.ops.length >= 1);
  assert.ok(Array.isArray(r.review.userNeeds));
  // Hisobot yangi hujjatdan: baholovchi 3/3.
  assert.equal(r.review.checks.find((c) => c.id === "judge:novelty")?.detail, "3/3");
});

test("runPolish (Q-3): ball oshmasa — ESKI hujjat va eski hisobot qaytadi, jurnal accepted:false; teng ball ham rad", async () => {
  const d = doc();
  const before = await baseReview(d, 2);
  const snapshot = JSON.stringify(d);
  // Baholovchi 0/3 → ball tushadi.
  const low = stub({ judge: 0 });
  const r = await runPolish(d, before, { complete: low.complete, deadline: Date.now() + 120_000, now: NOW });
  assert.equal(r.accepted, false);
  assert.equal(r.doc, d, "rad etilganda asl hujjat OBYEKTI qaytishi kerak");
  assert.equal(JSON.stringify(d), snapshot, "asl hujjat o'zgargan");
  assert.equal(r.review.score, before.score);
  assert.deepEqual(r.review.checks, before.checks);
  assert.equal(r.review.polish?.accepted, false);
  assert.ok(r.review.polish!.after < before.score);
  assert.deepEqual(r.ops, []);
  assert.ok(r.log.applied.length >= 1, "urinish jurnalda ko'rinishi kerak");
  // TENG ball: model kirishni AYNAN eski matn bilan qaytaradi (bitta blok), baholovchi eskisidek 2/3 → qoidalar ham, ball ham o'zgarmaydi → rad.
  const same = stub({ judge: 2, sectionText: d.sections[0].blocks[0].text, single: true });
  const r2 = await runPolish(d, before, { complete: same.complete, deadline: Date.now() + 120_000, now: NOW });
  assert.equal(r2.log.after, before.score, `teng ball ssenariysi buzildi: ${r2.log.after} vs ${before.score}`);
  assert.equal(r2.accepted, false, "teng ball qabul qilindi (Q-3: faqat OSHSA)");
  assert.equal(r2.doc, d);
});

test("runPolish: baholovchi javob bermasa ballari ESKI hisobotdan (izoh bilan) — neytral bilan soxta qabul yo'q", async () => {
  const d = doc();
  const before = await baseReview(d, 0);
  const s = stub({ judge: null });
  const r = await runPolish(d, before, { complete: s.complete, deadline: Date.now() + 120_000, now: NOW });
  // Qoidalar yaxshilangan bo'lishi mumkin (cheklov, havola) — lekin baholovchi 0/3 ESKICHA qoladi.
  const checks = r.accepted ? r.review.checks : before.checks;
  for (const c of JUDGE_CRITERIA) assert.equal(checks.find((x) => x.id === `judge:${c}`)?.detail, "0/3", `${c} neytralga «o'sdi»`);
  if (r.accepted) {
    assert.ok(r.review.judgeNotes.includes(POLISH_JUDGE_NOTE), "izoh yo'q");
    assert.ok(!r.review.judgeNotes.includes(JUDGE_NO_ANSWER));
  }
});

test("runPolish: tuzatiladigan band yo'q → LLM chaqirilmaydi, jurnal accepted:false; byudjet kam → `budget`, LLM chaqirilmaydi", async () => {
  const d = doc("120 talaba");
  const green = review([{ id: "structure", level: "green", label: "T" }], 3);
  const s = stub();
  const r = await runPolish(d, green, { complete: s.complete, deadline: Date.now() + 120_000, now: NOW });
  assert.equal(s.calls.length, 0);
  assert.equal(r.accepted, false);
  assert.deepEqual(r.log.applied, []);
  assert.equal(r.review.polish?.before, green.score);
  assert.equal(r.review.polish?.after, green.score);

  const b = review([{ id: "filler", level: "yellow", label: "F", fix: rw("intro", "Remove filler.") }], 1);
  const s2 = stub();
  const r2 = await runPolish(d, b, { complete: s2.complete, deadline: Date.now() + 45_000, now: NOW });
  assert.equal(s2.calls.length, 0, "byudjet yetmasa LLM chaqirilmasligi kerak (40 s baholovchi + 10 s tuzatish)");
  assert.ok(r2.log.skipped.some((x) => x.id === "budget" && x.reason === "budget"));
  assert.equal(r2.accepted, false);
  // judge:false — baholovchi zaxirasi yo'q, 45 s yetadi.
  const s3 = stub();
  const r3 = await runPolish(d, b, { complete: s3.complete, deadline: Date.now() + 45_000, now: NOW, judge: false });
  assert.ok(s3.calls.length >= 1);
  assert.ok(!s3.calls.some((c) => c.role === "judge"));
  assert.ok(!r3.log.skipped.some((x) => x.id === "budget"));
});

test("runPolish: hammasi yiqilsa (model javobsiz) — rad, skipped `error`, hujjat o'zgarmaydi", async () => {
  const d = doc();
  const b = review([{ id: "filler", level: "yellow", label: "F", fix: rw("intro", "Remove filler.") }], 1);
  const s = stub({ fail: "intro" });
  const r = await runPolish(d, b, { complete: s.complete, deadline: Date.now() + 120_000, now: NOW });
  assert.equal(r.accepted, false);
  assert.equal(r.doc, d);
  assert.deepEqual(r.log.applied, []);
  assert.ok(r.log.skipped.some((x) => x.id === "intro" && x.reason === "error"));
  assert.ok(!s.calls.some((c) => c.role === "judge"), "tuzatish bo'lmasa baholovchi chaqirilmaydi");
});

/* ══════════════════════════════ userNeeds ══════════════════════════════ */

test("userNeeds: udk/authors sariq → ro'yxatda; judge:methods qizil + userFacts bo'sh → «Natijalarim»; userFacts bo'lsa yo'q; natija talab qiladigan tavsiya ham", () => {
  const r = review(
    [
      { id: "udk", level: "yellow", label: "UDK" },
      { id: "authors", level: "yellow", label: "Mualliflar", detail: "Email yoki ORCID to‘liq emas" },
    ],
    1,
  );
  const n = userNeeds(r, doc());
  assert.deepEqual(
    n.map((x) => x.id),
    ["udk", "authors", "results"],
  );
  assert.match(n[1].hint, /ORCID/);
  assert.match(n[2].hint, /Natijalarim/);
  // Faktlar bor — natija so'ralmaydi.
  assert.deepEqual(userNeeds(r, doc("120 talaba")).map((x) => x.id), ["udk", "authors"]);
  // Baholovchi 3/3, lekin tavsiya tajriba ma'lumotini so'raydi.
  const r2 = review([{ id: "udk", level: "green", label: "UDK" }], 3, [fixCheck(1, "results", "Add the sample size and accuracy")]);
  assert.deepEqual(userNeeds(r2, doc()).map((x) => x.id), ["results"]);
  assert.deepEqual(userNeeds(review([{ id: "udk", level: "green", label: "UDK" }], 3), doc()), []);
});
