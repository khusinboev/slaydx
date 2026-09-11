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
import type { AcademicDoc, Block, DocSection } from "../types";
import type { ArticleReview, ArticleType, PublicationProfile, ReviewCheck, ReviewLevel } from "./types";
import { ARTICLE_TYPES } from "./types-registry";
import { PUBLICATION_PROFILES } from "./profiles";
import { articleLabels } from "./labels";
import { planArticle } from "./layout";
import { guardSection, missingFactNumbers, skeletonCoverage, wordsOf } from "./guard";
import { formatReference } from "../cite";
import { languageDirective } from "../i18n";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import type { LlmUsage, complete as completeRole } from "../llm-roles";
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

export const JUDGE_CRITERIA = ["novelty", "chain", "methods", "comparison", "overclaim", "style"] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

export type JudgeResult = Record<JudgeCriterion, number> & {
  notes: string[];
  fixes: { target: string; instruction: string }[];
};

/** Baholovchi javob bermaganda — neytral. */
export const JUDGE_NEUTRAL = 2;
export const JUDGE_TIMEOUT_MS = 35_000;
/** Chaqiruvga shundan kam vaqt qolsa umuman urinilmaydi. */
const JUDGE_MIN_MS = 8_000;
/** Bo'limlar matni baholovchiga shu belgidan oshmaydi (bo'limlar orasida mutanosib). */
export const JUDGE_TEXT_CHARS = 25_000;
/** Bo'limlar o'zaro takror deb hisoblanadigan 3-gram Jaccard chegarasi. */
export const REPETITION_JACCARD = 0.15;
/** Hajm chegarasi: maqsaddan ±20% — yashil. */
export const LENGTH_TOLERANCE = 0.2;

export const RULE_WEIGHT = 0.6;
export const JUDGE_WEIGHT = 0.4;

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

function textBlocks(s: DocSection): Extract<Block, { kind: "p" | "li" | "quote" }>[] {
  return s.blocks.filter((b): b is Extract<Block, { kind: "p" | "li" | "quote" }> => b.kind === "p" || b.kind === "li" || b.kind === "quote");
}

function sectionText(s: DocSection): string {
  return textBlocks(s)
    .map((b) => b.text)
    .join("\n");
}

/** Skelet id → bo'lim (erkin `body-N` ham `body` ga mos). */
function skeletonIdOf(sectionId: string): string {
  return sectionId.replace(/-\d+$/, "");
}

const check = (id: string, level: ReviewLevel, label: string, detail?: string, fix?: ReviewCheck["fix"]): ReviewCheck => ({
  id,
  level,
  label,
  ...(detail ? { detail } : {}),
  ...(fix ? { fix } : {}),
});

const rewrite = (target: string, instruction: string): ReviewCheck["fix"] => ({ op: "rewrite", target, instruction });

const list = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** So'zlar → 3-gramlar to'plami (kichik harf, faqat harf/raqam). */
export function trigrams(text: string): Set<string> {
  const w = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ────────────────────────── qoidalar ────────────────────────── */

export type RuleResult = { checks: ReviewCheck[]; verifiedShare: number; recentShare: number };

const LIMITATION_RE = /cheklov|chegaralan|limitation|limited|ограничен|недостат/iu;
const VISUAL_WORDS: Record<"uz" | "ru" | "en", { fig: RegExp; tab: RegExp }> = {
  uz: { fig: /\b(rasm|sxema|diagramma|chizma|grafik)/iu, tab: /\bjadval/iu },
  ru: { fig: /\b(рис|схем|диаграмм|график)/iu, tab: /\bтабл/iu },
  en: { fig: /\b(figure|fig\.|scheme|diagram|chart)/iu, tab: /\btable/iu },
};

function langKey(lang: string): "uz" | "ru" | "en" {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
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
    const VW = VISUAL_WORDS[langKey(lang)];
    const allText = sections.map(sectionText).join("\n");
    const problems: string[] = [];
    let fallback = 0;
    let count = 0;
    const figs = new Map(model.figures.map((f) => [f.id, f]));
    for (const s of sections) {
      const st = sectionText(s);
      for (const b of s.blocks) {
        if (b.kind === "figure") {
          const f = figs.get(b.figureId);
          if (f?.fallbackBlocks?.length) {
            fallback++;
            continue;
          }
          count++;
          const n = plan.numbers.figures[b.figureId];
          const explicit = allText.includes(`[fig:${b.figureId}]`) || (n && allText.toLowerCase().includes(L.figureRef(n).toLowerCase()));
          if (!explicit && !VW.fig.test(st)) problems.push(n ? L.figureRef(n) : b.figureId);
        } else if (b.kind === "tableRef") {
          count++;
          const n = plan.numbers.tables[b.tableId];
          const explicit = allText.includes(`[tab:${b.tableId}]`) || (n && allText.toLowerCase().includes(L.tableRef(n).toLowerCase()));
          if (!explicit && !VW.tab.test(st)) problems.push(n ? L.tableRef(n) : b.tableId);
        }
      }
    }
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

export function judgeSystemPrompt(sectionIds: string[]): string {
  return [
    "You are a strict peer reviewer for an academic journal. Evaluate the manuscript and return ONLY a JSON object, no prose.",
    "Score each criterion with an INTEGER 0–3 (3 = fully meets, 2 = mostly, 1 = weak, 0 = absent):",
    "- novelty: the contribution is stated explicitly and is specific (not generic).",
    "- chain: aim ↔ results ↔ conclusion are consistent — the conclusion answers the stated aim and the results support it.",
    "- methods: the methods are described so the study could be reproduced (sample, procedure, tools, analysis).",
    "- comparison: the discussion compares the findings with at least 3 cited sources.",
    "- overclaim: conclusions do NOT exceed what the results show (3 = no overclaiming).",
    "- style: academic style — precise, no filler phrases, varied sentence rhythm, consistent terminology.",
    "Then give up to 5 short, concrete notes (what exactly to improve, naming the section) and up to 5 fixes as {\"target\": <section id>, \"instruction\": <one-sentence rewrite instruction>}.",
    `Allowed target ids: ${sectionIds.join(", ")}.`,
    'JSON schema: {"novelty":0-3,"chain":0-3,"methods":0-3,"comparison":0-3,"overclaim":0-3,"style":0-3,"notes":["…"],"fixes":[{"target":"…","instruction":"…"}]}',
    "JSON keys and target ids stay exactly as given (English); the VALUES of notes and instruction follow the language rule below.",
    languageDirective("uz"),
  ].join("\n");
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
  const texts = groups.map((g) => g.lines.join("\n"));
  const total = texts.reduce((n, t) => n + t.length, 0);
  const scale = total > maxChars ? maxChars / total : 1;
  const body = groups
    .map((g, i) => {
      const t = texts[i];
      const cut = scale < 1 ? t.slice(0, Math.max(200, Math.floor(t.length * scale))) : t;
      return `## ${g.id} — ${g.title}\n${cut}${cut.length < t.length ? "\n[…truncated]" : ""}`;
    })
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

const clampScore = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : JUDGE_NEUTRAL;
};

/** Model javobi → `JudgeResult`; JSON emas → null. Noma'lum `target` tashlanadi. */
export function parseJudge(raw: string | null | undefined, sectionIds: string[]): JudgeResult | null {
  const j = parseLlmObject<Record<string, unknown>>(raw ?? "");
  if (!j) return null;
  const allowed = new Set([...sectionIds, "keywords", "highlights", "abstract:uz", "abstract:ru", "abstract:en"]);
  const notes = (Array.isArray(j.notes) ? j.notes : [])
    .map((n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);
  const fixes = (Array.isArray(j.fixes) ? j.fixes : [])
    .map((f) => {
      const o = f as { target?: unknown; instruction?: unknown } | null;
      const target = String(o?.target ?? "").trim();
      const instruction = String(o?.instruction ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      return allowed.has(target) && instruction ? { target, instruction } : null;
    })
    .filter((f): f is { target: string; instruction: string } => Boolean(f))
    .slice(0, 5);
  const scores = Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, clampScore(j[c])])) as Record<JudgeCriterion, number>;
  return { ...scores, notes, fixes };
}

export function neutralJudge(): JudgeResult {
  return { ...(Object.fromEntries(JUDGE_CRITERIA.map((c) => [c, JUDGE_NEUTRAL])) as Record<JudgeCriterion, number>), notes: [], fixes: [] };
}

/** Baholovchi mezonlari → `ReviewCheck` (3 yashil, 2 sariq, ≤1 qizil) + tavsiyalar. */
export function judgeChecks(j: JudgeResult): ReviewCheck[] {
  const out: ReviewCheck[] = JUDGE_CRITERIA.map((c) => check(`judge:${c}`, j[c] >= 3 ? "green" : j[c] === 2 ? "yellow" : "red", JUDGE_LABELS[c], `${j[c]}/3`));
  j.fixes.forEach((f, i) => out.push(check(`judge:fix:${i + 1}`, "yellow", "Baholovchi tavsiyasi", `${f.target}: ${f.instruction}`, rewrite(f.target, f.instruction))));
  return out;
}

/* ────────────────────────── ball ────────────────────────── */

const LEVEL_SCORE: Record<ReviewLevel, number> = { green: 1, yellow: 0.5, red: 0 };

/** 60% qoidalar (yashil 1 / sariq 0.5 / qizil 0) + 40% baholovchi (6 × 3). */
export function scoreReview(rules: ReviewCheck[], judge: JudgeResult): number {
  const r = rules.length ? rules.reduce((n, c) => n + LEVEL_SCORE[c.level], 0) / rules.length : 1;
  const j = JUDGE_CRITERIA.reduce((n, c) => n + judge[c], 0) / (JUDGE_CRITERIA.length * 3);
  return Math.max(0, Math.min(100, Math.round(100 * (RULE_WEIGHT * r + JUDGE_WEIGHT * j))));
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
      try {
        const r = await opts.complete("judge", judgeSystemPrompt(ids), judgeUserPrompt(doc), { json: true, maxTokens: 1500, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseJudge(r?.text, ids);
      } catch (e) {
        console.warn("[article] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push("Baholovchi javob bermadi");
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
