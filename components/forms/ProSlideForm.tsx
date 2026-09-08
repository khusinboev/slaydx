"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { priceFor, profileDefaults } from "@/lib/tools";
import { PLAN_ITEMS_DEFAULT, PRO_SLIDE_DEFAULT } from "@/lib/generation/slide-params";
import { LanguagePicker, Legend, ModeSwitch, TextInput } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SourceFileField } from "./SourceFileField";
import { TemplatePicker, ColorPicker } from "./SlideForm";
import { renderSlideParam, resetBlocksForPurpose } from "./slide-fields";

/**
 * Pro slayd formasi — WP-0b stub'ni almashtiradi.
 *
 * Maydonlar FAQAT `slideParamsFor("pro-slide")` reyestridan chiziladi
 * (`tests/slide-form.test.mts` qamrov testi buni tekshiradi).
 * `topic`/`language`/`slideTemplate`/`slideTheme` — mavjud komponentlar
 * bilan (`TemplatePicker`/`ColorPicker` `SlideForm`dan qayta ishlatiladi
 * — ikkita mustaqil chizuvchi bo'lmasin). Qolgan hammasi
 * `renderSlideParam` orqali — `SlideForm` bilan bitta manba.
 *
 * Uchta eksport qilingan ro'yxat asosiy tanadagi (ikkiga bo'lingan —
 * til tanlagichi orasiga kiradi) va «Qo'shimcha» bo'limidagi tartibni
 * belgilaydi; JSX ULARNI TO'G'RIDAN-TO'G'RI chizadi (qo'lda alohida
 * `renderSlideParam(...)` chaqiruvlari emas), shuning uchun bu
 * ro'yxatlar va haqiqiy render bir-biridan AJRALIB KETA OLMAYDI —
 * `tests/slide-form.test.mts` shu uchta ro'yxatni reyestr bilan
 * to'g'ridan-to'g'ri solishtiradi.
 */
export const PRO_INLINE_FIELD_IDS = ["topic", "language", "slideTemplate", "slideTheme"];
export const PRO_MAIN_FIELD_ORDER_1 = ["slideAudience", "slidePurpose", "blocks", "planItems", "subject", "slideCount"];
export const PRO_MAIN_FIELD_ORDER_2 = ["slideImageStyle", "logoAssetId", "author", "position", "organization"];
export const PRO_EXTRA_FIELD_ORDER = ["keyIdeas", "speakerNotes", "localExamples", "textVolume", "internetSearch", "quizCount", "titleSlide", "agendaSlide", "extra"];

export function ProSlideForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => ({
    ...profileDefaults(profile),
    mode: "topic",
    topic: "",
    language: "uz",
    extra: "",
    slideAudience: "auto",
    slidePurpose: "general",
    blocks: resetBlocksForPurpose("general"),
    planItems: PLAN_ITEMS_DEFAULT,
    slideCount: PRO_SLIDE_DEFAULT,
    textVolume: "standart",
    quizCount: 0,
    slideImageStyle: "photo",
    titleSlide: true,
    agendaSlide: true,
    localExamples: false,
    internetSearch: false,
    speakerNotes: true,
    keyIdeas: "",
    logoAssetId: "",
    position: "",
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
      extra={
        <>
          {PRO_EXTRA_FIELD_ORDER.map((id) => renderSlideParam(id, values, set))}
        </>
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
            placeholder="Masalan: Suvning tabiatdagi aylanishi"
            onChange={(v) => set("topic", v)}
          />
        </fieldset>
      )}

      {PRO_MAIN_FIELD_ORDER_1.map((id) => renderSlideParam(id, values, set))}

      <fieldset className="mb-6">
        <Legend>Taqdimot tili</Legend>
        <LanguagePicker
          value={String(values.language || "uz")}
          onChange={(v) => set("language", v)}
          scope="source"
        />
      </fieldset>

      {PRO_MAIN_FIELD_ORDER_2.map((id) => renderSlideParam(id, values, set))}

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
