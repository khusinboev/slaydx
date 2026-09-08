"use client";

import type { FormValues } from "@/lib/types";
import {
  AUDIENCE_RULES,
  SLIDE_AUDIENCES,
  type SlideAudience,
} from "@/lib/generation/slide-audience";
import { PURPOSE_DEFAULTS, SLIDE_PURPOSES, purposeDefaults } from "@/lib/generation/slide-purpose";
import { SLIDE_BLOCKS, isSlideBlockId, type SlideBlockId } from "@/lib/generation/slide-blocks";
import {
  PLAN_ITEMS_DEFAULT,
  PRO_SLIDE_DEFAULT,
  PRO_SLIDE_MAX,
  PRO_SLIDE_MIN,
  QUIZ_COUNTS,
  SLIDE_IMAGE_STYLES,
  SLIDE_TEXT_VOLUMES,
  clampInt,
  joinCsv,
  splitCsv,
} from "@/lib/generation/slide-params";
import { ChipGroup, Legend, MultiChipGroup, RangeField, TextArea, TextInput, Toggle } from "./fields";
import { LogoField } from "./LogoField";

/**
 * Reyestr id → render xaritasi (WP-G).
 *
 * Formalar maydonlarni FAQAT `slideParamsFor(tool)` ro'yxatidan chizadi.
 * `topic`, `language`, `slideTemplate`, `slideTheme`, `quality` — bu
 * yerda YO'Q: ular mavjud komponentlar bilan (`TemplatePicker`,
 * `ColorPicker`, `LanguagePicker`, `QUALITY` chip guruhi) formalarning
 * o'z faylida chiziladi (`tests/slide-form.test.mts` qamrov testi shu
 * fayllarning manba matnini ham qidiradi).
 */
export type SlideFieldSetter = (name: string, v: string | number | boolean) => void;

/**
 * `blocks` maydonining FormValues kodlashi — yagona joy, forma ham
 * mutatsiya testi ham shu funksiyalarni chaqiradi.
 */
export function decodeBlocks(raw: unknown): SlideBlockId[] {
  return splitCsv(raw, 12, 24).filter(isSlideBlockId);
}
export function encodeBlocks(ids: readonly SlideBlockId[]): string {
  return joinCsv(ids);
}

/**
 * `slidePurpose` o'zgarganda `blocks` standartga qaytadi.
 *
 * Sof funksiya — React holatidan ajratilgan, shuning uchun to'g'ridan-
 * to'g'ri sinaladi (`tests/slide-form.test.mts`).
 */
export function resetBlocksForPurpose(purpose: string): string {
  return encodeBlocks(purposeDefaults(purpose).blocks);
}

/* ─────────────────────────── Kichik komponentlar ────────────────────── */

function TextFieldRow({
  id,
  label,
  placeholder,
  hint,
  values,
  set,
}: {
  id: string;
  label: string;
  placeholder?: string;
  hint: string;
  values: FormValues;
  set: SlideFieldSetter;
}) {
  return (
    <fieldset className="mb-6">
      <Legend>{label}</Legend>
      <p className="text-muted-foreground mb-3 text-sm">{hint}</p>
      <TextInput value={String(values[id] ?? "")} placeholder={placeholder} onChange={(v) => set(id, v)} />
    </fieldset>
  );
}

function ToggleField({
  id,
  label,
  hint,
  defaultTrue,
  values,
  set,
}: {
  id: string;
  label: string;
  hint: string;
  defaultTrue?: boolean;
  values: FormValues;
  set: SlideFieldSetter;
}) {
  const checked = defaultTrue ? values[id] !== false : values[id] === true;
  return (
    <fieldset className="mb-6">
      <Legend>{label}</Legend>
      <p className="text-muted-foreground mb-3 text-sm">{hint}</p>
      <Toggle checked={checked} onChange={(v) => set(id, v)} />
    </fieldset>
  );
}

const AUDIENCE_OPTIONS = [
  { value: "auto", label: "Avtomatik" },
  ...SLIDE_AUDIENCES.filter((a): a is Exclude<SlideAudience, "auto"> => a !== "auto").map((a) => ({
    value: a,
    label: AUDIENCE_RULES[a].label,
  })),
];

function AudienceField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Auditoriya</Legend>
      <p className="text-muted-foreground mb-3 text-sm">
        Auditoriya shrift kattaligi va banddagi so‘z sonini belgilaydi. «Avtomatik» shablondan aniqlaydi.
      </p>
      <ChipGroup
        options={AUDIENCE_OPTIONS}
        value={String(values.slideAudience || "auto")}
        onChange={(v) => set("slideAudience", v)}
      />
    </fieldset>
  );
}

const PURPOSE_OPTIONS = SLIDE_PURPOSES.map((p) => ({ value: p, label: PURPOSE_DEFAULTS[p].label }));

function PurposeField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Taqdimot turi</Legend>
      <p className="text-muted-foreground mb-3 text-sm">
        Tur standart tuzilma bloklarini va yozish uslubini belgilaydi — bloklarni pastda o‘zgartirishingiz mumkin.
      </p>
      <ChipGroup
        options={PURPOSE_OPTIONS}
        value={String(values.slidePurpose || "general")}
        onChange={(v) => {
          set("slidePurpose", v);
          set("blocks", resetBlocksForPurpose(v));
        }}
      />
    </fieldset>
  );
}

const BLOCK_OPTIONS = SLIDE_BLOCKS.map((b) => ({ value: b.id, label: b.label }));

function BlocksField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  const selected = decodeBlocks(values.blocks);
  return (
    <fieldset className="mb-6">
      <Legend>Tuzilma bloklari</Legend>
      <p className="text-muted-foreground mb-3 text-sm">
        Taqdimot turi standart bloklarni beradi — bu yerda yoqasiz/o‘chirasiz.
      </p>
      <MultiChipGroup
        options={BLOCK_OPTIONS}
        value={selected}
        onChange={(next) => set("blocks", encodeBlocks(next.filter(isSlideBlockId)))}
      />
    </fieldset>
  );
}

const PLAN_ITEMS_OPTIONS = [3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} band` }));

function PlanItemsField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Reja bandlari</Legend>
      <p className="text-muted-foreground mb-3 text-sm">Reja slaydidagi va tuzilmadagi band soni.</p>
      <ChipGroup
        options={PLAN_ITEMS_OPTIONS}
        value={String(values.planItems ?? PLAN_ITEMS_DEFAULT)}
        onChange={(v) => set("planItems", Number(v))}
      />
    </fieldset>
  );
}

function SlideCountField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  const n = clampInt(values.slideCount, PRO_SLIDE_MIN, PRO_SLIDE_MAX, PRO_SLIDE_DEFAULT);
  return (
    <fieldset className="mb-6">
      <Legend>Slaydlar soni</Legend>
      <RangeField value={n} min={PRO_SLIDE_MIN} max={PRO_SLIDE_MAX} onChange={(v) => set("slideCount", v)} />
      <p className="text-muted-foreground mt-2 text-xs">1 slayd ≈ 2 daqiqa taqdimot vaqti.</p>
    </fieldset>
  );
}

const TEXT_VOLUME_LABELS: Record<(typeof SLIDE_TEXT_VOLUMES)[number], string> = {
  qisqa: "Qisqa",
  standart: "Standart",
  kop: "Ko‘p matnli",
};
const TEXT_VOLUME_OPTIONS = SLIDE_TEXT_VOLUMES.map((v) => ({ value: v, label: TEXT_VOLUME_LABELS[v] }));

function TextVolumeField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Matn hajmi</Legend>
      <p className="text-muted-foreground mb-3 text-sm">Band soni va uzunligini boshqaradi, shrift o‘lchami emas.</p>
      <ChipGroup
        options={TEXT_VOLUME_OPTIONS}
        value={String(values.textVolume || "standart")}
        onChange={(v) => set("textVolume", v)}
      />
    </fieldset>
  );
}

const QUIZ_OPTIONS = QUIZ_COUNTS.map((n) => ({ value: String(n), label: n === 0 ? "Testsiz" : String(n) }));

function QuizCountField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Nazorat testi</Legend>
      <p className="text-muted-foreground mb-3 text-sm">Deka oxirida qo‘shiladigan test savollari soni.</p>
      <ChipGroup
        options={QUIZ_OPTIONS}
        value={String(clampInt(values.quizCount, 0, 10, 0))}
        onChange={(v) => set("quizCount", Number(v))}
      />
    </fieldset>
  );
}

const IMAGE_STYLE_LABELS: Record<(typeof SLIDE_IMAGE_STYLES)[number], string> = {
  minimal: "Minimal",
  illustration: "Illyustratsiya",
  chalk: "Doska",
  photo: "Foto-realistik",
};
const IMAGE_STYLE_OPTIONS = SLIDE_IMAGE_STYLES.map((v) => ({ value: v, label: IMAGE_STYLE_LABELS[v] }));

function ImageStyleField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Rasm uslubi</Legend>
      <p className="text-muted-foreground mb-3 text-sm">Slaydlardagi AI rasmlarning vizual uslubi.</p>
      <ChipGroup
        options={IMAGE_STYLE_OPTIONS}
        value={String(values.slideImageStyle || "photo")}
        onChange={(v) => set("slideImageStyle", v)}
      />
    </fieldset>
  );
}

function KeyIdeasField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
    <fieldset className="mb-6">
      <Legend>Asosiy g‘oyalar</Legend>
      <p className="text-muted-foreground mb-3 text-sm">Har biri yangi qatordan, 3 tagacha — promptga aynan shu fikrlar kiritiladi.</p>
      <TextArea
        value={String(values.keyIdeas ?? "")}
        placeholder={"Suv bug‘lanadi\nBulut hosil bo‘ladi"}
        onChange={(v) => set("keyIdeas", v)}
      />
    </fieldset>
  );
}

function ExtraField({ values, set }: { values: FormValues; set: SlideFieldSetter }) {
  return (
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
  );
}

/**
 * Reyestr id → render.
 *
 * `default: return null` — `topic`/`language`/`slideTemplate`/
 * `slideTheme`/`quality` ataylab shu yerda ishlanmaydi (yuqoridagi
 * izohga qarang); chaqiruvchi forma ularni o'zi chizadi.
 */
export function renderSlideParam(id: string, values: FormValues, set: SlideFieldSetter): React.ReactNode {
  switch (id) {
    case "author":
      return (
        <TextFieldRow
          key={id}
          id="author"
          label="Muallif"
          placeholder="Aliyev Ali"
          hint="Taqdimot pastki qatorida ko‘rinadigan ism."
          values={values}
          set={set}
        />
      );
    case "position":
      return (
        <TextFieldRow
          key={id}
          id="position"
          label="Lavozim"
          placeholder="Fizika o‘qituvchisi"
          hint="Muallif lavozimi — titulda va pastki qatorda ko‘rinadi."
          values={values}
          set={set}
        />
      );
    case "organization":
      return (
        <TextFieldRow
          key={id}
          id="organization"
          label="Tashkilot"
          placeholder="12-maktab"
          hint="Muassasa nomi — titulda va pastki qatorda ko‘rinadi."
          values={values}
          set={set}
        />
      );
    case "subject":
      return (
        <TextFieldRow
          key={id}
          id="subject"
          label="Fan"
          placeholder="Biologiya"
          hint="Fan nomi promptga qo‘shiladi — aniqroq atama va misollar uchun."
          values={values}
          set={set}
        />
      );
    case "logoAssetId":
      return (
        <LogoField key={id} value={String(values.logoAssetId ?? "")} onChange={(assetId) => set("logoAssetId", assetId)} />
      );
    case "slideAudience":
      return <AudienceField key={id} values={values} set={set} />;
    case "slidePurpose":
      return <PurposeField key={id} values={values} set={set} />;
    case "blocks":
      return <BlocksField key={id} values={values} set={set} />;
    case "planItems":
      return <PlanItemsField key={id} values={values} set={set} />;
    case "slideCount":
      return <SlideCountField key={id} values={values} set={set} />;
    case "textVolume":
      return <TextVolumeField key={id} values={values} set={set} />;
    case "quizCount":
      return <QuizCountField key={id} values={values} set={set} />;
    case "slideImageStyle":
      return <ImageStyleField key={id} values={values} set={set} />;
    case "titleSlide":
      return (
        <ToggleField
          key={id}
          id="titleSlide"
          label="Titul slaydi"
          hint="Yoqilsa — birinchi slayd mavzu, muallif va logotip bilan chiqadi."
          defaultTrue
          values={values}
          set={set}
        />
      );
    case "agendaSlide":
      return (
        <ToggleField
          key={id}
          id="agendaSlide"
          label="Reja slaydi"
          hint="Yoqilsa — titul ortidan reja bandlari sanab o‘tiladi."
          defaultTrue
          values={values}
          set={set}
        />
      );
    case "localExamples":
      return (
        <ToggleField
          key={id}
          id="localExamples"
          label="Mahalliy misollar"
          hint="Yoqilsa — O‘zbekiston voqeligidan misol va kontekst qo‘shiladi."
          values={values}
          set={set}
        />
      );
    case "internetSearch":
      return (
        <ToggleField
          key={id}
          id="internetSearch"
          label="Internet qidiruvi"
          hint="Yoqilsa — dalillar va raqamlar internetdan tekshiriladi."
          values={values}
          set={set}
        />
      );
    case "speakerNotes":
      return (
        <ToggleField
          key={id}
          id="speakerNotes"
          label="Notiq izohlari"
          hint="Yoqilsa — har slaydga notiq uchun matn qo‘shiladi (PPTX «Speaker notes»)."
          defaultTrue
          values={values}
          set={set}
        />
      );
    case "keyIdeas":
      return <KeyIdeasField key={id} values={values} set={set} />;
    case "extra":
      return <ExtraField key={id} values={values} set={set} />;
    default:
      return null;
  }
}
