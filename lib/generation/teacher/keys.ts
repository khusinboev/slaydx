/**
 * KEYS (VAZIYATLI TOPSHIRIQ) YOZUVCHISI (AUDIT-20 WP-A).
 *
 * `write-specials.ts writeKeysWithLlm` ning o'rnini bosadi. Saqlangan
 * qarorlar: ikkinchi urinish YENGILROQ so'rov bilan (jonli sinovda
 * bitta og'ir so'rov timeout'ga urilib butun ish FAILED bo'lgan edi),
 * rubrika ballari yig'indisi QAT'IY 10, mundarija yo'q.
 *
 * Qo'shilganlar (R2 §3–§4 + egasi qarori):
 *   • `caseCount` 3/5/8 (narxsiz) — eski kodda 3–5 qattiq yozilgan edi;
 *   • `audience` (maktab/OTM) — til murakkabligi va rubrika shkalasi;
 *   • to'rt TUR (`muammoli`/`tahliliy`/`qaror-qabul-qilish`/`rolli`) —
 *     topshiriq formulirovkasini reyestr `guidance` si o'zgartiradi;
 *   • `noDuplicateCase` — model bir keysni ikki marta bermasin.
 *
 * Bo'lim id lari SHARTNOMA: `intro`, `case1..caseN`, `rubric`. Rubrika
 * ALOHIDA bo'limda (eski kodda har keys ichida edi): o'qituvchi
 * baholashda butun rubrikani bir varaqda ko'rishi kerak, va WP-C
 * maketi uni alohida bet sifatida chiza oladi.
 */
import type { Block, DocSection } from "../types";
import { remainingMs } from "../quality";
import { TEACHER_LIMITS, type KeysCase, type KeysModel } from "./types";
import type { KeysTypeSpec } from "./registry";
import { keysUserPrompt } from "./prompts";
import { caseKey, clean, clip, listOf, rubricRows, sumOf } from "./guard";
import { teacherJson, type TeacherWriter, type TeacherWritten } from "./engine";

const CALL_MS = 60_000;
const RETRY_MS = 45_000;
/** Kamida shuncha keys chiqmasa hujjat yaroqsiz (eski qoida: 3). */
export const KEYS_MIN = TEACHER_LIMITS.casesMin;

type RawCase = {
  title?: unknown;
  situation?: unknown;
  questions?: unknown;
  tasks?: unknown;
  solution?: unknown;
  key?: unknown;
  rubric?: unknown;
};

/** Model javobi -> tozalangan keyslar (takror va bo'sh kalitli tashlanadi). */
export function casesOf(raw: unknown[], want: number, seen: Set<string>): KeysCase[] {
  const out: KeysCase[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as RawCase;
    const title = clip(o.title, 120);
    const situation = clip(o.situation, TEACHER_LIMITS.situationCharsMax);
    if (!title || !situation) continue;
    const key = caseKey(title, situation);
    if (seen.has(key)) continue;
    const questions = listOf(o as Record<string, unknown>, "questions", "tasks")
      .map((q) => clip(q, 240))
      .filter(Boolean)
      .slice(0, TEACHER_LIMITS.caseQuestionsMax);
    const solution = clip(o.solution ?? o.key, 900);
    /*
     * Topshiriqsiz yoki kalitsiz keys — YARIM mahsulot: o'qituvchi uni
     * darsda ishlata olmaydi, lekin hujjatda «Keys 3» bo'lib turadi.
     * Shuning uchun u QABUL QILINMAYDI (hisobotdagi `hasQuestions` /
     * `hasSolution` bandlari esa tahrirdan keyingi holatni tekshiradi).
     */
    if (questions.length < TEACHER_LIMITS.caseQuestionsMin || !solution) continue;
    seen.add(key);
    out.push({ title, situation, questions, solution, rubric: rubricRows(listOf(o as Record<string, unknown>, "rubric")) });
    if (out.length >= want) break;
  }
  return out;
}

export const writeKeys: TeacherWriter = async (ctx, ask, o) => {
  const spec = ctx.spec as KeysTypeSpec;
  const i = ctx.input;
  const want = Math.max(spec.limits.cases[0], Math.min(spec.limits.cases[spec.limits.cases.length - 1], i.caseCount));
  const seen = new Set<string>();

  const askCases = async (count: number, timeoutMs: number, already: string[]) => {
    const raw = await ask("writer", keysUserPrompt(ctx, count, already), {
      maxTokens: Math.min(8000, 1400 + count * 480),
      timeoutMs,
    });
    return teacherJson<{ intro?: unknown; cases?: unknown; keys?: unknown }>(raw);
  };

  let data = await askCases(want, Math.min(CALL_MS, remainingMs(o.deadline)), []);
  const cases = casesOf(listOf(data as Record<string, unknown> | null, "cases", "keys"), want, seen);
  let intro = clip(data?.intro, 400);

  /*
   * Ikkinchi urinish — YENGILROQ so'rov (faqat yetishmagani). Timeout
   * bo'yicha `complete` qayta urinmaydi (byudjet sarflangan), shuning
   * uchun qayta urinish shu yerda va kichikroq hajm bilan bo'lishi kerak.
   */
  if (cases.length < want && remainingMs(o.deadline) > 18_000) {
    o.stage(40, `Keyslar: ${cases.length}/${want} — qayta urinilmoqda`);
    data = await askCases(want - cases.length, Math.min(RETRY_MS, remainingMs(o.deadline)), cases.map((c) => c.title));
    if (!intro) intro = clip(data?.intro, 400);
    cases.push(...casesOf(listOf(data as Record<string, unknown> | null, "cases", "keys"), want - cases.length, seen));
  }

  if (cases.length < KEYS_MIN) {
    console.warn(`[teacher] keys: ${cases.length} ta, kerak kamida ${KEYS_MIN}`);
    return null;
  }
  o.stage(55, `Keyslar: ${cases.length} ta`);

  const model: KeysModel = { type: i.type, audience: i.audience, cases };

  const L = ctx.labels;
  const sections: DocSection[] = [
    { id: "intro", title: L.intro, blocks: [{ kind: "p", text: clean(intro) || L.keysIntroFallback(i.topic) }] },
  ];

  cases.forEach((c, idx) => {
    const blocks: Block[] = [
      { kind: "p", text: c.situation },
      { kind: "h3", text: L.tasks },
      ...c.questions.map((q): Block => ({ kind: "li", text: q })),
      { kind: "h3", text: L.answerKey },
      { kind: "p", text: c.solution },
    ];
    sections.push({ id: `case${idx + 1}`, title: `${L.caseWord} ${idx + 1}. ${c.title}`, blocks });
  });

  /*
   * Rubrika bo'limi — faqat BALLI mezonlar bor keyslar uchun. Yarim
   * rubrika (mezoni bor, balli yo'q) `rubricRows` da allaqachon bo'sh
   * ro'yxatga aylangan: yo'qdan yomonroq.
   */
  const rubricBlocks: Block[] = [];
  cases.forEach((c, idx) => {
    if (!c.rubric.length) return;
    rubricBlocks.push({ kind: "h3", text: `${L.caseWord} ${idx + 1}` });
    for (const r of c.rubric) rubricBlocks.push({ kind: "li", text: `${r.criterion} — ${r.points} ${L.points}` });
    rubricBlocks.push({ kind: "p", text: `${L.totalPoints}: ${sumOf(c.rubric.map((r) => r.points))} ${L.points}` });
  });
  if (rubricBlocks.length) sections.push({ id: "rubric", title: L.rubric, blocks: rubricBlocks });

  const out: TeacherWritten = {
    sections,
    tables: [],
    model: { keys: model },
    delivered: { got: cases.length, want, unit: "keys" },
  };
  return out;
};
