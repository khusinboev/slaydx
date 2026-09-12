/**
 * So'z va bet rejasi (Maqola 2, AUDIT-17) — IZOMORF: dvigatel (`engine.ts`),
 * hisobot (`review.ts`), «Tuzatish» (`article-rewrite.ts`) va FORMA
 * (`ArticleComposer` — «taxminan N bet» ko'rsatmasi) bitta formuladan
 * o'qiydi. Bu faylga server/og'ir modullar (sharp, LLM) import qilinmaydi.
 */
import { targetWords } from "../quality";
import type { AcademicDoc, DocMeta } from "../types";
import type { ArticleType, ArticleWordPlan, PagesId, PublicationProfile } from "./types";

/**
 * Bir betga so'z — PROFILGA qarab. `WORDS_PER_PAGE` (230) TNR 14 / 1.5
 * uchun o'lchangan; TNR 12 yakka intervalda bir betga ~1.7 marta ko'p
 * so'z sig'adi. Sahifa darvozasi RENDERLANGAN sahifani sanaydi — so'z
 * maqsadi profilga ergashmasa IEEE maqolasi «10–15 bet» uchun 7 bet
 * chiqib, darvozadan yiqilardi.
 */
export function articleWordsPerPage(profile: PublicationProfile): number {
  return Math.round(targetWords(1) * (14 / profile.sizePt) * (1.5 / profile.line));
}

/**
 * So'z rejasi. Paket («3–5 bet») — hujjatning UMUMIY beti: sarlavha bloki,
 * uch tilli annotatsiya, adabiyotlar (OAK'da ikki ro'yxat), sxemalar va
 * jadval ham shu betlarga kiradi. Bo'lim matni byudjeti = paket beti −
 * qo'shimcha betlar; bo'lim matni paketning kamida 45 %.
 *
 * Koeffitsientlar jonli o'lchovdan (analytical, OAK, 3–5 bet, DOCX →
 * LibreOffice, `lineRule: auto` bilan — ya'ni Word'dagi haqiqiy 1,5
 * qator): sarlavha bloki 0,3 bet; har bo'lim sarlavhasi 0,06; annotatsiya
 * `size − 2` shriftda — zichlik = (size/12)·(line/abstractLine)·1,15 (OAK:
 * 14/12 · 1,5/1,15 · 1,15 ≈ 1,8); adabiyot satri 0,065 bet × ro'yxat soni
 * (TNR 12/1,15, ≈16 manba/bet); sxema 0,45 bet (160 mm eni, sarlavha
 * bilan); jadval 0,25 (3+ betda). OAK'da apparatura (3 annotatsiya + 2
 * ro'yxat × 10 manba + sxema + jadval) o'zi ≈ 4 bet — 3–5 betlik paket
 * bo'lim matni 45 % poliga tushadi va hujjat ~6 bet chiqadi.
 * Kichik paketda annotatsiya pastki chegaraga yaqin mo'ljallanadi (150–250
 * → 170), katta paketda o'rtaga. Sxema soni `FIGURES_BY_PAGES` bilan
 * kesilgan bo'ladi (forma va `parseArticleInput`).
 *
 * Jonli smoke tarixi (3–5 bet): eski formula 924 so'z/9 bet; birinchi
 * tuzatish 421 so'z/6 bet (annotatsiya 1,5 intervalda, 2 sxema).
 */
export function articleWordPlan(meta: DocMeta, type: ArticleType, profile: PublicationProfile): ArticleWordPlan {
  const perPage = articleWordsPerPage(profile);
  // `targetPages` yo'q (namunaviy/eski meta) — standart paket 3–5 (4), NaN maqsad chiqmasin.
  const pages = Math.max(1, Number.isFinite(meta.targetPages) ? meta.targetPages : 4);
  const [minW, maxW] = profile.abstractWords;
  const abstractAim = pages <= 5 ? Math.round(minW + (maxW - minW) * 0.2) : Math.round((minW + maxW) / 2);
  const abstracts = 3 * abstractAim;
  const figures = Math.max(0, meta.figureCount);
  if (type.wordRange) {
    const body = Math.round((type.wordRange[0] + type.wordRange[1]) / 2);
    return { perPage, total: body + abstracts, body, abstracts, abstractAim, refs: profile.refsMin, figures };
  }
  const refs = Math.min(profile.refsMax, Math.max(profile.refsMin, Math.round(pages * 2.5)));
  const overhead = articleOverheadPages({ perPage, abstracts, refs, figures }, type, profile, pages);
  const bodyPages = Math.max(pages * BODY_FLOOR, pages - overhead);
  const body = Math.max(300, Math.round(bodyPages * perPage));
  return { perPage, total: body + abstracts, body, abstracts, abstractAim, refs, figures };
}

/** Bo'lim matni paketning kamida shu ulushi — apparatura qancha bo'lmasin. */
export const BODY_FLOOR = 0.45;

/**
 * Apparatura beti (sarlavha bloki, bo'lim sarlavhalari, annotatsiya ×3,
 * adabiyotlar × ro'yxat soni, sxemalar, jadval) — `articleWordPlan` va
 * `estimateArticlePages` uchun BITTA formula.
 */
export function articleOverheadPages(
  plan: Pick<ArticleWordPlan, "perPage" | "abstracts" | "refs" | "figures">,
  type: ArticleType,
  profile: PublicationProfile,
  pages: number,
): number {
  const absDensity = (profile.sizePt / 12) * (profile.line / profile.abstractLine) * 1.15;
  return (
    0.3 +
    type.skeleton.length * 0.06 +
    plan.abstracts / (plan.perPage * absDensity) +
    plan.refs * 0.065 * (profile.secondEnglishList ? 2 : 1) +
    plan.figures * 0.45 +
    (pages >= 3 ? 0.25 : 0)
  );
}


/**
 * Hujjatning TAXMINIY umumiy beti — forma ko'rsatmasi uchun. Bo'lim matni
 * paketning 45 % idan pastga tushmaydi; apparatura paketdan katta bo'lsa
 * hujjat paketdan oshadi (OAK 3–5 bet → ~6). Formula `articleWordPlan` niki.
 */
export function estimateArticlePages(pages: PagesId, type: ArticleType, profile: PublicationProfile, figureCount: number): number {
  const m = /^(\d+)-(\d+)$/.exec(pages);
  const targetPages = m ? Math.round((Number(m[1]) + Number(m[2])) / 2) : 4;
  const plan = articleWordPlan({ targetPages, figureCount } as DocMeta, type, profile);
  if (type.wordRange) return Math.max(1, Math.ceil(plan.total / plan.perPage));
  return Math.max(1, Math.round(plan.body / plan.perPage + articleOverheadPages(plan, type, profile, targetPages)));
}

/** Paket yorlig'ining yuqori chegarasi («3-5» → 5). */
export function pagesUpper(pages: PagesId): number {
  const m = /-(\d+)$/.exec(pages);
  return m ? Number(m[1]) : 0;
}

/**
 * TAYYOR hujjatning taxminiy beti (hisobot `pageLimit` bandi uchun):
 * bo'lim so'zi / perPage + apparatura (haqiqiy annotatsiya so'zi, iqtibos
 * qilingan manba soni, sxema soni). Formula `articleOverheadPages` niki.
 */
export function estimateDocPages(doc: AcademicDoc, type: ArticleType, profile: PublicationProfile): number {
  const wc = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  const perPage = articleWordsPerPage(profile);
  let body = 0;
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === "p" || b.kind === "li" || b.kind === "quote") body += wc(b.text);
  const abstracts = (doc.abstracts ?? []).reduce((n, a) => n + wc(a.text), 0);
  const refs = doc.article ? doc.article.references.filter((r) => r.cited).length : (doc.references?.length ?? 0);
  const figures = doc.article?.figures.length ?? 0;
  const targetPages = Number.isFinite(doc.meta.targetPages) ? doc.meta.targetPages : 4;
  return body / perPage + articleOverheadPages({ perPage, abstracts, refs, figures }, type, profile, targetPages);
}
