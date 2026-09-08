"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { priceFor, profileDefaults } from "@/lib/tools";
import {
  SLIDE_TEMPLATE_BY_ID,
  SLIDE_TEMPLATE_GROUPS,
  SLIDE_TEMPLATES,
  normalizeTemplateId,
  type SlideVisual,
} from "@/lib/generation/slide-templates";
import { SLIDE_THEMES } from "@/lib/generation/slide-themes";
import { ChipGroup, LanguagePicker, Legend, ModeSwitch, TextInput } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SourceFileField } from "./SourceFileField";
import { slideParamsFor } from "@/lib/generation/slide-params";
import { renderSlideParam } from "./slide-fields";
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
 * `ProSlideForm` bilan bitta manba (WP-G): oddiy `slide` maydonlari
 * REYESTRDAN chiziladi, `slideParamsFor("slide")` da bo'lmagan id
 * (masalan `position`, `blocks`, `slideCount`, `keyIdeas`) bu yerda
 * ko'rinmaydi — `tests/slide-form.test.mts` qamrov testi buni tekshiradi.
 * `topic`/`language`/`quality`/`slideTemplate`/`slideTheme` mavjud
 * komponentlar bilan pastda o'zicha chiziladi, qolganini
 * `renderSlideParam` chizadi.
 */
const SLIDE_FIELD_ORDER = slideParamsFor("slide")
  .map((p) => p.id)
  .filter((id) => !["topic", "language", "quality", "slideTemplate", "slideTheme", "extra"].includes(id));

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

/**
 * `profile` MAJBURIY prop — ixtiyoriy emas.
 *
 * Ilgari `SlideForm` o'z qiymatlarini noldan qurar va profildan hech
 * narsa olmasdi (N-7). Natijada `meta.author` ham, `meta.university` ham
 * bo'sh bo'lib, har slaydning pastki qatori bo'sh chiqardi — himoya
 * taqdimotida ham muallif ismi ko'rinmasdi. Prop majburiy bo'lgani
 * uchun simlashni unutish endi TypeScript xatosi.
 */
export function SlideForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => ({
    ...profileDefaults(profile),
    mode: "topic",
    topic: "",
    language: "uz",
    extra: "",
    quality: "standard",
    slideAudience: "auto",
    slidePurpose: "general",
    planItems: 5,
    textVolume: "standart",
    quizCount: 0,
    slideImageStyle: "photo",
    titleSlide: true,
    agendaSlide: true,
    localExamples: false,
    internetSearch: false,
    speakerNotes: true,
    logoAssetId: "",
    slideTheme: "atlas",
    slideTemplate: "auto",
  }));
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
      extra={renderSlideParam("extra", values, set)}
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
        <LanguagePicker
          value={String(values.language || "uz")}
          onChange={(v) => set("language", v)}
          scope="source"
        />
      </fieldset>
      <fieldset className="mb-6">
        <Legend>Sifat / hajm</Legend>
        <ChipGroup options={QUALITY} value={String(values.quality)} onChange={(v) => set("quality", v)} />
      </fieldset>
      {SLIDE_FIELD_ORDER.map((id) => renderSlideParam(id, values, set))}
      <fieldset className="mb-6">
        <Legend>Shablon — tuzilma</Legend>
        <p className="text-muted-foreground mb-3 text-sm">
          Shablon slaydlar ketma-ketligini va sahna maketini belgilaydi. «Avtomatik» mavzudan tanlaydi.
        </p>
        <TemplatePicker value={String(values.slideTemplate || "auto")} onChange={(v) => set("slideTemplate", v)} />
      </fieldset>
      <fieldset className="mb-6">
        <Legend>Rang</Legend>
        <p className="text-muted-foreground mb-3 text-sm">Faqat palitra. Tuzilma o‘zgarmaydi.</p>
        <ColorPicker value={String(values.slideTheme || "atlas")} onChange={(v) => set("slideTheme", v)} />
      </fieldset>
    </ToolChrome>
  );
}

/**
 * Yig'iluvchi shablon tanlagich.
 *
 * Ilgari 21 ta karta bitta yassi to'rda turardi — formaning eng uzun
 * bo'lagi edi va tanlangani ko'rinmasdi. Endi: yopiq holatda faqat
 * TANLANGAN shablon ko'rinadi, ochilganda esa shablonlar guruhma-guruh
 * (akkordeon) — bir vaqtda bitta guruh ochiq.
 */
export function TemplatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = SLIDE_TEMPLATE_BY_ID[normalizeTemplateId(value)] ?? SLIDE_TEMPLATE_BY_ID.auto;
  const [open, setOpen] = useState(false);
  // Ochilganda foydalanuvchi turgan guruh ochiq bo'lsin — tanlovini
  // qidirib topishi shart emas.
  const [group, setGroup] = useState<string>(current.group);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setGroup(current.group);
          setOpen(true);
        }}
        className="border-input hover:border-foreground/30 flex w-full items-center gap-3 rounded-xl border p-2 text-left transition"
      >
        <span className="w-24 shrink-0 overflow-hidden rounded-lg">
          <TemplateSketch id={current.id} visual={current.visual} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current.nameUz}</span>
          <span className="text-muted-foreground block truncate text-[11px]">{current.blurb}</span>
        </span>
        <span className="text-muted-foreground shrink-0 pr-2 text-xs">O&apos;zgartirish</span>
      </button>
    );
  }

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="border-input overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-[13px] font-medium">Shablon tanlang</span>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground text-xs">
          Yopish
        </button>
      </div>

      <TemplateCard tpl={SLIDE_TEMPLATE_BY_ID.auto} on={current.id === "auto"} onPick={pick} wide />

      {SLIDE_TEMPLATE_GROUPS.map((g) => {
        const items = SLIDE_TEMPLATES.filter((t) => t.id !== "auto" && t.group === g.id);
        const expanded = group === g.id;
        return (
          <div key={g.id} className="border-t">
            <button
              type="button"
              onClick={() => setGroup(expanded ? "" : g.id)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="text-[13px] font-medium">{g.label}</span>
              <span className="text-muted-foreground text-xs">
                {items.some((t) => t.id === current.id) ? "tanlangan · " : ""}
                {expanded ? "−" : `+${items.length}`}
              </span>
            </button>
            {expanded ? (
              <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-3">
                {items.map((t) => (
                  <TemplateCard key={t.id} tpl={t} on={current.id === t.id} onPick={pick} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TemplateCard({
  tpl,
  on,
  onPick,
  wide,
}: {
  tpl: (typeof SLIDE_TEMPLATES)[number];
  on: boolean;
  onPick: (id: string) => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(tpl.id)}
      className={cn(
        "overflow-hidden rounded-xl border text-left transition",
        wide ? "m-3 mb-0 flex w-[calc(100%-1.5rem)] items-center gap-3 p-2" : "block",
        on ? "ring-primary border-transparent ring-2" : "border-input hover:border-foreground/30",
      )}
    >
      <span className={cn("block overflow-hidden", wide ? "w-24 shrink-0 rounded-lg" : "")}>
        <TemplateSketch id={tpl.id} visual={tpl.visual} />
      </span>
      <span className={cn("block", wide ? "min-w-0 flex-1" : "bg-card px-2.5 py-2")}>
        <span className="block truncate text-[13px] font-medium">{tpl.nameUz}</span>
        <span className="text-muted-foreground block truncate text-[11px]">{tpl.blurb}</span>
      </span>
    </button>
  );
}

/**
 * Eskiz `visual` dan chiziladi, shablon `id` sidan emas.
 *
 * Ilgari eskizlar id ro'yxatiga qo'lda bog'langan edi va ular maketga
 * MOS KELMASDI — masalan `case` va `lesson` «karta» eskizini olardi,
 * holbuki `cards` maketi kodda umuman yo'q edi va ular oddiy ro'yxat
 * bo'lib chiqardi. Endi eskiz aynan `slide-layout.ts` chizadigan
 * narsani ko'rsatadi.
 */
function TemplateSketch({ id, visual }: { id: string; visual: SlideVisual }) {
  if (id === "auto") {
    return (
      <div className="flex h-16 items-center justify-center bg-slate-100 text-xs font-medium text-slate-500">
        Auto
      </div>
    );
  }
  if (visual === "cards") {
    return (
      <div className="grid h-16 grid-cols-2 grid-rows-2 gap-1 bg-slate-100 p-2">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="rounded-sm border-l-2 border-slate-500 bg-white" />
        ))}
      </div>
    );
  }
  if (visual === "dense") {
    return (
      <div className="flex h-16 flex-col gap-1 bg-slate-800 px-2 py-2">
        <div className="h-1.5 w-10 rounded bg-slate-400" />
        <div className="h-2 w-full rounded-sm bg-slate-600" />
        <div className="h-1.5 w-full rounded-sm bg-slate-700" />
        <div className="h-1.5 w-full rounded-sm bg-slate-700" />
      </div>
    );
  }
  if (visual === "timeline") {
    return (
      <div className="relative flex h-16 items-center gap-1 bg-slate-100 px-2">
        <div className="absolute inset-x-2 top-4 h-0.5 bg-slate-400" />
        {[1, 2, 3].map((n) => (
          <div key={n} className="relative flex-1 rounded bg-white py-3 text-center text-[10px] font-bold text-slate-500">
            {n}
          </div>
        ))}
      </div>
    );
  }
  if (visual === "magazine") {
    return (
      <div className="flex h-16 flex-col justify-end bg-stone-400 p-0">
        <div className="bg-stone-800/85 px-2 py-1.5">
          <div className="h-2 w-20 rounded bg-stone-200" />
          <div className="mt-1 h-1 w-12 rounded bg-stone-400" />
        </div>
      </div>
    );
  }
  if (visual === "lab") {
    // `planLabRows`: daftar varag'i, chap chekkada bo'linmali o'lchov
    // chizig'i, raqamlangan kuzatuv qatorlari.
    return (
      <div className="flex h-16 gap-1.5 bg-white px-2 py-2">
        <div className="relative w-1 shrink-0 bg-amber-500">
          <div className="absolute -right-1 top-0 flex h-full flex-col justify-between">
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} className="h-px w-1.5 bg-amber-500/60" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-around pl-1.5">
          {[1, 2, 3].map((n) => (
            <div key={n} className="border-b border-slate-200 pb-0.5">
              <div className="h-1 w-full rounded bg-slate-300" style={{ width: `${100 - n * 12}%` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (visual === "hero-split") {
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
  return (
    <div className="flex h-16 flex-col justify-center gap-1 bg-slate-100 px-3">
      <div className="h-1.5 w-14 rounded bg-slate-400" />
      <div className="h-1 w-full rounded bg-slate-300" />
      <div className="h-1 w-4/5 rounded bg-slate-300" />
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
