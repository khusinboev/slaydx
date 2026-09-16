/**
 * GLOSSARIY YOZUVCHISI (AUDIT-20 WP-A).
 *
 * `write-specials.ts writeGlossaryWithLlm` ning o'rnini bosadi. Saqlangan
 * qarorlar: 20 talik BO'LAKLAR (40 ta atamani bitta javobda so'rash
 * ishonchsiz), 70 % darvozasi, alifbo tartibi bir marta (matn va jadval
 * bitta ro'yxatdan), «qisqa jadval» ATAYIN yo'q (ikkinchi nusxa).
 *
 * Qo'shilganlar (R2 §3–§4 + egasi qarori):
 *   • `noStubDefinition` — tavtologik ta'rif («Fotosintez — bu
 *     fotosintez jarayoni») endi QABUL QILINMAYDI, hisobotda ham bandi
 *     bor;
 *   • `includeExample` (standart yoqiq) — misol qatori;
 *   • `uch-tilli` turi — ru/en ustunli JADVAL qo'shiladi.
 *
 * Uch tilli jadval ATAMA + RU + EN ustunlari bilan chiziladi, TA'RIF
 * ustunisiz: ta'rif yuqorida to'liq turadi va uni jadvalda 200 belgiga
 * kesib takrorlash aynan AUDIT-6 B5 da olib tashlangan naqsh edi.
 * Jadval shu bilan qidiruv vositasi bo'lib qoladi, nusxa emas.
 */
import type { DocSection, DocTable } from "../types";
import { remainingMs } from "../quality";
import { TEACHER_LIMITS, type GlossaryModel, type GlossaryTerm } from "./types";
import type { GlossaryTypeSpec } from "./registry";
import { glossaryUserPrompt } from "./prompts";
import { clean, clip, glossaryTermBlocks, glossaryTriTable, listOf, pickTerms, sortTerms } from "./guard";
import { teacherJson, type TeacherWriter, type TeacherWritten } from "./engine";

/** Bitta so'rovda so'raladigan eng ko'p atama (eski qaror — o'zgarmaydi). */
export const GLOSSARY_CHUNK = 20;
/** Va'da qilingan atamalarning kamida shu ulushi kerak (`delivered` farqni qaytaradi). */
export const GLOSSARY_FLOOR = 0.7;
const CALL_MS = 55_000;
/** Bo'sh javobdan keyin ham urinishlar soni cheklangan — byudjet chekli. */
const MAX_ROUNDS = 4;

export const writeGlossary: TeacherWriter = async (ctx, ask, o) => {
  const spec = ctx.spec as GlossaryTypeSpec;
  const i = ctx.input;
  const want = i.termCount;
  const defMax = spec.limits.defChars[1];

  const collected: GlossaryTerm[] = [];
  const seen = new Set<string>();
  let intro = "";

  for (let round = 0; round < MAX_ROUNDS && collected.length < want; round++) {
    if (remainingMs(o.deadline) < 12_000) break;
    const need = want - collected.length;
    const count = Math.min(GLOSSARY_CHUNK, need);
    const raw = await ask("writer", glossaryUserPrompt(ctx, count, collected.map((t) => t.term)), {
      maxTokens: Math.min(8000, 1200 + count * 150),
      timeoutMs: Math.min(CALL_MS, remainingMs(o.deadline)),
    });
    const data = teacherJson<{ intro?: unknown; terms?: unknown; items?: unknown }>(raw);
    if (!intro) intro = clip(data?.intro, 500);
    const batch = pickTerms(listOf(data as Record<string, unknown> | null, "terms", "items"), seen, { defMax });
    // Model progress bermay qo'ydi — tsiklni davom ettirish foydasiz.
    if (!batch.length) break;
    collected.push(...batch);
    o.stage(Math.min(60, 20 + Math.round((collected.length / want) * 40)), `Atamalar: ${collected.length}/${want}`);
  }

  if (collected.length < Math.max(TEACHER_LIMITS.termsMin, Math.ceil(want * GLOSSARY_FLOOR))) {
    console.warn(`[teacher] glossariy: ${collected.length} atama, kerak ~${want}`);
    return null;
  }

  /*
   * Alifbo tartibi BIR MARTA, shu ro'yxat ustida: matn ham, jadval ham
   * undan quriladi, ya'ni ikkalasi hech qachon ajralib ketmaydi.
   */
  const terms = sortTerms(collected.slice(0, want), i.language);
  const tri = i.translationLangs.length > 0;

  const model: GlossaryModel = { type: i.type, terms, order: "alpha", includeExample: i.includeExample };

  const L = ctx.labels;
  const termBlocks = glossaryTermBlocks(terms, L.example, i.includeExample);

  const sections: DocSection[] = [
    { id: "intro", title: L.intro, blocks: [{ kind: "p", text: clean(intro) || L.glossaryIntroFallback(i.topic) }] },
    { id: "terms", title: L.terms, blocks: termBlocks },
  ];

  const tables: DocTable[] = tri ? [glossaryTriTable(terms, L.terms, L.triCols)] : [];

  const out: TeacherWritten = {
    sections,
    tables,
    model: { glossary: model },
    delivered: { got: terms.length, want, unit: "atama" },
  };
  return out;
};
