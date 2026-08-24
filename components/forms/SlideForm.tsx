"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { priceFor } from "@/lib/tools";
import { SLIDE_TEMPLATES } from "@/lib/generation/slide-templates";
import { SLIDE_THEMES } from "@/lib/generation/slide-themes";
import { ChipGroup, LanguagePicker, Legend, ModeSwitch, TextInput } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SourceFileField } from "./SourceFileField";
import { cn } from "@/lib/cn";

/**
 * Paket yorlig‘ida slaydlar soni ko‘rsatiladi.
 *
 * Ilgari faqat narx yozilardi va paket amalda hech narsani o‘zgartirmasdi —
 * to‘rttasi ham 7–10 slayd berardi. Endi paket ikki o‘lchovda farqlanadi:
 * HAJM (`meta.targetPages` → deck uzunligi) va VIZUAL SIFAT
 * (`meta.premiumVisuals` → rasm modeli, qadamlar soni va rasmlar soni).
 * Ikkalasi ham yorliqda ochiq yozilgan.
 */
/**
 * Auditoriya — himoya zali va 5-sinf bir xil deck olmasligi kerak.
 * Chegaralar `AUDIENCE_RULES` da (`slide-templates.ts`).
 */
const AUDIENCE = [
  { value: "auto", label: "Avtomatik" },
  { value: "defense", label: "Himoya" },
  { value: "lecture", label: "Ma'ruza" },
  { value: "school", label: "Maktab darsi" },
  { value: "pitch", label: "Pitch" },
];

/*
 * «Sifatli rasm» → «sifatliroq rasm»: standart paket ham fal.ai rasm
 * bilan ishlaydi, premium esa (sozlamada FAL_MODEL_PREMIUM ko'rsatilmasa)
 * bir xil modelning ko'proq (8 vs 4) qadamli chizilishi — bu haqiqiy,
 * lekin NISBIY farq, «sifatli» (aksincha standart sifatsiz degandek
 * o'qiladi) emas.
 */
const QUALITY = [
  { value: "standard", label: "Standart · 10 slayd · 3 000" },
  { value: "long", label: "Uzun · 14 slayd · 5 000" },
  { value: "premium", label: "Premium · 12 slayd · sifatliroq rasm · 6 000" },
  { value: "premium_long", label: "Premium uzun · 16 slayd · sifatliroq rasm · 8 000" },
];

export function SlideForm({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    mode: "topic",
    topic: "",
    language: "uz",
    extra: "",
    quality: "standard",
    slideAudience: "auto",
    titleSlide: true,
    slideTheme: "atlas",
    slideTemplate: "auto",
  });
  const [extraOpen, setExtraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, v: string | number | boolean) =>
    setValues((s) => ({ ...s, [name]: v }));

  async function submit() {
    setError(null);
    if (reading) {
      setError("Fayl hali o‘qilmoqda");
      return;
    }
    if (values.mode === "file" && !String(values.sourceText || "").trim()) {
      setError("Avval fayl tanlang — matn olingandan keyin taqdimot yaratiladi.");
      return;
    }
    if (values.mode !== "file" && !String(values.topic || "").trim()) {
      setError("Mavzu kiritilishi shart");
      return;
    }
    setLoading(true);
    try {
      const id = await runGeneration(tool, values);
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome
      title={tool.pageTitle}
      extra={
        <fieldset>
          <Legend>Qo&apos;shimcha talablar</Legend>
          <textarea
            value={String(values.extra ?? "")}
            onChange={(e) => set("extra", e.target.value)}
            rows={3}
            className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
            placeholder="Rejalar, uslub, auditoriya..."
          />
        </fieldset>
      }
      extraOpen={extraOpen}
      onExtra={() => setExtraOpen((v) => !v)}
      submitLabel={tool.submitLabel}
      price={priceFor(tool, values)}
      loading={loading}
      onSubmit={submit}
      error={error}
    >
      <ModeSwitch
        modes={tool.modes ?? []}
        value={String(values.mode)}
        onChange={(v) => set("mode", v)}
      />
      {values.mode === "file" ? (
        <SourceFileField
          legend="Fayl biriktirish"
          fileName={String(values.fileName ?? "")}
          sourceText={String(values.sourceText ?? "")}
          onBusyChange={setReading}
          onChange={({ fileName, sourceText }) =>
            setValues((s) => ({
              ...s,
              fileName,
              sourceText,
              topic: String(s.topic || "").trim() || fileName.replace(/\.[^.]+$/, ""),
            }))
          }
        />
      ) : (
        <fieldset className="mb-6">
          <Legend>Taqdimot mavzusini kiriting</Legend>
          <TextInput
            value={String(values.topic ?? "")}
            placeholder="Masalan: Fotosintez jarayoni"
            onChange={(v) => set("topic", v)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              "Fotosintez jarayoni",
              "Avtomobillar tarixi",
              "Alisher Navoiy hayoti va ijodi",
              "Ichki yonuv dvigateli va elektromobil farqi",
              "Maktabda kitobxonlik madaniyati",
            ].map((ex) => (
              <button
                key={ex}
                type="button"
                className="text-muted-foreground hover:text-foreground rounded-full border px-3 py-1 text-xs"
                onClick={() => set("topic", ex)}
              >
                {ex}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="mb-6">
        <Legend>Taqdimot tili</Legend>
        <LanguagePicker value={String(values.language || "uz")} onChange={(v) => set("language", v)} />
      </fieldset>
      <fieldset className="mb-6">
        <Legend>Sifat / hajm</Legend>
        <ChipGroup options={QUALITY} value={String(values.quality)} onChange={(v) => set("quality", v)} />
      </fieldset>
      <fieldset className="mb-6">
        <Legend>Kim uchun</Legend>
        <p className="text-muted-foreground mb-3 text-sm">
          Auditoriya shrift kattaligi va banddagi so‘z sonini belgilaydi. «Avtomatik» shablondan aniqlaydi.
        </p>
        <ChipGroup
          options={AUDIENCE}
          value={String(values.slideAudience || "auto")}
          onChange={(v) => set("slideAudience", v)}
        />
      </fieldset>
      <fieldset className="mb-6">
        <Legend>Shablon — tuzilma</Legend>
        <p className="text-muted-foreground mb-3 text-sm">
          Gamma kabi: shablon slaydlar ketma-ketligi va sahna tuzilishini belgilaydi. «Avtomatik» mavzudan tanlaydi.
        </p>
        <TemplatePicker value={String(values.slideTemplate || "auto")} onChange={(v) => set("slideTemplate", v)} />
      </fieldset>
      <fieldset className="mb-6">
        <Legend>Rang</Legend>
        <p className="text-muted-foreground mb-3 text-sm">Faqat palitra. Tuzilma o‘zgarmaydi.</p>
        <ColorPicker value={String(values.slideTheme || "atlas")} onChange={(v) => set("slideTheme", v)} />
      </fieldset>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(values.titleSlide)}
          onChange={(e) => set("titleSlide", e.target.checked)}
        />
        Titul slaydini qo&apos;shish
      </label>
    </ToolChrome>
  );
}

function TemplatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {SLIDE_TEMPLATES.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "overflow-hidden rounded-xl border text-left transition",
              on ? "ring-primary border-transparent ring-2" : "border-input hover:border-foreground/30",
            )}
          >
            <TemplateSketch id={t.id} />
            <div className="bg-card px-2.5 py-2">
              <div className="truncate text-[13px] font-medium">{t.nameUz}</div>
              <div className="text-muted-foreground truncate text-[11px]">{t.blurb}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TemplateSketch({ id }: { id: string }) {
  if (id === "pitch") {
    return (
      <div className="flex h-16 bg-slate-100">
        <div className="w-[38%] bg-slate-800" />
        <div className="flex flex-1 flex-col justify-center gap-1 px-2">
          <div className="h-2 w-16 rounded bg-slate-400" />
          <div className="h-1.5 w-10 rounded bg-slate-300" />
        </div>
      </div>
    );
  }
  if (id === "compare") {
    return (
      <div className="grid h-16 grid-cols-2 gap-1 bg-slate-100 p-2">
        <div className="rounded bg-white" />
        <div className="rounded bg-white" />
      </div>
    );
  }
  if (id === "process" || id === "timeline") {
    return (
      <div className="flex h-16 items-end gap-1 bg-slate-100 px-2 pb-2">
        {[40, 70, 55, 85].map((h) => (
          <div key={h} className="flex-1 rounded-t bg-slate-400" style={{ height: `${h}%` }} />
        ))}
      </div>
    );
  }
  if (id === "magazine") {
    return (
      <div className="flex h-16 flex-col justify-end bg-stone-200 p-2">
        <div className="h-3 w-20 rounded bg-stone-700" />
      </div>
    );
  }
  if (id === "report" || id === "defense") {
    return (
      <div className="grid h-16 grid-cols-3 gap-1 bg-slate-100 p-2">
        <div className="rounded bg-slate-300" />
        <div className="rounded bg-slate-400" />
        <div className="rounded bg-slate-300" />
      </div>
    );
  }
  if (id === "auto") {
    return (
      <div className="flex h-16 items-center justify-center bg-slate-100 text-xs font-medium text-slate-500">
        Auto
      </div>
    );
  }
  if (id === "bio" || id === "literature" || id === "story") {
    return (
      <div className="relative flex h-16 flex-col justify-end bg-amber-100 p-2">
        <div className="h-2 w-16 rounded bg-amber-800" />
        <div className="mt-1 h-1 w-10 rounded bg-amber-600/60" />
      </div>
    );
  }
  if (id === "debate" || id === "problem") {
    return (
      <div className="grid h-16 grid-cols-2 gap-px bg-slate-200">
        <div className="bg-slate-800" />
        <div className="bg-slate-100" />
      </div>
    );
  }
  if (id === "gallery") {
    return (
      <div className="grid h-16 grid-cols-3 gap-px bg-neutral-200">
        <div className="bg-neutral-400" />
        <div className="bg-neutral-600" />
        <div className="bg-neutral-300" />
      </div>
    );
  }
  if (id === "science" || id === "workshop") {
    return (
      <div className="flex h-16 items-center gap-1 bg-teal-50 px-2">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex-1 rounded bg-teal-200 py-3 text-center text-[10px] font-bold text-teal-800">
            {n}
          </div>
        ))}
      </div>
    );
  }
  if (id === "briefing" || id === "faq") {
    return (
      <div className="flex h-16 flex-col justify-center gap-1 bg-slate-100 px-3">
        <div className="h-2 w-8 rounded bg-slate-500" />
        <div className="h-1 w-full rounded bg-slate-300" />
        <div className="h-1 w-2/3 rounded bg-slate-300" />
      </div>
    );
  }
  return (
    <div className="flex h-16 flex-col justify-center gap-1 bg-slate-100 px-3">
      <div className="h-1.5 w-14 rounded bg-slate-400" />
      <div className="h-1 w-full rounded bg-slate-300" />
      <div className="h-1 w-4/5 rounded bg-slate-300" />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SLIDE_THEMES.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            title={t.nameUz}
            onClick={() => onChange(t.id)}
            className={cn("flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs", on ? "ring-primary ring-2" : "border-input")}
          >
            <span className="flex size-5 overflow-hidden rounded-full">
              <span className="h-full w-1/2" style={{ background: t.titleBg }} />
              <span className="h-full w-1/2" style={{ background: t.accent }} />
            </span>
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
