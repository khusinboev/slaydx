"use client";

import type { TestQuestionKind } from "@/lib/generation/teacher/types";
import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { Row, Segmented, SelectField, Switch } from "../compact";
import { Field, SourceFileRow } from "../shared";
import { TextInput } from "../fields";
import { CurriculumRow, nearestNum, type KindProps, type Ui } from "./common";
import type { CurriculumSelection } from "../CurriculumPicker";

/**
 * TEST qatorlari (AUDIT-24 WP-B) — 5 vositaning eng og'iri.
 *
 * Ilgari 9 kind-qatori «Fan, sinf, til» kartasiga TEKIS qo'shilardi
 * (forma 1 477 px, `forms3-olchov.md`). Endi ASOSIY kartada faqat tur va
 * savol soni, qolgan 8 qator ▸ Sozlamalarda yig'iq turadi.
 *
 * «Tasdiqlayman» (`approver`) — `testApproverAllowed`: dvigatel
 * (`teacher/test/input.ts:156`) uni FAQAT `bsb`/`chsb` turida saqlaydi,
 * qolgan 4 turda jimgina tashlardi. Endi forma ham aynan shu shartda
 * chizadi — «bezak maydon yo'q» qoidasining o'lik shoxi yopildi.
 */

const MODE_OPTIONS = [
  { value: "topic", label: "Mavzu asosida" },
  { value: "file", label: "Fayl asosida" },
  { value: "curriculum", label: "Darslik dasturi asosida" },
];

const DIFFICULTY_OPTIONS: { value: "standart" | "oson" | "qiyin"; label: string }[] = [
  { value: "standart", label: "Standart" },
  { value: "oson", label: "Oson" },
  { value: "qiyin", label: "Qiyin" },
];

const ANSWER_KEY_OPTIONS = [
  { value: "alohida-bet", label: "Alohida bet" },
  { value: "oxirgi-bet", label: "Oxirgi bet" },
];

const QUESTION_KIND_LABEL: Record<TestQuestionKind, string> = {
  single: "Bir tanlovli",
  multi: "Ko'p tanlovli",
  truefalse: "To'g'ri/Noto'g'ri",
  open: "Ochiq",
  match: "Moslashtirish",
};

export const MODE_LABEL: Record<string, string> = Object.fromEntries(MODE_OPTIONS.map((o) => [o.value, o.label]));

function variantLabel(n: number): string {
  return n === 1 ? "1 (yagona)" : n === 2 ? "2 (A/B)" : n === 4 ? "4 (A/B/C/D)" : String(n);
}

/** «Tasdiqlayman» qatori shu turda hujjatga tushadimi (registry `limits.approver`). */
export function testApproverAllowed(typeId: string): boolean {
  return teacherTypeOf("test", typeId).limits.approver;
}

export function testApplyType(prev: Ui, id: string): Ui {
  const t = teacherTypeOf("test", id);
  const allowed: readonly string[] = t.limits.kinds;
  const kept = prev.questionKinds.filter((k) => allowed.includes(k));
  const count = nearestNum(t.limits.count, prev.count, t.limits.countDefault);
  return {
    ...prev,
    typeId: id,
    count,
    questionKinds: kept.length ? kept : [...t.limits.kinds],
    variants: nearestNum(t.limits.variants, prev.variants, t.limits.variantsDefault),
    criteriaTable: t.limits.criteriaTable,
    timeMin: nearestNum(t.limits.timeMin, prev.timeMin, t.limits.timeMinDefault),
    openCount: Math.min(prev.openCount, count),
  };
}

/** Karta 1, 1-qator — rejim (undan keyin qobiq mavzu qatorini chizadi). */
export function TestModeRow({ ui, set }: KindProps) {
  return (
    <Row label="Rejim" wide>
      <Field id="mode">
        <Segmented ariaLabel="Rejim" options={MODE_OPTIONS} value={ui.mode} onChange={(v) => set("mode", v as Ui["mode"])} />
      </Field>
    </Row>
  );
}

/** Karta 1, manba bloklari — rejimga qarab fayl yoki o'quv dasturi. */
export function TestSourceRows({
  ui,
  setUi,
  onCurriculumChange,
  onBusyChange,
}: KindProps & { onCurriculumChange: (next: CurriculumSelection) => void; onBusyChange: (busy: boolean) => void }) {
  return (
    <>
      <div className={ui.mode === "file" ? "" : "hidden"}>
        <SourceFileRow
          label="Hujjat"
          value={{ fileName: ui.fileName, sourceText: ui.sourceText }}
          onChange={({ fileName, sourceText }) => setUi((s) => ({ ...s, fileName, sourceText }))}
          onBusyChange={onBusyChange}
        />
      </div>
      <div className={ui.mode === "curriculum" ? "" : "hidden"}>
        <CurriculumRow ui={ui} onChange={onCurriculumChange} hint="Fan va sinfni tanlang, so'ng 5 tagacha mavzu" />
      </div>
    </>
  );
}

export function TestMain({ ui, setUi, onTypeChange }: KindProps & { onTypeChange: (id: string) => void }) {
  const t = teacherTypeOf("test", ui.typeId);
  return (
    <>
      <Row label="Test turi" hint={t.hint}>
        <Field id="testType">
          <SelectField
            ariaLabel="Test turi"
            value={ui.typeId}
            onChange={onTypeChange}
            options={teacherTypesOf("test").map((x) => ({ value: x.id, label: x.label.uz }))}
          />
        </Field>
      </Row>
      <Row label="Savol soni">
        <Field id="count">
          <Segmented
            ariaLabel="Savol soni"
            options={t.limits.count.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(ui.count)}
            onChange={(v) => {
              const n = Number(v);
              setUi((s) => ({ ...s, count: n, openCount: Math.min(s.openCount, n) }));
            }}
          />
        </Field>
      </Row>
    </>
  );
}

export function TestSettings({ ui, set, setUi }: KindProps) {
  const t = teacherTypeOf("test", ui.typeId);
  return (
    <>
      <Row label="Savol turlari" wide>
        <Field id="questionKinds">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Savol turlari">
            {t.limits.kinds.map((k) => {
              const on = ui.questionKinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  data-kind={k}
                  onClick={() =>
                    setUi((s) => ({
                      ...s,
                      questionKinds: s.questionKinds.includes(k) ? s.questionKinds.filter((x) => x !== k) : [...s.questionKinds, k],
                    }))
                  }
                  className={`rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`}
                >
                  {QUESTION_KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
        </Field>
      </Row>
      <Row label="Ochiq savollar" hint="Savol sonidan oshmasin">
        <Field id="openCount">
          <TextInput
            type="number"
            value={String(ui.openCount)}
            onChange={(v) => setUi((s) => ({ ...s, openCount: Math.max(0, Math.min(s.count, Number(v) || 0)) }))}
          />
        </Field>
      </Row>
      <Row label="Qiyinlik">
        <Field id="difficulty">
          <Segmented ariaLabel="Qiyinlik" options={DIFFICULTY_OPTIONS} value={ui.difficulty} onChange={(v) => set("difficulty", v as Ui["difficulty"])} />
        </Field>
      </Row>
      <Row label="Variantlar">
        <Field id="variants">
          <Segmented
            ariaLabel="Variantlar"
            options={t.limits.variants.map((n) => ({ value: String(n), label: variantLabel(n) }))}
            value={String(ui.variants)}
            onChange={(v) => set("variants", Number(v))}
          />
        </Field>
      </Row>
      <Row label="Vaqt" hint="Daqiqa">
        <Field id="timeMin">
          <Segmented
            ariaLabel="Vaqt"
            options={t.limits.timeMin.map((n) => ({ value: String(n), label: `${n} daq` }))}
            value={String(ui.timeMin)}
            onChange={(v) => set("timeMin", Number(v))}
          />
        </Field>
      </Row>
      <Row label="OMR varag'i" hint="Javoblar varag'ini alohida chizish">
        <Field id="omr">
          <Switch checked={ui.omr} onChange={(v) => set("omr", v)} ariaLabel="OMR varag'i" />
        </Field>
      </Row>
      <Row label="Javoblar kaliti">
        <Field id="answerKey">
          <Segmented ariaLabel="Javoblar kaliti" options={ANSWER_KEY_OPTIONS} value={ui.answerKey} onChange={(v) => set("answerKey", v as Ui["answerKey"])} />
        </Field>
      </Row>
      <div className={t.limits.criteriaTable ? "" : "hidden"}>
        <Row label="Mezon jadvali" hint="BSB/ChSB uslubidagi ball taqsimoti">
          <Field id="criteriaTable">
            <Switch checked={ui.criteriaTable} onChange={(v) => set("criteriaTable", v)} ariaLabel="Mezon jadvali" />
          </Field>
        </Row>
      </div>
    </>
  );
}

export function testSummary(ui: Ui): string[] {
  return [
    `${ui.questionKinds.length} savol turi`,
    DIFFICULTY_OPTIONS.find((o) => o.value === ui.difficulty)?.label ?? "",
    `${ui.variants} variant`,
    `${ui.timeMin} daq`,
    ui.omr ? "OMR" : "",
  ].filter(Boolean);
}
