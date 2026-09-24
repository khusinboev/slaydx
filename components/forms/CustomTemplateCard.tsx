"use client";

import { useMemo, useState } from "react";
import { deleteTemplate, listTemplates, uploadTemplate, type CustomTemplateLite } from "@/lib/api-client";
import { isUncertainOutcome, reconcile } from "@/lib/api-edit";
import { bodyRules } from "@/lib/generation/slide-audience";
import { GALLERY_SLIDES, sampleDeck } from "@/lib/generation/slide-samples";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import type { SlideModel } from "@/lib/generation/slide-types";
import { cn } from "@/lib/cn";
import { SlideCanvas } from "../viewers/SlideCanvas";
import { Thumb } from "./Thumb";

/** Klientda ham oldindan tekshiriladi — serverga borib qaytishni kutmasdan. */
export const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;
export const TEMPLATE_WAIT_NOTE = "Namuna asosida yaratish ko‘proq vaqt oladi (≈1–2 daqiqa qo‘shimcha).";

/** Server saqlagan nom — `lib/server/template-upload.ts` bilan bir xil tozalash. */
const storedName = (f: File) => String(f.name || "namuna.pptx").replace(/[\r\n\t]/g, " ").trim().slice(0, 120) || "namuna.pptx";

/**
 * Yuklash + noaniq javobni tekshirish (FE-15).
 *
 * Tahlil va rasterlash 20–40 s, LibreOffice band bo'lsa ko'proq; proksi esa
 * `/api/uploads/` da 60 s dan keyin 504 beradi — server namunani baribir
 * SAQLAYDI. Ilgari UI xato ko'rsatardi va foydalanuvchi qayta yuklab,
 * dublikat yasardi. Endi noaniq javobda (`isUncertainOutcome`) fayl QAYTA
 * yuborilmaydi: ro'yxat so'raladi va yuklashdan oldin bo'lmagan, shu nomli
 * namuna topilsa — o'sha qaytadi. Topilmasa — aniq jumla.
 */
async function templateAssetId(f: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  } catch (err) {
    console.warn("[template] fayl xeshini hisoblab bo'lmadi — nom bo'yicha tekshiramiz", err);
    return null;
  }
}

async function uploadConfirmed(f: File, known: CustomTemplateLite[]): Promise<CustomTemplateLite> {
  try {
    return (await uploadTemplate(f)).template;
  } catch (e) {
    if (!isUncertainOutcome(e)) throw e;
    /*
     * Aniq moslik: server `assetId` = fayl baytlarining SHA-256 (24 hex,
     * `lib/server/template-upload.ts assetIdFor`). Bir xil faylni qayta
     * yuklash (server upsert) ham, ro'yxat hali yuklanmagan holat ham
     * shu bilan to'g'ri tanib olinadi (W4-D N4). `crypto.subtle` yo'q
     * (xavfsiz bo'lmagan kontekst) bo'lsa — nom bo'yicha, faqat yangi aktiv.
     */
    const expectedId = await templateAssetId(f);
    const before = new Set(known.map((t) => t.assetId));
    const name = storedName(f);
    const found = await reconcile(async () => {
      const list = await listTemplates();
      if (expectedId) return list.find((t) => t.assetId === expectedId) ?? null;
      return list.find((t) => t.name === name && !before.has(t.assetId)) ?? null;
    });
    if (found) return found;
    throw new Error("Namuna saqlanganini tasdiqlab bo‘lmadi (server javobi kelmadi) — qayta yuklab ko‘ring.");
  }
}

/**
 * «O'z shablonim» kartasi (Shablonlar 2, B4, faqat pro).
 *
 * Foydalanuvchi PPTX namunasini beradi → server tahlil qilib layout
 * fonlarini rasterlaydi (20–40 s, «Tahlil qilinmoqda…») → karta shu
 * namunada chizilgan HAQIQIY titul + 3 eskizni ko'rsatadi (`SlideCanvas`
 * `custom` — ko'ruvchi bilan bitta planer, «ko'rdim = oldim»). Tanlangan
 * `assetId` formaning `templateAssetId` maydoniga tushadi; oddiy shablon
 * kartasi bosilsa u tozalanadi (`TemplateGallery`).
 *
 * Sahifa qayta ochilganda `value` bor, obyekt yo'q — ro'yxatdan
 * (`GET /api/uploads/template`) topiladi; oldingi namunalar «qayta
 * ishlatish» uchun chip bo'lib chiqadi.
 */
export function CustomTemplateCard({
  on,
  onPick,
  onClear,
  themeId,
  tpl,
  list,
  onTpl,
  onList,
}: {
  on: boolean;
  onPick: (tpl: CustomTemplateLite) => void;
  onClear: () => void;
  themeId: string;
  /** Holat OTA komponentda (`TemplateGallery`) — oyna yopilganda yo'qolmasin. */
  tpl: CustomTemplateLite | null;
  list: CustomTemplateLite[];
  onTpl: (t: CustomTemplateLite | null) => void;
  onList: (l: CustomTemplateLite[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTpl = onTpl;
  const setList = (f: (l: CustomTemplateLite[]) => CustomTemplateLite[]) => onList(f(list));

  async function onFile(f: File) {
    setError(null);
    if (f.size > TEMPLATE_MAX_BYTES) {
      setError("Fayl 20 MB dan katta");
      return;
    }
    if (!/\.pptx$/i.test(f.name)) {
      setError("Faqat PPTX (PowerPoint) fayl");
      return;
    }
    setBusy(true);
    try {
      const template = await uploadConfirmed(f, list);
      setTpl(template);
      setList((l) => [template, ...l.filter((t) => t.assetId !== template.assetId)]);
      onPick(template);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Namuna yuklanmadi");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: CustomTemplateLite) {
    setList((l) => l.filter((x) => x.assetId !== t.assetId));
    if (tpl?.assetId === t.assetId) {
      setTpl(null);
      onClear();
    }
    await deleteTemplate(t.assetId).catch(() => {});
  }

  // Namuna bor-u tanlanmagan (ichki shablon bosilgan) — preview XIRA qoladi,
  // karta bosilsa qayta tanlanadi. Yuklash zonasi faqat namuna YO'Q bo'lganda:
  // aks holda kartaning o'rtasi fayl tanlash oynasini ochib yuborardi
  // (Chromium smoke'da ushlandi — jsdom buni ko'rmaydi).
  const current = tpl;

  return (
    <div
      role="radio"
      aria-checked={on}
      aria-label="O‘z shablonim"
      data-template-card="custom"
      tabIndex={0}
      onClick={() => {
        if (!on && tpl) onPick(tpl);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !on && tpl) {
          e.preventDefault();
          onPick(tpl);
        }
      }}
      className={cn(
        "bg-card overflow-hidden rounded-xl border p-2 text-left transition",
        on ? "ring-primary border-transparent ring-2" : "border-input hover:border-foreground/30",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 px-1 pb-1.5">
        <span className="truncate text-[13px] font-semibold">O‘z shablonim</span>
        <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px]">Pro · ustamasiz</span>
      </div>

      {current ? (
        <div className={cn(!on && "opacity-60")}>
          <CustomPreview tpl={current} themeId={themeId} />
        </div>
      ) : (
        <label
          className={cn(
            "border-input bg-background/60 hover:bg-muted/40 flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 text-center text-[12.5px]",
            busy && "cursor-progress opacity-70",
          )}
          style={{ aspectRatio: "16 / 9" }}
          onClick={(e) => e.stopPropagation()}
        >
          {busy ? (
            <>
              <span className="font-medium">Tahlil qilinmoqda…</span>
              <span className="text-muted-foreground mt-1 text-[11px]">Maketlar o‘qilib, fonlar chizilmoqda (20–40 s)</span>
            </>
          ) : (
            <>
              <span className="font-medium">PPTX namunani tanlang</span>
              <span className="text-muted-foreground mt-1 text-[11px]">Taqdimot aynan shu faylning dizaynida chiqadi · 20 MB gacha</span>
            </>
          )}
          <input
            type="file"
            className="hidden"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            aria-label="PPTX namuna"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {current ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px]" onClick={(e) => e.stopPropagation()}>
          <span className="text-muted-foreground min-w-0 flex-1 truncate" title={current.name}>
            {current.name}
          </span>
          <label className="cursor-pointer underline-offset-2 hover:underline">
            {busy ? "Yuklanmoqda…" : "Boshqa fayl"}
            <input
              type="file"
              className="hidden"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              aria-label="Boshqa PPTX namuna"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="text-destructive"
            onClick={() => {
              setTpl(null);
              onClear();
            }}
          >
            Olib tashlash
          </button>
        </div>
      ) : list.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1 px-1" onClick={(e) => e.stopPropagation()}>
          {list.slice(0, 4).map((t) => (
            <span key={t.assetId} className="bg-muted inline-flex max-w-full items-center gap-1 rounded-full pr-1 text-[11px]">
              <button
                type="button"
                className="max-w-[9rem] truncate py-0.5 pl-2"
                title={t.name}
                onClick={() => {
                  setTpl(t);
                  onPick(t);
                }}
              >
                {t.name}
              </button>
              <button type="button" aria-label={`${t.name} — o‘chirish`} className="text-muted-foreground hover:text-destructive px-1" onClick={() => void remove(t)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <p className="text-muted-foreground px-1 pt-1.5 text-[11px]">{TEMPLATE_WAIT_NOTE}</p>
      {error ? <p className="text-destructive px-1 pt-1 text-[11px]">{error}</p> : null}
    </div>
  );
}

/** Namunada chizilgan haqiqiy titul + 3 eskiz — oddiy kartalar bilan bir xil ko'rinish. */
export function CustomPreview({ tpl, themeId, mainOnly = false }: { tpl: CustomTemplateLite; themeId: string; mainOnly?: boolean }) {
  const deck = useMemo(() => sampleDeck("lecture"), []);
  const theme = useMemo(() => getSlideTheme(themeId as never), [themeId]);
  const bodyType = useMemo(() => bodyRules({ planItems: 5, textVolume: "standart" }, "lecture"), []);
  const render = (s: SlideModel, i: number) => (
    <SlideCanvas slide={s} theme={theme} visual="academic" audience="auto" templateId="lecture" bodyType={bodyType} custom={tpl} index={i} total={deck.length} />
  );
  return (
    <>
      <Thumb scaleHint={0.235}>{render(deck[0], 0)}</Thumb>
      {mainOnly ? null : (
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {GALLERY_SLIDES.slice(1).map((i) => (
          <Thumb key={i} scaleHint={0.075} small>
            {render(deck[i], i)}
          </Thumb>
        ))}
      </div>
      )}
    </>
  );
}
