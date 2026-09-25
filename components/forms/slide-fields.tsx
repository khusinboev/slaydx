"use client";

import type { FormValues } from "@/lib/types";
import {
  AUDIENCE_RULES,
  SLIDE_AUDIENCES,
  type SlideAudience,
} from "@/lib/generation/slide-audience";
import { PURPOSE_DEFAULTS, SLIDE_PURPOSES, purposeDefaults } from "@/lib/generation/slide-purpose";
import { SLIDE_BLOCKS, isSlideBlockId, QUIZ_COUNT_FALLBACK, type SlideBlockId } from "@/lib/generation/slide-blocks";
import {
  PLAN_ITEMS_MAX,
  PLAN_ITEMS_MIN,
  PRO_SLIDE_MAX,
  PRO_SLIDE_MIN,
  PRO_SLIDE_PER_SLIDE,
  QUIZ_COUNTS,
  SLIDE_BASE_PRICE,
  SLIDE_EXTRA_PRICE,
  SLIDE_IMAGE_STYLES,
  SLIDE_INCLUDED,
  SLIDE_MAX,
  SLIDE_MIN,
  SLIDE_TEXT_VOLUMES,
  activeBlockIds,
  clampInt,
  defaultSlideCount,
  effectivePlanItems,
  joinCsv,
  normalizeQuizCount,
  planCapacity,
  resolvePlanFlags,
  splitCsv,
  type SlideTool,
} from "@/lib/generation/slide-params";
import { formatTanga } from "@/lib/tools";
import { MultiChipGroup, RangeField } from "./fields";
import { Row, Segmented, SelectField, Switch, type SegmentedOption } from "./compact";
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
export const TEXT_VOLUME_LABELS: Record<(typeof SLIDE_TEXT_VOLUMES)[number], string> = {
  qisqa: "Qisqa",
  standart: "Standart",
  kop: "Ko‘p",
};
const TEXT_VOLUME_OPTIONS = SLIDE_TEXT_VOLUMES.map((v) => ({ value: v, label: TEXT_VOLUME_LABELS[v] }));
const QUIZ_OPTIONS = QUIZ_COUNTS.map((n) => ({ value: String(n), label: n === 0 ? "Testsiz" : String(n) }));

/**
 * Bloklar + `quizCount`/`agendaSlide` — server AYNAN shu yo'l bilan
 * hisoblaydi (`lib/generation/meta.ts extractMeta`, `resolvePlanFlags`
 * + `activeBlockIds`). AUDIT-25 N2 (re-review 8e4603e): forma bu yo'lni
 * TAKRORLAYDI, `purposeDefaults`ga qarab taxmin qilmaydi — aks holda
 * chip («Test»/«Reja» «Tuzilma bloklari»da) va son/kalit (`quizCount`/
 * `agendaSlide`) bir-biridan uzilib qolar edi (masalan foydalanuvchi
 * «Test»ni yoqib keyin o'chirsa, `quizCount` eskicha 3da qolaverardi).
 */
function resolvedFlags(values: FormValues, tool: SlideTool): { on: Set<string>; quizCount: number | undefined; agendaSlide: boolean | undefined } {
  const purpose = typeof values.slidePurpose === "string" ? values.slidePurpose : undefined;
  const given = values.blocks !== undefined && values.blocks !== null;
  const sent = given && tool === "pro-slide";
  const blocks: readonly string[] = given ? decodeBlocks(values.blocks) : purposeDefaults(purpose ?? "general").blocks;
  const rawQuiz = normalizeQuizCount(values.quizCount);
  const rawAgenda = values.agendaSlide === true ? true : values.agendaSlide === false ? false : undefined;
  const flags = resolvePlanFlags(sent, blocks, rawQuiz, rawAgenda);
  const on = activeBlockIds(blocks, flags.quizCount, values.internetSearch === true, flags.agendaSlide);
  return { on, quizCount: flags.quizCount, agendaSlide: flags.agendaSlide };
}

/**
 * `quizCount` KO'RSATILADIGAN qiymati — aniq (resolvePlanFlags'dan
 * neytrallanmagan) son USTUN; aks holda «test» bloki yoqiqmi (`on`) —
 * yoqiq bo'lsa `QUIZ_COUNT_FALLBACK`, aks holda 0.
 */
function resolvedQuizCount(values: FormValues, tool: SlideTool): number {
  const { on, quizCount } = resolvedFlags(values, tool);
  if (quizCount !== undefined) return quizCount;
  return on.has("test") ? QUIZ_COUNT_FALLBACK : 0;
}

/**
 * `agendaSlide` KO'RSATILADIGAN qiymati — `planBudgetForBody` bilan BIR
 * XIL shart: «reja» bloki yoqiq VA `agendaSlide` aniq `false` emas.
 */
function resolvedAgendaSlide(values: FormValues, tool: SlideTool): boolean {
  const { on, agendaSlide } = resolvedFlags(values, tool);
  return on.has("reja") && agendaSlide !== false;
}
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
  const n = clampInt(values.slideCount, pro ? PRO_SLIDE_MIN : SLIDE_MIN, pro ? PRO_SLIDE_MAX : SLIDE_MAX, defaultSlideCount(tool));
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
 * `planItems` sig'imi — AUDIT-25 qaror 3: `planCapacity` server nechta
 * reja bandini deka ichiga sig'dirishini hisoblaydi, forma AYNAN shu
 * bilan mos ko'rsatishi kerak (server baribir qisadi — kelishmovchilik
 * bo'lmasin). AUDIT-25 P1 swap: haqiqiy dvigatel funksiyasi
 * (`lib/generation/slide-params.ts`), stub emas.
 *
 * `tool` — real `planCapacity`ning o'zi `blocksSent` (pro-slayd chip
 * tanlovimi) shartini `v.tool`dan hisoblaydi (`meta.ts` bilan BIR XIL).
 *
 * INT-13 (AUDIT-25 integratsiya sharhi): `slideCount` MAYDONI o'rniga
 * `slidePagesOf(values, tool)` (allaqachon vositaga qarab standartlangan)
 * uzatiladi — xom `values.slideCount` `planCapacity` → `bodyWantOf`
 * ichida vositani BILMAYDIGAN `SLIDE_DEFAULT` (10) ga tushib qolardi,
 * pro dvigatel esa `slideCount` yo'q bo'lganda 12 dan hisoblaydi
 * (`extractMeta`, `meta.ts`). Natijada `slideCount` yuborilmagan holatda
 * forma sig'imi 7, dvigatel esa 9 deb hisoblardi (F7 dalili).
 */
export function capacityFor(values: FormValues, tool: SlideTool): number {
  return planCapacity({
    slideCount: slidePagesOf(values, tool),
    blocks: values.blocks,
    tool,
    quizCount: values.quizCount,
    agendaSlide: values.agendaSlide,
    titleSlide: values.titleSlide,
    speakerNotes: values.speakerNotes,
    internetSearch: values.internetSearch,
    slidePurpose: values.slidePurpose,
  });
}

/** Deka TANASI o'lchamiga qisilgan slaydlar soni — `defaultPlanItems`/`effectivePlanItems` shu bilan chaqiriladi (`meta.ts slidePages` bilan BIR XIL). */
export function slidePagesOf(values: FormValues, tool: SlideTool): number {
  return clampInt(values.slideCount, SLIDE_MIN, SLIDE_MAX, defaultSlideCount(tool));
}

/**
 * Foydalanuvchi TANLAMAGAN (`values.planItems === undefined`) holatda
 * ko'rsatiladigan xom qiymat — AUDIT-25 N3. Real `effectivePlanItems`
 * "xom" (sig'imdan oldingi) qiymatni alohida qaytarmaydi, shu sabab uni
 * cheksiz sig'im bilan chaqiramiz (`min(want, cheksiz) = want`) — ikki
 * xil hisoblash yozish o'rniga BITTA funksiyaning o'zidan olamiz.
 */
function rawPlanItems(values: FormValues, tool: SlideTool): number {
  return effectivePlanItems(values.planItems, Number.MAX_SAFE_INTEGER, slidePagesOf(values, tool));
}

/**
 * «Reja bandlari» segmenti — sig'imdan katta variantlar o'chiriladi
 * (`Segmented`ning `disabled` variant qo'llovi, AUDIT-25 CHANGES-6),
 * joriy qiymat sig'maganda samarali (qisilgan) qiymat ta'kidlanadi va
 * bitta qatorli o'zbekcha izoh chiqadi. Sig'im 3 dan kichik bo'lsa
 * pastki chegara `effective`gacha kengayadi — shu sabab variantlar
 * ro'yxati statik emas va samarali qiymat DOIM ro'yxatda bo'ladi
 * (CHANGES-1: `lo = min(PLAN_ITEMS_MIN, capacity, effective)`).
 *
 * N3: izoh FAQAT foydalanuvchi ANIQ tanlov qilganda («Tanlangan …»
 * so'zi haqiqat bo'lishi uchun) — standart (tanlanmagan) qiymat
 * sig'imga qisilsa ham izoh chiqmaydi.
 */
function PlanItemsField({ values, set, tool }: { values: FormValues; set: SlideFieldSetter; tool: SlideTool }) {
  const capacity = capacityFor(values, tool);
  const slidePages = slidePagesOf(values, tool);
  const raw = rawPlanItems(values, tool);
  const effective = effectivePlanItems(values.planItems, capacity, slidePages);
  const lo = Math.min(PLAN_ITEMS_MIN, capacity, effective);
  const options: SegmentedOption[] = [];
  for (let n = lo; n <= PLAN_ITEMS_MAX; n++) options.push({ value: String(n), label: String(n), disabled: n > capacity });
  // Yopiq raqam ko'rsatiladigan variantdan (6) oshmasin — real tanlanadigan maksimum shu.
  const shownCapacity = Math.min(capacity, PLAN_ITEMS_MAX);
  return (
    <Row
      label="Reja bandlari"
      hint={`Reja bandlari — har biri o‘z slaydi bilan; ${slidePages} slaydga ${shownCapacity} band sig‘adi.`}
    >
      <div>
        <Segmented ariaLabel="Reja bandlari" options={options} value={String(effective)} onChange={(v) => set("planItems", Number(v))} />
        {values.planItems !== undefined && effective < raw ? (
          <p className="text-muted-foreground mt-1 text-[11px]" data-plan-capacity-hint>
            {`Tanlangan ${raw} band sig‘maydi — ${effective} band yoziladi.`}
          </p>
        ) : null}
      </div>
    </Row>
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
              // AUDIT-25 N1: `blocks` FAQAT pro-slaydda yuboriladi — oddiy
              // «Slayd»da bu maydon uchun qator umuman yo'q, lekin eski kod
              // shu yerda SO'ZSIZ `set("blocks", ...)` chaqirardi, shu sabab
              // oddiy formada ham `values.blocks` to'lib qolardi va server
              // (P1 `resolvePlanFlags`) so'rovni "pro" deb noto'g'ri o'qirdi.
              if (ctx.tool === "pro-slide") {
                const newBlocks = purposeDefaults(v).blocks;
                set("blocks", encodeBlocks(newBlocks));
                /*
                 * AUDIT-25 F1 (final review caf9fcb): agar foydalanuvchi
                 * ALLAQACHON aniq tanlov qilgan bo'lsa («Nazorat testi»=5
                 * yoki «Reja slaydi» kaliti bosilgan), o'sha aniq tanlov
                 * YANGI bloklarga moslashtiriladi — aks holda eski aniq son
                 * yangi turda ham qoladi-yu, endi bloklarda yo'q «Test»
                 * chipi bilan ziddiyatga tushadi. TEGILMAGAN holatga
                 * TEGMAYMIZ: `resolvedQuizCount`/`resolvedAgendaSlide`
                 * allaqachon jonli `blocks`dan (shu yangilangan) to'g'ri
                 * o'qiydi, aniq qiymat yozib "tegilgan" holatga
                 * aylantirish A3-01/A3-02 "tegilmagan → yuborilmaydi"
                 * shartnomasini shunchaki tur almashtirish bilan buzardi.
                 */
                if (values.quizCount !== undefined) set("quizCount", newBlocks.includes("test") ? QUIZ_COUNT_FALLBACK : 0);
                if (values.agendaSlide !== undefined) set("agendaSlide", newBlocks.includes("reja"));
              }
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
            onChange={(next) => {
              const nextBlocks = next.filter(isSlideBlockId);
              const prevBlocks = decodeBlocks(values.blocks);
              set("blocks", encodeBlocks(nextBlocks));
              /*
               * AUDIT-25 N2: «Test»/«Reja» chiplari `quizCount`/`agendaSlide`
               * bilan IKKI TOMONLAMA sinxron — aks holda chip yoqiq turib son
               * «Testsiz» (yoki aksincha) ko'rsatishi mumkin edi (re-review
               * 8e4603e (a)-(d)). `resolvePlanFlags` pro-slaydda `blocks`ni
               * ustun qo'yadi, shu sabab forma ham ikkalasini birga yozadi.
               */
              const hadTest = prevBlocks.includes("test");
              const hasTestNow = nextBlocks.includes("test");
              if (hasTestNow && !hadTest) set("quizCount", QUIZ_COUNT_FALLBACK);
              else if (!hasTestNow && hadTest) set("quizCount", 0);
              const hadReja = prevBlocks.includes("reja");
              const hasRejaNow = nextBlocks.includes("reja");
              if (hasRejaNow && !hadReja) set("agendaSlide", true);
              else if (!hasRejaNow && hadReja) set("agendaSlide", false);
            }}
          />
        </Row>
      );
    case "planItems":
      return <PlanItemsField key={id} values={values} set={set} tool={ctx.tool} />;
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
          <Segmented
            ariaLabel="Nazorat testi"
            options={QUIZ_OPTIONS}
            value={String(resolvedQuizCount(values, ctx.tool))}
            onChange={(v) => {
              const n = Number(v);
              set("quizCount", n);
              // AUDIT-25 N2: pro-slaydda «Tuzilma bloklari»dagi «Test» chipi bilan sinxron (blocks-onChange bilan bir xil qoida).
              if (ctx.tool === "pro-slide") {
                const blocks = decodeBlocks(values.blocks);
                const hasTest = blocks.includes("test");
                if (n > 0 && !hasTest) set("blocks", encodeBlocks([...blocks, "test"]));
                else if (n === 0 && hasTest) set("blocks", encodeBlocks(blocks.filter((b) => b !== "test")));
              }
            }}
          />
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
      // AUDIT-25 P1 A3-02: generic `switchRow` ishlatilmaydi — standart holat
      // (foydalanuvchi tegmaganda) taqdimot turiga bog'liq (`resolvedAgendaSlide`),
      // doim yoqilgan emas (pitch/training standarti «reja»siz).
      return (
        <Row key={id} label="Reja slaydi" hint="Titul ortidan reja bandlari sanab o‘tiladi.">
          <Switch
            checked={resolvedAgendaSlide(values, ctx.tool)}
            ariaLabel="Reja slaydi"
            onChange={(v) => {
              set("agendaSlide", v);
              // AUDIT-25 N2: pro-slaydda «Tuzilma bloklari»dagi «Reja» chipi bilan sinxron (blocks-onChange bilan bir xil qoida).
              if (ctx.tool === "pro-slide") {
                const blocks = decodeBlocks(values.blocks);
                const hasReja = blocks.includes("reja");
                if (v && !hasReja) set("blocks", encodeBlocks([...blocks, "reja"]));
                else if (!v && hasReja) set("blocks", encodeBlocks(blocks.filter((b) => b !== "reja")));
              }
            }}
          />
        </Row>
      );
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
export function settingsSummary(values: FormValues, ids: readonly string[], tool: SlideTool = "slide"): string[] {
  const out: string[] = [];
  const has = (id: string) => ids.includes(id);
  if (has("slideAudience")) out.push(AUDIENCE_OPTIONS.find((o) => o.value === String(values.slideAudience || "auto"))?.label ?? "Avtomatik");
  if (has("slidePurpose")) out.push(PURPOSE_OPTIONS.find((o) => o.value === String(values.slidePurpose || "general"))?.label ?? "Umumiy");
  if (has("planItems")) out.push(`${effectivePlanItems(values.planItems, capacityFor(values, tool), slidePagesOf(values, tool))} band`);
  if (has("textVolume")) out.push(TEXT_VOLUME_LABELS[String(values.textVolume || "standart") as keyof typeof TEXT_VOLUME_LABELS] ?? "Standart");
  if (has("quizCount")) {
    const q = resolvedQuizCount(values, tool);
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
    // `agendaSlide` — AUDIT-25 P1 A3-02: tegilmagan bo'lsa taqdimot turi standartidan (`resolvedAgendaSlide`).
    const on = id === "agendaSlide" ? resolvedAgendaSlide(values, tool) : def ? values[id] !== false : values[id] === true;
    if (on) out.push(label);
  }
  return out;
}
