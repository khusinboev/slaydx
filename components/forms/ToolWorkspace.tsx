"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { defaultPages, missingRequired, priceFor, profileDefaults, toolBlockedReason } from "@/lib/tools";
import { draftOutline } from "@/lib/api-client";
import { useAppStore, writerProfile } from "@/lib/store";
import { useUi } from "@/lib/ui";
import type { UserProfile } from "@/lib/types";
import { FieldBlock, ModeSwitch, TextInput, Legend } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SlideForm } from "./SlideForm";
import { ProSlideForm } from "./ProSlideForm";
import { ResumeComposer } from "./ResumeComposer";
import { TranslationForm } from "./TranslationForm";
import { ImageStudio } from "./ImageStudio";
import { SourceFileField } from "./SourceFileField";

function defaultsFor(tool: ToolConfig, profile: UserProfile): FormValues {
  const v: FormValues = {
    // Muallif maydonlari yagona manbadan (`lib/tools.ts`) — `SlideForm`
    // ham aynan shu ro'yxatni oladi, shuning uchun ular ajralib ketmaydi.
    ...profileDefaults(profile),
    language: "uz",
    mode: tool.modes ? "topic" : "topic",
    topic: "",
    extra: "",
    design: "iris",
    // Standart hajm narx va dvigatel bilan bitta manbadan (P1-7).
    pages: defaultPages(tool.id),
    grade: 8,
    duration: "45",
    kind: "standard",
    annotationLangs: "same",
    ministry: "oliy",
    tocMethod: "ai",
    images: "yes",
    quality: "standard",
    titleSlide: true,
    weeklyHours: 4,
    totalHours: 136,
  };
  return v;
}

export function ToolWorkspace({ tool }: { tool: ToolConfig }) {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const user = useAppStore((s) => s.user);
  const features = useAppStore((s) => s.features);
  const open = useUi((s) => s.open);

  // Sessiya serverdan tasdiqlanmaguncha login modalini ochmaymiz —
  // aks holda kirgan foydalanuvchiga ham bir lahza "kiring" chiqardi.
  useEffect(() => {
    if (sessionChecked && !loggedIn) {
      open("login", { returnTo: `/uz/${tool.slug}` });
    }
  }, [sessionChecked, loggedIn, open, tool.slug]);

  if (!sessionChecked) {
    return <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;
  }

  /*
   * Kalitsiz xizmat sotilmaydi (N-6).
   *
   * Kartochka `CreateGrid` da allaqachon o'chirilgan, lekin sahifani
   * to'g'ridan-to'g'ri ochish mumkin: havola, zakladka, orqaga tugmasi.
   * To'siq shu yerda ham bo'lishi kerak — aks holda foydalanuvchi to'lab,
   * navbat kutib, faqat shundan keyin xato olardi.
   */
  const blocked = toolBlockedReason(tool, features);
  if (blocked) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="font-medium">{tool.pageTitle}</p>
        <p className="text-muted-foreground mt-2 text-sm">{blocked}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Hisobingizdan hech narsa yechilmadi.
        </p>
      </div>
    );
  }

  const profile = writerProfile(user);

  if (tool.custom === "slide") return <SlideForm tool={tool} profile={profile} />;
  if (tool.custom === "pro-slide") return <ProSlideForm tool={tool} profile={profile} />;
  if (tool.custom === "resume") return <ResumeComposer tool={tool} profile={profile} />;
  if (tool.custom === "translation") return <TranslationForm tool={tool} />;
  if (tool.custom === "image") return <ImageStudio tool={tool} />;

  return <StandardForm tool={tool} profile={profile} />;
}

function StandardForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => defaultsFor(tool, profile));
  const [extraOpen, setExtraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (name: string, v: string | number | boolean) =>
    setValues((s) => ({ ...s, [name]: v }));

  /**
   * Reja matni va rejim bitta harakatda o'rnatiladi.
   *
   * Matn yozilsa — `manual`, tozalansa — `ai`. Ilgari `tocMethod`
   * FAQAT «AI reja tuzsin» tugmasida o'zgarardi, shuning uchun qo'lda
   * yozilgan reja dvigatelga «avtomatik» bayrog'i bilan borib, jim
   * tashlanardi.
   */
  const setOutline = (text: string) =>
    setValues((s) => ({ ...s, tocText: text, tocMethod: text.trim() ? "manual" : "ai" }));

  const [outlineBusy, setOutlineBusy] = useState(false);
  // Reja tahriri bo'lgan vositalarda `tocText` asosiy joyda ko'rsatiladi,
  // shuning uchun uni «qo'shimcha» ro'yxatidan chiqaramiz.
  const hasOutline = tool.fields.some((f) => f.name === "tocMethod");
  /*
   * `tocMethod` chips i ATAYIN ko'rsatilmaydi.
   *
   * U reja matni maydoni bilan bitta narsani boshqarardi va ikkalasi
   * bir-biriga zid bo'lishi mumkin edi: foydalanuvchi rejasini yozadi,
   * chips esa «AI yaratishi» da qolib, reja jim tashlanardi. Endi
   * signal bitta — matnning o'zi (`setOutline` va `manualOutlineOf`).
   */
  const mainFields = tool.fields.filter((f) => !f.extra && !(hasOutline && f.name === "tocMethod"));
  const extraFields = tool.fields.filter((f) => f.extra && !(hasOutline && f.name === "tocText"));
  const needsTopic = Boolean(tool.topicLegend);
  const fileMode = tool.modes && values.mode === "file";
  const price = useMemo(() => priceFor(tool, values), [tool, values]);

  /**
   * Rejani AI tuzadi va tahrirlash uchun ko'rsatadi.
   *
   * Bepul: kredit yechilmaydi. Foydalanuvchi rejani tuzatgach
   * `tocMethod` «manual» ga o'tadi va dvigatel AYNAN shu rejani
   * ishlatadi — ostmavzular ham saqlanadi.
   */
  async function makeOutline() {
    setError(null);
    if (!String(values.topic ?? "").trim()) {
      setError("Avval mavzuni kiriting");
      return;
    }
    setOutlineBusy(true);
    try {
      const { text } = await draftOutline(tool.slug, values);
      setOutline(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reja tuzilmadi");
    } finally {
      setOutlineBusy(false);
    }
  }

  async function submit() {
    setError(null);
    if (reading) {
      setError("Fayl hali o‘qilmoqda");
      return;
    }
    if (fileMode && !String(values.sourceText || "").trim()) {
      setError("Avval fayl tanlang — matn olingandan keyin yaratish boshlanadi.");
      return;
    }
    if (needsTopic && !fileMode && !String(values.topic || "").trim()) {
      setError("Mavzu kiritilishi shart");
      return;
    }
    // Qoida bitta manbada (`lib/tools.ts`) — server ham shuni tekshiradi.
    const missing = missingRequired(tool, values);
    if (missing.length) {
      setError(`${missing[0]} to‘ldirilishi kerak`);
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
        extraFields.length ? (
          <>
            {extraFields.map((f) => (
              <FieldBlock key={f.name} field={f} values={values} set={set} />
            ))}
            <fieldset className="mb-4">
              <Legend>Qo&apos;shimcha talablar</Legend>
              <textarea
                value={String(values.extra ?? "")}
                onChange={(e) => set("extra", e.target.value)}
                className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
                rows={3}
                placeholder="Mavzu, yo'nalish va boshqa qo'shimchalar"
              />
            </fieldset>
          </>
        ) : tool.extraOptional ? (
          <fieldset>
            <Legend>Qo&apos;shimcha talablar</Legend>
            <textarea
              value={String(values.extra ?? "")}
              onChange={(e) => set("extra", e.target.value)}
              className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
              rows={3}
            />
          </fieldset>
        ) : null
      }
      extraOpen={extraOpen}
      onExtra={() => setExtraOpen((v) => !v)}
      submitLabel={tool.submitLabel}
      price={price}
      loading={loading}
      onSubmit={submit}
      error={error}
    >
      {tool.modes ? (
        <ModeSwitch
          modes={tool.modes}
          value={String(values.mode ?? "topic")}
          onChange={(v) => set("mode", v)}
        />
      ) : null}

      {fileMode ? (
        <SourceFileField
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
      ) : needsTopic ? (
        <fieldset className="mb-6">
          <Legend>{tool.topicLegend}</Legend>
          <TextInput
            value={String(values.topic ?? "")}
            placeholder={tool.topicPlaceholder}
            onChange={(v) => set("topic", v)}
          />
          {tool.topicExamples?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {tool.topicExamples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                  onClick={() => set("topic", ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {hasOutline ? (
        <fieldset className="mb-6">
          <Legend>Ish rejasi</Legend>
          <p className="text-muted-foreground mb-3 text-sm">
            Rejani oldindan ko&apos;rib, tuzatib olishingiz mumkin — bu bepul. Tahrirlangan reja hujjat tuzilmasiga
            aynan tushadi.
          </p>
          <button
            type="button"
            onClick={makeOutline}
            disabled={outlineBusy || loading}
            className="border-input bg-card hover:bg-muted mb-3 rounded-xl border px-4 py-2 text-sm disabled:opacity-60"
          >
            {outlineBusy ? "Reja tuzilmoqda…" : "AI reja tuzsin"}
          </button>
          <textarea
            value={String(values.tocText ?? "")}
            onChange={(e) => setOutline(e.target.value)}
            rows={String(values.tocText ?? "") ? 9 : 4}
            className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 font-mono text-[13px] outline-none focus:ring-2"
            placeholder={"1. Birinchi bob\n  1.1 Ostmavzu\n  1.2 Ostmavzu\n2. Ikkinchi bob"}
          />
          <p className="text-muted-foreground mt-2 text-xs">
            Bu yerga yozganingiz hujjat tuzilmasiga aynan tushadi. Bo&apos;sh qoldirsangiz reja avtomatik
            tuziladi. Ostmavzuni ichkariga surib yoki «1.1» deb yozing.
          </p>
        </fieldset>
      ) : null}
      {mainFields.map((f) => (
        <FieldBlock key={f.name} field={f} values={values} set={set} />
      ))}
    </ToolChrome>
  );
}
