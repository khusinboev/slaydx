"use client";

import { useEffect, useId, useState } from "react";
import { LayoutTemplate, X } from "lucide-react";
import { ApiImg } from "@/lib/use-api-src";
import { categoryLabel, type StudioTemplate } from "@/lib/media/library";
import { Field } from "@/components/forms/shared";
import { fetchTemplates } from "./studio-api";

/** Templates change rarely and depend on availability (the server checks it): one load per page visit. */
let loaded: Promise<StudioTemplate[]> | null = null;

export function dropTemplatesCache(): void {
  loaded = null;
}

function loadTemplates(): Promise<StudioTemplate[]> {
  loaded ??= fetchTemplates().catch((e: unknown) => {
    loaded = null;
    throw e;
  });
  return loaded;
}

/**
 * «Shablonlar» row (docs/studio/P2B-SPEC.md, canvas phone «Rasm»): one card per template whose model the picker offers
 * (`modelIds`; the server already hid unavailable / invalid ones). A tap hands the template to the page, which picks
 * its model, applies its preset values and builds the prompt from the slots. Nothing shows while loading or when the
 * list is empty or failed: the row is a shortcut, never a blocker of the form.
 */
export function TemplatesRow({ modelIds, activeId, onPick }: { modelIds: readonly string[]; activeId: string | null; onPick: (t: StudioTemplate) => void }) {
  const [list, setList] = useState<StudioTemplate[] | null>(null);
  useEffect(() => {
    let live = true;
    loadTemplates().then(
      (l) => live && setList(l),
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const shown = (list ?? []).filter((t) => modelIds.includes(t.modelId));
  if (shown.length === 0) return null;
  return (
    <section aria-label="Shablonlar" data-studio-templates className="mb-3">
      <h2 className="text-muted-foreground mb-2 text-[13px] font-semibold tracking-[0.06em] uppercase">Shablonlar</h2>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {shown.map((t) => (
          <li key={t.id} className="w-[8.5rem] shrink-0">
            <button
              type="button"
              data-template-card={t.id}
              aria-pressed={activeId === t.id}
              onClick={() => onPick(t)}
              className={
                "bg-card focus-visible:ring-ring flex w-full flex-col overflow-hidden rounded-[16px] border-2 text-left outline-none focus-visible:ring-2 " +
                (activeId === t.id ? "border-primary" : "border-border hover:border-foreground/25")
              }
            >
              {t.previewUrl ? (
                <ApiImg src={t.previewUrl} alt="" loading="lazy" className="bg-muted aspect-[4/3] w-full object-cover" />
              ) : (
                <span aria-hidden className="bg-accent-soft text-accent-soft-foreground flex aspect-[4/3] w-full items-center justify-center">
                  <LayoutTemplate className="size-6" />
                </span>
              )}
              <span className="block px-2.5 pt-1.5 text-[13.5px] leading-tight font-bold">{t.title}</span>
              <span className="text-muted-foreground block px-2.5 pb-2 text-[12px]">{categoryLabel(t.category)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The chosen template's slots: one labelled input per slot, exactly one `data-field="slot.<name>"` each (every-param
 * rule). Each change rebuilds the prompt (the page owns the values); ✕ leaves the template, keeping the prompt text.
 */
export function TemplateSlots({
  template,
  values,
  onChange,
  onClose,
}: {
  template: StudioTemplate;
  values: Readonly<Record<string, string>>;
  onChange: (name: string, value: string) => void;
  onClose: () => void;
}) {
  const base = useId();
  return (
    <section aria-label={`Shablon: ${template.title}`} data-template-slots={template.id} className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[14.5px] font-bold">Shablon: {template.title}</p>
        <button
          type="button"
          data-template-close
          aria-label="Shablondan chiqish"
          onClick={onClose}
          className="hover:bg-muted focus-visible:ring-ring -m-1.5 inline-flex size-11 items-center justify-center rounded-[10px] outline-none focus-visible:ring-2"
        >
          <X className="size-[18px]" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {template.slots.map((s) => (
          <Field key={s.name} id={`slot.${s.name}`}>
            <label htmlFor={`${base}-${s.name}`} className="text-muted-foreground mb-1 block text-[13px] font-semibold">
              {s.label}
            </label>
            <input
              id={`${base}-${s.name}`}
              type="text"
              value={values[s.name] ?? ""}
              maxLength={s.max}
              placeholder={s.placeholder ?? ""}
              onChange={(e) => onChange(s.name, e.target.value.slice(0, s.max))}
              className="bg-background focus-visible:ring-ring h-11 w-full rounded-[12px] border px-3 text-[16px] outline-none focus-visible:ring-2"
            />
          </Field>
        ))}
      </div>
    </section>
  );
}
