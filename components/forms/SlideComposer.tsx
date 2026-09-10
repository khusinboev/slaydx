"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { formatTanga, priceFor, profileDefaults } from "@/lib/tools";
import { updateProfile } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { profilePatchFrom } from "@/lib/profile-sync";
import { PLAN_ITEMS_DEFAULT, PRO_SLIDE_DEFAULT, SLIDE_DEFAULT, type SlideTool } from "@/lib/generation/slide-params";
import { cn } from "@/lib/cn";
import { LanguagePicker } from "./fields";
import { Card, Row, SummaryChips } from "./compact";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SourceFileField } from "./SourceFileField";
import { TemplatePicker, ColorPicker } from "./slide-pickers";
import { renderSlideParam, resetBlocksForPurpose, settingsSummary } from "./slide-fields";

/**
 * IKKALA slayd formasining kompozitori (Formalar 2).
 *
 * `SlideForm`/`ProSlideForm` faqat reyestr ro'yxatlarini beradi
 * (`tests/viewer/slide-form.test.mts` ularni reyestr bilan solishtiradi);
 * bu yerda ular 4 karta + yig'iq «Sozlamalar» ga taqsimlanadi:
 *
 *   Mavzu · Slaydlar soni (narx sarlavhada) · Muallif (profilga
 *   saqlanadi) · Ko'rinish · ▸ Sozlamalar (yopiq holda joriy tanlovlar
 *   qisqa chiplar bilan).
 *
 * `<details>` — brauzerning o'zi ochib-yopadi va SSR HTML ida hamma
 * maydon bor (qamrov/SSR testlari ko'radi), lekin foydalanuvchi ochmasa
 * forma ~4 karta balandligida qoladi.
 *
 * Muallif maydonlari: «Yaratish» muvaffaqiyatli bo'lgach o'zgarganlari
 * profilga yoziladi (`profilePatchFrom`) — keyingi safar standart bo'lib
 * chiqadi. Xato yutiladi: profil sinxroni generatsiyani to'xtatmasin.
 */

/** Muallif kartasiga tushadigan reyestr id lari (tartib shu). */
export const AUTHOR_FIELD_IDS = ["author", "position", "organization", "subject", "logoAssetId"] as const;
/** «Sozlamalar» ichidagi tartib — mazmunan guruhlangan (reyestr tartibi emas). */
const SETTINGS_ORDER = [
  "slideAudience",
  "slidePurpose",
  "blocks",
  "planItems",
  "textVolume",
  "quizCount",
  "slideImageStyle",
  "titleSlide",
  "agendaSlide",
  "speakerNotes",
  "localExamples",
  "internetSearch",
  "keyIdeas",
  "extra",
];

const TOPIC_EXAMPLES = [
  "Fotosintez jarayoni",
  "Avtomobillar tarixi",
  "Alisher Navoiy hayoti va ijodi",
  "Ichki yonuv dvigateli va elektromobil farqi",
  "Maktabda kitobxonlik madaniyati",
];

export function SlideComposer({
  tool,
  profile,
  kind,
  fields,
}: {
  tool: ToolConfig;
  profile: UserProfile;
  kind: SlideTool;
  /** Reyestrdan chiziladigan id lar (inline `topic/language/slideTemplate/slideTheme` dan tashqari). */
  fields: readonly string[];
}) {
  const router = useRouter();
  const pro = kind === "pro-slide";
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
    slideCount: pro ? PRO_SLIDE_DEFAULT : SLIDE_DEFAULT,
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
    slideTheme: "atlas",
    slideTemplate: "auto",
  }));
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, v: string | number | boolean) => setValues((s) => ({ ...s, [name]: v }));

  const countIds = fields.filter((id) => id === "slideCount");
  const authorIds = AUTHOR_FIELD_IDS.filter((id) => fields.includes(id));
  const settingIds = fields
    .filter((id) => id !== "slideCount" && !(AUTHOR_FIELD_IDS as readonly string[]).includes(id))
    .sort((a, b) => SETTINGS_ORDER.indexOf(a) - SETTINGS_ORDER.indexOf(b));
  const ctx = { tool: kind };
  const price = priceFor(tool, values);

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
      syncProfile(values, profile);
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  const mode = String(values.mode);
  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card
        title="Mavzu"
        aside={
          <div role="tablist" className="bg-muted/60 inline-flex rounded-lg p-0.5">
            {(tool.modes ?? []).map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                title={m.hint}
                onClick={() => set("mode", m.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  mode === m.id ? "bg-card shadow-sm font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.title}
              </button>
            ))}
          </div>
        }
      >
        {mode === "file" ? (
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
          <>
            <input
              type="text"
              aria-label={tool.topicLegend ?? "Mavzu"}
              value={String(values.topic ?? "")}
              placeholder={tool.topicPlaceholder}
              onChange={(e) => set("topic", e.target.value)}
              className="border-input bg-card focus:ring-ring h-11 w-full rounded-xl border px-3.5 text-[15px] outline-none focus:ring-2"
            />
            {pro ? null : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TOPIC_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded-full border px-2.5 py-0.5 text-[11.5px]"
                    onClick={() => set("topic", ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <div className="mt-2">
          <Row label="Til">
            <LanguagePicker compact scope="source" value={String(values.language || "uz")} onChange={(v) => set("language", v)} />
          </Row>
        </div>
      </Card>

      {countIds.length ? (
        <Card title="Slaydlar soni" aside={<span className="font-semibold tabular-nums" data-price>{formatTanga(price)}</span>}>
          {countIds.map((id) => renderSlideParam(id, values, set, ctx))}
        </Card>
      ) : null}

      {authorIds.length ? (
        <Card title="Muallif" aside={<span className="text-muted-foreground text-[11.5px]">profilga saqlanadi</span>}>
          <div className="grid gap-x-6 sm:grid-cols-2">{authorIds.map((id) => renderSlideParam(id, values, set, ctx))}</div>
        </Card>
      ) : null}

      <Card title="Ko‘rinish">
        <Row label="Shablon" hint="Slaydlar ketma-ketligi va sahna maketi. «Avtomatik» mavzudan tanlaydi.">
          <TemplatePicker value={String(values.slideTemplate || "auto")} onChange={(v) => set("slideTemplate", v)} />
        </Row>
        <Row label="Rang" hint="Faqat palitra — tuzilma o‘zgarmaydi.">
          <ColorPicker value={String(values.slideTheme || "atlas")} onChange={(v) => set("slideTheme", v)} />
        </Row>
      </Card>

      {settingIds.length ? (
        <details className="group bg-card mb-3 rounded-2xl border" data-settings>
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <span className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">Sozlamalar</span>
            <span className="text-muted-foreground text-xs transition group-open:rotate-90">▸</span>
            <span className="min-w-0 flex-1 group-open:hidden">
              <SummaryChips items={settingsSummary(values, settingIds)} />
            </span>
          </summary>
          <div className="grid gap-x-6 border-t px-4 pt-2 pb-4 sm:grid-cols-2">
            {settingIds.map((id) => renderSlideParam(id, values, set, ctx))}
          </div>
        </details>
      ) : null}
    </ToolChrome>
  );
}

/** Muallif maydonlari → profil (faqat o'zgarganlari); xato jim — generatsiya ketdi. */
function syncProfile(values: FormValues, profile: UserProfile) {
  const patch = profilePatchFrom(values, profile);
  if (!Object.keys(patch).length) return;
  updateProfile(patch)
    .then((r) => useAppStore.getState().setUser(r.user))
    .catch(() => {});
}
