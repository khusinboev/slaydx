"use client";

import { useId, useRef } from "react";
import { BookOpen, ImagePlus, Sparkles } from "lucide-react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Switch } from "@/components/forms/compact";
import { Counter, Field } from "@/components/forms/shared";
import { groupDigits } from "@/lib/format";
import { STUDIO_INPUT_ACCEPT } from "./ImageInputs";
import { PROMPT_BYTES_MESSAGE, type PromptBytes } from "./studio-values";

const TOOL =
  "focus-visible:ring-ring bg-muted/70 hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/** Under the counter: Cyrillic letters and «‘» take more than one byte, so a prompt can break the limit below the character count. */
export function PromptBytesNote({ bytes }: { bytes: PromptBytes | null }) {
  if (!bytes) return null;
  return (
    <p role="alert" data-prompt-bytes className="text-destructive mt-1 text-[13px] leading-snug">
      {PROMPT_BYTES_MESSAGE} ({groupDigits(bytes.used)} / {groupDigits(bytes.max)} bayt).
    </p>
  );
}

/** «Yaxshilash (AI)»: one button for every prompt box of the Studio. */
export function EnhanceTool({ disabled, enhancing, onClick }: { disabled: boolean; enhancing: boolean; onClick: () => void }) {
  return (
    <button type="button" data-prompt-tool="enhance" disabled={disabled || enhancing} onClick={onClick} className={TOOL} title="Tilni o‘zi aniqlaydi va inglizcha yozadi. Bepul, kuniga cheklangan marta">
      <Sparkles className="size-4" aria-hidden />
      {enhancing ? "Yaxshilanmoqda…" : "Yaxshilash (AI)"}
    </button>
  );
}

/**
 * «AI yaxshilash»: on (the default), the prompt goes to the model translated to English and improved, in the worker, for free.
 * The button above is the see-it-first way to the same result; this one is the hands-off way.
 */
export function AiImproveTool({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div data-prompt-tool="ai-improve" className="bg-muted/70 pointer-coarse:min-h-11 inline-flex min-h-9 items-center gap-2 rounded-[12px] px-3 text-[13.5px] font-semibold" title="Tavsifingiz inglizchaga tarjima qilinib, yaxshilangan holda modelga yuboriladi. Bepul">
      <span>AI yaxshilash</span>
      <Switch ariaLabel="AI yaxshilash" checked={checked} onChange={onChange} />
    </div>
  );
}

/** «Namuna promptlar»: one button for every prompt box that has a library. */
export function SamplesTool({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" data-prompt-tool="samples" onClick={onClick} className={TOOL}>
      <BookOpen className="size-4" aria-hidden />
      Namuna promptlar
    </button>
  );
}

/**
 * The prompt box of the Studio (canvas «Nimani chizamiz?»): a card with a growing textarea (`AutoTextarea`, no resize
 * handle) and the character counter. `limit` is the `max` of the chosen model's `prompt` text param. The text is kept
 * exactly as typed; the request carries its normalized form (`studio-values.ts requestValues`).
 *
 * P2b (docs/studio/P2B-SPEC.md) — the canvas's tool row under the text, each button drawn only when the page wires it:
 * «Namuna promptlar» (`onSamples`, the library sheet), «Rasm yuklash» (`onUpload`, a picture → the edit mode) and
 * «Yaxshilash (AI)» (`onEnhance`, a free English rewrite the user sees and edits; needs a prompt of at least `min` characters)
 * and the «AI yaxshilash» switch (`ai`).
 */
export function PromptBox({
  value,
  onChange,
  limit,
  bytes = null,
  label = "Nimani chizamiz?",
  min = 3,
  onSamples,
  onUpload,
  uploading = false,
  onEnhance,
  enhancing = false,
  ai,
}: {
  value: string;
  onChange: (v: string) => void;
  limit: number;
  /** The prompt is over the model's byte limit (`promptBytes`). */
  bytes?: PromptBytes | null;
  label?: string;
  min?: number;
  onSamples?: () => void;
  onUpload?: (file: File) => void;
  uploading?: boolean;
  onEnhance?: () => void;
  enhancing?: boolean;
  /** «AI yaxshilash» (`AiImproveTool`); absent where nothing may rewrite the text: an image edit instruction. */
  ai?: { on: boolean; setOn: (v: boolean) => void };
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const tools = Boolean(onSamples || onUpload || onEnhance || ai);
  return (
    <section aria-label="So‘rov" data-studio-prompt className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
      <label htmlFor={id} className="text-muted-foreground mb-1.5 block text-[13px] font-semibold">
        {label}
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
        <PromptBytesNote bytes={bytes} />
      </Field>
      {tools ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-prompt-tools>
          {onSamples ? <SamplesTool onClick={onSamples} /> : null}
          {onUpload ? (
            <>
              <button type="button" data-prompt-tool="upload" disabled={uploading} onClick={() => fileRef.current?.click()} className={TOOL}>
                <ImagePlus className="size-4" aria-hidden />
                {uploading ? "Yuklanmoqda…" : "Rasm yuklash"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={STUDIO_INPUT_ACCEPT}
                className="hidden"
                data-prompt-upload-file
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUpload(f);
                }}
              />
            </>
          ) : null}
          {onEnhance ? <EnhanceTool disabled={value.trim().length < min} enhancing={enhancing} onClick={onEnhance} /> : null}
          {ai ? <AiImproveTool checked={ai.on} onChange={ai.setOn} /> : null}
        </div>
      ) : null}
    </section>
  );
}
