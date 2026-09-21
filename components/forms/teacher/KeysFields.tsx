"use client";

import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { Row, Segmented, SelectField } from "../compact";
import { Field } from "../shared";
import { nearestNum, type KindProps, type Ui } from "./common";

/**
 * KEYS (case-study) qatorlari (AUDIT-24 WP-B).
 *
 * ASOSIY karta — tur va keyslar soni; «Auditoriya» ▸ Sozlamalarda
 * (standart `otm`, kamdan-kam o'zgaradi).
 */

const AUDIENCE_OPTIONS = [
  { value: "maktab", label: "Maktab" },
  { value: "otm", label: "OTM" },
];

export function keysApplyType(prev: Ui, id: string): Ui {
  const t = teacherTypeOf("keys", id);
  return { ...prev, typeId: id, caseCount: nearestNum(t.limits.cases, prev.caseCount, t.limits.casesDefault) };
}

export function KeysMain({ ui, set, onTypeChange }: KindProps & { onTypeChange: (id: string) => void }) {
  const t = teacherTypeOf("keys", ui.typeId);
  return (
    <>
      <Row label="Keys turi" hint={t.hint}>
        <Field id="keysType">
          <SelectField
            ariaLabel="Keys turi"
            value={ui.typeId}
            onChange={onTypeChange}
            options={teacherTypesOf("keys").map((x) => ({ value: x.id, label: x.label.uz }))}
          />
        </Field>
      </Row>
      <Row label="Keyslar soni">
        <Field id="caseCount">
          <Segmented
            ariaLabel="Keyslar soni"
            options={t.limits.cases.map((n) => ({ value: String(n), label: String(n) }))}
            value={String(ui.caseCount)}
            onChange={(v) => set("caseCount", Number(v))}
          />
        </Field>
      </Row>
    </>
  );
}

export function KeysSettings({ ui, set }: KindProps) {
  return (
    <Row label="Auditoriya" hint="Kim uchun — maktab o'quvchisi yoki talaba">
      <Field id="audience">
        <Segmented ariaLabel="Auditoriya" options={AUDIENCE_OPTIONS} value={ui.audience} onChange={(v) => set("audience", v as Ui["audience"])} />
      </Field>
    </Row>
  );
}

export function keysSummary(ui: Ui): string[] {
  return [AUDIENCE_OPTIONS.find((o) => o.value === ui.audience)?.label ?? ""].filter(Boolean);
}
