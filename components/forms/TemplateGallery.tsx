"use client";

import { useMemo } from "react";
import { SLIDE_TEMPLATES, normalizeTemplateId, type SlideTemplate, type SlideTemplateId } from "@/lib/generation/slide-templates";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { bodyRules } from "@/lib/generation/slide-audience";
import { GALLERY_SLIDES, sampleDeck } from "@/lib/generation/slide-samples";
import type { SlideModel, SlideThemeId } from "@/lib/generation/slide-types";
import { cn } from "@/lib/cn";
import { SlideCanvas } from "../viewers/SlideCanvas";
import { ColorPicker } from "./slide-pickers";
import { Row } from "./compact";
import { Thumb } from "./Thumb";
import { CustomTemplateCard } from "./CustomTemplateCard";
import type { CustomTemplateLite } from "@/lib/api-client";

/**
 * Shablon galereyasi (Shablonlar 2).
 *
 * Har karta — shablonning HAQIQIY titul slaydi (`SlideCanvas`, namunaviy
 * o'zbekcha deka `sampleDeck`) va uchta eskiz (bo'lim, bandlar, raqamlar).
 * CSS «eskiz» emas: foydalanuvchi aynan nima olishini ko'radi («ko'rdim =
 * oldim» galereyada ham). Preview'lar TANLANGAN rangda chiziladi — rang
 * swatchlari galereya ostida; shablon tanlanganda uning standart palitrasi
 * (`defaultTheme`) rangga tushadi, keyin swatch bilan o'zgartirish mumkin.
 *
 * 11 karta × 4 canvas = 44 `planSlide` — `content-visibility: auto` bilan
 * ekrandan tashqaridagilar chizilmaydi.
 */
export function TemplateGallery({
  value,
  theme,
  onChange,
  onTheme,
  custom,
}: {
  value: string;
  theme: string;
  onChange: (templateId: SlideTemplateId) => void;
  onTheme: (themeId: SlideThemeId) => void;
  /**
   * «O'z shablonim» (faqat pro): `value` — `templateAssetId`. Berilmasa
   * karta chiqmaydi (oddiy slayd). Tanlanganda ichki shablon/rang
   * e'tiborsiz — deka namuna dizaynida chiqadi.
   */
  custom?: { value: string; onChange: (assetId: string) => void };
}) {
  const current = normalizeTemplateId(value);
  const themeObj = getSlideTheme(theme as SlideThemeId);
  const customOn = Boolean(custom?.value);
  return (
    <div>
      <div role="radiogroup" aria-label="Shablon" className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-template-gallery>
        {SLIDE_TEMPLATES.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            tpl={tpl}
            on={!customOn && current === tpl.id}
            themeId={themeObj.id}
            onPick={() => {
              onChange(tpl.id);
              // Shablonning o'z palitrasi — foydalanuvchi keyin swatch bilan o'zgartiradi.
              onTheme(tpl.defaultTheme);
              // Ichki shablon tanlandi — namuna bekor.
              custom?.onChange("");
            }}
          />
        ))}
        {custom ? (
          <CustomTemplateCard
            value={custom.value}
            on={customOn}
            themeId={themeObj.id}
            onPick={(t: CustomTemplateLite) => custom.onChange(t.assetId)}
            onClear={() => custom.onChange("")}
          />
        ) : null}
      </div>
      <div className="mt-3">
        {customOn ? (
          <Row label="Rang" hint="O'z shablonda ranglar va shriftlar namunaning o'zidan olinadi.">
            <span className="text-muted-foreground text-[12.5px]">Namunaning o‘z ranglari</span>
          </Row>
        ) : (
          <Row label="Rang" hint="Palitra — tanlangan shablonning barcha slaydlariga; preview'lar ham shu rangda.">
            <ColorPicker value={themeObj.id} onChange={(v) => onTheme(v as SlideThemeId)} />
          </Row>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ tpl, on, themeId, onPick }: { tpl: SlideTemplate; on: boolean; themeId: SlideThemeId; onPick: () => void }) {
  const deck = useMemo(() => sampleDeck(tpl.id), [tpl.id]);
  const theme = useMemo(() => getSlideTheme(themeId), [themeId]);
  const bodyType = useMemo(() => bodyRules({ planItems: 5, textVolume: "standart" }, tpl.id), [tpl.id]);
  const render = (s: SlideModel, i: number) => (
    <SlideCanvas slide={s} theme={theme} visual={tpl.visual} audience="auto" templateId={tpl.id} bodyType={bodyType} index={i} total={deck.length} />
  );
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={tpl.nameUz}
      data-template-card={tpl.id}
      onClick={onPick}
      className={cn(
        "bg-card overflow-hidden rounded-xl border p-2 text-left transition",
        on ? "ring-primary border-transparent ring-2" : "border-input hover:border-foreground/30",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "320px 250px" } as React.CSSProperties}
    >
      <div className="flex items-baseline justify-between gap-2 px-1 pb-1.5">
        <span className="truncate text-[13px] font-semibold">{tpl.nameUz}</span>
        {tpl.id === "auto" ? <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px]">mavzudan</span> : null}
      </div>
      <Thumb scaleHint={0.235}>{render(deck[0], 0)}</Thumb>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {GALLERY_SLIDES.slice(1).map((i) => (
          <Thumb key={i} scaleHint={0.075} small>
            {render(deck[i], i)}
          </Thumb>
        ))}
      </div>
      <p className="text-muted-foreground truncate px-1 pt-1.5 text-[11px]">{tpl.blurb}</p>
    </button>
  );
}
