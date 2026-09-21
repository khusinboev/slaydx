"use client";

import { priceFor, formatTanga } from "@/lib/tools";
import { teacherTypeOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { Row, Segmented, SelectField, Switch } from "../compact";
import { Field } from "../shared";
import { nearestNum, type KindProps, type Ui } from "./common";

/**
 * GLOSSARIY qatorlari (AUDIT-24 WP-B).
 *
 * ASOSIY karta — tur va atama soni: `termCount` o'qituvchi oilasidagi
 * YAGONA narxga ta'sir qiluvchi parametr (`teacher-params.ts`), shuning
 * uchun narx shu qatorda ko'rsatiladi — qiymat FAQAT `priceFor` dan
 * (egasi qarori, `docs/AUDIT-24.md` §6).
 */

export function glossaryApplyType(prev: Ui, id: string): Ui {
  const t = teacherTypeOf("glossary", id);
  return {
    ...prev,
    typeId: id,
    termCount: nearestNum(t.limits.terms, prev.termCount, t.limits.termsDefault),
    includeExample: t.limits.includeExampleDefault,
    translationLangs: id === "uch-tilli" ? prev.translationLangs : [],
  };
}

export function GlossaryMain({ ui, set, tool, onTypeChange }: KindProps & { onTypeChange: (id: string) => void }) {
  const t = teacherTypeOf("glossary", ui.typeId);
  return (
    <>
      <Row label="Glossariy turi" hint={t.hint}>
        <Field id="glossaryType">
          <SelectField
            ariaLabel="Glossariy turi"
            value={ui.typeId}
            onChange={onTypeChange}
            options={teacherTypesOf("glossary").map((x) => ({ value: x.id, label: x.label.uz }))}
          />
        </Field>
      </Row>
      <Row label="Atama soni" hint="Narx shu tanlovga bog'liq" wide>
        <Field id="termCount">
          <Segmented
            ariaLabel="Atama soni"
            options={t.limits.terms.map((n) => ({ value: String(n), label: `${n} ta · ${formatTanga(priceFor(tool, { termCount: n }))}` }))}
            value={String(ui.termCount)}
            onChange={(v) => set("termCount", Number(v))}
          />
        </Field>
      </Row>
    </>
  );
}

export function GlossarySettings({ ui, set }: KindProps) {
  const t = teacherTypeOf("glossary", ui.typeId);
  const langs = t.limits.translationLangs.length ? t.limits.translationLangs : ["ru", "en"];
  return (
    <>
      <Row label="Misol qatori" hint="Har atamaga qo'llanish misoli">
        <Field id="includeExample">
          <Switch checked={ui.includeExample} onChange={(v) => set("includeExample", v)} ariaLabel="Misol qatori" />
        </Field>
      </Row>
      <div className={ui.typeId === "uch-tilli" ? "" : "hidden"}>
        <Row label="Tarjima tillari" wide>
          <Field id="translationLangs">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tarjima tillari">
              {langs.map((l) => {
                const on = ui.translationLangs.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={on}
                    data-lang={l}
                    onClick={() => set("translationLangs", on ? ui.translationLangs.filter((x) => x !== l) : [...ui.translationLangs, l])}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`}
                  >
                    {l.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </Field>
        </Row>
      </div>
    </>
  );
}

export function glossarySummary(ui: Ui): string[] {
  return [
    ui.includeExample ? "misol bilan" : "misolsiz",
    ui.typeId === "uch-tilli" && ui.translationLangs.length ? ui.translationLangs.map((l) => l.toUpperCase()).join("/") : "",
  ].filter(Boolean);
}
