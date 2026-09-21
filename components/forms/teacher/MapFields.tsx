"use client";

import { TEACHER_LIMITS } from "@/lib/generation/teacher/types";
import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { Row, Segmented } from "../compact";
import { Field } from "../shared";
import { TextInput } from "../fields";
import type { KindProps, Ui } from "./common";

/**
 * TEXNOLOGIK XARITA qatorlari (AUDIT-24 WP-B).
 *
 * ASOSIY karta — tur (yillik/choraklik) va soatlar (jadval kattaligini
 * shular belgilaydi); «Nazorat ustuni» ▸ Sozlamalarda.
 */

const CONTROL_LINK_OPTIONS = [
  { value: "erkin", label: "Erkin" },
  { value: "bsb-chsb", label: "BSB/ChSB bilan bog'liq" },
];

/** Xaritada turga bog'liq chegara yo'q — faqat `typeId` yangilanadi. */
export function mapApplyType(prev: Ui, id: string): Ui {
  return { ...prev, typeId: id };
}

export function MapMain({ ui, setUi, onTypeChange }: KindProps & { onTypeChange: (id: string) => void }) {
  const t = teacherTypeOf("map", ui.typeId);
  const onWeekly = (v: string) => {
    const n = Math.max(1, Math.min(TEACHER_LIMITS.weeklyHoursMax, Number(v) || 1));
    setUi((s) => ({ ...s, weeklyHours: n, totalHours: Math.max(n, s.totalHours) }));
  };
  const onTotal = (v: string) =>
    setUi((s) => ({ ...s, totalHours: Math.max(s.weeklyHours, Math.min(TEACHER_LIMITS.totalHoursMax, Number(v) || s.weeklyHours)) }));
  return (
    <>
      <Row label="Xarita turi" hint={t.hint} wide>
        <Field id="mapType">
          <Segmented
            ariaLabel="Xarita turi"
            options={teacherTypesOf("map").map((x) => ({ value: x.id, label: x.label.uz }))}
            value={ui.typeId}
            onChange={onTypeChange}
          />
        </Field>
      </Row>
      <Row label="Haftalik soat">
        <Field id="weeklyHours">
          <TextInput type="number" value={String(ui.weeklyHours)} onChange={onWeekly} />
        </Field>
      </Row>
      <Row label="Yillik soat">
        <Field id="totalHours">
          <TextInput type="number" value={String(ui.totalHours)} onChange={onTotal} />
        </Field>
      </Row>
    </>
  );
}

export function MapSettings({ ui, set }: KindProps) {
  return (
    <Row label="Nazorat ustuni" hint="BSB/ChSB bilan bog'lansinmi?">
      <Field id="controlLink">
        <Segmented ariaLabel="Nazorat ustuni" options={CONTROL_LINK_OPTIONS} value={ui.controlLink} onChange={(v) => set("controlLink", v as Ui["controlLink"])} />
      </Field>
    </Row>
  );
}

export function mapSummary(ui: Ui): string[] {
  return [CONTROL_LINK_OPTIONS.find((o) => o.value === ui.controlLink)?.label ?? ""].filter(Boolean);
}
