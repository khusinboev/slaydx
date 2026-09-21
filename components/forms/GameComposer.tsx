"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldOption, FormValues, ToolConfig } from "@/lib/types";
import { missingRequired, priceFor } from "@/lib/tools";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { TARGET_LANGUAGES } from "@/lib/languages";
/*
 * Import ATAYIN reyestr modullaridan, `games/index` barrelidan emas
 * (`EssayComposer` qoidasi): kerak bo'lgani — SOF ma'lumot (turlar,
 * chegaralar, normallashtirish). Dvigatel (`games/engine.ts`, LLM
 * rollari, baholovchi) mijoz bundle'iga tushmaydi.
 */
import { gameDefaultTypeId, gameKindOf, gameTypeOf, gameTypesOf, normalizeGameType } from "@/lib/generation/games/registry";
import {
  GAME_LIMITS,
  normalizeCategoryCount,
  normalizeGameCount,
  normalizeItemsPerCategory,
  normalizeListeningCount,
  type GameKind,
} from "@/lib/generation/games/types";
import { LISTENING_FALLBACK_NATIVE, LISTENING_FALLBACK_TARGET } from "@/lib/generation/games/listening/input";
import { Card, Row, Segmented, SelectField, Switch } from "./compact";
import { ClearFormButton, Field, LimitedTextarea, SettingsDetails, SourceFileRow, TopicRow } from "./shared";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * O'YINLAR FORMASI (Formalar 3 / AUDIT-24 WP-D1) — krossvord, flesh
 * kartalar, saralash, tinglash BITTA composerda.
 *
 * Nega bitta: to'rtala vosita AYNAN bitta shaklga ega — mavzu → o'yin
 * turi → hajm → til(lar) → ▸ Sozlamalar. Farqlar (qaysi maydon, qanday
 * chegara, qanday standart) REYESTRDA yozilgan (`games/registry.ts`),
 * ya'ni ular bu yerda qayta yozilmaydi: forma reyestrdan O'QIYDI.
 * To'rt alohida composer yozilsa, yangi o'yin turi qo'shilganda bittasi
 * jimgina eskirib qolardi (`teacherTypesOf` saboqi).
 *
 * ── Nega `StandardForm` dan chiqildi (`forms3-oyinlar-media.md` §2)
 *
 *   • Standart chip YOQILMAGAN edi (saralash/tinglash): `defaultsFor`
 *     faqat krossvord/kartalar uchun `gameDefaultTypeId` ni chaqirardi
 *     — foydalanuvchi hech narsa tanlanmagan formani ko'rar, server esa
 *     jimgina birinchi turni qo'yardi. Bu yerda HAR standart reyestrdan
 *     keladi (`*Default`, `gameDefaultTypeId`).
 *   • `field.hint` va chip `option.hint` (har turning bir qatorli
 *     tavsifi) HECH QAYERDA chizilmasdi — endi `Row` tooltipida (ⓘ).
 *   • `fieldset + Legend` uslubi AUDIT-12 dan oldingi davrga tegishli
 *     edi: etalon — `Card`/`Row`/`Segmented` va yopiq ▸ Sozlamalar.
 *
 * ── Shartnomalar (o'zgarmaydi)
 *
 *   • `FormValues` KALITLARI dvigatelniki: `crosswordType`, `wordCount`,
 *     `cardType`, `cardCount`, `includeExample`, `sortingType`,
 *     `categoryCount`, `itemsPerCategory`, `listeningType`, `itemCount`,
 *     `nativeLanguage`/`targetLanguage`, `language`, `mode`,
 *     `sourceText`, `topic`, `extra` (reyestr — `game-params.ts`).
 *     Sonlar SATR sifatida yuboriladi (eski forma ham shunday yuborardi;
 *     dvigatel `normalize*` bilan `Number()` qiladi).
 *   • Har reyestr `id` formada AYNAN BITTA `data-field` bilan
 *     (`Field`) — qamrov testi ikki yo'nalishda tekshiradi.
 *   • NARX — faqat `priceFor` (tekis 2 000, egasi qarori 6). Formada
 *     hech qanday hisob yo'q: kelajakdagi admin panel narxni bazadan
 *     boshqaradi, forma esa faqat natijani ko'rsatadi.
 */

/* ────────────────────────── yorliqlar ────────────────────────── */

/** Hujjat tillari — `LanguagePicker` bilan BITTA ro'yxat (`TARGET_LANGUAGES`). */
const LANGUAGE_OPTIONS: FieldOption[] = TARGET_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));

/** Reyestr turlari → tanlov variantlari (yorliq va izoh reyestrdan). */
function typeOptions(kind: GameKind): FieldOption[] {
  return gameTypesOf(kind).map((t) => ({ value: t.id, label: t.label.uz, hint: t.hint }));
}

const numberOptions = (values: readonly number[], suffix: string): FieldOption[] =>
  values.map((n) => ({ value: String(n), label: `${n} ${suffix}` }));

/** Kind → tur maydonining nomi (`FormValues` kaliti, reyestr id si). */
const TYPE_FIELD: Record<GameKind, string> = {
  crossword: "crosswordType",
  flashcards: "cardType",
  sorting: "sortingType",
  listening: "listeningType",
};

const TYPE_LABEL: Record<GameKind, string> = {
  crossword: "Savol turi",
  flashcards: "Karta turi",
  sorting: "O'yin turi",
  listening: "Topshiriq turi",
};

/* ────────────────────────── standartlar (REYESTRDAN) ────────────────────────── */

/**
 * Boshlang'ich qiymatlar — HAMMASI reyestrdan (`gameDefaultTypeId` +
 * turning `limits.*Default` lari).
 *
 * Qo'lda yozilgan raqam bu yerda BO'LMASIN: reyestr standarti
 * o'zgarganda forma jimgina eskirardi, va aynan shu nomuvofiqlik
 * `forms3-oyinlar-media.md` da ⚠ topilma bo'lib qayd etilgan.
 */
function defaultValuesFor(kind: GameKind): FormValues {
  const base: FormValues = { topic: "", extra: "" };
  if (kind === "crossword") {
    const spec = gameTypeOf("crossword", gameDefaultTypeId("crossword"));
    return {
      ...base,
      // Fayl rejimi FAQAT krossvordda (`tool.modes`); standart — mavzu.
      mode: "topic",
      fileName: "",
      sourceText: "",
      language: "uz",
      crosswordType: spec.id,
      wordCount: String(spec.limits.wordsDefault),
    };
  }
  if (kind === "flashcards") {
    const spec = gameTypeOf("flashcards", gameDefaultTypeId("flashcards"));
    return {
      ...base,
      language: "uz",
      cardType: spec.id,
      cardCount: String(spec.limits.cardsDefault),
      // Dvigatel `ha|true|1|yes` ni rost deb o'qiydi (`games/input.ts`).
      includeExample: spec.limits.includeExampleDefault ? "ha" : "yoq",
    };
  }
  if (kind === "sorting") {
    const spec = gameTypeOf("sorting", gameDefaultTypeId("sorting"));
    return {
      ...base,
      language: "uz",
      sortingType: spec.id,
      categoryCount: String(spec.limits.categoriesDefault),
      itemsPerCategory: String(spec.limits.itemsPerCategoryDefault),
    };
  }
  const spec = gameTypeOf("listening", gameDefaultTypeId("listening"));
  return {
    ...base,
    listeningType: spec.id,
    itemCount: String(spec.limits.itemsDefault),
    /*
     * Tinglashda «Til» O'RNIGA juftlik: variantlar ona tilida, audio
     * esa o'rganiladigan tilda. Standartlar dvigatelning O'Z zaxira
     * qiymatlaridan (`listening/input.ts`) — ikkalasi teng kelsa mashq
     * ma'nosini yo'qotardi («library» → «library»).
     */
    nativeLanguage: LISTENING_FALLBACK_NATIVE,
    targetLanguage: LISTENING_FALLBACK_TARGET,
  };
}

/**
 * Qoralamadan tiklash: FAQAT shu vositaning kalitlari olinadi va
 * hammasi dvigatelning O'Z normallashtiruvchilaridan o'tadi.
 *
 * Aks holda eski/noma'lum qiymat (masalan olib tashlangan tur yoki
 * 7 ta toifa) formada «tanlanmagan» chip guruhi bo'lib ko'rinardi —
 * ya'ni standart yo'qligi muammosi qoralama orqali qaytib kelardi.
 */
function restoreDraft(kind: GameKind, draft: FormValues, base: FormValues): FormValues {
  const next: FormValues = { ...base };
  for (const key of Object.keys(base)) {
    const v = draft[key];
    if (v !== undefined && v !== null) next[key] = v;
  }
  const typeField = TYPE_FIELD[kind];
  next[typeField] = normalizeGameType(kind, next[typeField]);
  if (kind === "crossword") {
    next.mode = String(next.mode) === "file" ? "file" : "topic";
    next.wordCount = String(normalizeGameCount(next.wordCount));
  }
  if (kind === "flashcards") {
    next.cardCount = String(normalizeGameCount(next.cardCount));
    next.includeExample = String(next.includeExample) === "ha" ? "ha" : "yoq";
  }
  if (kind === "sorting") {
    next.categoryCount = String(normalizeCategoryCount(next.categoryCount));
    next.itemsPerCategory = String(normalizeItemsPerCategory(next.itemsPerCategory));
  }
  if (kind === "listening") {
    next.itemCount = String(normalizeListeningCount(next.itemCount));
    for (const key of ["nativeLanguage", "targetLanguage"] as const) {
      if (!LANGUAGE_OPTIONS.some((o) => o.value === String(next[key]))) next[key] = String(base[key]);
    }
  } else if (!LANGUAGE_OPTIONS.some((o) => o.value === String(next.language))) {
    next.language = "uz";
  }
  return next;
}

/* ────────────────────────── tanlov qatori ────────────────────────── */

/**
 * Bitta tanlov qatori — variant soniga qarab `Segmented` yoki
 * `SelectField` (etalon checklist 4-bandi: 3–6 → segment, ≥7 → select).
 *
 * Qoida shu yerda BITTA joyda yozilgan: reyestrga beshinchi krossvord
 * turi yoki yangi hajm chipi qo'shilsa, forma o'zi to'g'ri boshqaruvga
 * o'tadi va hech kim uni qo'lda ko'chirishni unutmaydi.
 */
const SEGMENTED_MAX = 6;

/*
 * MUHIM: `ChoiceRow` ga beriladigan qiymat FAQAT holatdan o'qiladi —
 * `values.x ?? standart` shaklidagi zaxira ATAYIN yo'q. Aks holda
 * standart IKKI joyda bo'lardi (`defaultValuesFor` va chizish joyi) va
 * biri yo'qolganda ekran «tanlangan» ko'rinib turib, yuborilgan tanada
 * maydon UMUMAN bo'lmasdi — ya'ni foydalanuvchi ko'rgan qiymat bilan
 * dvigatel olgan qiymat ayrilardi (mutatsiya testi aynan shuni ushladi).
 */
function ChoiceRow({
  id,
  label,
  hint,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  options: FieldOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label} hint={hint} wide={options.length > SEGMENTED_MAX}>
      <Field id={id}>
        {options.length > SEGMENTED_MAX ? (
          <SelectField ariaLabel={label} options={options} value={value} onChange={onChange} />
        ) : (
          <Segmented ariaLabel={label} options={options} value={value} onChange={onChange} />
        )}
      </Field>
    </Row>
  );
}

/* ────────────────────────── forma ────────────────────────── */

export function GameComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const kind = gameKindOf(tool.id) as GameKind;
  const [values, setValues] = useState<FormValues>(() => defaultValuesFor(kind));
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  // Qoralama BIR marta qo'llanadi — yozilayotgan matn ustiga yozilmasin.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setValues((s) => restoreDraft(kind, draft, s));
  }, [ready, draft, restored, kind]);

  useEffect(() => {
    if (!restored) return;
    save(values);
  }, [values, restored, save]);

  const set = (name: string, v: string | number | boolean) => setValues((s) => ({ ...s, [name]: v }));

  const typeField = TYPE_FIELD[kind];
  const typeId = String(values[typeField] ?? "");
  const price = priceFor(tool, values);
  const fileMode = Boolean(tool.modes) && String(values.mode) === "file";

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setValues(defaultValuesFor(kind));
  });

  async function submit() {
    setError(null);
    if (reading) {
      setError("Fayl hali o‘qilmoqda");
      return;
    }
    // Qoida BITTA manbadan (`lib/tools.ts`) — server ham shuni tekshiradi.
    const missing = missingRequired(tool, values);
    if (missing.length) {
      setError(fileMode && missing[0] === "Manba fayl matni" ? "Avval fayl tanlang — matn olingandan keyin yaratish boshlanadi." : `${missing[0]} to‘ldirilishi kerak`);
      return;
    }
    setLoading(true);
    flush();
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
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card
        title="Mavzu"
        aside={
          tool.modes ? (
            <Field id="mode" className="inline-block">
              <Segmented
                ariaLabel="Rejim"
                options={tool.modes.map((m) => ({ value: m.id, label: m.title }))}
                value={String(values.mode ?? "topic")}
                onChange={(v) => set("mode", v)}
              />
            </Field>
          ) : null
        }
      >
        {/*
         * Ikkala kirish ham CHIZILADI, faolsizi `hidden` bilan
         * yashiriladi (`TeacherComposer` naqshi): shunda `data-field`
         * qamrovi rejimga bog'liq bo'lmaydi va fayl tanlangach mavzuga
         * qaytish yozilganni yo'qotmaydi.
         */}
        <div className={fileMode ? "hidden" : undefined}>
          <TopicRow
            label="Mavzu"
            hint={tool.topicLegend}
            value={String(values.topic ?? "")}
            onChange={(v) => set("topic", v)}
            placeholder={tool.topicPlaceholder}
            limit={GAME_LIMITS.topicChars}
          />
        </div>
        {tool.modes ? (
          <div className={fileMode ? undefined : "hidden"}>
            <SourceFileRow
              label="Fayl"
              value={{ fileName: String(values.fileName ?? ""), sourceText: String(values.sourceText ?? "") }}
              onBusyChange={setReading}
              onChange={({ fileName, sourceText }) =>
                setValues((s) => ({
                  ...s,
                  fileName,
                  sourceText,
                  // Mavzu bo'sh bo'lsa fayl nomi mavzu bo'ladi (StandardForm xulqi).
                  topic: String(s.topic || "").trim() || fileName.replace(/\.[^.]+$/, ""),
                }))
              }
            />
          </div>
        ) : null}
      </Card>

      <Card title="O‘yin">
        <ChoiceRow
          id={typeField}
          label={TYPE_LABEL[kind]}
          hint={gameTypeOf(kind, typeId).hint}
          options={typeOptions(kind)}
          value={typeId}
          onChange={(v) => set(typeField, v)}
        />
        <SizeRows kind={kind} values={values} set={set} />
        {kind === "listening" ? (
          <>
            <ChoiceRow
              id="nativeLanguage"
              label="Ona tili"
              hint="Variantlar va varaq matni shu tilda yoziladi"
              options={LANGUAGE_OPTIONS}
              value={String(values.nativeLanguage ?? "")}
              onChange={(v) => set("nativeLanguage", v)}
            />
            <ChoiceRow
              id="targetLanguage"
              label="O‘rganiladigan til"
              hint="Audio shu tilda eshitiladi — ovoz til jadvalidan tanlanadi"
              options={LANGUAGE_OPTIONS}
              value={String(values.targetLanguage ?? "")}
              onChange={(v) => set("targetLanguage", v)}
            />
          </>
        ) : (
          <ChoiceRow
            id="language"
            label="Til"
            hint="Hujjat tili — savollar, javoblar va sarlavhalar shu tilda"
            options={LANGUAGE_OPTIONS}
            value={String(values.language ?? "")}
            onChange={(v) => set("language", v)}
          />
        )}
      </Card>

      <SettingsDetails summary={settingsSummary(kind, values)}>
        {kind === "flashcards" ? (
          <Row label="Misol" hint="Orqa yuzga atamani ishlatgan bitta jumla qo‘shiladi">
            <Field id="includeExample">
              <Switch
                ariaLabel="Misol qo‘shilsinmi?"
                checked={String(values.includeExample) === "ha"}
                onChange={(on) => set("includeExample", on ? "ha" : "yoq")}
              />
            </Field>
          </Row>
        ) : null}
        <Row label="Qo‘shimcha" hint="Modelga alohida talab (masalan, faqat darslik atamalari)" wide>
          <Field id="extra">
            <LimitedTextarea
              ariaLabel="Qo‘shimcha talablar"
              value={String(values.extra ?? "")}
              onChange={(v) => set("extra", v)}
              limit={GAME_LIMITS.extraChars}
              placeholder="Ixtiyoriy"
            />
          </Field>
        </Row>
        <div className="mt-2">
          <ClearFormButton armed={clearConfirm.armed} onClick={clearConfirm.trigger} />
        </div>
      </SettingsDetails>
    </ToolChrome>
  );
}

/* ────────────────────────── hajm qatorlari ────────────────────────── */

/**
 * Hajm — kind bo'yicha, chiplar va standart TURNING chegaralaridan.
 *
 * Saralashdagi `categoryCount` «qarama-qarshi juftlik» turida
 * CHIZILMAYDI: reyestr u yerda toifa sonini 2 ga qulflaydi
 * (`limits.categories` bitta qiymatli), ya'ni tanlov inert bo'lardi —
 * bu `lib/tools.ts` dagi `hideWhen` qoidasining AYNAN o'zi, faqat
 * yagona manbadan (reyestrdan) hisoblanadi.
 */
function SizeRows({ kind, values, set }: { kind: GameKind; values: FormValues; set: (name: string, v: string) => void }) {
  if (kind === "crossword") {
    const spec = gameTypeOf("crossword", values.crosswordType);
    return (
      <ChoiceRow
        id="wordCount"
        label="So‘zlar"
        hint="To‘rga sig‘magan so‘z tashlanadi va hisobotda ko‘rsatiladi"
        options={numberOptions(spec.limits.words, "so‘z")}
        value={String(values.wordCount ?? "")}
        onChange={(v) => set("wordCount", v)}
      />
    );
  }
  if (kind === "flashcards") {
    const spec = gameTypeOf("flashcards", values.cardType);
    return (
      <ChoiceRow
        id="cardCount"
        label="Kartalar"
        hint={`Bir A4 varaqqa ${GAME_LIMITS.cardCols * GAME_LIMITS.cardRows} ta A7 karta joylashadi`}
        options={numberOptions(spec.limits.cards, "karta")}
        value={String(values.cardCount ?? "")}
        onChange={(v) => set("cardCount", v)}
      />
    );
  }
  if (kind === "sorting") {
    const spec = gameTypeOf("sorting", values.sortingType);
    const lockedCategories = spec.limits.categories.length === 1;
    return (
      <>
        {lockedCategories ? null : (
          <ChoiceRow
            id="categoryCount"
            label="Toifalar"
            hint="Nechta guruhga ajratiladi"
            options={numberOptions(spec.limits.categories, "toifa")}
            value={String(values.categoryCount ?? "")}
            onChange={(v) => set("categoryCount", v)}
          />
        )}
        <ChoiceRow
          id="itemsPerCategory"
          label="Har toifada"
          hint="Har guruhga tushadigan element soni"
          options={numberOptions(spec.limits.itemsPerCategory, "element")}
          value={String(values.itemsPerCategory ?? "")}
          onChange={(v) => set("itemsPerCategory", v)}
        />
      </>
    );
  }
  const spec = gameTypeOf("listening", values.listeningType);
  return (
    <ChoiceRow
      id="itemCount"
      label="Topshiriqlar"
      hint="Har topshiriq alohida audio bo‘lagi"
      options={numberOptions(spec.limits.items, "ta")}
      value={String(values.itemCount ?? "")}
      onChange={(v) => set("itemCount", v)}
    />
  );
}

/* ────────────────────────── xulosa chiplari ────────────────────────── */

/**
 * Yopiq «Sozlamalar» sarlavhasidagi chiplar: tur · soni · til.
 *
 * Matn REYESTR yorlig'idan (etalon checklist 24-bandi) — qo'lda
 * yozilgan ikkinchi nusxa reyestr o'zgarganda ajralib ketardi.
 */
export function settingsSummary(kind: GameKind, values: FormValues): string[] {
  const language = (code: unknown) => LANGUAGE_OPTIONS.find((o) => o.value === String(code))?.label ?? String(code);
  const type = gameTypeOf(kind, values[TYPE_FIELD[kind]]).label.uz;
  if (kind === "crossword") return [type, `${normalizeGameCount(values.wordCount)} so‘z`, language(values.language ?? "uz")];
  if (kind === "flashcards") {
    return [
      type,
      `${normalizeGameCount(values.cardCount)} karta`,
      language(values.language ?? "uz"),
      String(values.includeExample) === "ha" ? "misolli" : "",
    ].filter(Boolean);
  }
  if (kind === "sorting") {
    const spec = gameTypeOf("sorting", values.sortingType);
    const categories = spec.limits.categories.length === 1 ? spec.limits.categoriesDefault : normalizeCategoryCount(values.categoryCount);
    return [type, `${categories} × ${normalizeItemsPerCategory(values.itemsPerCategory)}`, language(values.language ?? "uz")];
  }
  return [
    type,
    `${normalizeListeningCount(values.itemCount)} ta`,
    `${language(values.nativeLanguage ?? LISTENING_FALLBACK_NATIVE)} → ${language(values.targetLanguage ?? LISTENING_FALLBACK_TARGET)}`,
  ];
}
