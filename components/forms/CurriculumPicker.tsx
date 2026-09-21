"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { curriculumIndex, type CurriculumIndexSubject } from "@/lib/curriculum";
import { fetchCurriculumTopics, type CurriculumTopicsResponse } from "@/lib/api-client";
import { TEACHER_LIMITS } from "@/lib/generation/teacher/types";
import { SelectField } from "./compact";

/**
 * O'QUV DASTURI TANLOVI (AUDIT-20 WP-E) — fan → sinf → mavzular (≤5).
 *
 * Ikki qatlamli manba (`lib/curriculum.ts`): fan × sinf indeksi
 * (`curriculumIndex()`) STATIK IMPORT bo'lgani uchun tarmoqsiz, faqat
 * `hasCurriculum` bo'lgan fan/sinf ko'rinadi (X-2 — baza to'liqmas).
 * Mavzular esa `GET /api/curriculum?subject=&grade=` orqali —
 * fan fayli (~1,5 MB) klient bandliga kirmasligi kerak edi.
 *
 * `lib/curriculum.ts` `node:fs` ishlatmaydi (izomorf), shuning uchun bu
 * komponent uni TO'G'RIDAN-TO'G'RI import qiladi — server modulga
 * zanjir yo'q (`tests/client-boundary.test.mts`).
 */

export type CurriculumSelection = { subjectId: string; grade: number; topicIds: string[] };

const EMPTY: CurriculumSelection = { subjectId: "", grade: 0, topicIds: [] };
export { EMPTY as EMPTY_CURRICULUM_SELECTION };

function subjectLabel(s: CurriculumIndexSubject): string {
  return s.uz || s.id;
}

export function CurriculumPicker({
  value,
  onChange,
}: {
  value: CurriculumSelection;
  onChange: (next: CurriculumSelection) => void;
}) {
  const index = curriculumIndex();
  // Faqat bazada mavzular BOR fanlar (X-2) — bo'sh fan tanlansa forma
  // darhol 404 ga urilardi.
  const subjects = index.subjects.filter((s) => s.grades.length > 0);
  const subject = subjects.find((s) => s.id === value.subjectId) ?? null;
  const grades = subject?.grades ?? [];

  const [topics, setTopics] = useState<CurriculumTopicsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setTopics(null);
    setError(null);
    if (!value.subjectId || !value.grade) return;
    setLoading(true);
    fetchCurriculumTopics(value.subjectId, value.grade)
      .then((r) => {
        if (alive) setTopics(r);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "O'quv dasturi topilmadi");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [value.subjectId, value.grade]);

  function onSubjectChange(id: string) {
    const next = subjects.find((s) => s.id === id) ?? null;
    const grade = next?.grades.includes(value.grade) ? value.grade : (next?.grades[0] ?? 0);
    setUnitIdx(0);
    setQ("");
    onChange({ subjectId: next?.id ?? "", grade, topicIds: [] });
  }

  function onGradeChange(g: string) {
    setUnitIdx(0);
    setQ("");
    onChange({ ...value, grade: Number(g) || 0, topicIds: [] });
  }

  function toggleTopic(id: string) {
    const on = value.topicIds.includes(id);
    if (on) {
      onChange({ ...value, topicIds: value.topicIds.filter((t) => t !== id) });
      return;
    }
    if (value.topicIds.length >= TEACHER_LIMITS.curriculumTopicsMax) return;
    onChange({ ...value, topicIds: [...value.topicIds, id] });
  }

  const flat = topics ? topics.units.flatMap((u) => u.topics.map((t) => ({ ...t, unit: u.title }))) : [];

  /*
   * IXCHAMLIK (AUDIT-24 R2 topilmasi): 5-sinf matematikada 70, 11-sinfda
   * 61 mavzu bor — hammasi chip bulutida chizilsa test formasi 2 246 px
   * bo'lib ketardi (yopiq me'yor ≤ 1 200). Endi bir vaqtda faqat BITTA
   * bo'lim (o'rtacha 5–13 mavzu) yoki qidiruv natijasi (≤ 20) ko'rinadi;
   * tanlanganlar alohida qatorda turadi va bo'lim almashsa yo'qolmaydi.
   */
  const [unitIdx, setUnitIdx] = useState(0);
  const [q, setQ] = useState("");
  const units = topics?.units ?? [];
  const safeUnit = Math.min(unitIdx, Math.max(0, units.length - 1));
  const query = q.trim().toLowerCase();
  const shown = query
    ? flat.filter((t) => t.title.toLowerCase().includes(query)).slice(0, 20)
    : (units[safeUnit]?.topics ?? []).map((t) => ({ ...t, unit: units[safeUnit]?.title ?? "" }));
  const selected = value.topicIds.map((id) => flat.find((t) => t.id === id)).filter((t): t is (typeof flat)[number] => Boolean(t));

  return (
    <div className="space-y-2" data-curriculum-picker>
      <div className="flex flex-wrap gap-2">
        <span data-field="subjectId" className="block">
          <SelectField
            ariaLabel="Fan"
            value={value.subjectId}
            onChange={onSubjectChange}
            options={[{ value: "", label: "Fan tanlang" }, ...subjects.map((s) => ({ value: s.id, label: subjectLabel(s) }))]}
          />
        </span>
        <span className="block">
          <SelectField
            ariaLabel="Sinf"
            value={value.grade ? String(value.grade) : ""}
            onChange={onGradeChange}
            options={[{ value: "", label: "Sinf" }, ...grades.map((g) => ({ value: String(g), label: `${g}-sinf` }))]}
          />
        </span>
      </div>
      {/*
       * `data-field="topicIds"` HAR DOIM DOM da bo'lishi kerak (fan/sinf
       * tanlanmagan bo'lsa ham) — aks holda `teacherParamsOf("test")`
       * qamrov testi (`topicIds` reyestrda) mavzu tanlanmagan holatda
       * qizil chiqardi (`tests/viewer/teacher-form.test.mts`).
       */}
      <div data-field="topicIds">
        {value.subjectId && value.grade ? (
          <>
            {loading ? <p className="text-muted-foreground text-[12px]">Mavzular yuklanmoqda…</p> : null}
            {error ? <p className="text-destructive text-[12px]">{error}</p> : null}
            {topics ? (
              <>
                {selected.length ? (
                  <div className="mb-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Tanlangan mavzular" data-selected-topics>
                    {selected.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed
                        data-topic={t.id}
                        onClick={() => toggleTopic(t.id)}
                        title={`${t.unit} · olib tashlash`}
                        className="border-primary bg-primary text-primary-foreground rounded-full border px-2.5 py-1 text-[12px]"
                      >
                        {t.title} <span aria-hidden>×</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {units.length > 1 ? (
                    <SelectField
                      ariaLabel="Bo'lim"
                      value={String(safeUnit)}
                      onChange={(v) => {
                        setUnitIdx(Number(v) || 0);
                        setQ("");
                      }}
                      options={units.map((u, i) => ({ value: String(i), label: `${i + 1}. ${u.title} (${u.topics.length})` }))}
                    />
                  ) : null}
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Mavzu qidirish…"
                    aria-label="Mavzu qidirish"
                    className="border-input bg-card focus:ring-ring h-8 min-w-0 flex-1 rounded-lg border px-2 text-[13px] outline-none focus:ring-2"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mavzular">
                  {shown.filter((t) => !value.topicIds.includes(t.id)).map((t) => {
                    const on = value.topicIds.includes(t.id);
                    const disabled = !on && value.topicIds.length >= TEACHER_LIMITS.curriculumTopicsMax;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        disabled={disabled}
                        data-topic={t.id}
                        onClick={() => toggleTopic(t.id)}
                        title={t.unit}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted",
                        )}
                      >
                        {t.title}
                      </button>
                    );
                  })}
                </div>
                {query && !shown.length ? <p className="text-muted-foreground text-[12px]">Mos mavzu topilmadi.</p> : null}
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {value.topicIds.length}/{TEACHER_LIMITS.curriculumTopicsMax} mavzu tanlandi · {flat.length} mavzu, {units.length} bo&apos;lim — manba: {topics.source.title}
                </p>
              </>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-[12px]">Avval fan va sinfni tanlang.</p>
        )}
      </div>
    </div>
  );
}
