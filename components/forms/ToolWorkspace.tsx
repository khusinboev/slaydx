"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { defaultPages, fieldVisible, missingRequired, priceFor, profileDefaults, toolBlockedReason } from "@/lib/tools";
import { draftOutline, type ServerUser } from "@/lib/api-client";
import { useAppStore, writerProfile } from "@/lib/store";
import { useUi } from "@/lib/ui";
import type { UserProfile } from "@/lib/types";
import { FieldBlock, ModeSwitch, TextInput, Legend } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SourceFileField } from "./SourceFileField";
import { gameDefaultTypeId } from "@/lib/generation/games/registry";
import { GAME_LIMITS } from "@/lib/generation/games/types";
import { infographicDefaultTypeId } from "@/lib/generation/infographic/registry";
import { INFOGRAPHIC_LIMITS, PALETTES } from "@/lib/generation/infographic/types";

/*
 * Har vositaning formasi ALOHIDA bo'lakda (FE-11).
 *
 * Ilgari 12 ta composer statik import qilinardi: `/uz/rasm` ni ochgan
 * foydalanuvchi rezyume formasi, kasblar bazasi (~580 KB), maqola va
 * o'yin formalari bilan birga ~500 KB gz JS yuklardi. Endi sahifa faqat
 * o'z formasini `import()` bilan oladi. Xulq o'zgarmaydi: forma baribir
 * sessiya tasdiqlangandan keyin chiziladi, bo'lak shu vaqtda yetib keladi.
 */
const SlideForm = lazy(() => import("./SlideForm").then((m) => ({ default: m.SlideForm })));
const ProSlideForm = lazy(() => import("./ProSlideForm").then((m) => ({ default: m.ProSlideForm })));
const ResumeComposer = lazy(() => import("./ResumeComposer").then((m) => ({ default: m.ResumeComposer })));
const TranslationForm = lazy(() => import("./TranslationForm").then((m) => ({ default: m.TranslationForm })));
const ImageStudio = lazy(() => import("./ImageStudio").then((m) => ({ default: m.ImageStudio })));
const ArticleComposer = lazy(() => import("./ArticleComposer").then((m) => ({ default: m.ArticleComposer })));
const EssayComposer = lazy(() => import("./EssayComposer").then((m) => ({ default: m.EssayComposer })));
const WorkComposer = lazy(() => import("./WorkComposer").then((m) => ({ default: m.WorkComposer })));
const TeacherComposer = lazy(() => import("./TeacherComposer").then((m) => ({ default: m.TeacherComposer })));
const MediaComposer = lazy(() => import("./MediaComposer").then((m) => ({ default: m.MediaComposer })));
const InfographicComposer = lazy(() => import("./InfographicComposer").then((m) => ({ default: m.InfographicComposer })));
const GameComposer = lazy(() => import("./GameComposer").then((m) => ({ default: m.GameComposer })));

const LOADING = <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;

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
    /*
     * O'yinlar va infografika (AUDIT-21 R0) — chip standartlari REYESTRDAN.
     *
     * Ularsiz forma HECH BIR chipni tanlanmagan holda ko'rsatar, dvigatel
     * esa o'z standartini (10 so'z, `klassik`, `list`…) jimgina qo'llardi:
     * foydalanuvchi «10 so'z» ni hech qayerda ko'rmay, shuni olardi.
     * Qiymatlar SATR — `ChipGroup` `String(values[name])` bilan solishtiradi.
     */
    wordCount: String(GAME_LIMITS.countDefault),
    crosswordType: gameDefaultTypeId("crossword"),
    cardCount: String(GAME_LIMITS.countDefault),
    cardType: gameDefaultTypeId("flashcards"),
    includeExample: "yoq",
    infographicType: infographicDefaultTypeId(),
    blockCount: String(INFOGRAPHIC_LIMITS.blocksDefault),
    palette: PALETTES[0].id,
    size: "A4",
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

  if (!sessionChecked) return LOADING;

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
  return <Suspense fallback={LOADING}>{toolForm(tool, profile, user)}</Suspense>;
}

/** Vosita → uning formasi (bo'lagi kerak bo'lganda yuklanadi). */
function toolForm(tool: ToolConfig, profile: UserProfile, user: ServerUser | null) {
  if (tool.custom === "slide") return <SlideForm tool={tool} profile={profile} />;
  if (tool.custom === "pro-slide") return <ProSlideForm tool={tool} profile={profile} />;
  if (tool.custom === "resume") return <ResumeComposer tool={tool} profile={profile} />;
  if (tool.custom === "translation") return <TranslationForm tool={tool} />;
  if (tool.custom === "image") return <ImageStudio tool={tool} />;
  if (tool.custom === "article") return <ArticleComposer tool={tool} profile={profile} user={user} />;
  // Insho 2 (AUDIT-19): kontekst × tur formasi — standart forma maydonlar
  // orasidagi bog'liqlikni (IELTS → faqat ingliz tili) chiza olmasdi.
  if (tool.custom === "essay") return <EssayComposer tool={tool} />;
  if (tool.custom === "work") return <WorkComposer tool={tool} profile={profile} user={user} />;
  // O'qituvchi vositalari 2 (AUDIT-20 WP-E): dars rejasi / texnologik
  // xarita / glossariy / keys / test bitta `TeacherComposer` ga o'tadi.
  if (tool.custom === "teacher") return <TeacherComposer tool={tool} profile={profile} user={user} />;
  // Formalar 3 (AUDIT-24 WP-D1/D2): o'yinlar, podkast/tabriknoma va
  // infografika o'z composerlariga o'tadi — standartlar reyestrdan,
  // `hint` tooltipda, ▸ Sozlamalar yopiq. StandardForm faqat zaxira.
  if (tool.custom === "game") return <GameComposer tool={tool} />;
  if (tool.custom === "media") return <MediaComposer tool={tool} />;
  if (tool.custom === "infographic") return <InfographicComposer tool={tool} />;

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
  const mainFields = tool.fields.filter((f) => !f.extra && !(hasOutline && f.name === "tocMethod") && fieldVisible(f, values));
  const extraFields = tool.fields.filter((f) => f.extra && !(hasOutline && f.name === "tocText") && fieldVisible(f, values));
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
