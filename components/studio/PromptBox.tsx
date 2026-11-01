"use client";

import { useId } from "react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Counter, Field } from "@/components/forms/shared";

/**
 * The prompt box of the Studio (canvas «Nimani chizamiz?»): a card with a growing textarea (`AutoTextarea`, no resize
 * handle) and the character counter. `limit` is the `max` of the chosen model's `prompt` text param. The text is kept
 * exactly as typed; the request carries its normalized form (`studio-values.ts requestValues`).
 *
 * The canvas also draws sample prompts, an upload and an «AI improve» button here: those are P2 and are not drawn.
 */
export function PromptBox({ value, onChange, limit }: { value: string; onChange: (v: string) => void; limit: number }) {
  const id = useId();
  return (
    <section aria-label="So‘rov" data-studio-prompt className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
      <label htmlFor={id} className="text-muted-foreground mb-1.5 block text-[13px] font-semibold">
        Nimani chizamiz?
      </label>
      <Field id="prompt">
        <AutoTextarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, limit))}
          minRows={3}
          maxRows={10}
          maxLength={limit}
          placeholder="Masalan: Samarqand Registon maydoni, kechqurun, iliq chiroqlar, kino kadri uslubida"
          className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[16px] leading-relaxed outline-none"
        />
        <Counter len={value.length} limit={limit} />
      </Field>
    </section>
  );
}
