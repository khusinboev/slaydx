"use client";

import { TEACHER_LIMITS } from "@/lib/generation/teacher/types";
import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { Row, Segmented } from "../compact";
import { Field, NumberInput } from "../shared";
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
  /*
   * Klamp `NumberInput` ichida (min/max HTML atributi bilan KO'RINADI —
   * R0 izohi), bu yerda faqat juftlik qoidasi: yillik soat haftalikdan
   * kam bo'lmaydi.
   */
  const onWeekly = (n: number) => setUi((s) => ({ ...s, weeklyHours: n, totalHours: Math.max(n, s.totalHours) }));
  const onTotal = (n: number) => setUi((s) => ({ ...s, totalHours: Math.max(s.weeklyHours, n) }));
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
      {/* Ikki soat maydoni BITTA qatorda — jadval kattaligi shu juftlikdan chiqadi. */}
      <Row label="Soatlar" hint="Haftalik va yillik soat">
        <span className="flex flex-wrap items-center gap-2">
          <Field id="weeklyHours" className="inline-block">
            <NumberInput ariaLabel="Haftalik soat" value={ui.weeklyHours} onChange={onWeekly} min={1} max={TEACHER_LIMITS.weeklyHoursMax} />
          </Field>
          <span className="text-muted-foreground text-[12px]">hafta ·</span>
          <Field id="totalHours" className="inline-block">
            <NumberInput ariaLabel="Yillik soat" value={ui.totalHours} onChange={onTotal} min={1} max={TEACHER_LIMITS.totalHoursMax} />
          </Field>
          <span className="text-muted-foreground text-[12px]">yil</span>
        </span>
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
