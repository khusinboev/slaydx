"use client";

import { TEACHER_LIMITS } from "@/lib/generation/teacher/types";
import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { parseTeacherList } from "@/lib/generation/teacher/input";
import { Row, Segmented, SelectField } from "../compact";
import { Field, LimitedTextarea } from "../shared";
import { nearestNum, type KindProps, type Ui } from "./common";

/**
 * DARS REJASI qatorlari (AUDIT-24 WP-B).
 *
 * ASOSIY karta — tur va davomiylik (hujjat skeletini shular belgilaydi);
 * qolgani (bosqichlar, kompetensiyalar, baholash) ▸ Sozlamalarda.
 */

const ASSESSMENT_STYLE_OPTIONS = [
  { value: "an'anaviy", label: "An'anaviy" },
  { value: "bsb", label: "BSB uslubida" },
];

/** Tur almashganda chegaralarni yangi turga siqish (eski `onTypeChange` shoxi). */
export function lessonApplyType(prev: Ui, id: string): Ui {
  const t = teacherTypeOf("lesson", id);
  return {
    ...prev,
    typeId: id,
    duration: nearestNum(t.limits.durations, prev.duration, t.limits.durationDefault),
    stageCount: Math.max(t.limits.stages[0], Math.min(t.limits.stages[1], prev.stageCount)),
  };
}

export function LessonMain({ ui, set, onTypeChange }: KindProps & { onTypeChange: (id: string) => void }) {
  const t = teacherTypeOf("lesson", ui.typeId);
  return (
    <>
      <Row label="Dars turi" hint={t.hint}>
        <Field id="lessonType">
          <SelectField
            ariaLabel="Dars turi"
            value={ui.typeId}
            onChange={onTypeChange}
            options={teacherTypesOf("lesson").map((x) => ({ value: x.id, label: x.label.uz }))}
          />
        </Field>
      </Row>
      <Row label="Davomiylik" hint="Daqiqa">
        <Field id="duration">
          <Segmented
            ariaLabel="Davomiylik"
            options={t.limits.durations.map((n) => ({ value: String(n), label: `${n} daq` }))}
            value={String(ui.duration)}
            onChange={(v) => set("duration", Number(v))}
          />
        </Field>
      </Row>
    </>
  );
}

export function LessonSettings({ ui, set }: KindProps) {
  const t = teacherTypeOf("lesson", ui.typeId);
  const stages = Array.from({ length: t.limits.stages[1] - t.limits.stages[0] + 1 }, (_, i) => t.limits.stages[0] + i);
  return (
    <>
      <Row label="Bosqichlar">
        <Field id="stageCount">
          <Segmented
            ariaLabel="Bosqichlar"
            options={stages.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(ui.stageCount)}
            onChange={(v) => set("stageCount", Number(v))}
          />
        </Field>
      </Row>
      <Row label="Kompetensiyalar" hint={`Vergul bilan ajratib yozing — ${TEACHER_LIMITS.competenciesMax} tagacha`} wide>
        <Field id="competencies">
          <LimitedTextarea
            ariaLabel="Kompetensiyalar"
            value={ui.competencies.join(", ")}
            onChange={(v) => set("competencies", parseTeacherList(v, TEACHER_LIMITS.competenciesMax, 120))}
            limit={TEACHER_LIMITS.competenciesMax * 120}
            rows={2}
            placeholder="Axborot bilan ishlash, Muammoni hal qilish"
          />
        </Field>
      </Row>
      <Row label="Baholash">
        <Field id="assessmentStyle">
          <Segmented
            ariaLabel="Baholash"
            options={ASSESSMENT_STYLE_OPTIONS}
            value={ui.assessmentStyle}
            onChange={(v) => set("assessmentStyle", v as Ui["assessmentStyle"])}
          />
        </Field>
      </Row>
    </>
  );
}

/** Yopiq «Sozlamalar» chiplari — yorliqlar reyestrdan (etalon §24). */
export function lessonSummary(ui: Ui): string[] {
  return [`${ui.stageCount} bosqich`, ui.competencies.length ? `${ui.competencies.length} kompetensiya` : "", ASSESSMENT_STYLE_OPTIONS.find((o) => o.value === ui.assessmentStyle)?.label ?? ""].filter(
    Boolean,
  );
}
