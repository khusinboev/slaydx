"use client";

import { Minus, Plus } from "lucide-react";
import type { ClientEntry, ParamSchema } from "@/lib/studio-core";
import { Card, Row, Segmented, SelectField, Switch } from "@/components/forms/compact";
import { Field, SettingsDetails } from "@/components/forms/shared";
import { TextInput } from "@/components/forms/fields";
import { ImageInputs } from "./ImageInputs";
import { PROMPT_PARAM, effective, type RawValues } from "./studio-values";

/** From this many options an enum becomes a `<select>` (the forms rule: ≥ 7 → `SelectField`, fewer → `Segmented`). */
export const SELECT_FROM = 7;
/** An int with at most this many distinct values is a `Segmented`; a longer range is a stepper. */
export const SEGMENT_MAX = 6;

/** The values an int param accepts, in order (`min`, `min + step`, … `max`). */
export function intValues(p: Extract<ParamSchema, { type: "int" }>): number[] {
  const step = p.step && p.step > 0 ? p.step : 1;
  const out: number[] = [];
  for (let n = p.min; n <= p.max; n += step) out.push(n);
  return out;
}

/**
 * The settings of the chosen model, GENERATED from its ParamSchema (docs/studio/P0-SPEC.md §3.2): one `Row` and exactly
 * one `data-field={param.name}` per param; `advanced` ones sit under the collapsed «Qo'shimcha sozlamalar». The prompt
 * (the text param named `prompt`) is the prompt box's field, so it is the only schema param not drawn here.
 *
 * Control by type: enum — `Segmented`, or `SelectField` from 7 options; int — `Segmented` up to 6 values, else a
 * stepper; number — a slider; bool — a switch; any other text — an input; image — the pictures with upload / remove
 * (P2b, `ImageInputs`). `voice` belongs to the speech phase and no Studio model has one: an honest note, never a dead
 * control.
 */
export function ParamRows({ entry, raw, onChange }: { entry: ClientEntry; raw: RawValues; onChange: (name: string, value: unknown) => void }) {
  const values = effective(entry, raw);
  const params = entry.params.filter((p) => !(p.type === "text" && p.name === PROMPT_PARAM));
  const main = params.filter((p) => !p.advanced);
  const advanced = params.filter((p) => p.advanced);
  const row = (p: ParamSchema) => (
    <Row key={p.name} label={p.label} hint={p.hint}>
      <Field id={p.name}>
        <Control param={p} value={values[p.name]} onChange={(v) => onChange(p.name, v)} />
      </Field>
    </Row>
  );
  return (
    <>
      {main.length ? <Card title="Sozlamalar">{main.map(row)}</Card> : null}
      {advanced.length ? (
        <SettingsDetails title="Qo‘shimcha sozlamalar" summary={advanced.map((p) => summaryOf(p, values[p.name]))} testId="studio-advanced">
          {advanced.map(row)}
        </SettingsDetails>
      ) : null}
    </>
  );
}

/** What a collapsed «Qo'shimcha sozlamalar» says about a param (`null`: nothing worth a chip). */
function summaryOf(p: ParamSchema, v: unknown): string | null {
  switch (p.type) {
    case "enum":
      return p.options.find((o) => o.value === v)?.label ?? null;
    case "int":
    case "number":
      return `${p.label}: ${String(v)}`;
    case "bool":
      return v === true ? p.label : null;
    case "text":
      return typeof v === "string" && v ? `${p.label}: ${v.length > 14 ? `${v.slice(0, 13)}…` : v}` : null;
    default:
      return null;
  }
}

function Control({ param: p, value, onChange }: { param: ParamSchema; value: unknown; onChange: (v: unknown) => void }) {
  switch (p.type) {
    case "enum": {
      const options = p.options.map((o) => ({ value: o.value, label: o.label }));
      return options.length >= SELECT_FROM ? (
        <SelectField ariaLabel={p.label} options={options} value={String(value)} onChange={onChange} />
      ) : (
        <Segmented ariaLabel={p.label} options={options} value={String(value)} onChange={onChange} />
      );
    }
    case "int": {
      const list = intValues(p);
      return list.length <= SEGMENT_MAX ? (
        <Segmented ariaLabel={p.label} options={list.map((n) => ({ value: String(n), label: String(n) }))} value={String(value)} onChange={(v) => onChange(Number(v))} />
      ) : (
        <Stepper ariaLabel={p.label} value={Number(value)} min={p.min} max={p.max} step={p.step ?? 1} onChange={onChange} />
      );
    }
    case "number":
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label={p.label}
            min={p.min}
            max={p.max}
            step={(p.max - p.min) / 20}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="pointer-coarse:h-11 accent-primary h-6 min-w-0 flex-1"
          />
          <output className="w-10 shrink-0 text-right text-[14.5px] tabular-nums">{String(value)}</output>
        </div>
      );
    case "bool":
      return <Switch ariaLabel={p.label} checked={value === true} onChange={onChange} />;
    case "text":
      return <TextInput value={String(value ?? "")} onChange={(v) => onChange(v.slice(0, p.max))} />;
    case "image":
      return <ImageInputs param={p} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;
    case "voice":
      return <p className="text-muted-foreground text-[13.5px]">Bu sozlama Studio rasm bo‘limida hali ishlamaydi.</p>;
  }
}

/** − value + for an int range too long for chips; 44 px targets. */
function Stepper({ value, min, max, step, onChange, ariaLabel }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; ariaLabel: string }) {
  const btn =
    "focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-[10px] outline-none hover:bg-card focus-visible:ring-2 disabled:opacity-40";
  return (
    <div role="group" aria-label={ariaLabel} className="bg-muted/70 inline-flex items-center gap-0.5 rounded-[12px] p-1">
      <button type="button" aria-label={`${ariaLabel}: kamaytirish`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} className={btn}>
        <Minus className="size-4" aria-hidden />
      </button>
      <output aria-live="polite" className="min-w-10 text-center text-[15px] font-semibold tabular-nums">
        {value}
      </output>
      <button type="button" aria-label={`${ariaLabel}: ko‘paytirish`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} className={btn}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
