/**
 * SLIDE VOICE (docs/slide-quality/SPEC.md §C) — who is «speaking» on the slides.
 *
 * Owner's complaint: «slaydlar domla yasagandek, talaba tilida emas». The writer prompt had a single role line
 * («Siz professional taqdimot muallifisiz») and no register rule, so the model fell back to the methodical-document
 * register: «…amalga oshiriladi», «…muhim ahamiyat kasb etadi», speaker notes opening with «Hurmatli talabalar,
 * bugungi ma'ruzamizda…» — a lecturer's voice on a student's deck.
 *
 * Two voices, by the RESOLVED audience (`audienceRules` with the deck's template — «auto» on a lecture deck is
 * bachelor students):
 *   student      — pupils, students, course participants, mixed/general public: a good student presenting in
 *                  own words — short active sentences, concrete examples, terms explained, no officialese;
 *   professional — educators, management, employees: a professional, businesslike register (still no slogans).
 *
 * Plus a cheap deterministic officialese detector (`officialeseHits`) that feeds the EXISTING single repair call
 * (`repairThinSlides`) — no second LLM round. Pure, client-safe.
 */
import { normalizeAudienceId, type SlideAudience } from "./slide-audience";
import type { SlideTemplateId } from "./slide-templates";
import type { SlideModel } from "./slide-types";

export type SlideVoice = "student" | "professional";

const PROFESSIONAL: ReadonlySet<SlideAudience> = new Set(["educators", "management", "employees"]);

/** Voice of a deck. «auto» audience follows the template rule of `audienceRules` (none of them is professional). */
export function slideVoice(audience: string | undefined, tplId: SlideTemplateId): SlideVoice {
  void tplId;
  const id = normalizeAudienceId(audience);
  return id !== "auto" && PROFESSIONAL.has(id) ? "professional" : "student";
}

/** Prompt lines of the voice — compact on purpose (the system prompt is long already; text limits are unchanged). */
export function voiceLines(voice: SlideVoice): string[] {
  if (voice === "professional") {
    return [
      `Siz shu soha mutaxassisisiz: hamkasblar yoki rahbariyat oldida taqdimot qilasiz.`,
      `USLUB — rasmiy-ishchan, lekin jonli: har da’vo ortida fakt yoki misol; «muhim ahamiyat kasb etadi», «ta’kidlash joizki» kabi bo‘sh ibora va shior yozmang.`,
    ];
  }
  return [
    `Siz bu taqdimotni o‘zi tayyorlab, o‘zi gapirib beradigan a’lochi talaba (o‘quvchi)siz — domla yoki metodik qo‘llanma emas.`,
    `USLUB: o‘z so‘zingiz bilan, tabiiy va savodli o‘zbek tilida; qisqa, faol gaplar (kim nima qiladi); har fikrga hayotdan aniq misol, son yoki taqqoslash (o‘rinli bo‘lsa O‘zbekistondan); yangi atamani birinchi ishlatganda oddiy so‘z bilan tushuntiring.`,
    `Sarlavha — darslik bobi nomi emas, ma’noli fikr yoki savol: «Barg quyosh nurini qanday qandga aylantiradi?», «Temur tarqoq bekliklarni qanday birlashtirdi».`,
    `IDORAVIY USLUB TAQIQLANADI: «…amalga oshiriladi», «muhim ahamiyat kasb etadi», «ta’kidlash joizki», «alohida o‘rin tutadi», «dolzarb masalalardan biri», «…hisoblanadi» zanjiri, «mazkur», shior va maqtov, mazmunsiz umumiy gap.`,
    `Yomon: «Fotosintez jarayoni o‘simliklar hayotida muhim ahamiyat kasb etadi.» Yaxshi: «Barg quyosh nuridan qand yasaydi — o‘simlik shu qand hisobiga o‘sadi.»`,
    `Jargon, hazil va uydirma fakt/raqam yo‘q — himoyada uyaltirmaydigan, aniq va to‘g‘ri matn.`,
  ];
}

/** The speaker-notes line of the voice (the notes are what the presenter SAYS). */
export function notesVoiceLine(voice: SlideVoice): string {
  return voice === "professional"
    ? `notes — ishchan og‘zaki nutq: asosiy xulosa va dalil.`
    : `notes — talabaning jonli og‘zaki nutqi («Tasavvur qiling…», «Masalan…»), o‘qib beriladigan rasmiy matn emas; «Hurmatli talabalar», «bugungi ma’ruzamizda» kabi domla iboralari YO‘Q.`;
}

/*
 * Officialese markers. `strong` phrases are pure filler (2 points), `weak` ones are fine once but turn a slide into
 * a methodical document when they pile up (1 point). Apostrophe variants are unified before matching.
 */
const STRONG: readonly RegExp[] = [
  /muhim ahamiyat(ga ega| kasb)/,
  /ahamiyat kasb et/,
  /ta'kidlash joiz/,
  /shuni (ta'kidlash|aytish) (kerak|lozim)/,
  /alohida (o'rin|ahamiyat)/,
  /dolzarb masala(lar)?dan biri/,
  /muhim o'rin tut/,
  /hurmatli (talabalar|tinglovchilar|o'quvchilar)/,
  /bugungi ma'ruza/,
  /играет важную роль|необходимо отметить|следует отметить|имеет большое значение/,
  /plays a (crucial|vital|key) role|it is worth noting|is of great importance/,
];
const WEAK: readonly RegExp[] = [
  /amalga oshiril/,
  /hisoblanadi/,
  /\bmazkur\b/,
  /bugungi kunda/,
  /o'z navbatida/,
  /keng ko'lamli/,
  /yuqori darajada/,
  /e'tibor qaratil/,
  /muhim rol o'ynaydi/,
  /ta'minlanadi/,
  /\bushbu\b/,
  /осуществляется|является/,
];

/** Points per slide at which the slide is sent to the (existing) repair call. */
export const OFFICIALESE_MIN = 3;

function norm(text: string): string {
  return text.toLowerCase().replace(/[ʻʼ’‘`]/g, "'");
}

/** Officialese points of a text: 2 per strong phrase hit, 1 per weak one (each occurrence counts). */
export function officialeseScore(text: string): number {
  const t = norm(text);
  const count = (re: RegExp) => (t.match(new RegExp(re.source, "g")) ?? []).length;
  return STRONG.reduce((n, re) => n + 2 * count(re), 0) + WEAK.reduce((n, re) => n + count(re), 0);
}

/** The visible text of a slide the repair call can rewrite (title excluded: plan titles are a contract). */
export function officialeseText(s: SlideModel): string {
  return [s.subtitle, ...(s.bullets ?? []), ...(s.left ?? []), ...(s.right ?? []), ...(s.steps ?? []).map((x) => x.text)].filter(Boolean).join(" \n ");
}

/** Layouts whose body the repair call rewrites wholesale (`mergeBody`); others are never candidates. */
const REWRITABLE = new Set(["bullets", "process", "twoCol", "compare", "section"]);

/** Does this slide read like a methodical document (student voice only; the caller decides the voice). */
export function isOfficialese(s: SlideModel): boolean {
  return REWRITABLE.has(s.layout) && officialeseScore(officialeseText(s)) >= OFFICIALESE_MIN;
}
