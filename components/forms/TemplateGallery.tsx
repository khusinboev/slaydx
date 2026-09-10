"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE_BY_ID, normalizeTemplateId, type SlideTemplate, type SlideTemplateId } from "@/lib/generation/slide-templates";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { bodyRules } from "@/lib/generation/slide-audience";
import { GALLERY_SLIDES, sampleDeck } from "@/lib/generation/slide-samples";
import type { SlideModel, SlideTheme, SlideThemeId } from "@/lib/generation/slide-types";
import { listTemplates, type CustomTemplateLite } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { SlideCanvas } from "../viewers/SlideCanvas";
import { useDialog } from "../overlays/useDialog";
import { ColorPicker } from "./slide-pickers";
import { Row } from "./compact";
import { Thumb } from "./Thumb";
import { CustomTemplateCard, CustomPreview } from "./CustomTemplateCard";

/**
 * Shablon tanlagich (Shablonlar 2, «qalqib chiquvchi oyna» varianti).
 *
 * Formada faqat BITTA plitka turadi — joriy tanlov:
 *   - «Avtomatik» (standart) — shablon preview'i EMAS (mavzu hali yo'q,
 *     birorta dizaynni ko'rsatish yolg'on bo'lardi), bezakli plitka:
 *     «mavzuga qarab dizayn tanlanadi»;
 *   - tanlangan shablon — uning HAQIQIY titul slaydi (`SlideCanvas`,
 *     `sampleDeck`), joriy rangda;
 *   - «O'z shablonim» — namunada chizilgan titul.
 * Plitka bosilsa oyna ochiladi: barcha shablonlar (haqiqiy titul + 3 eskiz)
 * va pro'da «O'z shablonim» kartasi; karta bosilishi bilan tanlov qo'llanib
 * oyna yopiladi. Rang swatchlari plitka ostida — oynasiz o'zgartiriladi,
 * plitka preview'i shu zahoti qayta chiziladi.
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
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Namuna holati OYNA tashqarisida — oyna yopilganda yo'qolmasin (plitka preview'i uchun).
  const [customTpl, setCustomTpl] = useState<CustomTemplateLite | null>(null);
  const [customList, setCustomList] = useState<CustomTemplateLite[] | null>(null);
  useEffect(() => {
    if (!custom) return;
    let alive = true;
    listTemplates()
      .then((items) => {
        if (!alive) return;
        setCustomList(items);
        if (custom.value) setCustomTpl((cur) => cur ?? items.find((t) => t.assetId === custom.value) ?? null);
      })
      .catch(() => {
        if (alive) setCustomList([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(custom)]);

  const pick = (tpl: SlideTemplate) => {
    onChange(tpl.id);
    // Shablonning o'z palitrasi — foydalanuvchi keyin swatch bilan o'zgartiradi.
    onTheme(tpl.defaultTheme);
    custom?.onChange("");
    close();
  };

  return (
    <div>
      <SelectionTile
        current={current}
        themeObj={themeObj}
        customTpl={customOn ? customTpl : null}
        customName={customOn ? customTpl?.name ?? "Yuklangan namuna" : null}
        onOpen={() => setOpen(true)}
      />
      <div className="mt-3">
        {customOn ? (
          <Row label="Rang" hint="O'z shablonda ranglar va shriftlar namunaning o'zidan olinadi.">
            <span className="text-muted-foreground text-[12.5px]">Namunaning o‘z ranglari</span>
          </Row>
        ) : (
          <Row label="Rang" hint="Palitra — tanlangan shablonning barcha slaydlariga; preview ham shu rangda.">
            <ColorPicker value={themeObj.id} onChange={(v) => onTheme(v as SlideThemeId)} />
          </Row>
        )}
      </div>
      {open ? (
        <TemplateDialog
          current={current}
          customOn={customOn}
          themeObj={themeObj}
          onPick={pick}
          close={close}
          custom={
            custom
              ? {
                  value: custom.value,
                  tpl: customTpl,
                  list: customList ?? [],
                  onTpl: setCustomTpl,
                  onList: setCustomList,
                  onPick: (t: CustomTemplateLite) => {
                    setCustomTpl(t);
                    custom.onChange(t.assetId);
                    close();
                  },
                  onClear: () => custom.onChange(""),
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/** Formadagi plitka — joriy tanlov; bosilsa oyna. */
function SelectionTile({
  current,
  themeObj,
  customTpl,
  customName,
  onOpen,
}: {
  current: SlideTemplateId;
  themeObj: SlideTheme;
  customTpl: CustomTemplateLite | null;
  customName: string | null;
  onOpen: () => void;
}) {
  const tpl = SLIDE_TEMPLATE_BY_ID[current];
  const label = customName ? "O‘z shablonim" : tpl.nameUz;
  const blurb = customName ? customName : current === "auto" ? "Mavzuga qarab eng mos dizayn va rang tanlanadi" : tpl.blurb;
  return (
    <button
      type="button"
      data-template-tile={customName ? "custom" : current}
      aria-haspopup="dialog"
      aria-label={`Shablon: ${label} — o‘zgartirish`}
      onClick={onOpen}
      className="border-input bg-card hover:border-foreground/30 group flex w-full items-stretch gap-3 rounded-xl border p-2 text-left transition"
    >
      <span className="w-[44%] shrink-0 sm:w-[38%]">
        {customName ? (
          customTpl ? (
            <CustomPreview tpl={customTpl} themeId={themeObj.id} mainOnly />
          ) : (
            <span className="bg-muted text-muted-foreground flex items-center justify-center rounded-md text-[11px]" style={{ aspectRatio: "16 / 9" }}>
              Namuna yuklanmoqda…
            </span>
          )
        ) : current === "auto" ? (
          <AutoTile theme={themeObj} />
        ) : (
          <TemplateMainThumb tpl={tpl} themeId={themeObj.id} />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold">{label}</span>
          {current === "auto" && !customName ? <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px]">standart</span> : null}
        </span>
        <span className="text-muted-foreground line-clamp-2 text-[12px]">{blurb}</span>
        <span className="text-primary mt-1 text-[12px] font-medium underline-offset-2 group-hover:underline">Shablonni o‘zgartirish ›</span>
      </span>
    </button>
  );
}

/**
 * «Avtomatik» plitkasi — shablon preview'i o'rniga bezak: joriy palitra
 * gradienti ustida uch xil mavhum «slayd» (kartalar yelpig'ichi). Rang
 * swatch o'zgarsa plitka ham shu rangga o'tadi.
 */
function AutoTile({ theme }: { theme: SlideTheme }) {
  const cards = [
    { rot: -9, x: 8, y: 22, bars: [64, 40, 52] },
    { rot: 0, x: 30, y: 12, bars: [70, 46, 58] },
    { rot: 9, x: 52, y: 22, bars: [56, 38, 48] },
  ];
  return (
    <span
      data-auto-tile
      className="relative block w-full overflow-hidden rounded-md"
      style={{ aspectRatio: "16 / 9", background: `linear-gradient(135deg, ${theme.titleBg} 0%, ${theme.accent} 140%)` }}
    >
      <span className="absolute -top-6 -right-6 size-24 rounded-full opacity-25" style={{ background: theme.accent2 }} />
      <span className="absolute -bottom-8 -left-4 size-20 rounded-full opacity-20" style={{ background: theme.titleText }} />
      {cards.map((c, i) => (
        <span
          key={i}
          className="absolute rounded-[3px] shadow-md"
          style={{
            left: `${c.x}%`,
            top: `${c.y}%`,
            width: "40%",
            aspectRatio: "16 / 9",
            background: theme.surface,
            transform: `rotate(${c.rot}deg)`,
            zIndex: i === 1 ? 2 : 1,
          }}
        >
          <span className="absolute top-[14%] left-[10%] h-[10%] rounded-sm" style={{ width: `${c.bars[0]}%`, background: theme.titleBg }} />
          <span className="absolute top-[36%] left-[10%] h-[6%] rounded-sm opacity-70" style={{ width: `${c.bars[1]}%`, background: theme.muted }} />
          <span className="absolute top-[50%] left-[10%] h-[6%] rounded-sm opacity-70" style={{ width: `${c.bars[2]}%`, background: theme.muted }} />
          <span className="absolute right-[10%] bottom-[12%] h-[16%] w-[22%] rounded-sm" style={{ background: theme.accent }} />
        </span>
      ))}
    </span>
  );
}

function TemplateMainThumb({ tpl, themeId }: { tpl: SlideTemplate; themeId: SlideThemeId }) {
  const deck = useMemo(() => sampleDeck(tpl.id), [tpl.id]);
  const theme = useMemo(() => getSlideTheme(themeId), [themeId]);
  const bodyType = useMemo(() => bodyRules({ planItems: 5, textVolume: "standart" }, tpl.id), [tpl.id]);
  return (
    <Thumb scaleHint={0.235}>
      <SlideCanvas slide={deck[0]} theme={theme} visual={tpl.visual} audience="auto" templateId={tpl.id} bodyType={bodyType} index={0} total={deck.length} />
    </Thumb>
  );
}

type CustomDialogProps = {
  value: string;
  tpl: CustomTemplateLite | null;
  list: CustomTemplateLite[];
  onTpl: (t: CustomTemplateLite | null) => void;
  onList: (l: CustomTemplateLite[]) => void;
  onPick: (t: CustomTemplateLite) => void;
  onClear: () => void;
};

/** Qalqib chiquvchi oyna — barcha shablonlar (haqiqiy titul + 3 eskiz) va «O'z shablonim». */
function TemplateDialog({
  current,
  customOn,
  themeObj,
  onPick,
  close,
  custom,
}: {
  current: SlideTemplateId;
  customOn: boolean;
  themeObj: SlideTheme;
  onPick: (tpl: SlideTemplate) => void;
  close: () => void;
  custom?: CustomDialogProps;
}) {
  const panelRef = useDialog(true, close);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Shablon tanlash">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" onClick={close} />
      <div ref={panelRef} className="bg-card relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">Shablon tanlash</h2>
            <p className="text-muted-foreground text-[12px]">Har karta — haqiqiy slaydlar. Bosilganda tanlanadi.</p>
          </div>
          <button type="button" onClick={close} className="hover:bg-muted rounded-lg p-1.5" aria-label="Yopish">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-3 sm:p-4">
          <div role="radiogroup" aria-label="Shablon" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-template-gallery>
            {SLIDE_TEMPLATES.map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} on={!customOn && current === tpl.id} themeObj={themeObj} onPick={() => onPick(tpl)} />
            ))}
            {custom ? (
              <CustomTemplateCard
                on={customOn}
                themeId={themeObj.id}
                tpl={custom.tpl}
                list={custom.list}
                onTpl={custom.onTpl}
                onList={custom.onList}
                onPick={custom.onPick}
                onClear={custom.onClear}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({ tpl, on, themeObj, onPick }: { tpl: SlideTemplate; on: boolean; themeObj: SlideTheme; onPick: () => void }) {
  const deck = useMemo(() => sampleDeck(tpl.id), [tpl.id]);
  const bodyType = useMemo(() => bodyRules({ planItems: 5, textVolume: "standart" }, tpl.id), [tpl.id]);
  const render = (s: SlideModel, i: number) => (
    <SlideCanvas slide={s} theme={themeObj} visual={tpl.visual} audience="auto" templateId={tpl.id} bodyType={bodyType} index={i} total={deck.length} />
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
      {tpl.id === "auto" ? (
        <>
          <AutoTile theme={themeObj} />
          <p className="text-muted-foreground px-1 pt-1.5 text-[11px]">Mavzuga qarab 10 dizayndan eng mosi va rangi tanlanadi.</p>
        </>
      ) : (
        <>
          <Thumb scaleHint={0.235}>{render(deck[0], 0)}</Thumb>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {GALLERY_SLIDES.slice(1).map((i) => (
              <Thumb key={i} scaleHint={0.075} small>
                {render(deck[i], i)}
              </Thumb>
            ))}
          </div>
          <p className="text-muted-foreground truncate px-1 pt-1.5 text-[11px]">{tpl.blurb}</p>
        </>
      )}
    </button>
  );
}
