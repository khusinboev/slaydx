"use client";

import { useState } from "react";
import { EXTRA_LANGUAGES, ESSAY_DESIGNS, PRIMARY_LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/cn";
import type { FieldOption, FormValues, ToolField } from "@/lib/types";

export function Legend({ children }: { children: React.ReactNode }) {
  return <legend className="mb-2.5 text-[15px] font-medium">{children}</legend>;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="border-input bg-card focus:ring-ring h-11 w-full rounded-xl border px-3.5 text-[15px] outline-none focus:ring-2"
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={4}
      className="border-input bg-card focus:ring-ring w-full resize-y rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
    />
  );
}

export function ChipGroup({
  options,
  value,
  onChange,
}: {
  options: FieldOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function LanguagePicker({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  const [more, setMore] = useState(false);
  const list = more ? [...PRIMARY_LANGUAGES, ...EXTRA_LANGUAGES] : PRIMARY_LANGUAGES;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((l) => {
        const on = value === l.value;
        return (
          <button
            key={l.value}
            type="button"
            onClick={() => onChange(l.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card hover:bg-muted",
            )}
          >
            {l.flag} {compact ? l.label.split(" ")[0] : l.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="border-input bg-card hover:bg-muted rounded-full border px-3 py-1.5 text-sm"
      >
        {more ? "Kamroq" : compact ? "Ko'proq (+7)" : "Ko'proq (+10)"}
      </button>
    </div>
  );
}

export function RangeField({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{min}</span>
        <span className="text-lg font-semibold">{value}</span>
        <span className="text-muted-foreground">{max}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

export function DesignPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {ESSAY_DESIGNS.map((d) => {
        const on = value === d.value;
        return (
          <button
            key={d.value}
            type="button"
            onClick={() => onChange(d.value)}
            className={cn(
              "overflow-hidden rounded-xl border text-left",
              on ? "ring-primary ring-2" : "border-input",
            )}
          >
            <div
              className="h-14"
              style={{ background: `linear-gradient(135deg, ${d.from}, ${d.to})` }}
            />
            <div className="bg-card px-2 py-1.5 text-xs font-medium">{d.label}</div>
          </button>
        );
      })}
    </div>
  );
}

export function ModeSwitch({
  modes,
  value,
  onChange,
}: {
  modes: { id: string; title: string; hint: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {modes.map((m) => {
        const on = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-2xl border p-4 text-left transition-colors",
              on ? "border-primary bg-card shadow-sm" : "border-input bg-card/60 hover:bg-card",
            )}
          >
            <div className="font-medium">{m.title}</div>
            <div className="text-muted-foreground mt-1 text-sm">{m.hint}</div>
          </button>
        );
      })}
    </div>
  );
}

export function FieldBlock({
  field,
  values,
  set,
}: {
  field: ToolField;
  values: FormValues;
  set: (name: string, v: string | number) => void;
}) {
  const raw = values[field.name];
  const text = raw === null || raw === undefined ? "" : String(raw);
  return (
    <fieldset className="mb-6">
      <Legend>{field.legend}</Legend>
      {field.kind === "text" || field.kind === "email" || field.kind === "number" ? (
        <TextInput
          type={field.kind === "email" ? "email" : field.kind === "number" ? "number" : "text"}
          value={text}
          placeholder={field.placeholder}
          onChange={(v) => set(field.name, field.kind === "number" ? Number(v) : v)}
        />
      ) : null}
      {field.kind === "textarea" ? (
        <TextArea value={text} placeholder={field.placeholder} onChange={(v) => set(field.name, v)} />
      ) : null}
      {field.kind === "chips" && field.options ? (
        <ChipGroup options={field.options} value={text} onChange={(v) => set(field.name, v)} />
      ) : null}
      {field.kind === "language" ? (
        <LanguagePicker value={text || "uz"} onChange={(v) => set(field.name, v)} />
      ) : null}
      {field.kind === "range" ? (
        <RangeField
          value={Number(raw ?? field.min ?? 1)}
          min={field.min ?? 1}
          max={field.max ?? 11}
          onChange={(v) => set(field.name, v)}
        />
      ) : null}
      {field.kind === "design" ? (
        <DesignPicker value={text || "iris"} onChange={(v) => set(field.name, v)} />
      ) : null}
    </fieldset>
  );
}
