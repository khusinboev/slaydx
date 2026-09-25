/**
 * Slayd REJA/mazmun tekshiruvi (AUDIT-25 P5) — `AcademicDoc` JSON (yoki
 * shunday fayllar katalogi) ustida, LLM chaqiruvisiz.
 *
 * Nega kerak (`docs/AUDIT-25.md` §1 tashxis): reja bandlari mazmun
 * slaydiga bog'lanmagan bo'lishi (S1), raqamlar reja bilan mos kelmasligi
 * (S2), zaxira skeletning uydirma raqamlari (S3) va axboriy matn kamligi
 * (S4) — bularning hech biri unit test bilan emas, TAYYOR `doc.json`
 * ustida tekshiriladi. `scripts/live-engine.mts` `slide`/`pro-slide`
 * holatlari va bu skript BIR XIL `auditSlideDoc` dan foydalanadi — ikkita
 * alohida "tekshirish kodi" yo'q (loyihaning "yagona manba" qoidasi).
 *
 * Kontrakt eslatmasi (P1/P3 parallel ishlaydi, §3): `SlideModel.plan?:
 * number` va `thinSlides(slides, rules)` (`lib/generation/slide-quality.ts`)
 * shu paket YOZILAYOTGANDA hali bu worktree'da yo'q edi. Shuning uchun:
 *   - `plan` maydoni DUCK-TYPE bilan o'qiladi (`SlideForAudit.plan`) — P1
 *     qo'shgach `SlideModel`ning o'zida bo'ladi, bu yerdagi kasting
 *     zararsiz qoladi;
 *   - yupqa-slayd aniqlash P3'ning `thinSlides()`'ini IMPORT QILMAYDI —
 *     shu faylda MUSTAQIL, oddiy evristika bilan qayta yozilgan, alohida
 *     `thinHeuristic()` deb eksport qilingan (ruhda bir xil: band/so'z
 *     chegaralari AUDIT-25 §2.6 dan). Bitta chaqiruv nuqtasi bor (pastda,
 *     `// AUDIT-25 merge` izohi) — birlashgach shu bitta qator P3'nikiga
 *     almashtiriladi. Kesiklar (`truncated`) va skelet sizishi
 *     (`skeleton-leak`) P3'da YO'Q — ular shu faylda QOLADI.
 *
 * Independent review (`audit/reviews/AUDIT-25-P5.md`) topgan nuqsonlar
 * shu versiyada tuzatilgan: plan-untagged/plan-extra (item 1–2), ordinal
 * regex false-positive'lari (item 3), kesiklar HAMMA matn maydonida
 * (item 4), halol skelet sizishi (item 5), yupqa qoida faqat reja
 * slaydlariga (item 9b), `thin-quote` olib tashlandi (item 9a).
 *
 * Foydalanish:
 *   npm run slide-audit -- <deck.doc.json>
 *   npm run slide-audit -- eval-out/live          # katalogdagi barcha *.doc.json (slaydsizlar SKIP qilinadi)
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { thinSlides } from "../lib/generation/slide-quality.ts";
import { normalizeTemplateId, type SlideVisual } from "../lib/generation/slide-templates.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * Auditga kerak bo'lgan maydonlargina — TO'LIQ `SlideModel` emas
 * (`lib/generation/slide-types.ts`) qasddan IMPORT QILINMAGAN: bu
 * skript qo'lda qurilgan yoki qisman/buzuq JSON ustida ham ishlashi
 * kerak (`doc.json` — LLM javobidan chiqqan modeldan saqlanadi, CLAUDE.md
 * qoidasi — «FormValues'dan AcademicDoc'gacha bo'lgan yo'lda hech qanday
 * qadam ishonchli hisoblanmaydi»). `plan` — P1 kontrakti
 * (`SlideModel.plan?: number`, hali bu worktree'da yo'q) — shu sabab
 * duck-type bilan shu yerning O'ZIDA e'lon qilingan.
 */
type SlideForAudit = {
  layout?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  left?: string[];
  right?: string[];
  quote?: string;
  quoteBy?: string;
  stats?: { value?: string; label?: string }[];
  steps?: { n?: string; title?: string; text?: string }[];
  quiz?: { q?: string; options?: string[]; answer?: number }[];
  table?: { headers?: string[]; rows?: string[][] };
  /** P1 kontrakti (`docs/AUDIT-25.md` §3) — duck-type, yuqoridagi izohga qarang. */
  plan?: number;
};
type SlideDocLike = {
  slides?: SlideForAudit[];
  /** `AcademicDoc.meta` — bor bo'lsa P3 detektori auditoriya qoidalari bilan ishlaydi. */
  meta?: Record<string, unknown>;
  slideTemplate?: string;
  slideVisual?: string;
};

export type SlideAuditIssue = { slide: number; kind: string; detail: string };
export type SlideAuditResult = { ok: boolean; issues: SlideAuditIssue[] };

/**
 * «1.», «1)», rim raqami «I.–VI.» bilan boshlangan sarlavha — maketdan
 * emas, LLM yozgan tartib raqami.
 *
 * Review item 3: eski `\d+[.)]` "1.5 million…"dagi "1."ni ham, `[IVXLCDM]+`
 * esa "M. Ulug'bek"/"D. Mendeleyev" kabi bosh harf-nuqta initsiallarni ham
 * yolg'on ushlardi. Endi: (a) raqam FAQAT 1–2 xonali va undan keyin
 * BO'SHLIQ kelishi shart (`(?=\s)` — "1.5" da "." dan keyin "5" keladi,
 * mos kelmaydi); (b) rim raqami FAQAT I–VI (`PLAN_ITEMS_MAX` = 6, undan
 * katta reja bandi yo'q) — C/D/L/M harflari umuman olib tashlangan, ular
 * har doim initsial. Yolg'iz `I.`/`V.` baribir initsial bilan noaniq
 * qoladi (masalan «V. Malikov») — bu chegara ataylab shunday qoldirilgan,
 * chunki reja bandi ≤6 bo'lgani uchun xato tomonga og'ish arzonroq
 * (o'tkazib yuborish P1 regressiyasini yashirar edi).
 */
const ORDINAL_LEAK_RE = /^\s*(?:\d{1,2}[.)](?=\s)|(?:I{1,3}|IV|VI?)[.)](?=\s))\s*/;
/** `stats` uydirma raqam bergan holatlar — qiymat "bor", yorliq umuman ma'nosiz. */
const GENERIC_STAT_LABELS = new Set(["asosiy nuqta", "—", "-", ""]);
/**
 * Kesilgan matn — `…`/`...` bilan tugaydi VA undan oldin harf, raqam
 * yoki yopuvchi tinish belgisi keladi (review item 4: qasddan qo'yilgan
 * tinish belgisidan keyingi «…» ni yolg'on ushlamaslik uchun, masalan
 * "Tayyor!..." emas — undov belgisi bu sinfga kirmaydi).
 *
 * N7 (`AUDIT-25-P14c.md`): faqat `\p{L}` (harf) yetarli emas edi —
 * `clipTo` (dvigatel) raqam, yopuvchi qo'shtirnoq «»» yoki qavs «)»
 * bilan ham kesadi (masalan "…2020)…", "«ozon»…", "99…"), C9 esa
 * dvigatelning `clipped-text` sababini filtrladi (endi `pushTrunc`
 * yagona manba) — shu holatlar hech qayerda ko'rinmay qolgan edi.
 * Sinf endi `\p{L}\p{N}\p{Pe}\p{Pf}\p{No}` (harf, raqam, yopuvchi qavs,
 * yopuvchi qo'shtirnoq, boshqa raqam belgisi kabi «³»).
 *
 * Dvigatelning `clippedAt` (`lib/generation/slide-quality.ts`) uzunlik
 * shartini ham qo'shadi (`length >= ⌈0.6·(cap−1)⌉ − CLIP_TAIL_SLACK`),
 * lekin bu maydonning qirqish qopqog'iga bog'liq — `pushTrunc` har xil
 * maydonni bir xil chaqiradi va qopqoqni bilmaydi. Shuning uchun bu
 * yerda ham eski (harf) yo'l singari qopqoqsiz — undan oldingi belgi
 * sinfi o'zi filtr vazifasini bajaradi: bo'sh joyli savol ("1/2 + 1/4 =
 * …") "=" dan keyin BO'SHLIQ keladi, "…" dan oldingi belgi bo'shliqning
 * o'zi bo'lib, hech qaysi sinfga kirmaydi — mos kelmaydi, qasddan
 * qoldirilgan qisqa savol xato hisoblanmaydi.
 */
const TRUNCATED_RE = /[\p{L}\p{N}\p{Pe}\p{Pf}\p{No}](…|\.\.\.)\s*$/u;

function wordCount(s: string | undefined | null): number {
  return (s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** Case/probel-insensitiv, boshidagi tartib raqami olib tashlangan solishtirish uchun. */
function normTitle(s: string | undefined | null): string {
  return (s ?? "")
    .replace(ORDINAL_LEAK_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * S4 — yupqa mazmun evristikasi: MUSTAQIL, P3'ning `thinSlides()`
 * (`lib/generation/slide-quality.ts`) o'rnini HALI BOSMAYDI (fayl
 * boshidagi izohga qarang). Alohida eksport qilingan — birlashgandan
 * keyin `auditSlideDoc` ichidagi YAGONA chaqiruv nuqtasida P3'nikiga
 * almashtiriladi.
 *
 * Review item 9(b): `thin-bullets` FAQAT reja mazmun slaydlariga
 * (`typeof s.plan === "number"`) qo'llanadi — maqsadlar/uyga vazifa kabi
 * standart bloklar QASDDAN qisqa yoziladi, ularni yupqa deb belgilash
 * yolg'on signal edi. `thin-quote` esa BUTUNLAY OLIB TASHLANDI (item 9a) —
 * §2.6(b) da bunday qoida yo'q, «savol yoki fakt» motivatsiya iqtibosi
 * qasddan qisqa bo'lishi mumkin.
 */
export function thinHeuristic(slides: SlideForAudit[]): SlideAuditIssue[] {
  const issues: SlideAuditIssue[] = [];
  const push = (slide: number, kind: string, detail: string) => issues.push({ slide, kind, detail });
  slides.forEach((s, idx) => {
    const n = idx + 1;
    if (s.layout === "bullets" && typeof s.plan === "number") {
      const bullets = s.bullets ?? [];
      if (bullets.length < 2) {
        push(n, "thin-bullets", `${bullets.length} band (< 2)`);
      } else {
        const avg = bullets.reduce((sum, b) => sum + wordCount(b), 0) / bullets.length;
        if (avg < 6) push(n, "thin-bullets", `o'rtacha ${avg.toFixed(1)} so'z/band (< 6)`);
      }
    }
    for (const step of s.steps ?? []) {
      const words = wordCount(step.text);
      if (words < 6) push(n, "thin-process-step", `qadam "${step.title}" — ${words} so'z (< 6): "${step.text}"`);
    }
    if (s.layout === "section" && !(s.subtitle ?? "").trim()) {
      push(n, "thin-section-subtitle", "bo'lim slaydida subtitle yo'q");
    }
    if (s.layout === "twoCol" || s.layout === "compare") {
      const leftLen = (s.left ?? []).length;
      const rightLen = (s.right ?? []).length;
      if (leftLen < 2) push(n, "thin-column", `chap ustun ${leftLen} band (< 2)`);
      if (rightLen < 2) push(n, "thin-column", `o'ng ustun ${rightLen} band (< 2)`);
    }
  });
  return issues;
}

/**
 * Bitta dekani tekshiradi — TOZA funksiya (I/O yo'q), `live-engine.mts`
 * checks'lari va testlar shu bilan chaqiradi.
 */
/**
 * Yupqa slaydlar — dvigatel detektori (`thinSlides`, P3) bilan, `meta`
 * bo'lsa. `SlideForAudit` `SlideModel`ning duck-typed qismi: `thinSlides`
 * faqat matn maydonlarini o'qiydi, shuning uchun to'g'ridan-to'g'ri
 * uzatiladi. Sabab → `thin-<sabab>` turi (masalan `thin-few-bullets`).
 *
 * Review C9 (`audit/reviews/AUDIT-25-P14.md`): `clipped-text` sababi shu
 * yerda TASHLAB YUBORILADI — xuddi shu maydonni pastdagi `pushTrunc`
 * o'zining `truncated` topilmasi bilan ALLAQACHON hisobga oladi, u
 * ANIQROQ (maydon nomi va indeksni ataydi). Filtrlamasak, bitta kesilgan
 * band ikki marta — `truncated` va `thin-clipped-text` — sanalar edi va
 * xulosa qatoridagi `thin=` soni shishirilardi. Qolgan barcha sabablar
 * (`few-bullets`, `short-bullets`, ...) o'zgarishsiz o'tadi.
 */
function thinIssues(doc: SlideDocLike, slides: SlideForAudit[]): SlideAuditIssue[] {
  if (!doc.meta || typeof doc.meta !== "object") return thinHeuristic(slides);
  const meta = doc.meta as unknown as DocMeta;
  const rules = bodyRules(meta, normalizeTemplateId(doc.slideTemplate ?? meta.slideTemplate));
  const visual = typeof doc.slideVisual === "string" ? (doc.slideVisual as SlideVisual) : undefined;
  return thinSlides(slides as unknown as SlideModel[], rules, visual).flatMap((t) =>
    t.reasons
      .filter((r) => r !== "clipped-text")
      .map((r) => ({ slide: t.index + 1, kind: `thin-${r}`, detail: `${slides[t.index]?.layout ?? "?"}: ${r}` })),
  );
}

export function auditSlideDoc(doc: SlideDocLike): SlideAuditResult {
  const slides: SlideForAudit[] = Array.isArray(doc.slides) ? doc.slides : [];
  const issues: SlideAuditIssue[] = [];
  const push = (slide: number, kind: string, detail: string) => issues.push({ slide, kind, detail });

  /*
   * ── 1. Reja qamrovi ──
   *
   * Review item 1–2: uch holat bor, ULARNI ALOHIDA ko'rish kerak edi:
   *   (a) agenda bor, lekin BIRORTA slaydda `plan` yo'q — bu "coverage
   *       0/N" EMAS, "plan-untagged" (eski doc_json yoki P1 regressiyasi);
   *   (b) agenda bor va `plan` tegilgan — har band 1..N oralig'ida,
   *       tartibda, sarlavha mos (avvalgi mantiq) + `plan` N dan katta
   *       yoki 1 dan kichik bo'lsa "plan-extra" (§2.1: agenda — `plan`dan
   *       HOSILA, demak plan qiymati hech qachon agenda uzunligidan
   *       oshmasligi kerak);
   *   (c) agenda yo'q (`agendaSlide:false`), lekin `plan` tegilgan — §2.1:
   *       `plan` agendadan MUSTAQIL shartnoma, shu sabab baribir
   *       1..max ketma-ket va tartibda bo'lishi tekshiriladi (sarlavha
   *       solishtirilmaydi — agenda matni yo'q);
   *   (d) agenda yo'q va `plan` yo'q — eski deka, JIM o'tkaziladi (bugun
   *       shunday, to'g'ri xulq).
   */
  const agendaIdx = slides.findIndex((s) => s.layout === "agenda");
  const agenda = agendaIdx >= 0 ? slides[agendaIdx] : undefined;
  const agendaBullets = agenda?.bullets ?? [];
  const hasAnyPlanTag = slides.some((s) => typeof s.plan === "number");

  if (agenda && !hasAnyPlanTag) {
    push(agendaIdx + 1, "plan-untagged", "reja bandlari slaydlarga bog'lanmagan (plan maydoni yo'q — eski doc_json yoki P1 regressiyasi)");
  } else if (agenda) {
    const planTotal = agendaBullets.length;
    let lastGroupMaxIdx = -1;
    for (let i = 1; i <= planTotal; i++) {
      const group = slides.map((s, idx) => ({ s, idx })).filter(({ s }) => s.plan === i);
      if (group.length === 0) {
        push(0, "plan-coverage", `reja bandi ${i}/${planTotal} uchun mazmun slaydi yo'q (agenda: "${agendaBullets[i - 1] ?? ""}")`);
        continue;
      }
      const firstIdx = Math.min(...group.map((g) => g.idx));
      const maxIdx = Math.max(...group.map((g) => g.idx));
      if (firstIdx <= lastGroupMaxIdx) {
        push(firstIdx + 1, "plan-order", `reja bandi ${i} oldingi banddan KEYIN kelishi kerak edi (slayd #${firstIdx + 1})`);
      }
      lastGroupMaxIdx = Math.max(lastGroupMaxIdx, maxIdx);
      /* Bo'lim (`section`) beat'i bo'lsa — sarlavha shundan, aks holda guruhdagi BIRINCHI slayddan. */
      const sectionSlide = group.find((g) => g.s.layout === "section");
      const target = sectionSlide ?? group.reduce((a, b) => (a.idx < b.idx ? a : b));
      const want = normTitle(agendaBullets[i - 1]);
      const got = normTitle(target.s.title);
      /*
       * P11 (INT-02): agenda bandi agenda QATORI sig'imida so'z chegarasida
       * kesiladi (`syncAgenda` → `clipTo`), sarlavha esa to'liq qoladi.
       * «…» bilan tugagan band sarlavhaning PREFIKSI bo'lsa — bu mos,
       * kesik emas (qaror 2: agenda = sarlavha, sig'imgacha).
       */
      const clippedPrefix = want.endsWith("…") && got.startsWith(want.slice(0, -1).trimEnd());
      if (want && got && want !== got && !clippedPrefix) {
        push(target.idx + 1, "plan-title-mismatch", `agenda "${agendaBullets[i - 1]}" ≠ slayd sarlavhasi "${target.s.title}"`);
      }
    }
    slides.forEach((s, idx) => {
      if (typeof s.plan === "number" && (s.plan < 1 || s.plan > planTotal)) {
        push(idx + 1, "plan-extra", `slayd #${idx + 1} plan=${s.plan} — agenda faqat 1..${planTotal} band beradi`);
      }
    });
  } else if (hasAnyPlanTag) {
    const planValues = slides.map((s) => s.plan).filter((p): p is number => typeof p === "number");
    const planMax = Math.max(0, ...planValues);
    let lastGroupMaxIdx = -1;
    for (let i = 1; i <= planMax; i++) {
      const group = slides.map((s, idx) => ({ s, idx })).filter(({ s }) => s.plan === i);
      if (group.length === 0) {
        push(0, "plan-coverage", `reja bandi ${i}/${planMax} uchun mazmun slaydi yo'q (agenda yo'q — plan yorliqlaridan)`);
        continue;
      }
      const firstIdx = Math.min(...group.map((g) => g.idx));
      const maxIdx = Math.max(...group.map((g) => g.idx));
      if (firstIdx <= lastGroupMaxIdx) {
        push(firstIdx + 1, "plan-order", `reja bandi ${i} oldingi banddan KEYIN kelishi kerak edi (slayd #${firstIdx + 1})`);
      }
      lastGroupMaxIdx = Math.max(lastGroupMaxIdx, maxIdx);
    }
  }
  /* (d) agenda yo'q, `plan` yo'q — hech narsa qilinmaydi (eski deka, `agendaSlide:false`). */

  /* ── 2. Tartib raqami sizishi ── */
  slides.forEach((s, idx) => {
    if (ORDINAL_LEAK_RE.test(s.title ?? "")) {
      push(idx + 1, "ordinal-leak", `sarlavha tartib raqami bilan boshlanadi: "${s.title}"`);
    }
  });

  /* ── 3. Uydirma raqamlar (S3: zaxira skelet qoldig'i — ESKI skelet) ── */
  slides.forEach((s, idx) => {
    for (const st of s.stats ?? []) {
      if (/^\d{1,3}$/.test((st.value ?? "").trim()) && GENERIC_STAT_LABELS.has((st.label ?? "").trim().toLowerCase())) {
        push(idx + 1, "stray-number", `stats qiymati "${st.value}" umumiy yorliq "${st.label}" bilan — uydirma ko'rinadi`);
      }
    }
    for (const step of s.steps ?? []) {
      const text = (step.text ?? "").trim();
      if (text && text.toLowerCase() === (step.title ?? "").trim().toLowerCase()) {
        push(idx + 1, "stray-step-echo", `process qadam "${step.title}" matni sarlavhani so'zma-so'z takrorlaydi (mazmun yo'q)`);
      }
    }
  });

  /*
   * ── 3b. Halol skelet sizishi (§2.5, review item 5) — YANGI skelet ──
   *
   * §2.5 qarori: `beatToSlide` zaxira skeleti ENDI stats `value: "—"`,
   * bullets `["…"]` yozadi (uydirma raqam emas) va FAYLGA HECH QACHON
   * tushmasligi kerak. Shu sabab bu belgilar (agar fayldan topilsa) har
   * doim §2.5 buzilishi — «fuzzy» uchinchi qoida (bir xil step matni 2+
   * joyda) reviewer tavsiyasiga ko'ra QASDDAN qo'shilmagan (juda noaniq).
   */
  slides.forEach((s, idx) => {
    const n = idx + 1;
    for (const st of s.stats ?? []) {
      if ((st.value ?? "").trim() === "—") {
        push(n, "skeleton-leak", `stats qiymati "—" — halol skelet qoldig'i (§2.5), fayldan chiqmasligi kerak edi`);
      }
    }
    for (const arr of [s.bullets, s.left, s.right]) {
      for (const item of arr ?? []) {
        if ((item ?? "").trim() === "…") {
          push(n, "skeleton-leak", `band "…" — halol skelet qoldig'i (§2.5), fayldan chiqmasligi kerak edi`);
        }
      }
    }
  });

  /*
   * ── 4. Kesiklar (decision 7 «"…" kesiklar», review item 4) ──
   *
   * Eski qoida faqat quiz variantlarini tekshirardi (`thin-quiz-option`) —
   * A4 baseline'da (lecture-12) 5 ta `twoCol` band + `quoteBy` va
   * (defense-14) `closing.subtitle` kesilgan bo'lsa ham ko'rmasdi. Endi
   * HAR matn maydonida: title/subtitle/quote/quoteBy, bullets/left/right,
   * process qadam matni, stats yorlig'i, jadval katakchalari, quiz savol
   * va variantlari.
   */
  const pushTrunc = (n: number, field: string, text: string | undefined) => {
    if (typeof text === "string" && TRUNCATED_RE.test(text.trim())) {
      push(n, "truncated", `${field} kesilgan: "${text}"`);
    }
  };
  /* Agenda bandi sarlavhaning kesilgan prefiksi bo'lsa — kesik hisoblanmaydi (yuqoridagi qoida). */
  const planTitles = new Set(slides.filter((s) => typeof s.plan === "number").map((s) => normTitle(s.title)));
  const isClippedPlanTitle = (b: string) => {
    const w = normTitle(b);
    if (!w.endsWith("…")) return false;
    const pre = w.slice(0, -1).trimEnd();
    for (const t of planTitles) if (t.startsWith(pre)) return true;
    return false;
  };
  slides.forEach((s, idx) => {
    const n = idx + 1;
    pushTrunc(n, "title", s.title);
    pushTrunc(n, "subtitle", s.subtitle);
    pushTrunc(n, "quote", s.quote);
    pushTrunc(n, "quoteBy", s.quoteBy);
    (s.bullets ?? []).forEach((b, i) => { if (!(s.layout === "agenda" && isClippedPlanTitle(b))) pushTrunc(n, `bullets[${i}]`, b); });
    (s.left ?? []).forEach((b, i) => pushTrunc(n, `left[${i}]`, b));
    (s.right ?? []).forEach((b, i) => pushTrunc(n, `right[${i}]`, b));
    (s.steps ?? []).forEach((st, i) => pushTrunc(n, `steps[${i}].text`, st.text));
    (s.stats ?? []).forEach((st, i) => pushTrunc(n, `stats[${i}].label`, st.label));
    (s.quiz ?? []).forEach((q, i) => {
      pushTrunc(n, `quiz[${i}].q`, q.q);
      (q.options ?? []).forEach((o, j) => pushTrunc(n, `quiz[${i}].options[${j}]`, o));
    });
    if (s.table) {
      (s.table.headers ?? []).forEach((h, i) => pushTrunc(n, `table.headers[${i}]`, h));
      (s.table.rows ?? []).forEach((row, ri) => row.forEach((cell, ci) => pushTrunc(n, `table.rows[${ri}][${ci}]`, cell)));
    }
  });

  /*
   * ── 5. Yupqa mazmun (S4) ──
   * `meta` bor (haqiqiy `doc.json`) → P3 `thinSlides` — dvigatel bilan
   * AYNAN bir xil auditoriya qoidalari va vizual sig'imi; `meta` yo'q
   * (qo'lda tuzilgan fixture) → mahalliy evristika.
   */
  issues.push(...thinIssues(doc, slides));

  /* ── 6. Blok qamrovi / tartib: title birinchi, closing oxirgi, agenda ikkinchi ── */
  const layouts = slides.map((s) => s.layout);
  const hasTitle = layouts.includes("title");
  const hasClosing = layouts.includes("closing");
  if (hasTitle && slides[0]?.layout !== "title") {
    push(1, "block-order", `birinchi slayd "${slides[0]?.layout}" — "title" bo'lishi kerak edi`);
  }
  if (hasClosing && slides[slides.length - 1]?.layout !== "closing") {
    push(slides.length, "block-order", `oxirgi slayd "${slides[slides.length - 1]?.layout}" — "closing" bo'lishi kerak edi`);
  }
  if (agenda) {
    const expectedIdx = hasTitle ? 1 : 0;
    if (agendaIdx !== expectedIdx) {
      push(agendaIdx + 1, "block-order", `agenda #${agendaIdx + 1} da turibdi, kutilgan o'rin #${expectedIdx + 1}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Qamrov hisobotidagi «covered/total» — CLI xulosasi uchun.
 *
 * Review item 1: agenda bor-u `plan` yo'q holatda endi `"untagged"`
 * qaytadi (CLI buni `plan=untagged/N` deb bosadi), `0/N` EMAS — ular
 * semantik jihatdan boshqa narsa (birinchisi — «hali tekshirib bo'lmaydi»,
 * ikkinchisi — «tekshirildi va HAMMASI yo'q»).
 */
function planCoverage(doc: SlideDocLike, issues: SlideAuditIssue[]): { covered: number | "untagged"; total: number } {
  const slides = doc.slides ?? [];
  const agenda = slides.find((s) => s.layout === "agenda");
  const hasAnyPlanTag = slides.some((s) => typeof s.plan === "number");
  const missing = issues.filter((i) => i.kind === "plan-coverage").length;
  if (agenda) {
    const total = agenda.bullets?.length ?? 0;
    if (!hasAnyPlanTag) return { covered: "untagged", total };
    return { covered: Math.max(0, total - missing), total };
  }
  if (hasAnyPlanTag) {
    const planValues = slides.map((s) => s.plan).filter((p): p is number => typeof p === "number");
    const total = Math.max(0, ...planValues);
    return { covered: Math.max(0, total - missing), total };
  }
  return { covered: 0, total: 0 };
}

/** Uchragan layoutlar ro'yxati — hisobot uchun (P5 topshirig'idagi «blok qamrovi» bandi). */
function layoutsSummary(doc: SlideDocLike): string {
  const slides = doc.slides ?? [];
  const counts = new Map<string, number>();
  for (const s of slides) {
    const l = s.layout ?? "?";
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([l, n]) => `${l}×${n}`)
    .join(" · ");
}

/* ═════════════════════════════ CLI ═════════════════════════════ */

/**
 * Bitta faylni tekshiradi.
 *
 * Review item 7(a): `opts.lenient` (katalog rejimi) — slaydsiz `doc.json`
 * (maqola, krossvord, ...) SKIP qilinadi, muvaffaqiyatsizlik deb
 * sanalmaydi. Aniq nomlangan YAKKA fayl (`lenient: false`) bo'lsa,
 * slaydsizlik xato — foydalanuvchi ANIQ shu faylni so'ragan.
 */
async function auditFile(file: string, opts: { lenient: boolean }): Promise<boolean | "skip"> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    console.log(`✘ ${file}: o'qib bo'lmadi — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(`✘ ${file}: JSON emas — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  /* Fayl to'g'ridan-to'g'ri AcademicDoc (`live-engine.mts` slayd holatlari shunday yozadi); `{doc:...}` bo'lsa ham qabul qilinadi. */
  const doc = (
    parsed && typeof parsed === "object" && Array.isArray((parsed as SlideDocLike).slides)
      ? (parsed as SlideDocLike)
      : (parsed as { doc?: SlideDocLike })?.doc
  ) as SlideDocLike | undefined;
  if (!doc || !Array.isArray(doc.slides)) {
    if (opts.lenient) {
      console.log(`· skip (slayd emas): ${path.basename(file)}`);
      return "skip";
    }
    console.log(`✘ ${file}: doc.slides massiv emas — slayd hujjati emasmi?`);
    return false;
  }

  const { ok, issues } = auditSlideDoc(doc);
  const { covered, total } = planCoverage(doc, issues);
  const thin = issues.filter((i) => i.kind.startsWith("thin-")).length;
  const leaks = issues.filter((i) => i.kind === "ordinal-leak").length;
  /* Review (coordinator follow-up): kesiklar (item 4) HAM xulosa qatorida ko'rinishi kerak — o'z hisoblagichi bilan. */
  const trunc = issues.filter((i) => i.kind === "truncated").length;

  console.log(`\n═══ ${path.basename(file)} ═══`);
  console.log(`  bloklar: ${layoutsSummary(doc) || "(bo'sh)"}`);
  for (const iss of issues) {
    console.log(`  ${iss.slide > 0 ? `#${iss.slide}`.padEnd(4) : "—   "} ${iss.kind.padEnd(22)} ${iss.detail}`);
  }
  console.log(`${ok ? "OK" : "FAIL"} slides=${doc.slides.length} plan=${covered}/${total} thin=${thin} leaks=${leaks} trunc=${trunc}`);
  return ok;
}

async function main() {
  const target = process.argv[2];
  if (!target || target.startsWith("--")) {
    console.error("Foydalanish: npm run slide-audit -- <deck.doc.json | katalog>");
    process.exitCode = 2;
    return;
  }
  const resolved = path.resolve(process.cwd(), target);
  let isDir: boolean;
  let files: string[];
  try {
    const st = await stat(resolved);
    isDir = st.isDirectory();
    files = isDir
      ? (await readdir(resolved))
          .filter((e) => e.endsWith(".doc.json"))
          .sort()
          .map((e) => path.join(resolved, e))
      : [resolved];
  } catch (e) {
    console.error(`✘ topilmadi: ${resolved} — ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
    return;
  }
  if (files.length === 0) {
    console.error(`Hech qanday *.doc.json topilmadi: ${resolved}`);
    process.exitCode = 2;
    return;
  }
  let allOk = true;
  let audited = 0;
  for (const f of files) {
    const result = await auditFile(f, { lenient: isDir });
    if (result === "skip") continue;
    audited++;
    allOk = allOk && result;
  }
  if (isDir && audited === 0) {
    console.error(`Katalogda slayd hujjati topilmadi (barcha *.doc.json boshqa vositaga tegishli): ${resolved}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = allOk ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
