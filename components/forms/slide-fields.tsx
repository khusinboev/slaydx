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
  PRO_SLIDE_PER_SLIDE,
  QUIZ_COUNTS,
  SLIDE_BASE_PRICE,
  SLIDE_DEFAULT,
  SLIDE_EXTRA_PRICE,
  SLIDE_IMAGE_STYLES,
  SLIDE_INCLUDED,
  SLIDE_MAX,
  SLIDE_MIN,
  SLIDE_TEXT_VOLUMES,
  clampInt,
  joinCsv,
  splitCsv,
  type SlideTool,
} from "@/lib/generation/slide-params";
import { formatTanga } from "@/lib/tools";
import { MultiChipGroup, RangeField } from "./fields";
import { Row, Segmented, SelectField, Switch } from "./compact";
import { LogoField } from "./LogoField";

/**
 * Reyestr id → render xaritasi (WP-G, Formalar 2 da ixcham).
 *
 * Formalar maydonlarni FAQAT `slideParamsFor(tool)` ro'yxatidan chizadi.
 * `topic`, `language`, `slideTemplate`, `slideTheme` — bu yerda YO'Q:
 * ular `SlideComposer` kartalarida o'z komponentlari bilan chiziladi
 * (`tests/slide-form.test.mts` qamrov testi shu fayllarning manba
 * matnini ham qidiradi). Muallif maydonlari (`author`/`position`/
 * `organization`/`subject`/`logoAssetId`) ham shu xaritadan, lekin
 * kompozitor ularni «Muallif» kartasiga joylaydi.
 *
 * Har maydon BITTA `Row` (yorliq | boshqaruv), izoh `hint` tooltip'da.
 */
export type SlideFieldSetter = (name: string, v: string | number | boolean) => void;

/** Render konteksti — narx satri vositaga qarab (oddiy: formula, pro: har slayd). */
export type SlideFieldCtx = { tool: SlideTool };

export function decodeBlocks(raw: unknown): SlideBlockId[] {
  return splitCsv(raw, 12, 24).filter(isSlideBlockId);
}
export function encodeBlocks(ids: readonly SlideBlockId[]): string {
  return joinCsv(ids);
}

/** `slidePurpose` o'zgarganda `blocks` standartga qaytadi (sof — `tests/slide-form.test.mts`). */
export function resetBlocksForPurpose(purpose: string): string {
  return encodeBlocks(purposeDefaults(purpose).blocks);
}

/* ─────────────────────────── Yorliqlar (yig'iq sarlavha ham shulardan) ────── */

export const AUDIENCE_OPTIONS = [
  { value: "auto", label: "Avtomatik" },
  ...SLIDE_AUDIENCES.filter((a): a is Exclude<SlideAudience, "auto"> => a !== "auto").map((a) => ({
    value: a,
    label: AUDIENCE_RULES[a].label,
  })),
];
export const PURPOSE_OPTIONS = SLIDE_PURPOSES.map((p) => ({ value: p, label: PURPOSE_DEFAULTS[p].label }));
const BLOCK_OPTIONS = SLIDE_BLOCKS.map((b) => ({ value: b.id, label: b.label }));
// Segment yorliqlari QISQA — qator ichida sig'sin (yorliq «Reja bandlari» chapda turadi).
const PLAN_ITEMS_OPTIONS = [3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }));
export const TEXT_VOLUME_LABELS: Record<(typeof SLIDE_TEXT_VOLUMES)[number], string> = {
  qisqa: "Qisqa",
  standart: "Standart",
  kop: "Ko‘p",
};
const TEXT_VOLUME_OPTIONS = SLIDE_TEXT_VOLUMES.map((v) => ({ value: v, label: TEXT_VOLUME_LABELS[v] }));
const QUIZ_OPTIONS = QUIZ_COUNTS.map((n) => ({ value: String(n), label: n === 0 ? "Testsiz" : String(n) }));
export const IMAGE_STYLE_LABELS: Record<(typeof SLIDE_IMAGE_STYLES)[number], string> = {
  minimal: "Minimal",
  illustration: "Illyustratsiya",
  chalk: "Doska",
  photo: "Foto",
};
const IMAGE_STYLE_OPTIONS = SLIDE_IMAGE_STYLES.map((v) => ({ value: v, label: IMAGE_STYLE_LABELS[v] }));

/* ─────────────────────────── Maydonlar ─────────────────────────────────── */

function textRow(id: string, label: string, hint: string, placeholder: string, values: FormValues, set: SlideFieldSetter) {
  return (
    <Row key={id} label={label} hint={hint}>
      <input
        type="text"
        aria-label={label}
        value={String(values[id] ?? "")}
        placeholder={placeholder}
        onChange={(e) => set(id, e.target.value)}
        className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2"
      />
    </Row>
  );
}

function switchRow(id: string, label: string, hint: string, defaultTrue: boolean, values: FormValues, set: SlideFieldSetter) {
  const checked = defaultTrue ? values[id] !== false : values[id] === true;
  return (
    <Row key={id} label={label} hint={hint}>
      <Switch checked={checked} ariaLabel={label} onChange={(v) => set(id, v)} />
    </Row>
  );
}

/** Slaydlar soni — slayder + narx qoidasi (kompozitor «Slaydlar soni» kartasiga qo'yadi). */
function SlideCountField({ values, set, tool }: { values: FormValues; set: SlideFieldSetter; tool: SlideTool }) {
  const pro = tool === "pro-slide";
  const n = pro
    ? clampInt(values.slideCount, PRO_SLIDE_MIN, PRO_SLIDE_MAX, PRO_SLIDE_DEFAULT)
    : clampInt(values.slideCount, SLIDE_MIN, SLIDE_MAX, SLIDE_DEFAULT);
  return (
    <div data-slide-count>
      <RangeField value={n} min={pro ? PRO_SLIDE_MIN : SLIDE_MIN} max={pro ? PRO_SLIDE_MAX : SLIDE_MAX} onChange={(v) => set("slideCount", v)} />
      <p className="text-muted-foreground mt-1.5 text-[11.5px]" data-price-rule>
        {pro
          ? `Har slayd ${formatTanga(PRO_SLIDE_PER_SLIDE)} · 1 slayd ≈ 2 daqiqa`
          : `${SLIDE_INCLUDED} tagacha ${formatTanga(SLIDE_BASE_PRICE)} · keyingi har biri +${SLIDE_EXTRA_PRICE} · 1 slayd ≈ 2 daqiqa`}
      </p>
    </div>
  );
}

/**
 * Reyestr id → render.
 *
 * `default: return null` — `topic`/`language`/`slideTemplate`/
 * `slideTheme`/`templateAssetId` ataylab shu yerda ishlanmaydi (yuqoridagi
 * izohga qarang; oxirgisi — galereyaning «O'z shablonim» kartasi).
 */
export function renderSlideParam(
  id: string,
  values: FormValues,
  set: SlideFieldSetter,
  ctx: SlideFieldCtx = { tool: "slide" },
): React.ReactNode {
  switch (id) {
    case "author":
      return textRow("author", "Muallif", "Taqdimot pastki qatorida ko‘rinadigan ism.", "Aliyev Ali", values, set);
    case "position":
      return textRow("position", "Lavozim", "Titulda va pastki qatorda ko‘rinadi.", "Fizika o‘qituvchisi", values, set);
    case "organization":
      return textRow("organization", "Tashkilot", "Muassasa nomi — titulda va pastki qatorda.", "12-maktab", values, set);
    case "subject":
      return textRow("subject", "Fan", "Fan nomi promptga qo‘shiladi — aniqroq atama va misollar.", "Biologiya", values, set);
    case "logoAssetId":
      return (
        <Row key={id} label="Logotip" hint="Taqdimotning pastki burchagida ko‘rinadi — ixtiyoriy.">
          <LogoField compact value={String(values.logoAssetId ?? "")} onChange={(assetId) => set("logoAssetId", assetId)} />
        </Row>
      );
    case "slideAudience":
      return (
        <Row key={id} label="Auditoriya" hint="Shrift kattaligi va banddagi so‘z sonini belgilaydi. «Avtomatik» shablondan aniqlaydi.">
          <SelectField ariaLabel="Auditoriya" options={AUDIENCE_OPTIONS} value={String(values.slideAudience || "auto")} onChange={(v) => set("slideAudience", v)} />
        </Row>
      );
    case "slidePurpose":
      return (
        <Row key={id} label="Taqdimot turi" hint="Standart tuzilma bloklari va yozish uslubini belgilaydi.">
          <SelectField
            ariaLabel="Taqdimot turi"
            options={PURPOSE_OPTIONS}
            value={String(values.slidePurpose || "general")}
            onChange={(v) => {
              set("slidePurpose", v);
              set("blocks", resetBlocksForPurpose(v));
            }}
          />
        </Row>
      );
    case "blocks":
      return (
        <Row key={id} label="Tuzilma bloklari" hint="Taqdimot turi standart bloklarni beradi — bu yerda yoqasiz/o‘chirasiz." wide>
          <MultiChipGroup
            options={BLOCK_OPTIONS}
            value={decodeBlocks(values.blocks)}
            onChange={(next) => set("blocks", encodeBlocks(next.filter(isSlideBlockId)))}
          />
        </Row>
      );
    case "planItems":
      return (
        <Row key={id} label="Reja bandlari" hint="Reja slaydidagi va tuzilmadagi band soni.">
          <Segmented ariaLabel="Reja bandlari" options={PLAN_ITEMS_OPTIONS} value={String(values.planItems ?? PLAN_ITEMS_DEFAULT)} onChange={(v) => set("planItems", Number(v))} />
        </Row>
      );
    case "slideCount":
      return <SlideCountField key={id} values={values} set={set} tool={ctx.tool} />;
    case "textVolume":
      return (
        <Row key={id} label="Matn hajmi" hint="Band soni va uzunligini boshqaradi, shrift o‘lchami emas.">
          <Segmented ariaLabel="Matn hajmi" options={TEXT_VOLUME_OPTIONS} value={String(values.textVolume || "standart")} onChange={(v) => set("textVolume", v)} />
        </Row>
      );
    case "quizCount":
      return (
        <Row key={id} label="Nazorat testi" hint="Deka oxirida qo‘shiladigan test savollari soni.">
          <Segmented ariaLabel="Nazorat testi" options={QUIZ_OPTIONS} value={String(clampInt(values.quizCount, 0, 10, 0))} onChange={(v) => set("quizCount", Number(v))} />
        </Row>
      );
    case "slideImageStyle":
      return (
        <Row key={id} label="Rasm uslubi" hint="Slaydlardagi AI rasmlarning vizual uslubi.">
          <Segmented ariaLabel="Rasm uslubi" options={IMAGE_STYLE_OPTIONS} value={String(values.slideImageStyle || "photo")} onChange={(v) => set("slideImageStyle", v)} />
        </Row>
      );
    case "titleSlide":
      return switchRow("titleSlide", "Titul slaydi", "Birinchi slayd mavzu, muallif va logotip bilan.", true, values, set);
    case "agendaSlide":
      return switchRow("agendaSlide", "Reja slaydi", "Titul ortidan reja bandlari sanab o‘tiladi.", true, values, set);
    case "localExamples":
      return switchRow("localExamples", "Mahalliy misollar", "O‘zbekiston voqeligidan misol va kontekst qo‘shiladi.", false, values, set);
    case "internetSearch":
      return switchRow("internetSearch", "Internet qidiruvi", "Dalillar va raqamlar internetdan tekshiriladi.", false, values, set);
    case "speakerNotes":
      return switchRow("speakerNotes", "Notiq izohlari", "Har slaydga notiq uchun matn (PPTX «Speaker notes»).", true, values, set);
    case "keyIdeas":
      return (
        <Row key={id} label="Asosiy g‘oyalar" hint="Har biri yangi qatordan, 3 tagacha — promptga aynan shu fikrlar kiritiladi." wide>
          <textarea
            aria-label="Asosiy g‘oyalar"
            value={String(values.keyIdeas ?? "")}
            onChange={(e) => set("keyIdeas", e.target.value)}
            rows={2}
            placeholder={"Suv bug‘lanadi\nBulut hosil bo‘ladi"}
            className="border-input bg-card focus:ring-ring w-full resize-y rounded-lg border px-2.5 py-2 text-[13px] outline-none focus:ring-2"
          />
        </Row>
      );
    case "extra":
      return (
        <Row key={id} label="Qo‘shimcha" hint="Rejalar, uslub, auditoriya — erkin matn." wide>
          <textarea
            aria-label="Qo‘shimcha talablar"
            value={String(values.extra ?? "")}
            onChange={(e) => set("extra", e.target.value)}
            rows={2}
            placeholder="Rejalar, uslub, auditoriya..."
            className="border-input bg-card focus:ring-ring w-full resize-y rounded-lg border px-2.5 py-2 text-[13px] outline-none focus:ring-2"
          />
        </Row>
      );
    default:
      return null;
  }
}

/**
 * Yig'iq «Sozlamalar» sarlavhasi uchun joriy tanlovlar — foydalanuvchi
 * bo'limni ochmasdan nima tanlanganini ko'radi.
 */
export function settingsSummary(values: FormValues, ids: readonly string[]): string[] {
  const out: string[] = [];
  const has = (id: string) => ids.includes(id);
  if (has("slideAudience")) out.push(AUDIENCE_OPTIONS.find((o) => o.value === String(values.slideAudience || "auto"))?.label ?? "Avtomatik");
  if (has("slidePurpose")) out.push(PURPOSE_OPTIONS.find((o) => o.value === String(values.slidePurpose || "general"))?.label ?? "Umumiy");
  if (has("planItems")) out.push(`${clampInt(values.planItems, 3, 6, PLAN_ITEMS_DEFAULT)} band`);
  if (has("textVolume")) out.push(TEXT_VOLUME_LABELS[String(values.textVolume || "standart") as keyof typeof TEXT_VOLUME_LABELS] ?? "Standart");
  if (has("quizCount")) {
    const q = clampInt(values.quizCount, 0, 10, 0);
    out.push(q ? `${q} savol` : "Testsiz");
  }
  if (has("slideImageStyle")) out.push(IMAGE_STYLE_LABELS[String(values.slideImageStyle || "photo") as keyof typeof IMAGE_STYLE_LABELS] ?? "Foto");
  const flags: [string, string, boolean][] = [
    ["titleSlide", "Titul", true],
    ["agendaSlide", "Reja", true],
    ["speakerNotes", "Izohlar", true],
    ["localExamples", "Misollar", false],
    ["internetSearch", "Internet", false],
  ];
  for (const [id, label, def] of flags) {
    if (!has(id)) continue;
    const on = def ? values[id] !== false : values[id] === true;
    if (on) out.push(label);
  }
  return out;
}
