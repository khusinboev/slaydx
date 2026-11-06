"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { ClientEntry, ParamSchema } from "@/lib/studio-core";
import { IMAGE_RATIOS, IMAGE_STYLES } from "@/lib/generation/image-studio-options";
import { Card, Row, Segmented, SelectField, Switch } from "@/components/forms/compact";
import { Field, SettingsDetails } from "@/components/forms/shared";
import { TextInput } from "@/components/forms/fields";
import { ImageInputs } from "./ImageInputs";
import { PROMPT_PARAM, effective, type RawValues } from "./studio-values";

/** From this many options an enum becomes a `<select>` (the forms rule: ≥ 7 → `SelectField`, fewer → `Segmented`). */
export const SELECT_FROM = 7;
/** An int with at most this many distinct values is a `Segmented`; a longer range is presets + a direct input. */
export const SEGMENT_MAX = 6;
/** How many preset chips a long range shows (its ends included). */
export const PRESET_COUNT = 5;

type IntParam = Extract<ParamSchema, { type: "int" }>;
type EnumParam = Extract<ParamSchema, { type: "enum" }>;

/** A host's bound on a param beyond its schema (the «Montaj» start offset is capped to the chosen video). */
export type ParamLimits = Readonly<Record<string, { max?: number }>>;

/** The values an int param accepts, in order (`min`, `min + step`, … `max`). */
export function intValues(p: IntParam): number[] {
  const step = p.step && p.step > 0 ? p.step : 1;
  const out: number[] = [];
  for (let n = p.min; n <= p.max; n += step) out.push(n);
  return out;
}

/** Round-number candidates for the preset chips between the ends of a long range: small ranges, and spans of 20 or more. */
const NICE_SMALL = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 50, 60, 90, 100, 120, 150, 180, 200, 300];
const NICE_LARGE = [5, 10, 15, 20, 30, 45, 50, 60, 90, 100, 120, 150, 180, 200, 300];

/**
 * The preset chips of a long range (`count` of them, the ends always among them): the round numbers the range accepts,
 * the one nearest each even share of the span — 3–15 s → 3 · 5 · 8 · 10 · 15, 1–30 s → 1 · 10 · 15 · 20 · 30,
 * 10–200 % by 10 → 10 · 60 · 100 · 150 · 200.
 */
export function presetsOf(min: number, max: number, step = 1, count = PRESET_COUNT): number[] {
  const accepts = (n: number) => n > min && n < max && (n - min) % step === 0;
  const inner = (max - min >= 20 ? NICE_LARGE : NICE_SMALL).filter(accepts);
  const want = Math.max(0, count - 2);
  const middle: number[] = [];
  if (inner.length <= want) middle.push(...inner);
  else {
    for (let i = 1; i <= want; i++) {
      const target = min + (i * (max - min)) / (want + 1);
      // The candidate nearest the target (the lower one on a tie), each used once.
      const pick = inner.filter((n) => !middle.includes(n)).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
      middle.push(pick);
    }
  }
  return [...new Set([min, ...middle, max])].sort((a, b) => a - b);
}

/** The nearest value the range accepts (clamped to its ends, snapped to its step). */
export function snapInt(n: number, min: number, max: number, step = 1): number {
  if (!Number.isFinite(n)) return min;
  const clamped = Math.min(max, Math.max(min, n));
  return Math.min(max, min + Math.round((clamped - min) / step) * step);
}

/** «Post» / «Slayd» / «Stories»… — the ratio hints the image catalog holds (`IMAGE_RATIOS`), by ratio. */
export function aspectHint(ratio: string): string | null {
  return IMAGE_RATIOS.find((r) => r.id === ratio)?.hint ?? null;
}

/** A style's one-line description (`IMAGE_STYLES.blurb`), by id. */
export function styleBlurb(id: string): string | null {
  return IMAGE_STYLES.find((s) => s.id === id)?.blurb ?? null;
}

const RATIO_RE = /^\d+:\d+$/;
/** An enum whose every option is a `w:h` ratio: drawn with a shape preview per option. */
export const isAspectParam = (p: ParamSchema): boolean => p.type === "enum" && p.options.length > 0 && p.options.every((o) => RATIO_RE.test(o.value));
/** The picture style enum of the image models (`IMAGE_STYLES` ids): drawn with its description. */
export const isStyleParam = (p: ParamSchema): boolean => p.type === "enum" && p.name === "imageStyle";

/**
 * The settings of the chosen model, GENERATED from its ParamSchema (docs/studio/P0-SPEC.md §3.2): one `Row` and exactly
 * one `data-field={param.name}` per param; `advanced` ones sit under the collapsed «Qo'shimcha sozlamalar». The prompt
 * (the text param named `prompt`) is the prompt box's field, so it is the only schema param not drawn here.
 *
 * Control by type (P11 §D): enum — `Segmented`, or `SelectField` from 7 options; a ratio enum — shapes with the catalog's
 * hint under them; the picture style — a select with its description; int — `Segmented` up to 6 values, else preset chips
 * plus a direct number input (a long range: a clip's seconds, an effect's seconds, a volume); number — a slider; bool — a
 * switch; any other text — an input; image — the pictures with upload / remove (P2b, `ImageInputs`). `voice` belongs to
 * the speech phase and no Studio model has one: an honest note, never a dead control. `limits` lets the host cap a range
 * below the schema (the «Montaj» start offset ends where the chosen video ends).
 */
export function ParamRows({ entry, raw, onChange, limits }: { entry: ClientEntry; raw: RawValues; onChange: (name: string, value: unknown) => void; limits?: ParamLimits }) {
  const values = effective(entry, raw);
  const params = entry.params.filter((p) => !(p.type === "text" && p.name === PROMPT_PARAM));
  const main = params.filter((p) => !p.advanced);
  const advanced = params.filter((p) => p.advanced);
  const row = (p: ParamSchema) => (
    <Row key={p.name} label={p.label} hint={p.hint} stack>
      <Field id={p.name}>
        <Control param={p} value={values[p.name]} onChange={(v) => onChange(p.name, v)} limit={limits?.[p.name]} />
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

function Control({ param: p, value, onChange, limit }: { param: ParamSchema; value: unknown; onChange: (v: unknown) => void; limit?: { max?: number } }) {
  switch (p.type) {
    case "enum": {
      if (isAspectParam(p)) return <AspectPicker param={p} value={String(value)} onChange={onChange} />;
      const options = p.options.map((o) => ({ value: o.value, label: o.label }));
      if (isStyleParam(p)) {
        const blurb = styleBlurb(String(value));
        return (
          <div className="flex flex-col gap-1">
            <SelectField ariaLabel={p.label} options={options} value={String(value)} onChange={onChange} />
            {blurb ? (
              <span className="text-muted-foreground text-[12.5px] leading-snug" data-style-blurb>
                {p.options.find((o) => o.value === value)?.label} — {blurb}
              </span>
            ) : null}
          </div>
        );
      }
      return options.length >= SELECT_FROM ? (
        <SelectField ariaLabel={p.label} options={options} value={String(value)} onChange={onChange} />
      ) : (
        <Segmented ariaLabel={p.label} options={options} value={String(value)} onChange={onChange} />
      );
    }
    case "int": {
      const max = typeof limit?.max === "number" ? Math.max(p.min, Math.min(p.max, limit.max)) : p.max;
      const list = intValues({ ...p, max });
      return list.length <= SEGMENT_MAX ? (
        <Segmented ariaLabel={p.label} options={list.map((n) => ({ value: String(n), label: String(n) }))} value={String(value)} onChange={(v) => onChange(Number(v))} />
      ) : (
        <PresetRange ariaLabel={p.label} value={Number(value)} min={p.min} max={max} step={p.step ?? 1} onChange={onChange} />
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

const CHIP =
  "pointer-coarse:min-h-11 pointer-coarse:min-w-11 focus-visible:ring-ring rounded-[9px] px-2.5 py-1.5 text-[14px] whitespace-nowrap tabular-nums outline-none transition-colors focus-visible:ring-2";

/**
 * A long int range (P11 §D): preset chips (the round numbers the range accepts, its ends included) and a direct number
 * input for any other value; a typed value is snapped to the range on blur / Enter, never sent outside it. 44 px targets.
 */
function PresetRange({ value, min, max, step, onChange, ariaLabel }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; ariaLabel: string }) {
  const presets = presetsOf(min, max, step);
  const [typed, setTyped] = useState(String(value));
  // A value set elsewhere (a preset, a model switch, a cap) shows in the box.
  useEffect(() => setTyped(String(value)), [value]);
  const commit = () => {
    const n = snapInt(Number(typed), min, max, step);
    setTyped(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2" data-presets>
      <div className="bg-muted/70 inline-flex max-w-full flex-wrap gap-0.5 rounded-[12px] p-1">
        {presets.map((n) => (
          <button key={n} type="button" aria-pressed={value === n} data-preset={n} onClick={() => onChange(n)} className={cn(CHIP, value === n ? "bg-card text-foreground font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {n}
          </button>
        ))}
      </div>
      <input
        type="number"
        inputMode="numeric"
        aria-label={`${ariaLabel}: qiymat`}
        min={min}
        max={max}
        step={step}
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          const n = Number(e.target.value);
          // A value the range accepts as typed applies at once; anything else waits for the blur to be snapped.
          if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max && (n - min) % step === 0) onChange(n);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="border-input bg-card focus:ring-ring pointer-coarse:h-11 h-10 w-20 rounded-[12px] border px-3 text-[16px] tabular-nums outline-none focus:ring-2"
        data-preset-input
      />
      <span className="text-muted-foreground text-[12.5px] tabular-nums" data-preset-range>
        {min}–{max}
      </span>
    </div>
  );
}

/** A ratio enum as shapes («16:9» a wide box, «9:16» a tall one) with the catalog's hint of the chosen one under the row. */
function AspectPicker({ param: p, value, onChange }: { param: EnumParam; value: string; onChange: (v: string) => void }) {
  const hint = aspectHint(value);
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label={p.label} className="flex flex-wrap gap-1.5" data-aspect-picker>
        {p.options.map((o) => {
          const on = value === o.value;
          const [w, h] = o.value.split(":").map(Number) as [number, number];
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "bg-card focus-visible:ring-ring flex min-h-11 min-w-[3.75rem] flex-col items-center justify-center gap-1 rounded-[12px] border-2 px-2 py-1.5 outline-none focus-visible:ring-2",
                on ? "border-primary" : "border-border hover:border-foreground/25",
              )}
            >
              <span aria-hidden className={cn("block rounded-[3px] border-2", on ? "border-primary" : "border-muted-foreground/60")} style={{ width: `${Math.round((22 * w) / Math.max(w, h))}px`, height: `${Math.round((22 * h) / Math.max(w, h))}px` }} />
              <span className="text-[13px] font-semibold tabular-nums">{o.label}</span>
            </button>
          );
        })}
      </div>
      {hint ? (
        <span className="text-muted-foreground text-[12.5px]" data-aspect-hint>
          {value} · {hint}
        </span>
      ) : null}
    </div>
  );
}
