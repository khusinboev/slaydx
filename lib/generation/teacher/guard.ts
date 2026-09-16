/**
 * O'QITUVCHI QO'RIQCHISI (AUDIT-20 WP-A) — SOF ARIFMETIKA VA FILTRLAR.
 *
 * Bu faylda tarmoq ham, `DocMeta` ham, `AcademicDoc` ham YO'Q: faqat
 * «model javobini qabul qilishdan oldin nima to'g'rilanadi» degan
 * savolga javob beradigan funksiyalar. Sabab `work/guard.ts` dagi bilan
 * bir xil — bu mantiq dvigatel ichida tursa SINOVDAN O'TMAYDI, va aynan
 * shu turdagi jim xato (daqiqa yig'indisi 45 emas 60, rubrika bali 10
 * emas 13) o'qituvchini hujjatni qo'lda tuzatishga majbur qiladi.
 *
 * `write-specials.ts` dan KO'CHIRILGAN sof qismlar: `normalizeMinutes`
 * (daqiqa/ball taqsimoti), `mapWeeks` (`weeksFor`), `pickMapMethod` /
 * `pickMapResult` / `pickMapControl` zaxiralari va atama filtri. Eski
 * fayl bir sprint qoladi (`TEACHER_ENGINE=0`), shuning uchun u yerda
 * ham nusxasi bor — bu ATAYLAB: eski yo'l o'chirilganda bu fayl
 * o'zgarmaydi.
 */
import { isGenericGlossaryTerm } from "../quality";
import { TEACHER_LIMITS, type GlossaryTerm, type KeysRubricRow } from "./types";
import type { Block, DocTable } from "../types";

/* ────────────────────────── matn ────────────────────────── */

/** HTML entity, markdown va ortiqcha probellardan tozalangan bir qatorli matn. */
export function clean(s: unknown): string {
  if (Array.isArray(s)) return s.map((x) => clean(x)).filter(Boolean).join("\n");
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    return [o.title, o.text, o.value, o.name].map((x) => clean(x)).filter(Boolean).join(" — ");
  }
  return String(s ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&apos;|&#39;|&lsquo;|&rsquo;/gi, "‘")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, "\"")
    .replace(/&nbsp;/gi, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tozalangan matn, `n` belgidan uzun bo'lsa kesiladi. */
export function clip(s: unknown, n: number): string {
  const t = clean(s);
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Model JSON idagi ro'yxat maydoni — turli nomlar ostida kelishi mumkin. */
export function listOf(o: Record<string, unknown> | null | undefined, ...keys: string[]): unknown[] {
  for (const k of keys) {
    const v = o?.[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/* ────────────────────────── yig'indi taqsimoti ────────────────────────── */

/**
 * Bir nechta musbat qiymatni ANIQ yig'indiga moslaydi (nisbat saqlanadi,
 * yaxlitlash qoldig'i eng kattasiga qo'shiladi, har qiymat >= 1).
 *
 * `write-specials.ts normalizeMinutes` dan ko'chirildi — u yerda ikki
 * masala bitta funksiya bilan yechilar edi va shu to'g'ri qaror bo'lib
 * qoldi: dars bosqichlari daqiqasi ham, rubrika ballari ham, xarita
 * soatlari ham aynan «kamida 1 shart bilan aniq yig'indiga moslash»
 * masalasi.
 *
 * Nega MUHIM: promptda «yig'indi ${duration} bo'lsin» deyilgan, lekin
 * bu HECH QACHON tekshirilmagan edi — 45 daqiqalik darsda bosqichlar
 * yig'indisi 60 chiqardi.
 */
export function normalizeMinutes(raw: unknown[], total: number): number[] {
  const d = Math.max(1, Math.round(total) || 1);
  const minutes = raw.map((m) => Math.max(1, Math.round(Number(m) || 0) || 1));
  if (!minutes.length) return [];
  const sum = minutes.reduce((a, b) => a + b, 0);
  const scaled = sum === d ? [...minutes] : minutes.map((m) => Math.max(1, Math.round((m / sum) * d)));
  // Tsikl chegaralangan: har element kamida 1 bo'lgani uchun kamaytirish
  // imkonsiz holat ham bo'lishi mumkin (elementlar soni > yig'indi).
  for (let guard = 0; guard < 500; guard++) {
    const diff = d - scaled.reduce((a, b) => a + b, 0);
    if (diff === 0) break;
    const peak = Math.max(...scaled);
    if (diff < 0 && peak <= 1) break;
    scaled[scaled.indexOf(peak)] += diff > 0 ? 1 : -1;
  }
  return scaled;
}

/** Yig'indi (sinov va hisobot bandlari uchun yagona hisob). */
export const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/* ────────────────────────── xarita ────────────────────────── */

/**
 * Hafta soni — soatlardan. `write-specials.ts mapWeeks` bilan AYNI
 * qoida (`budget.ts teacherSize` ham shu klampni takrorlaydi).
 */
export function weeksFor(weeklyHours: number, totalHours: number): number {
  const weekly = Math.max(1, Math.round(Number(weeklyHours) || 1));
  const total = Math.max(weekly, Math.round(Number(totalHours) || weekly));
  return Math.max(TEACHER_LIMITS.weeksMin, Math.min(TEACHER_LIMITS.weeksMax, Math.round(total / weekly)));
}

/** Haftalarga soat taqsimoti — ustun yig'indisi `totalHours` ga QAT'IY teng. */
export function hoursFor(weekCount: number, weeklyHours: number, totalHours: number): number[] {
  const weekly = Math.max(1, Math.round(Number(weeklyHours) || 1));
  const total = Math.max(weekly, Math.round(Number(totalHours) || weekly));
  return normalizeMinutes(new Array(Math.max(0, weekCount)).fill(weekly), total);
}

/**
 * Chorakka hafta taqsimoti (`choraklik` turi): 4 chorakka imkon qadar
 * teng, qoldiq BIRINCHI choraklarga. O'zbek maktabida I-II chorak
 * uzunroq, shuning uchun qoldiq boshiga qo'shiladi.
 */
export function weeksPerQuarter(weeks: number, quarters = TEACHER_LIMITS.quarters): number[] {
  const n = Math.max(quarters, Math.round(weeks) || quarters);
  const base = Math.floor(n / quarters);
  const rest = n - base * quarters;
  return Array.from({ length: quarters }, (_, i) => base + (i < rest ? 1 : 0));
}

/** «1-mavzu», «Mavzu 3», «Tema 2» — mazmunsiz o'rin egallovchi. */
export function isPlaceholderTopic(topic: string): boolean {
  const t = clean(topic);
  if (!t) return true;
  return /^\d+[-.\s]*(mavzu|tema|topic|урок|тема)\b/i.test(t) || /^(mavzu|tema|topic|тема)\s*\d+$/i.test(t);
}

/**
 * «Kutilgan natija» ustunidagi UMUMIY shablon.
 *
 * Eski `mapDoc` aynan 3 ta iborani bilardi; tadqiqot (R1 §4
 * `resultVariety`) ro'yxatni kengaytirishni tavsiya qiladi — bitta
 * ibora o'zgarsa filtr butunlay ochilib ketardi.
 */
const GENERIC_RESULT_RE =
  /^(tushuncha\s+shakllanadi|ko[‘’'`]?nikma\s+mustahkamlanadi|mustaqil\s+ishlay\s+oladi|bilim\s+(va\s+ko[‘’'`]?nikma\w*\s+)?(oshadi|mustahkamlanadi)|mavzuni\s+(o[‘’'`]?zlashtiradi|tushunadi)|формируется\s+понятие|закрепляются\s+навыки|understands\s+the\s+topic)\s*\.?$/i;

export function isGenericResult(result: string): boolean {
  const t = clean(result);
  return !t || GENERIC_RESULT_RE.test(t);
}

/** Mavzuga qarab metod zaxirasi (model bermasa) — eski `pickMapMethod`. */
export function fallbackMethod(topic: string, i: number): string {
  const t = topic.toLowerCase();
  if (/laborator|tajriba|mikroskop|preparat|hujayra/.test(t)) return "Laboratoriya";
  if (/nazorat|takror|test|mustahkamlash/.test(t)) return "Takror va nazorat";
  if (/amaliy|mashq|hisob|yechim/.test(t)) return "Amaliy mashg‘ulot";
  if (/loyiha|mustaqil|referat/.test(t)) return "Mustaqil ish / loyiha";
  if (/kirish|ahamiyat|predmet/.test(t)) return "Ma’ruza + suhbat";
  return ["Ma’ruza + suhbat", "Amaliy mashg‘ulot", "Laboratoriya", "Mustaqil ish / loyiha", "Takror va nazorat"][i % 5];
}

/** Mavzuga qarab kutilgan natija zaxirasi — eski `pickMapResult`. */
export function fallbackResult(topic: string): string {
  const t = topic.toLowerCase();
  if (/hujayra/.test(t)) return "Hujayra tuzilishini tushuntiradi";
  if (/fotosintez/.test(t)) return "Fotosintez bosqichlarini ayta oladi";
  if (/suv/.test(t)) return "Suv almashinuvini izohlaydi";
  if (/nafas/.test(t)) return "Nafas olishni tushuntiradi";
  if (/ko‘pay|kopay|urug‘/.test(t)) return "Ko‘payish turlarini ajratadi";
  if (/nazorat|test/.test(t)) return "O‘zlashtirishni namoyish etadi";
  return `${topic.split(/\s+/).slice(0, 3).join(" ")} bo‘yicha tushuntira oladi`;
}

/**
 * Nazorat turi zaxirasi — eski `pickMapControl`.
 *
 * Egasi qarori (AUDIT-20 «Tadqiqotdan keyingi qarorlar»): nazorat turi
 * endi LLM javobidan olinadi, bu funksiya FAQAT model ustunni bo'sh
 * qoldirganda ishlaydi. Ilgari u YAGONA manba edi va tasodifiy indeksga
 * bog'liq bo'lgani uchun `controlFit` mezoni hech qachon bajarilmasdi.
 */
export function fallbackControl(topic: string, i: number): string {
  const t = topic.toLowerCase();
  if (/laborator|tajriba|amaliy/.test(t)) return "Amaliy ish";
  if (/nazorat|takror|yakun/.test(t)) return "Yozma nazorat";
  return ["Og‘zaki so‘rov", "Yozma topshiriq", "Amaliy ish", "Test"][i % 4];
}

/* ────────────────────────── glossariy ────────────────────────── */

/**
 * «Ta'rif atamaning o'zini takrorlaydi» — R2 §4 `noStubDefinition`.
 *
 * «Fotosintez — bu fotosintez jarayoni» ta'rif emas. Tekshiruv: ta'rif
 * atamadan (va uning «— bu» bog'lovchisidan) tozalanganda ma'noli matn
 * qolmasa yoki qolgan qism juda qisqa bo'lsa — stub.
 */
export function isStubDefinition(term: string, def: string): boolean {
  const t = clean(term).toLowerCase();
  const d = clean(def).toLowerCase();
  if (!d) return true;
  if (d.length < TEACHER_LIMITS.defCharsMin) return true;
  if (!t) return false;
  const stem = t.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (stem.length < 3) return false;
  const re = new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  /*
   * Ikki BELGI, ikkalasi ham oddiy va tushuntirib beriladigan:
   *   1. atama ta'rif ichida IKKI marta uchraydi — «Fotosintez — bu
   *      fotosintez jarayoni»: izoh atamaning o'zi bilan berilgan;
   *   2. atamani olib tashlaganda ma'noli so'z deyarli qolmaydi.
   * Bitta uchrash NORMAL: «Fotosintez barg hujayralarida kechadi» —
   * ta'rif atamani nomlashi mumkin va kerak ham.
   */
  const hits = (d.match(re) ?? []).length;
  if (hits >= 2) return true;
  const rest = d
    .replace(re, " ")
    .replace(/(\u2014|-|\u2013)?\s*(bu|это|is)\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return rest.split(/\s+/).filter((w) => w.length > 2).length < 5;
}

export type RawTerm = { term?: unknown; def?: unknown; example?: unknown; ru?: unknown; en?: unknown };

/**
 * Model bergan atamalar -> tozalangan, TAKRORSIZ ro'yxat.
 *
 * Uch filtr birga ishlaydi va ularning har biri alohida qoidaga javob
 * beradi (`TEACHER_RULE_IDS.glossary`): `noGenericTerm`,
 * `duplicateTerm`, `noStubDefinition`.
 *
 * @param seen  Oldingi bo'laklardan yig'ilgan kalitlar (20 talik
 *   so'rovlar orasida takror bo'lmasin) — funksiya uni TO'LDIRADI.
 */
export function pickTerms(raw: unknown[], seen: Set<string>, opts: { defMax?: number } = {}): GlossaryTerm[] {
  const defMax = opts.defMax ?? TEACHER_LIMITS.defCharsMax;
  const out: GlossaryTerm[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as RawTerm & Record<string, unknown>;
    const term = clip(o.term ?? o.name ?? o.atama ?? o.title, 60);
    const def = clip(o.def ?? o.definition ?? o.izoh ?? o.text, defMax);
    if (!term || !def) continue;
    if (isGenericGlossaryTerm(term)) continue;
    if (isStubDefinition(term, def)) continue;
    const key = term.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const example = clip(o.example ?? o.misol, 220);
    const ru = clip(o.ru ?? o.russian, 80);
    const en = clip(o.en ?? o.english, 80);
    out.push({ term, def, ...(example ? { example } : {}), ...(ru ? { ru } : {}), ...(en ? { en } : {}) });
  }
  return out;
}

/**
 * Alifbo tartibi hujjat tilida (`Intl.Collator`) — boshidagi qo'shtirnoq
 * va tirelar hisobga olinmaydi («"Aksiya"» «B» dan keyin qolmasin).
 */
export function sortTerms(terms: readonly GlossaryTerm[], language: string): GlossaryTerm[] {
  const collator = new Intl.Collator(language || "uz", { sensitivity: "base", numeric: true });
  const key = (t: string) => String(t).replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return [...terms].sort((a, b) => collator.compare(key(a.term), key(b.term)));
}

/** Ro'yxat alifbo tartibidami — hisobot bandi (`alphaOrder`). */
export function isAlphaOrdered(terms: readonly GlossaryTerm[], language: string): boolean {
  const sorted = sortTerms(terms, language);
  return sorted.every((t, i) => t.term === terms[i]?.term);
}

/* ────────────────────────── keys ────────────────────────── */

/**
 * Rubrika qatorlari — mezon matni + ball, yig'indi QAT'IY `total`.
 *
 * Yarim rubrika (mezoni bor, balli yo'q) yo'qdan yomonroq: o'qituvchi
 * uni ishlata olmaydi, lekin hujjatda «baholash mezoni» deb turadi.
 * Shuning uchun 2 tadan kam yaroqli qator bo'lsa — bo'sh ro'yxat.
 */
export function rubricRows(raw: unknown[], total = TEACHER_LIMITS.rubricTotal, max = TEACHER_LIMITS.rubricMax): KeysRubricRow[] {
  const rows = raw
    .map((r) => {
      const o = (r ?? {}) as { criterion?: unknown; mezon?: unknown; points?: unknown; ball?: unknown };
      return { criterion: clip(o.criterion ?? o.mezon, 140), points: Number(o.points ?? o.ball) };
    })
    .filter((r) => r.criterion.length > 2 && Number.isFinite(r.points) && r.points > 0)
    .slice(0, max);
  if (rows.length < 2) return [];
  const points = normalizeMinutes(rows.map((r) => r.points), total);
  return rows.map((r, i) => ({ criterion: r.criterion, points: points[i] }));
}

/**
 * Keyslar bir-birining nusxasi emasmi (`noDuplicateCase`) — sarlavha va
 * vaziyat boshlanishining dastlabki 40 belgisi bo'yicha.
 */
export function caseKey(title: string, situation: string): string {
  return `${clean(title).toLowerCase().slice(0, 40)}|${clean(situation).toLowerCase().slice(0, 40)}`;
}

/**
 * Vaziyatda ANIQ kontekst bormi (`realism`): ism, lavozim, muassasa,
 * son yoki sinf. To'liq ishonchli emas (shuning uchun baholovchi ham
 * `situationRealism` ni ko'radi), lekin «Bir maktabda muammo yuzaga
 * keldi» kabi bo'sh shablonni deterministik rad etadi.
 */
const REALISM_RE =
  /(?<![\p{L}])([\p{Lu}][\p{Ll}‘’'`]{2,}\s+(opa|aka|ota|ona|o[‘’'`]?qituvchi|domla|xonim|janob))|((o[‘’'`]?qituvchi|o[‘’'`]?quvchi|talaba|direktor|mudir|rahbar|shifokor|muhandis|tadbirkor|buxgalter|sotuvchi|dehqon|fermer|menejer)\s+[\p{Lu}][\p{Ll}‘’'`]{2,})|(\d+\s*-?\s*[«"“]?[\p{Lu}]?[»"”]?\s*(sinf|kurs|yosh|nafar|ta\b|foiz|%|soat|daqiqa|kun|oy|yil|so[‘’'`]?m))|(direktor|mudir|rahbar|menejer|shifokor|muhandis|tadbirkor|ota-ona|buxgalter|sotuvchi|dehqon|fermer|sinf rahbari)/u;

export function hasRealisticDetail(situation: string): boolean {
  return REALISM_RE.test(clean(situation));
}

/* ────────────────────────── dars rejasi ────────────────────────── */

/**
 * «Umumiy shablon» faoliyat (`noGenericActivity`): matn juda qisqa yoki
 * har qanday mavzuga mos gap.
 *
 * R1 §5 yomon misoli — «O'quvchilar bilim va ko'nikmalarini
 * mustahkamlaydi.»: hech qaysi mavzuga tegishli emas, hech narsa
 * o'lchanmaydi.
 */
const GENERIC_ACTIVITY_RE =
  /^(o[‘’'`]?quvchilar\s+)?(bilim\s+va\s+ko[‘’'`]?nikma\w*|mavzu\w*)\s+(mustahkamla\w+|takrorla\w+|o[‘’'`]?zlashtira\w+)\s*\.?$/i;

export const ACTIVITY_MIN_CHARS = 40;

export function isGenericActivity(text: string): boolean {
  const t = clean(text);
  return t.length < ACTIVITY_MIN_CHARS || GENERIC_ACTIVITY_RE.test(t);
}

/**
 * Bosqich mavzuga bog'langanmi (`topicGrounded`) — mavzuning birinchi
 * ma'noli so'zi (yoki 12 belgisi) bosqich matnida uchraydimi.
 */
export function mentionsTopic(text: string, topic: string): boolean {
  const t = clean(topic).toLowerCase();
  if (t.length < 3) return false;
  const hay = clean(text).toLowerCase();
  if (hay.includes(t.slice(0, 12))) return true;
  const words = t.split(/\s+/).filter((w) => w.length >= 5);
  return words.some((w) => hay.includes(w.slice(0, Math.min(w.length, 8))));
}

/**
 * ATAMA BLOKLARI — YAGONA quruvchi (AUDIT-20 WP-D).
 *
 * Dvigatel ham, avto-sayqal ham (`teacher/polish.ts`) SHU funksiyadan
 * foydalanadi. Ilgari sayqal `terms` bo'limini umumiy nasr sifatida
 * qayta yozardi: `blocksFromLlm` qisqa qatorlarni tashlab, `h3`
 * sarlavhalarni `p` ga aylantirib yuborardi — jonli sinovda 20
 * atamadan 18 tasining SARLAVHASI yo'qolgan (ta'rif qolgan, atama
 * yo'q), model esa o'zgarmagani uchun hisobot hamon 20 ta atamani
 * ko'rsatardi. Tuzilma shu yerda QURILADI, modeldan chiqadi va
 * `applyTeacherOps` uni bloklardan qayta o'qiy oladi.
 */
export function glossaryTermBlocks(terms: readonly GlossaryTerm[], exampleLabel: string, includeExample = true): Block[] {
  const out: Block[] = [];
  for (const t of terms) {
    out.push({ kind: "h3", text: t.term });
    out.push({ kind: "p", text: t.def });
    if (includeExample && t.example) out.push({ kind: "p", text: `${exampleLabel}: ${t.example}` });
  }
  return out;
}

/** Uch tilli jadval — ATAMA + RU + EN (ta'rif ustuni ATAYIN yo'q, AUDIT-6 B5). */
export function glossaryTriTable(terms: readonly GlossaryTerm[], caption: string, cols: readonly [string, string, string]): DocTable {
  return {
    caption,
    anchor: "terms",
    widths: [40, 30, 30],
    headers: [...cols],
    rows: terms.map((t) => [t.term, t.ru ?? "", t.en ?? ""]),
  };
}
