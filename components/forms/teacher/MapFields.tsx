"use client";

import { TEACHER_LIMITS } from "@/lib/generation/teacher/types";
import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { Row, Segmented } from "../compact";
import { Field } from "../shared";
import type { KindProps, Ui } from "./common";

/** Ixcham son maydoni — ikkalasi bitta qatorga sig'ishi uchun. */
function NumberInput({ value, onChange, ariaLabel }: { value: number; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-card focus:ring-ring h-8 w-full rounded-lg border px-2 text-[13px] tabular-nums outline-none focus:ring-2"
    />
  );
}

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
      {/* Ikki soat maydoni BITTA qatorda — jadval kattaligi shu juftlikdan chiqadi. */}
      <Row label="Soatlar" hint="Haftalik va yillik soat">
        <span className="flex flex-wrap items-center gap-2">
          <Field id="weeklyHours" className="inline-block w-24">
            <NumberInput ariaLabel="Haftalik soat" value={ui.weeklyHours} onChange={onWeekly} />
          </Field>
          <span className="text-muted-foreground text-[12px]">hafta ·</span>
          <Field id="totalHours" className="inline-block w-24">
            <NumberInput ariaLabel="Yillik soat" value={ui.totalHours} onChange={onTotal} />
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
