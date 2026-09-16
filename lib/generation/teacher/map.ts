/**
 * TEXNOLOGIK XARITA YOZUVCHISI (AUDIT-20 WP-A).
 *
 * `write-specials.ts mapDoc` ning o'rnini bosadi. Farqlar (R1 §3–§4 +
 * egasi qarori):
 *   • `choraklik` turi — TO'RTTA jadval, har biri o'z soat yig'indisi
 *     bilan; `yillik` — bitta jadval (eski xulq);
 *   • so'rov BO'LAKLARGA bo'linadi (chorak yoki yarim yil) va
 *     `mapPool(2)` bilan parallel yuboriladi — 34 haftalik xaritani
 *     bitta javobda so'rash jonli sinovda ishonchsiz edi (model 24
 *     qator qaytarardi va qolgani takrorlanardi);
 *   • `control` ustuni endi MODELDAN (egasi qarori); `fallbackControl`
 *     faqat model ustunni bo'sh qoldirganda ishlaydi;
 *   • `resources` ustuni qo'shildi — lekin JADVAL USTUNLARI
 *     o'zgarmaydi (`yearCols`, sinovdan o'tgan): resurs mavzular
 *     modelida saqlanadi va WP-C maketida ishlatiladi.
 *
 * Invariantlar (o'zgarmagan): hafta soni `weeksFor` (8–36), soat ustuni
 * yig'indisi `totalHours` ga QAT'IY teng, noyob mavzu ulushi ≥70 %.
 */
import type { Block, DocSection, DocTable } from "../types";
import { mapPool, remainingMs } from "../quality";
import { TEACHER_LIMITS, type MapModel, type MapQuarter, type MapWeek } from "./types";
import { mapUserPrompt, type MapPart, type TeacherContext } from "./prompts";
import { clean, clip, fallbackControl, fallbackMethod, fallbackResult, hoursFor, isGenericResult, isPlaceholderTopic, listOf, sumOf, weeksFor, weeksPerQuarter } from "./guard";
import { teacherJson, type TeacherWriter, type TeacherWritten } from "./engine";

const PART_MS = 60_000;
/** Bitta so'rovda so'raladigan eng ko'p qator — undan ortig'i bo'lakka bo'linadi. */
export const MAP_CHUNK = 12;
/** Va'da qilingan haftalarning kamida shu ulushi noyob mavzu bilan to'lishi kerak. */
export const MAP_FLOOR = 0.7;

type RawWeek = { n?: unknown; topic?: unknown; title?: unknown; method?: unknown; resources?: unknown; result?: unknown; control?: unknown };

/** Xaritani nechta so'rovga bo'lamiz — chorak turida doim 4 ta. */
export function mapParts(ctx: TeacherContext, weeks: number): MapPart[] {
  if (ctx.input.mapType === "choraklik") {
    const per = weeksPerQuarter(weeks);
    const out: MapPart[] = [];
    let from = 1;
    per.forEach((count, idx) => {
      out.push({ quarter: idx + 1, from, count });
      from += count;
    });
    return out;
  }
  const chunks = Math.max(1, Math.ceil(weeks / MAP_CHUNK));
  const base = Math.floor(weeks / chunks);
  const rest = weeks - base * chunks;
  const out: MapPart[] = [];
  let from = 1;
  for (let i = 0; i < chunks; i++) {
    const count = base + (i < rest ? 1 : 0);
    out.push({ quarter: 0, from, count });
    from += count;
  }
  return out;
}

/** Bitta bo'lak javobi -> tozalangan qatorlar (mavzu bo'sh/placeholder bo'lsa tashlanadi). */
export function rowsOf(raw: unknown[], startIndex: number): Omit<MapWeek, "n" | "hours">[] {
  const out: Omit<MapWeek, "n" | "hours">[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as RawWeek;
    const topic = clip(o.topic ?? o.title, 120);
    if (!topic || isPlaceholderTopic(topic)) continue;
    const idx = startIndex + out.length;
    const result = clip(o.result, 90);
    out.push({
      topic,
      method: clip(o.method, 60) || fallbackMethod(topic, idx),
      resources: clip(o.resources, 120),
      result: isGenericResult(result) ? fallbackResult(topic) : result,
      control: clip(o.control, 60) || fallbackControl(topic, idx),
    });
  }
  return out;
}

export const writeMap: TeacherWriter = async (ctx, ask, o) => {
  const i = ctx.input;
  const weeks = weeksFor(i.weeklyHours, i.totalHours);
  const parts = mapParts(ctx, weeks);
  const intro: string[] = [];

  /*
   * `mapPool(2)`: ikkitadan ortiq parallel so'rov provayder chegarasiga
   * urilardi (429), bittalab esa 4 chorak uchun 4×60 s kerak bo'lardi —
   * byudjet (`teacherBudgetMs`) buni ko'tarmaydi.
   */
  const answers = await mapPool(parts, 2, async (part, idx) => {
    const timeoutMs = Math.min(PART_MS, remainingMs(o.deadline));
    const maxTokens = Math.min(6000, 900 + part.count * 200);
    const raw = await ask("writer", mapUserPrompt(ctx, part, []), { maxTokens, timeoutMs });
    const data = teacherJson<{ intro?: unknown; weeks?: unknown; topics?: unknown }>(raw);
    if (idx === 0) intro.push(clip(data?.intro, 400));
    return { part, rows: rowsOf(listOf(data as Record<string, unknown> | null, "weeks", "topics"), part.from - 1) };
  });

  /* ── takror mavzularni tashlash (model bo'laklararo takrorlashi mumkin) ── */
  const seen = new Set<string>();
  const perPart = answers.map((a) => {
    const rows = a.rows.filter((r) => {
      const key = r.topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { part: a.part, rows };
  });

  /*
   * Bo'sh qolgan bo'lakni BIR MARTA qayta so'raymiz — boshqa
   * bo'laklardan chiqqan mavzular ro'yxati bilan (takror bo'lmasin).
   */
  for (const p of perPart) {
    if (p.rows.length >= Math.ceil(p.part.count * MAP_FLOOR)) continue;
    if (remainingMs(o.deadline) < 15_000) break;
    const raw = await ask("writer", mapUserPrompt(ctx, p.part, [...seen]), {
      maxTokens: Math.min(6000, 900 + p.part.count * 200),
      timeoutMs: Math.min(40_000, remainingMs(o.deadline)),
    });
    const data = teacherJson<{ weeks?: unknown }>(raw);
    for (const r of rowsOf(listOf(data as Record<string, unknown> | null, "weeks", "topics"), p.part.from - 1)) {
      const key = r.topic.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      p.rows.push(r);
      if (p.rows.length >= p.part.count) break;
    }
  }

  const flat = perPart.flatMap((p) => p.rows);
  /*
   * 70 % darvozasi (eski `mapDoc` qoidasi): tsikl bilan to'ldirmaymiz —
   * takrorlangan mavzuli xarita o'qituvchi uchun YARAMAYDI.
   */
  if (flat.length < Math.max(6, Math.ceil(weeks * MAP_FLOOR))) {
    console.warn(`[teacher] xarita: ${flat.length} noyob mavzu, kerak ~${weeks}`);
    return null;
  }

  const filled = flat.slice(0, weeks);
  const hours = hoursFor(filled.length, i.weeklyHours, i.totalHours);
  o.stage(55, `Haftalar: ${filled.length} ta, ${sumOf(hours)} ${ctx.labels.hoursWord}`);

  /* ── chorak/yil bo'yicha guruhlash ── */
  const quarters: MapQuarter[] = [];
  let cursor = 0;
  if (i.mapType === "choraklik") {
    for (const p of weeksPerQuarter(filled.length)) {
      const slice = filled.slice(cursor, cursor + p);
      quarters.push({
        n: quarters.length + 1,
        weeks: slice.map((r, k) => ({ ...r, n: cursor + k + 1, hours: hours[cursor + k] })),
      });
      cursor += p;
    }
  } else {
    quarters.push({ n: 0, weeks: filled.map((r, k) => ({ ...r, n: k + 1, hours: hours[k] })) });
  }

  const model: MapModel = {
    type: i.mapType,
    weeklyHours: i.weeklyHours,
    totalHours: i.totalHours,
    quarters,
  };

  /* ── bo'limlar va jadvallar (id lar SHARTNOMA) ── */
  const L = ctx.labels;
  const passport: Block[] = [
    {
      kind: "p",
      text: `${L.fieldSubject}: ${i.subject}. ${L.fieldWeeklyHours}: ${i.weeklyHours}. ${L.fieldTotalHours}: ${i.totalHours}. ${L.fieldWeeks}: ${filled.length}.`,
    },
    { kind: "p", text: clean(intro[0]) || L.mapIntroFallback },
  ];
  const sections: DocSection[] = [{ id: "passport", title: L.subjectPassport, blocks: passport }];
  const tables: DocTable[] = [];

  const rowOf = (w: MapWeek) => [String(w.n), String(w.hours), w.topic, w.method, w.result, w.control];

  if (i.mapType === "choraklik") {
    for (const q of quarters) {
      const id = `q${q.n}`;
      const title = L.quarter(q.n);
      const qh = sumOf(q.weeks.map((w) => w.hours));
      sections.push({
        id,
        title,
        blocks: [{ kind: "p", text: `${q.weeks.length} ${L.weekWord}, ${qh} ${L.hoursWord}.` }],
      });
      tables.push({ caption: `${title} — ${L.yearPlan}`, anchor: id, headers: [...L.yearCols], rows: q.weeks.map(rowOf) });
    }
  } else {
    sections.push({
      id: "year",
      title: L.yearPlan,
      blocks: [{ kind: "p", text: `${filled.length} ${L.weekWord}, ${i.totalHours} ${L.hoursWord}.` }],
    });
    tables.push({ caption: L.yearPlan, anchor: "year", headers: [...L.yearCols], rows: quarters[0].weeks.map(rowOf) });
  }

  const out: TeacherWritten = {
    sections,
    tables,
    model: { map: model },
    delivered: { got: filled.length, want: weeks, unit: L.lang === "uz" ? "hafta" : L.weekWord },
  };
  return out;
};

/** Reyestr chegarasi sinovlar uchun ochiq (hafta soni 8–36). */
export const MAP_WEEK_RANGE: readonly [number, number] = [TEACHER_LIMITS.weeksMin, TEACHER_LIMITS.weeksMax];
