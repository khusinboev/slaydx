/**
 * TAYYORLIK HISOBOTI (Maqola 2, AUDIT-17 WP5) — `reviewArticle`.
 *
 * Ikki qatlam:
 *   1. QOIDALAR — deterministik, 100% aniq (`ruleChecks`): tuzilma, UDK,
 *      annotatsiya ×3, kalit so'zlar, mualliflar, iqtibos ↔ ro'yxat 1:1,
 *      tasdiqlangan ulush, manbalar soni, «oxirgi N yil» ulushi, DOI,
 *      vizuallar havolasi, manbasiz raqamlar, foydalanuvchi faktlari,
 *      «suv» iboralar, bo'limlar takrori, hajm, PRISMA, highlights,
 *      cheklovlar. Har biri `ReviewCheck` — yorliqlar O'ZBEKCHA (interfeys
 *      tili; hujjat tili emas).
 *   2. BAHOLOVCHI — `judge` rol (WP8 Claude Sonnet 5 ga yo'naltiradi), JSON:
 *      6 mezon × 0–3 (yangilik, maqsad↔natija↔xulosa, takrorlanuvchanlik,
 *      taqqoslash, oshirib yuborish, uslub) + ≤5 izoh + ≤5 «tuzatish».
 *      Javob bo'lmasa — neytral 2 va «Baholovchi javob bermadi».
 *
 * BALL = 60% qoidalar (yashil 1, sariq 0.5, qizil 0) + 40% baholovchi
 * (6 × 3 = 18 dan), 0–100 butun.
 *
 * `fix` — `{op:"rewrite", target, instruction}`: WP7 serverda `writer`
 * roli bilan bajaradi; bu yerda faqat SHARTNOMA (target = bo'lim id |
 * `abstract:<lang>` | `keywords` | `highlights`).
 *
 * Nega guard hisoboti QAYTA hisoblanadi (dvigatel `guard` bersa ham):
 * hisobot tahrirdan keyin ham (WP7) qayta chaqiriladi — o'shanda dvigatel
 * yo'q; `guardSection` bir xil qoidalarni beradi. Dvigateldan faqat
 * QAYTA TIKLAB BO'LMAYDIGAN narsa olinadi: o'chirilgan noma'lum
 * iqtiboslar (`unresolved`) va bo'sh qolgan bo'limlar.
 *
 * Izomorf: DOM/server importi yo'q — panel (`ArticleReviewPanel`) guruh
 * jadvalini shu yerdan oladi.
 */
import type { AcademicDoc, DocSection } from "../types";
import type { ArticleReview, ArticleType, PublicationProfile, ReviewCheck } from "./types";
import { ARTICLE_TYPES } from "./types-registry";
import { PUBLICATION_PROFILES } from "./profiles";
import { articleLabels } from "./labels";
import { planArticle } from "./layout";
import { estimateDocPages } from "./plan";
import { guardSection, missingFactNumbers, skeletonCoverage, wordsOf } from "./guard";
import { formatReference } from "../cite";
import { remainingMs } from "../quality";
/*
 * NEYTRAL QATLAM (AUDIT-19 R0-A) — ball formulasi, baholovchi prompti/
 * tahlili, matn namunasi va 3-gram takror `lib/generation/report/` da:
 * kurs ishi (`work/`) va insho (`essay/`) dvigatellari ham shulardan
 * foydalanadi. Bu fayl MAQOLAGA XOS qismni (qoidalar, `planArticle` ga
 * bog'liq vizual hisob, mezon ta'riflari) va o'zgarmagan IMZOLARNI
 * saqlaydi — X-7: `article/*` xulqi zarracha o'zgarmaydi.
 */
import { JUDGE_WEIGHT, RULE_WEIGHT, check, jaccard, langKey, rewrite, scoreReviewFor, sectionText, trigrams, visualCoverageOf, type UnreferencedVisual } from "../report/score";
import { JUDGE_MIN_MS, JUDGE_NEUTRAL, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../report/judge";
import { sampleForJudge } from "../report/text";
import type { JudgeResult as ReportJudgeResult, JudgeSpec } from "../report/types";
import type { LlmUsage, complete as completeRole } from "../llm-roles";
import { JUDGE_CRITERIA, type ArticleJudgeConfig, type JudgeCriterion } from "./types";
import type { ResearchStats } from "../research/pipeline";

/* ────────────────────────── tiplar ────────────────────────── */

export type CompleteFn = typeof completeRole;

/** Dvigateldan keladigan, hujjatdan QAYTA HISOBLAB BO'LMAYDIGAN qism. */
export type ReviewGuardInput = {
  unresolved?: { id: string; sectionId: string }[];
  emptySections?: string[];
};

export type ReviewOpts = {
  research?: ResearchStats;
  guard?: ReviewGuardInput;
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (neytral ball, izohsiz). */
  judge?: boolean;
  /** Butun hujjat so'z maqsadi (`articleWordPlan.total`); berilmasa dvigateldan hisoblanadi. */
  wordTarget?: number;
  /** Test uchun «hozir» (oxirgi N yil, `builtAt`). */
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

export { JUDGE_CRITERIA } from "./types";
export type { JudgeCriterion } from "./types";

/** Maqola baholovchisi — 6 mezon (`JUDGE_CRITERIA`) ustidagi neytral shakl. */
export type JudgeResult = ReportJudgeResult<JudgeCriterion>;

export { JUDGE_NEUTRAL, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS };
export { RULE_WEIGHT, JUDGE_WEIGHT, trigrams, jaccard };

/** Bo'limlar matni baholovchiga shu belgidan oshmaydi (bo'limlar orasida mutanosib). */
export const JUDGE_TEXT_CHARS = 25_000;
/** Bo'limlar o'zaro takror deb hisoblanadigan 3-gram Jaccard chegarasi. */
export const REPETITION_JACCARD = 0.15;
/** Hajm chegarasi: maqsaddan ±20% — yashil. */
export const LENGTH_TOLERANCE = 0.2;

/*
 * Panel guruhlari (Tuzilma · Manbalar · Vizuallar · Ilmiy mazmun · AI izi)
 * ATAYLAB bu yerda EMAS — `components/viewers/ArticleReviewPanel.tsx` da:
 * bu fayl `engine` ni (dinamik) import qiladi, mijoz bundle'iga
 * kirmasligi kerak. Tekshiruv id lari ro'yxati — `RULE_IDS`.
 */
export const RULE_IDS = [
  "structure",
  "udk",
  "abstracts",
  "keywords",
  "authors",
  "citations",
  "verified",
  "refsCount",
  "recent",
  "doi",
  "visuals",
  "unsourcedNumbers",
  "userFacts",
  "filler",
  "repetition",
  "length",
  "prisma",
  "highlights",
  "limitations",
] as const;

export const JUDGE_LABELS: Record<JudgeCriterion, string> = {
  novelty: "Yangilik va hissa",
  chain: "Maqsad ↔ natija ↔ xulosa mosligi",
  methods: "Metodlarning takrorlanuvchanligi",
  comparison: "Muhokamada manbalar bilan taqqoslash",
  overclaim: "Xulosa natijadan oshmaydi",
  style: "Ilmiy uslub",
};

/* ────────────────────────── yordamchilar ────────────────────────── */

const WORD_RE = /\S+/g;
const words = (s: string) => (s.match(WORD_RE) ?? []).length;

/** Skelet id → bo'lim (erkin `body-N` ham `body` ga mos). */
function skeletonIdOf(sectionId: string): string {
  return sectionId.replace(/-\d+$/, "");
}

const list = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

const pct = (x: number) => `${Math.round(x * 100)}%`;

/* ────────────────────────── qoidalar ────────────────────────── */

export type RuleResult = { checks: ReviewCheck[]; verifiedShare: number; recentShare: number };

const LIMITATION_RE = /cheklov|chegaralan|limitation|limited|ограничен|недостат/iu;

export type { UnreferencedVisual };

/**
 * Rasm/jadval bloklari matnda havola qilinganmi — `visuals` qoidasi VA
 * avto-sayqal (`polish.ts`, «havola qo'sh» tuzatishi) BITTA hisobdan
 * o'qiydi. Sof hisob `report/score.ts visualCoverageOf` da; bu o'ram
 * `planArticle` dan raqam/yorliq/til beradi (maqolaga bog'liq qism).
 */
export function visualCoverage(doc: AcademicDoc): { unreferenced: UnreferencedVisual[]; fallback: number; count: number } {
  const plan = planArticle(doc);
  return visualCoverageOf(doc.sections, plan.model.figures, plan.numbers, articleLabels(plan.language), plan.language);
}

/**
 * Deterministik qoidalar. `wordTarget` — BO'LIM matni so'z maqsadi (`articleWordPlan.body`)
 * (annotatsiyalar alohida qoidada); `wordRange` li turlarda (tezis) e'tiborsiz.
 */
export function ruleChecks(doc: AcademicDoc, o: { guard?: ReviewGuardInput; research?: ResearchStats; wordTarget: number; now?: Date }): RuleResult {
  const plan = planArticle(doc);
  const model = plan.model;
  const type: ArticleType = plan.type;
  const profile: PublicationProfile = plan.profile;
  const lang = plan.language;
  const L = articleLabels(lang);
  const year = (o.now ?? new Date()).getFullYear();
  const sections = doc.sections.filter((s) => s.blocks.length);
  const refs = model.references.filter((r) => r.cited);
  const out: ReviewCheck[] = [];

  /* ── structure: majburiy bo'limlar bor va skelet tartibida ── */
  {
    const cov = skeletonCoverage(type, sections);
    const order = new Map(type.skeleton.map((s, i) => [s.id, i]));
    const idx = sections.map((s) => order.get(skeletonIdOf(s.id))).filter((i): i is number => i !== undefined);
    const ordered = idx.every((v, i) => i === 0 || v >= idx[i - 1]);
    const empty = o.guard?.emptySections ?? [];
    const name = (id: string) => L.section[type.skeleton.find((s) => s.id === id)?.titleKey ?? "body"] ?? id;
    if (cov.hardMissing.length) out.push(check("structure", "red", "Tuzilma", `Majburiy bo‘lim yo‘q: ${cov.hardMissing.map(name).join(", ")}`));
    else if (cov.missing.length || empty.length) out.push(check("structure", "yellow", "Tuzilma", `Bo‘lim yo‘q yoki bo‘sh: ${[...new Set([...cov.missing, ...empty])].map(name).join(", ")}`));
    else if (!ordered) out.push(check("structure", "yellow", "Tuzilma", "Bo‘limlar skelet tartibida emas"));
    else out.push(check("structure", "green", "Tuzilma", `${sections.length} bo‘lim, skeletga mos`));
  }

  /* ── udk ── */
  if (profile.udk) {
    out.push(model.udk?.trim() ? check("udk", "green", "UDK", `UDK ${model.udk.trim()}`) : check("udk", "yellow", "UDK", "Profil UDK talab qiladi — ko‘rsatilmagan"));
  }

  /* ── abstracts: 3 til, so'z chegarasi ── */
  {
    const [minW, maxW] = profile.abstractWords;
    const have = new Map((doc.abstracts ?? []).map((a) => [langKey(a.lang), a]));
    const missing = (["uz", "ru", "en"] as const).filter((l) => !have.get(l)?.text.trim());
    const off = [...have.values()].map((a) => ({ lang: a.lang, n: words(a.text) })).filter((a) => a.n < minW || a.n > maxW);
    if (missing.length) out.push(check("abstracts", "red", "Annotatsiya ×3", `Yo‘q: ${missing.join(", ")}`, rewrite(`abstract:${missing[0]}`, `Write the ${missing[0]} abstract (${minW}–${maxW} words).`)));
    else if (off.length)
      out.push(
        check("abstracts", "yellow", "Annotatsiya ×3", `So‘z chegarasi ${minW}–${maxW}: ${off.map((a) => `${a.lang} ${a.n}`).join(", ")}`, rewrite(`abstract:${langKey(off[0].lang)}`, `Rewrite the abstract to ${minW}–${maxW} words, keeping aim, method, result and conclusion.`)),
      );
    else out.push(check("abstracts", "green", "Annotatsiya ×3", [...have.values()].map((a) => `${a.lang} ${words(a.text)}`).join(", ")));
  }

  /* ── keywords: 3 tilda, profil chegarasi ── */
  {
    const [minK, maxK] = profile.keywords;
    const count = (l: "uz" | "ru" | "en") => {
      const fromModel = model.keywords[l]?.filter(Boolean) ?? [];
      if (fromModel.length) return fromModel.length;
      const a = (doc.abstracts ?? []).find((x) => langKey(x.lang) === l);
      return a?.keywords ? a.keywords.split(/[,;]/).filter((k) => k.trim()).length : 0;
    };
    const counts = (["uz", "ru", "en"] as const).map((l) => ({ l, n: count(l) }));
    const missing = counts.filter((c) => !c.n).map((c) => c.l);
    const off = counts.filter((c) => c.n && (c.n < minK || c.n > maxK));
    if (missing.length) out.push(check("keywords", "red", "Kalit so‘zlar", `Yo‘q: ${missing.join(", ")}`, rewrite("keywords", `Provide ${minK}–${maxK} keywords in ${missing.join(", ")}.`)));
    else if (off.length) out.push(check("keywords", "yellow", "Kalit so‘zlar", `Chegara ${minK}–${maxK}: ${off.map((c) => `${c.l} ${c.n}`).join(", ")}`, rewrite("keywords", `Adjust the keyword list to ${minK}–${maxK} items per language.`)));
    else out.push(check("keywords", "green", "Kalit so‘zlar", counts.map((c) => `${c.l} ${c.n}`).join(", ")));
  }

  /* ── authors: F.I.Sh. + tashkilot; email/ORCID sariq ── */
  {
    const a = model.authors.filter((x) => x.name?.trim());
    if (!a.length) out.push(check("authors", "red", "Mualliflar", "Muallif ko‘rsatilmagan"));
    else if (a.some((x) => !x.org?.trim())) out.push(check("authors", "yellow", "Mualliflar", "Tashkilot ko‘rsatilmagan: " + a.filter((x) => !x.org?.trim()).map((x) => x.name).join(", ")));
    else if (a.some((x) => !x.email?.trim() || !x.orcid?.trim())) out.push(check("authors", "yellow", "Mualliflar", "Email yoki ORCID to‘liq emas (ko‘p jurnallar talab qiladi)"));
    else out.push(check("authors", "green", "Mualliflar", `${a.length} muallif, tashkilot/email/ORCID to‘liq`));
  }

  /* ── citations: matn ↔ ro'yxat 1:1 ── */
  const inText = new Set<string>();
  let citeCount = 0;
  {
    const known = new Set(model.references.map((r) => r.id));
    const re = /\[([^\[\]\n]{1,240})\]/g;
    const scan = (t: string) => {
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) for (const tok of m[1].split(";")) {
        const id = tok.trim();
        if (known.has(id)) {
          inText.add(id);
          citeCount++;
        }
      }
    };
    for (const s of sections) for (const b of s.blocks) if (b.kind !== "formula") scan(b.text);
    for (const t of doc.tables ?? []) {
      if (t.caption) scan(t.caption);
      for (const r of t.rows) for (const c of r) scan(c);
    }
    const unresolved = o.guard?.unresolved ?? [];
    const orphan = refs.filter((r) => !inText.has(r.id));
    if (unresolved.length) out.push(check("citations", "red", "Iqtibos ↔ ro‘yxat", `${unresolved.length} ta reyestrda yo‘q iqtibos o‘chirildi (${list([...new Set(unresolved.map((u) => u.sectionId))])}) — jumlalar manbasiz qoldi`));
    else if (!citeCount && profile.refsMin > 0) out.push(check("citations", "red", "Iqtibos ↔ ro‘yxat", "Matnda birorta iqtibos yo‘q"));
    else if (orphan.length) out.push(check("citations", "yellow", "Iqtibos ↔ ro‘yxat", `Ro‘yxatda bor, matnda yo‘q: ${list(orphan.map((r) => r.id))}`));
    else out.push(check("citations", "green", "Iqtibos ↔ ro‘yxat", `${citeCount} iqtibos, ${refs.length} manba — 1:1`));
  }

  /* ── verified ── */
  const verifiedShare = refs.length ? refs.filter((r) => r.verified !== "unverified").length / refs.length : 1;
  {
    const bad = refs.filter((r) => r.verified === "unverified");
    if (verifiedShare < 0.8) out.push(check("verified", "red", "Tasdiqlangan manbalar", `${pct(verifiedShare)} tasdiqlangan; tekshirilmagan: ${list(bad.map((r) => r.id))}`));
    else if (verifiedShare < 1) out.push(check("verified", "yellow", "Tasdiqlangan manbalar", `${pct(verifiedShare)} tasdiqlangan; tekshirilmagan: ${list(bad.map((r) => r.id))}`));
    else out.push(check("verified", "green", "Tasdiqlangan manbalar", refs.length ? "Barcha manbalar OpenAlex/Crossref yoki foydalanuvchidan" : "Manba yo‘q"));
  }

  /* ── refsCount ── */
  {
    const n = refs.length;
    const r = o.research;
    const src = r ? ` (qidiruv: ${r.found} topildi, ${r.selected} tanlandi${r.failedQueries ? `, ${r.failedQueries} so‘rov xato` : ""})` : "";
    if (n < profile.refsMin) out.push(check("refsCount", "red", "Manbalar soni", `${n} ta — profil kamida ${profile.refsMin} talab qiladi${src}`));
    else if (n > profile.refsMax) out.push(check("refsCount", "yellow", "Manbalar soni", `${n} ta — profil ko‘pi bilan ${profile.refsMax}`));
    else out.push(check("refsCount", "green", "Manbalar soni", `${n} ta (${profile.refsMin}–${profile.refsMax})${src}`));
  }

  /* ── recent: oxirgi N yil ulushi (yilsiz manba hisobga olinmaydi) ── */
  const dated = refs.filter((r) => Number.isInteger(r.year));
  const recentShare = dated.length ? dated.filter((r) => r.year! >= year - profile.recentYearsMin).length / dated.length : 0;
  {
    const need = profile.recentShare;
    const d = `oxirgi ${profile.recentYearsMin} yil: ${pct(recentShare)} (kerak ≥ ${pct(need)})`;
    if (!dated.length) out.push(check("recent", refs.length ? "yellow" : "green", "Manbalar yangiligi", refs.length ? "Manbalarda yil yo‘q" : "Manba yo‘q"));
    else if (recentShare >= need) out.push(check("recent", "green", "Manbalar yangiligi", d));
    else if (recentShare >= need / 2) out.push(check("recent", "yellow", "Manbalar yangiligi", d));
    else out.push(check("recent", "red", "Manbalar yangiligi", d));
  }

  /* ── doi (apa/ieee) ── */
  if (plan.cite === "apa7" || plan.cite === "ieee") {
    const noLink = refs.filter((r) => !r.doi && !r.url && !r.raw);
    out.push(noLink.length ? check("doi", "yellow", "DOI / URL", `DOI ham, URL ham yo‘q: ${list(noLink.map((r) => r.id))}`) : check("doi", "green", "DOI / URL", "Barcha manbalarda DOI yoki URL bor"));
  }

  /* ── visuals: har rasm/jadval matnda havola qilinganmi; fallback ── */
  {
    const v = visualCoverage(doc);
    const problems = v.unreferenced.map((x) => x.label);
    const { fallback, count } = v;
    if (problems.length) out.push(check("visuals", "yellow", "Vizuallar", `Matnda havola yo‘q: ${list(problems)}`));
    else if (fallback) out.push(check("visuals", "yellow", "Vizuallar", `${fallback} ta sxema chizilmadi — ro‘yxat sifatida qoldi`));
    else if (!count && doc.meta.figureCount > 0) out.push(check("visuals", "yellow", "Vizuallar", `${doc.meta.figureCount} ta sxema so‘ralgan, bittasi ham yo‘q`));
    else out.push(check("visuals", "green", "Vizuallar", count ? `${count} ta vizual, hammasi matnda havola qilingan` : "Vizual yo‘q"));
  }

  /* ── guard qayta: manbasiz raqamlar, suv, per-bo'lim ── */
  const perSection = sections.map((s) => ({ s, r: guardSection(s.blocks, { refs: model.references, userFacts: model.userFacts }).report }));
  {
    const unsourced = perSection.flatMap((x) => x.r.unsourcedNumbers);
    const worst = [...perSection].sort((a, b) => b.r.unsourcedNumbers.length - a.r.unsourcedNumbers.length)[0];
    out.push(
      unsourced.length
        ? check("unsourcedNumbers", "red", "Manbasiz raqamlar", `Iqtibossiz va foydalanuvchi faktida yo‘q foizlar: ${list([...new Set(unsourced)])}`, rewrite(worst.s.id, "Remove or attribute every percentage that has no cited source or user fact; describe qualitatively instead."))
        : check("unsourcedNumbers", "green", "Manbasiz raqamlar", "Barcha foizlar manbali yoki foydalanuvchi faktidan"),
    );
  }
  {
    const missing = missingFactNumbers(sections, model.userFacts);
    if (!model.userFacts?.trim()) out.push(check("userFacts", "green", "Foydalanuvchi faktlari", "Fakt berilmagan"));
    else if (missing.length) {
      const target = sections.find((s) => /result|natija|analysis|findings/i.test(s.id)) ?? sections[0];
      out.push(check("userFacts", "yellow", "Foydalanuvchi faktlari", `Matnda uchramagan raqamlar: ${list(missing)}`, rewrite(target.id, `Include the user's own figures verbatim: ${missing.slice(0, 6).join(", ")}.`)));
    } else out.push(check("userFacts", "green", "Foydalanuvchi faktlari", "Barcha foydalanuvchi raqamlari matnda"));
  }
  {
    const filler = perSection.flatMap((x) => x.r.filler);
    const worst = [...perSection].sort((a, b) => b.r.filler.length - a.r.filler.length)[0];
    const d = `${filler.length} ta: ${list([...new Set(filler)])}`;
    if (filler.length > 3) out.push(check("filler", "red", "«Suv» iboralar", d, rewrite(worst.s.id, "Remove filler phrases (e.g. “bugungi kunda”, “ma’lumki”) and make every sentence carry a specific claim.")));
    else if (filler.length) out.push(check("filler", "yellow", "«Suv» iboralar", d, rewrite(worst.s.id, "Remove filler phrases and make every sentence carry a specific claim.")));
    else out.push(check("filler", "green", "«Suv» iboralar", "Topilmadi"));
  }

  /* ── repetition: 3-gram Jaccard ── */
  {
    const big = sections.filter((s) => words(sectionText(s)) >= 30).map((s) => ({ s, g: trigrams(sectionText(s)) }));
    let worst: { a: DocSection; b: DocSection; j: number } | null = null;
    for (let i = 0; i < big.length; i++)
      for (let k = i + 1; k < big.length; k++) {
        const j = jaccard(big[i].g, big[k].g);
        if (j > REPETITION_JACCARD && (!worst || j > worst.j)) worst = { a: big[i].s, b: big[k].s, j };
      }
    out.push(
      worst
        ? check("repetition", "yellow", "Bo‘limlar takrori", `«${worst.a.title}» ↔ «${worst.b.title}»: ${pct(worst.j)} umumiy 3-gram`, rewrite(worst.b.id, `Rewrite so it does not repeat sentences from “${worst.a.title}”; add new content specific to this section.`))
        : check("repetition", "green", "Bo‘limlar takrori", "Bo‘limlar bir-birini takrorlamaydi"),
    );
  }

  /* ── length ── */
  {
    const body = sections.reduce((n, s) => n + wordsOf(s.blocks), 0);
    if (type.wordRange) {
      const [lo, hi] = type.wordRange;
      const d = `${body} so‘z (kerak ${lo}–${hi})`;
      const target = sections[0]?.id ?? "body";
      if (body >= lo && body <= hi) out.push(check("length", "green", "Hajm", d));
      else if (body >= lo * (1 - LENGTH_TOLERANCE) && body <= hi * (1 + LENGTH_TOLERANCE)) out.push(check("length", "yellow", "Hajm", d, rewrite(target, `Adjust the text to ${lo}–${hi} words.`)));
      else out.push(check("length", "red", "Hajm", d, rewrite(target, `Rewrite the text to ${lo}–${hi} words.`)));
    } else {
      /*
       * Faqat BO'LIM matni: annotatsiyalar alohida qoida (`abstracts`) bilan
       * o'lchanadi, dvigatel rejasi (`articleWordPlan.body`) ham bo'lim
       * matniga tegishli. Ilgari annotatsiya qo'shib sanalgani uchun mos
       * hajmli maqola «153%» deb qizil chiqardi.
       */
      const t = Math.max(1, o.wordTarget);
      const ratio = body / t;
      const d = `${body} so‘z (maqsad ≈${t}, ${pct(ratio)})`;
      if (Math.abs(ratio - 1) <= LENGTH_TOLERANCE) out.push(check("length", "green", "Hajm", d));
      else if (Math.abs(ratio - 1) <= LENGTH_TOLERANCE * 2) out.push(check("length", "yellow", "Hajm", d));
      else out.push(check("length", "red", "Hajm", d));
    }
  }

  /* ── prisma ── */
  if (type.requiresPrisma) {
    const prisma = model.figures.find((f) => f.spec.kind === "prisma");
    const placed = prisma && sections.some((s) => s.blocks.some((b) => b.kind === "figure" && b.figureId === prisma.id));
    out.push(placed ? check("prisma", "green", "PRISMA diagrammasi", prisma!.fallbackBlocks?.length ? "Ro‘yxat sifatida (chizilmadi)" : "Natijalar bo‘limida") : check("prisma", "red", "PRISMA diagrammasi", "Sistematik sharhda PRISMA oqim diagrammasi majburiy — yo‘q"));
  }

  /* ── highlights (elsevier) ── */
  if (type.highlights) {
    const h = model.highlights ?? [];
    const { min, max, maxChars } = type.highlights;
    const long = h.filter((x) => x.length > maxChars);
    if (!h.length) out.push(check("highlights", "red", "Highlights", `${min}–${max} ta, har biri ≤${maxChars} belgi — yo‘q`, rewrite("highlights", `Write ${min}–${max} highlights, each at most ${maxChars} characters.`)));
    else if (h.length < min || h.length > max || long.length) out.push(check("highlights", "yellow", "Highlights", `${h.length} ta${long.length ? `, ${long.length} tasi ${maxChars} belgidan uzun` : ""} (kerak ${min}–${max} × ≤${maxChars})`, rewrite("highlights", `Provide ${min}–${max} highlights, each at most ${maxChars} characters.`)));
    else out.push(check("highlights", "green", "Highlights", `${h.length} ta, har biri ≤${maxChars} belgi`));
  }

  /* ── pageLimit: profil bet chegarasi (universitet ≤ 15, konferensiya ≤ 5) — AUDIT-18 Q-8 ── */
  if (profile.maxPages) {
    const est = estimateDocPages(doc, type, profile);
    const longest = [...sections].sort((a, b) => wordsOf(b.blocks) - wordsOf(a.blocks))[0];
    const over = est > profile.maxPages;
    out.push(
      over
        ? check(
            "pageLimit",
            est > profile.maxPages * 1.2 ? "red" : "yellow",
            "Bet chegarasi",
            `Taxminan ${Math.round(est)} bet — profil ko‘pi bilan ${profile.maxPages} talab qiladi`,
            longest ? rewrite(longest.id, `Shorten this section by about ${Math.min(50, Math.round(((est - profile.maxPages) / est) * 100) + 10)}% — remove redundancy, keep every fact and citation.`) : undefined,
          )
        : check("pageLimit", "green", "Bet chegarasi", `Taxminan ${Math.round(est)} bet (≤ ${profile.maxPages})`),
    );
  }

  /* ── limitations ── */
  {
    const tail = sections.filter((s) => /^(discussion|conclusion|synthesis|future|outcome|evaluation)/.test(s.id));
    const has = tail.some((s) => LIMITATION_RE.test(sectionText(s)));
    const target = tail.find((s) => s.id.startsWith("discussion")) ?? tail[0] ?? sections[sections.length - 1];
    out.push(
      has
        ? check("limitations", "green", "Cheklovlar", "Muhokama/xulosada tadqiqot cheklovlari aytilgan")
        : check("limitations", "yellow", "Cheklovlar", "Tadqiqot cheklovlari (limitations) aytilmagan", target ? rewrite(target.id, "Add a short paragraph on the study's limitations (sample, method, generalizability).") : undefined),
    );
  }

  return { checks: out, verifiedShare, recentShare };
}

/* ────────────────────────── baholovchi ────────────────────────── */

/** Standart mezon ta'riflari — tur `judge.describe` bilan ustidan yozadi. */
export const JUDGE_DESCRIBE: Record<JudgeCriterion, string> = {
  novelty: "the contribution is stated explicitly and is specific (not generic).",
  chain: "aim ↔ results ↔ conclusion are consistent — the conclusion answers the stated aim and the results support it.",
  methods: "the methods are described so the study could be reproduced (sample, procedure, tools, analysis).",
  comparison: "the discussion compares the findings with at least 3 cited sources.",
  overclaim: "conclusions do NOT exceed what the results show (3 = no overclaiming).",
  style: "academic style — precise, no filler phrases, varied sentence rhythm, consistent terminology.",
};

/** Tur uchun baholanadigan mezonlar (`skip` chiqarilgan). */
export function judgeCriteriaFor(judge?: ArticleJudgeConfig): JudgeCriterion[] {
  const skip = new Set(judge?.skip ?? []);
  return JUDGE_CRITERIA.filter((c) => !skip.has(c));
}

/** Maqola turining baholovchi spetsifikatsiyasi (neytral qatlam shakli). */
export function articleJudgeSpec(judge?: ArticleJudgeConfig, typeLabel?: string): JudgeSpec<JudgeCriterion> {
  return {
    criteria: JUDGE_CRITERIA,
    describe: { ...JUDGE_DESCRIBE, ...(judge?.describe ?? {}) },
    labels: JUDGE_LABELS,
    ...(judge?.skip?.length ? { skip: judge.skip } : {}),
    ...(typeLabel ? { typeLabel } : {}),
  };
}

/**
 * Baholovchi tizim prompti — TURGA bog'liq (AUDIT-18 Q-7): sharh maqolasi
 * «metodlar» bo'yicha IMRAD kabi baholanib adolatsiz qizil olardi; tur
 * `describe` bilan mezonni o'z ma'nosida beradi, `skip` bilan chiqaradi.
 */
export function judgeSystemPrompt(sectionIds: string[], judge?: ArticleJudgeConfig, typeLabel?: string): string {
  return judgeSystemPromptFor(articleJudgeSpec(judge, typeLabel), sectionIds);
}

/**
 * Baholovchiga beriladigan matn: sarlavha, tur/profil, hujjat tilidagi
 * annotatsiya, bo'limlar (jami ≤ `JUDGE_TEXT_CHARS`, har bo'lim o'z
 * ulushida OXIRIDAN kesiladi — xulosa ham ko'rinadi), manbalar ro'yxati.
 */
export function judgeUserPrompt(doc: AcademicDoc, maxChars = JUDGE_TEXT_CHARS): string {
  const plan = planArticle(doc);
  const lang = plan.language;
  const abs = (doc.abstracts ?? []).find((a) => langKey(a.lang) === langKey(lang)) ?? doc.abstracts?.[0];
  /*
   * Matn REJADAN olinadi (`plan.body`): iqtiboslar «[1]»/«(Lin, 2023)»
   * ko'rinishida — quyidagi ro'yxat raqamlari bilan mos; xom `[W…]` id
   * lari baholovchini chalg'itardi. Rasm/jadval o'rnida sarlavhasi.
   */
  const groups: { id: string; title: string; lines: string[] }[] = [];
  for (const it of plan.body) {
    if (it.k === "h1" && it.sectionId) groups.push({ id: it.sectionId, title: it.title, lines: [] });
    else if (groups.length) {
      const g = groups[groups.length - 1];
      if (it.k === "p" || it.k === "li" || it.k === "quote") g.lines.push(it.text);
      else if (it.k === "h2" || it.k === "h3") g.lines.push(`### ${it.text}`);
      else if (it.k === "figure" || it.k === "table") g.lines.push(`[${it.caption}]`);
    }
  }
  const body = sampleForJudge(groups, maxChars)
    .map((g) => `## ${g.id} — ${g.title}\n${g.text}${g.truncated ? "\n[…truncated]" : ""}`)
    .join("\n\n");
  const refs = plan.refs.map((r) => `${r.n}. ${formatReference(r.ref, plan.cite, lang)}`).join("\n");
  return [
    `TITLE: ${doc.meta.topic}`,
    `TYPE: ${plan.type.id} · PROFILE: ${plan.profile.id} · LANGUAGE: ${lang}`,
    abs ? `ABSTRACT (${abs.lang}): ${abs.text}` : "ABSTRACT: (missing)",
    "",
    "SECTIONS:",
    body,
    "",
    `REFERENCES (${plan.refs.length}):`,
    refs || "(none)",
  ].join("\n");
}

/** Bo'lim id laridan tashqari ruxsat etilgan `fix` nishonlari. */
const EXTRA_TARGETS = ["keywords", "highlights", "abstract:uz", "abstract:ru", "abstract:en"];

/** Model javobi → `JudgeResult`; JSON emas → null. Noma'lum `target` tashlanadi. */
export function parseJudge(raw: string | null | undefined, sectionIds: string[], judgeCfg?: ArticleJudgeConfig): JudgeResult | null {
  return parseJudgeFor(articleJudgeSpec(judgeCfg), raw, sectionIds, EXTRA_TARGETS);
}

export function neutralJudge(): JudgeResult {
  return neutralJudgeFor(articleJudgeSpec());
}

/** Baholovchi mezonlari → `ReviewCheck` (3 yashil, 2 sariq, ≤1 qizil) + tavsiyalar. */
export function judgeChecks(j: JudgeResult): ReviewCheck[] {
  return judgeChecksFor(articleJudgeSpec(), j);
}

/* ────────────────────────── ball ────────────────────────── */

/** 60% qoidalar (yashil 1 / sariq 0.5 / qizil 0) + 40% baholovchi (6 × 3). */
export function scoreReview(rules: ReviewCheck[], judge: JudgeResult): number {
  return scoreReviewFor(rules, judge, JUDGE_CRITERIA);
}

/* ────────────────────────── asosiy ────────────────────────── */

export async function reviewArticle(doc: AcademicDoc, opts: ReviewOpts = {}): Promise<ArticleReview> {
  const now = opts.now ?? new Date();
  let wordTarget = opts.wordTarget;
  if (!wordTarget) {
    // Dvigatel bermagan (tahrirdan keyingi qayta hisobot) — formula dvigatelda, sikl bo'lmasin deb dinamik.
    const { articleWordPlan } = await import("./engine");
    const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
    const profile = PUBLICATION_PROFILES[doc.article?.profile ?? type.defaultProfile];
    wordTarget = articleWordPlan(doc.meta, type, profile).body;
  }
  const rules = ruleChecks(doc, { guard: opts.guard, research: opts.research, wordTarget, now });

  let judge: JudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      const ids = doc.sections.filter((s) => s.blocks.length).map((s) => s.id);
      const type = ARTICLE_TYPES[doc.article?.type ?? "imrad_oak"];
      try {
        const r = await opts.complete("judge", judgeSystemPrompt(ids, type.judge, type.label.en), judgeUserPrompt(doc), { json: true, maxTokens: 1500, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseJudge(r?.text, ids, type.judge);
      } catch (e) {
        console.warn("[article] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }
  const j = judge ?? neutralJudge();
  judgeNotes.push(...j.notes);

  return {
    score: scoreReview(rules.checks, j),
    checks: [...rules.checks, ...judgeChecks(j)],
    judgeNotes,
    verifiedShare: Math.round(rules.verifiedShare * 100) / 100,
    recentShare: Math.round(rules.recentShare * 100) / 100,
    builtAt: now.toISOString(),
  };
}
