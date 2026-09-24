/**
 * INFOGRAFIKA TAYYORLIK HISOBOTI (AUDIT-21 WP-C) — `reviewInfographic`.
 *
 * Ikki qatlam (`teacher/review.ts` bilan bir xil naqsh, mantiq NEYTRAL
 * qatlamda `report/`):
 *   1. QOIDALAR — `registry.ts INFOGRAPHIC_RULE_IDS` da QULFLANGAN
 *      o'nta deterministik band (tadqiqot §4);
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3.
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 % baholovchi).
 *
 * Nega kirish `AcademicDoc`, sof `InfographicSpec` emas: hisobot
 * avto-sayqaldan KEYIN ham chaqiriladi (`report/polish-core.ts
 * runPolishWith` `review(doc, guard)` shaklini talab qiladi), va
 * o'shanda o'zgargan narsa hujjat ichidagi spetsifikatsiya bo'ladi.
 * MAKET esa har safar QAYTA hisoblanadi (`layoutInfographic`) —
 * `noOverflow` bandi maketning haqiqiy natijasini o'lchashi kerak,
 * eski bayroqni emas.
 *
 * Izomorf: DOM/`sharp`/server importi yo'q.
 */
import type { AcademicDoc } from "../types";
import type { DocReview, JudgeResult, ReviewCheck, ReviewGuardInput, UserNeed } from "../report/types";
import { check, rewrite, scoreReviewFor } from "../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../report/judge";
import { remainingMs } from "../quality";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn } from "../research/pipeline";
import { INFOGRAPHIC_LIMITS, PALETTE_BY_ID, isKnownIcon, type InfographicBlock, type InfographicSpec, type PaletteId } from "./types";
import { infographicTypeOf, type InfographicJudgeCriterion } from "./registry";
import { layoutInfographic } from "./layout";

export type InfographicJudgeResult = JudgeResult<InfographicJudgeCriterion>;

export type InfographicReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  now?: Date;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  /**
   * Formada SO'RALGAN blok soni. Hisobot hujjatdan qayta hisoblanadi,
   * lekin «nechta so'ralgan» hujjatda YO'Q — uni chaqiruvchi beradi
   * (sayqal ham o'sha qiymatni uzatadi, aks holda band sayqaldan
   * keyin boshqacha baholanardi).
   */
  want?: number;
};

/** Sayqal va «Tuzatish» uchun yagona nishon: plakatning O'ZI. */
export const SPEC_TARGET = "spec";

const L = INFOGRAPHIC_LIMITS;

const words = (s: string): number => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/** Plakatdagi BARCHA matn — `textLength` bandi uchun. */
export function specWords(spec: InfographicSpec): number {
  return (
    words(spec.title) +
    words(spec.subtitle ?? "") +
    spec.blocks.reduce((n, b) => n + words(b.heading) + words(b.text) + words(b.stat?.label ?? ""), 0)
  );
}

/* ══════════════════════════ halollik ══════════════════════════ */

/** Raqamlar (foiz, son, yil) — halollik solishtiruvi uchun normallashgan. */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  // NBSP va oddiy bo'shliq bilan ajratilgan guruhlar («1 200») bitta son.
  for (const m of String(text ?? "").matchAll(/\d[\d   ]*(?:[.,]\d+)?/g)) {
    const n = m[0].replace(/[  \s]/g, "").replace(",", ".").replace(/\.0+$/, "");
    if (n) out.push(n.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/**
 * Raqam foydalanuvchi ma'lumotiga tayanadimi.
 *
 * Solishtirish RAQAMNING O'ZI bo'yicha, matn bo'yicha emas: model
 * «71%» ni «Yer yuzasining 71 foizi» deb boshqacha yozishi mumkin,
 * lekin RAQAM o'zgarmaydi. Shu sabab `InfographicBlock.stat` R0 da
 * ataylab `{value, label}` tuzilmasi qilingan.
 */
export function groundedIn(value: string, facts: string): boolean {
  const have = new Set(numbersIn(facts));
  const want = numbersIn(value);
  if (!want.length) return true; // raqamsiz qiymat («ko'p», «uchdan biri») — tekshirilmaydi
  return want.every((n) => have.has(n));
}

/* ══════════════════════════ qoidalar ══════════════════════════ */

export function infographicChecks(spec: InfographicSpec, facts: string, want?: number): ReviewCheck[] {
  const type = infographicTypeOf(spec.type);
  const [min, max] = type.limits.blocks;
  const out: ReviewCheck[] = [];
  const n = spec.blocks.length;

  /* ── 1. blockCount ── */
  {
    const d = `${n} blok (tur chegarasi ${min}–${max}${want ? `, so‘ralgan ${want}` : ""})`;
    out.push(
      n < min || n > max
        ? check("blockCount", "red", "Blok soni", `${d} — chegaradan tashqarida`, rewrite(SPEC_TARGET, `The poster must have between ${min} and ${max} blocks for this type; rewrite it with ${want ?? type.limits.blocksDefault} blocks.`))
        : want && n !== want
          ? check("blockCount", "yellow", "Blok soni", `${d} — so‘ralganidan farq qiladi`)
          : check("blockCount", "green", "Blok soni", d),
    );
  }

  /* ── 2. textLength ── */
  {
    const total = specWords(spec);
    const d = `${total} so‘z (chegara ${L.textWordsMax})`;
    const longBlocks = spec.blocks.filter((b) => words(b.text) > L.blockTextWordsMax).map((b) => b.id);
    out.push(
      total > L.textWordsMax || longBlocks.length
        ? check(
            "textLength",
            total > L.textWordsMax * 1.25 ? "red" : "yellow",
            "Matn hajmi",
            longBlocks.length ? `${d}; uzun bloklar: ${list(longBlocks)}` : `${d} — ko‘p`,
            rewrite(SPEC_TARGET, `Cut the poster text to at most ${L.textWordsMax} words in total and ${L.blockTextWordsMax} words per block, keeping every fact.`),
          )
        : check("textLength", "green", "Matn hajmi", d),
    );
  }

  /* ── 3. titleLength ── */
  {
    const t = spec.title.length;
    const sub = (spec.subtitle ?? "").length;
    const d = `sarlavha ${t}/${L.titleCharsMax}, ost sarlavha ${sub}/${L.subtitleCharsMax} belgi`;
    out.push(
      t === 0
        ? check("titleLength", "red", "Sarlavha", "sarlavha yo‘q", rewrite(SPEC_TARGET, "Give the poster a concrete title naming the topic."))
        : t > L.titleCharsMax || sub > L.subtitleCharsMax
          ? check("titleLength", "yellow", "Sarlavha", `${d} — uzun`, rewrite(SPEC_TARGET, `Shorten the title to ${L.titleCharsMax} characters and the subtitle to ${L.subtitleCharsMax}.`))
          : check("titleLength", "green", "Sarlavha", d),
    );
  }

  /* ── 4. headingLength ── */
  {
    const long = spec.blocks.filter((b) => b.heading.length > L.headingCharsMax).map((b) => b.id);
    const empty = spec.blocks.filter((b) => !b.heading.trim()).map((b) => b.id);
    out.push(
      empty.length
        ? check("headingLength", "red", "Blok sarlavhalari", `sarlavhasiz bloklar: ${list(empty)}`, rewrite(SPEC_TARGET, "Every block needs a short heading of a few words."))
        : long.length
          ? check("headingLength", "yellow", "Blok sarlavhalari", `${L.headingCharsMax} belgidan uzun: ${list(long)}`, rewrite(SPEC_TARGET, `Shorten every block heading to at most ${L.headingCharsMax} characters — a scannable phrase, not a sentence.`))
          : check("headingLength", "green", "Blok sarlavhalari", `${n} ta, hammasi ≤${L.headingCharsMax} belgi`),
    );
  }

  /* ── 5. iconKnown ── */
  {
    const bad = spec.blocks.filter((b) => !isKnownIcon(b.icon)).map((b) => `${b.id}:${b.icon || "—"}`);
    out.push(
      bad.length
        ? check("iconKnown", "yellow", "Ikonlar", `standart ikonga almashtirildi: ${list(bad)}`)
        : check("iconKnown", "green", "Ikonlar", `${n} ta ikon tasdiqlangan ro‘yxatdan`),
    );
  }

  /* ── 6. contrast ── */
  {
    /*
     * RUNTIME tekshiruv EMAS: palitralar statik va ular
     * `tests/infographic-registry` da WCAG formulasi bilan HISOBLAB
     * qulflangan. Band ro'yxatda qoladi, chunki hujjat paneli
     * foydalanuvchiga «kontrast tekshirildi» deb aytishi kerak.
     */
    const p = PALETTE_BY_ID[spec.palette as PaletteId];
    out.push(
      p
        ? check("contrast", "green", "Rang kontrasti", `${p.label.uz} — matn/fon juftliklari WCAG AA (≥4.5:1)`)
        : check("contrast", "yellow", "Rang kontrasti", "noma’lum palitra — standart (Indigo) qo‘llandi"),
    );
  }

  /* ── 7. noOverflow ── */
  {
    const layout = layoutInfographic(spec);
    out.push(
      layout.overflow.length
        ? check(
            "noOverflow",
            "red",
            "Matn kartaga sig‘ishi",
            `kesilgan bloklar: ${list(layout.overflow)}`,
            rewrite(SPEC_TARGET, `Shorten the text of these blocks so it fits the printed card: ${layout.overflow.join(", ")}. Aim for about half the current length in each.`),
          )
        : check("noOverflow", "green", "Matn kartaga sig‘ishi", `${spec.size} bosma maketda hamma matn to‘liq ko‘rinadi`),
    );
  }

  /* ── 8. statPresent ── */
  {
    const needsStat = type.requires.includes("stat");
    const withStat = spec.blocks.filter((b) => (b.stat?.value ?? "").trim());
    if (!needsStat) {
      out.push(check("statPresent", "green", "Statistika", withStat.length ? `${withStat.length} blokda raqam (bu turda ixtiyoriy)` : "bu turda raqam talab qilinmaydi"));
    } else {
      const missing = spec.blocks.filter((b) => !(b.stat?.value ?? "").trim()).map((b) => b.id);
      out.push(
        missing.length
          ? check("statPresent", "red", "Statistika", `raqamsiz bloklar: ${list(missing)}`, rewrite(SPEC_TARGET, `In a statistics poster every block carries a stat value taken from the user's data; drop the blocks you cannot support with a supplied number instead of inventing one: ${missing.join(", ")}.`))
          : check("statPresent", "green", "Statistika", `${n} blokning hammasida raqam bor`),
      );
      const tooLong = withStat.filter((b) => b.stat!.value.length > L.statValueCharsMax).map((b) => b.id);
      if (tooLong.length) out.push(check("statValue", "yellow", "Raqam uzunligi", `badge ichiga sig‘maydi: ${list(tooLong)}`));
    }
  }

  /* ── 9. typeFields ── */
  {
    const fields = type.requires.filter((f) => f !== "stat");
    const bad: string[] = [];
    for (const f of fields) {
      const missing = spec.blocks.filter((b) => !fieldOf(b, f)).map((b) => b.id);
      if (missing.length) bad.push(`${f}: ${list(missing)}`);
    }
    if (type.id === "compare") {
      const left = spec.blocks.filter((b) => b.side === "left").length;
      const right = spec.blocks.filter((b) => b.side === "right").length;
      if (left !== right) bad.push(`ustunlar teng emas (${left}/${right})`);
    }
    if (type.id === "cause-effect") {
      const causes = spec.blocks.filter((b) => b.role === "cause").length;
      const effects = spec.blocks.filter((b) => b.role === "effect").length;
      if (causes < 2 || effects < 2) bad.push(`sabab ${causes}, natija ${effects} — har guruhda kamida 2 ta bo‘lishi kerak`);
    }
    out.push(
      bad.length
        ? check("typeFields", "red", "Turga xos maydonlar", bad.join("; "), rewrite(SPEC_TARGET, `Fill the fields this poster type requires (${type.requires.join(", ")}) in every block, and keep the type's own balance rules.`))
        : check("typeFields", "green", "Turga xos maydonlar", fields.length ? `${fields.join(", ")} — hamma blokda` : "bu turda qo‘shimcha maydon talab qilinmaydi"),
    );
  }

  /* ── 10. sourceGrounded ── */
  {
    const invented = spec.blocks.filter((b) => b.stat?.value && !groundedIn(b.stat.value, facts)).map((b) => `${b.id}:${b.stat!.value}`);
    const src = (spec.source ?? "").trim();
    const srcOk = !src || facts.toLowerCase().includes(src.toLowerCase().slice(0, 12));
    out.push(
      invented.length
        ? check(
            "sourceGrounded",
            "red",
            "Raqamlar halolligi",
            `foydalanuvchi bermagan raqamlar: ${list(invented)}`,
            rewrite(SPEC_TARGET, `Remove every stat value that does not appear in the user's data (${invented.join(", ")}); write the block qualitatively instead. Do not replace one invented figure with another.`),
          )
        : !srcOk
          ? check("sourceGrounded", "yellow", "Manba halolligi", "manba qatori foydalanuvchi bergan ma’lumotda uchramadi", rewrite(SPEC_TARGET, "Remove the source line: it was not supplied by the user."))
          : check("sourceGrounded", "green", "Raqamlar halolligi", src ? "raqamlar va manba foydalanuvchi ma’lumotidan" : "o‘ylab topilgan raqam yo‘q"),
    );
  }

  return out;
}

function fieldOf(b: InfographicBlock, f: "order" | "side" | "role" | "when"): boolean {
  if (f === "order") return typeof b.order === "number" && b.order > 0;
  if (f === "side") return b.side === "left" || b.side === "right";
  if (f === "role") return b.role === "cause" || b.role === "effect";
  return Boolean((b.when ?? "").trim());
}

/* ══════════════════════════ «Sizdan kutiladi» ══════════════════════════ */

/**
 * AI O'YLAB TOPMAYDIGAN narsalar (AUDIT-18 Q-2). Plakatda ular ikkita:
 * STATISTIKA va MANBA — aynan hisobotning halollik chegarasi taqiqlagan
 * ikki maydon.
 */
export function infographicUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const spec = doc.infographic?.spec;
  if (!spec) return [];
  const out: UserNeed[] = [];
  const facts = String(doc.meta.extra ?? "").trim();
  const type = infographicTypeOf(spec.type);

  if (type.requires.includes("stat") && !numbersIn(facts).length) {
    out.push({
      id: "stat",
      label: "Statistika raqamlari",
      hint: "Statistika plakati raqamsiz to‘liq bo‘lmaydi — AI ularni o‘ylab topmaydi. Raqamlarni «Qo‘shimcha ma’lumot» maydoniga yozing yoki manba fayl yuklang",
    });
  }
  if (!(spec.source ?? "").trim()) {
    out.push({
      id: "source",
      label: "Manba",
      hint: "Pastki qatordagi manba faqat siz bergan bo‘lsa yoziladi (darslik, hisobot, sayt) — uydirma havola chizilmaydi",
    });
  }
  for (const id of ["noOverflow", "blockCount"]) {
    const c = review.checks.find((x) => x.id === id);
    if (c && c.level === "red" && id === "blockCount") {
      out.push({ id, label: "Blok soni", hint: `${c.detail ?? ""} — mavzuni toraytiring yoki kamroq blok tanlang` });
    }
  }
  return out;
}

/* ══════════════════════════ baholovchi ══════════════════════════ */

/** Baholovchiga beriladigan plakat matni (JSON emas — o'qilishi oson). */
export function judgeText(spec: InfographicSpec): string {
  const rows = spec.blocks.map((b, i) => {
    const bits = [
      b.order !== undefined ? `#${b.order}` : "",
      b.when ? `[${b.when}]` : "",
      b.side ? `(${b.side})` : "",
      b.role ? `(${b.role})` : "",
      b.stat?.value ? `«${b.stat.value} ${b.stat.label ?? ""}»` : "",
    ].filter(Boolean);
    return `${b.id} ${bits.join(" ")} ${b.heading} — ${b.text}`.replace(/\s+/g, " ").trim() || `${i + 1}`;
  });
  return [`TITLE: ${spec.title}`, spec.subtitle ? `SUBTITLE: ${spec.subtitle}` : "", `TYPE: ${spec.type}`, "BLOCKS:", ...rows, spec.source ? `SOURCE: ${spec.source}` : "SOURCE: (none)"]
    .filter(Boolean)
    .join("\n");
}

export const targetsOf = (spec: InfographicSpec): string[] => [SPEC_TARGET, ...spec.blocks.map((b) => b.id)];

export function neutralInfographicJudge(spec: InfographicSpec): InfographicJudgeResult {
  return neutralJudgeFor(infographicTypeOf(spec.type).judge);
}

export function infographicJudgeChecks(spec: InfographicSpec, j: InfographicJudgeResult): ReviewCheck[] {
  return judgeChecksFor(infographicTypeOf(spec.type).judge, j);
}

export function scoreInfographicReview(rules: ReviewCheck[], spec: InfographicSpec, j: InfographicJudgeResult): number {
  return scoreReviewFor(rules, j, infographicTypeOf(spec.type).judge.criteria);
}

async function runJudge(spec: InfographicSpec, facts: string, opts: InfographicReviewOpts): Promise<{ judge: InfographicJudgeResult; answered: boolean }> {
  const judgeSpec = infographicTypeOf(spec.type).judge;
  if (opts.judge === false || !opts.complete) return { judge: neutralJudgeFor(judgeSpec), answered: true };
  if (remainingMs(opts.deadline) < JUDGE_MIN_MS) return { judge: neutralJudgeFor(judgeSpec), answered: false };
  const targets = targetsOf(spec);
  const system = judgeSystemPromptFor(judgeSpec, targets);
  const user = [judgeText(spec), "", facts ? `USER DATA (the only admissible source of figures and citations):\n${facts.slice(0, 4000)}` : "USER DATA: none"].join("\n");
  const r = await opts
    .complete("judge", system, user, { json: true, deadline: opts.deadline, maxTokens: 1200, timeoutMs: Math.min(JUDGE_TIMEOUT_MS, Math.max(1, remainingMs(opts.deadline))) })
    .catch(() => null);
  if (r?.usage) opts.onUsage?.(r.usage);
  const parsed = parseJudgeFor(judgeSpec, r?.text, targets);
  return parsed ? { judge: parsed, answered: true } : { judge: neutralJudgeFor(judgeSpec), answered: false };
}

/* ══════════════════════════ kirish nuqtasi ══════════════════════════ */

export async function reviewInfographic(doc: AcademicDoc, opts: InfographicReviewOpts = {}): Promise<DocReview> {
  const spec = doc.infographic?.spec;
  const now = opts.now ?? new Date();
  if (!spec) {
    return { score: 0, checks: [check("blockCount", "red", "Blok soni", "plakat spetsifikatsiyasi yo‘q")], judgeNotes: [], verifiedShare: 0, recentShare: 0, builtAt: now.toISOString() };
  }
  const facts = String(doc.meta.extra ?? "");
  const rules = infographicChecks(spec, facts, opts.want);
  const { judge, answered } = await runJudge(spec, facts, opts);
  const review: DocReview = {
    score: scoreInfographicReview(rules, spec, judge),
    checks: [...rules, ...infographicJudgeChecks(spec, judge)],
    judgeNotes: answered ? judge.notes : [...judge.notes, JUDGE_NO_ANSWER],
    /*
     * `verifiedShare`/`recentShare` — MAQOLA o'lchovlari (tekshirilgan
     * va yangi manbalar ulushi). Plakatda adabiyotlar ro'yxati yo'q,
     * shuning uchun 0: panel ularni ko'rsatmaydi. Maydon `DocReview`
     * shartnomasida majburiy, ya'ni soxta 1 yozish «hammasi
     * tekshirilgan» degan yolg'on bo'lardi.
     */
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
  review.userNeeds = infographicUserNeeds(review, doc);
  return review;
}
