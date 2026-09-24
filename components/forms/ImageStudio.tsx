"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import type { FormValues, ToolConfig } from "@/lib/types";
import { formatTanga, IMAGE_PROMPT_MIN, priceFor } from "@/lib/tools";
import { IMAGE_RATIOS, IMAGE_STYLES } from "@/lib/generation/image-studio-options";
import { IMAGE_PROMPT_LIMIT } from "@/lib/generation/image-params";
import { Card, Row, Segmented, SelectField } from "./compact";
import { ClearFormButton, Field, LimitedTextarea, SettingsDetails } from "./shared";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";

/*
 * Rasm formasi (WP-E, Formalar 3) — ilgari `ToolChrome`SIZ, o'zining
 * chizg'ichi bilan edi (1 359 px, etalon nomuvofiqligi — qolgan 21 forma
 * bitta qobiqda). Endi boshqa umumiy formalar bilan bir xil naqsh: kartalar
 * → sticky narx (`ToolChrome`), har parametr `data-field` bilan
 * (`lib/generation/image-params.ts` reyestri — «bezak maydon yo'q»
 * `tests/image-params.test.mts` bilan qulflangan).
 *
 * Har biri gazetteer (`uz-gazetteer.ts`) tan oladigan kalit so'zni o'z
 * ichiga oladi — shunda foydalanuvchi bosgan zahoti aniq vizual
 * tafsilotlar bilan boyitilgan, haqiqiyroq rasm ko'radi.
 */
const EXAMPLES = [
  "Registon maydoni erta tongda, tuman, keng kadr",
  "Buxorodagi Poi Kalon minorasi kechqurun, yorug‘lik bilan",
  "Laganda dam olayotgan issiq palov, bug‘i chiqib turibdi",
  "Tandirdan yangi olingan non, uy sharoiti, tabiiy yorug‘lik",
  "Atlas mato bozori, rang-barang rulonlar, quyosh nuri",
  "Xivadagi Ichan qal'a devorlari, oqshom, sokin ko‘cha",
  "Amir Temur haykali, qish kuni, qor yog‘moqda",
  "Toshkent kechasi, yomg‘irli ko‘cha, neon yorug‘lik, kino kadri",
];

const STYLE_OPTIONS = IMAGE_STYLES.map((st) => ({ value: st.id, label: `${st.name} — ${st.blurb}` }));
const RATIO_OPTIONS = IMAGE_RATIOS.map((r) => ({ value: r.id, label: r.label }));
const COUNT_OPTIONS = [1, 2, 4].map((n) => ({ value: String(n), label: String(n) }));

const INITIAL: FormValues = {
  prompt: "",
  imageStyle: "photo",
  imageRatio: "1:1",
  imageCount: 1,
};

export function ImageStudio({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => ({ ...INITIAL }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, v: string | number) => setValues((s) => ({ ...s, [name]: v }));

  const price = priceFor(tool, values);
  const ratio = IMAGE_RATIOS.find((r) => r.id === values.imageRatio) ?? IMAGE_RATIOS[0];

  const clearConfirm = useConfirmClick(() => setValues({ ...INITIAL }));

  async function submit() {
    setError(null);
    const prompt = String(values.prompt || "").trim();
    // Chegara `lib/tools.ts` da — server ham aynan shuni tekshiradi
    // (`preflightError`). Matn bu yerda aniqroq, qoida esa bitta.
    if (prompt.length < IMAGE_PROMPT_MIN) {
      setError("Nima chizish kerakligini yozing");
      return;
    }
    setLoading(true);
    try {
      const id = await runGeneration(tool, { ...values, topic: prompt.slice(0, 72) });
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Tavsif">
        <Field id="prompt">
          <LimitedTextarea
            value={String(values.prompt ?? "")}
            onChange={(v) => set("prompt", v)}
            limit={IMAGE_PROMPT_LIMIT}
            rows={4}
            ariaLabel="Rasm tavsifi"
            placeholder="Masalan: ertalabki Buxoro ko‘chasi, quyosh nuri, odamlar yo‘q, kino uslubi..."
          />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="text-muted-foreground hover:text-foreground max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11.5px]"
              onClick={() => set("prompt", ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Uslub">
        <Row label="Uslub" hint="Rasmning vizual uslubi — foto, kino kadri, illyustratsiya va h.k.">
          <Field id="imageStyle">
            <SelectField ariaLabel="Uslub" options={STYLE_OPTIONS} value={String(values.imageStyle || "photo")} onChange={(v) => set("imageStyle", v)} />
          </Field>
        </Row>
      </Card>

      <Card
        title="Nisbat va soni"
        aside={
          <span className="font-semibold tabular-nums" data-price>
            {formatTanga(price)}
          </span>
        }
      >
        <Row label="Nisbat" hint={`Chiqish: ${ratio.w}×${ratio.h} px`}>
          <Field id="imageRatio">
            <Segmented ariaLabel="Nisbat" options={RATIO_OPTIONS} value={String(values.imageRatio || "1:1")} onChange={(v) => set("imageRatio", v)} />
          </Field>
        </Row>
        <Row label="Nechta rasm" hint="1 rasm 2 000 · 2 rasm 3 500 · 4 rasm 6 000">
          <Field id="imageCount">
            <Segmented ariaLabel="Nechta rasm" options={COUNT_OPTIONS} value={String(values.imageCount ?? 1)} onChange={(v) => set("imageCount", Number(v))} />
          </Field>
        </Row>
      </Card>

      <SettingsDetails summary={[]}>
        <ClearFormButton armed={clearConfirm.armed} onClick={clearConfirm.trigger} />
      </SettingsDetails>
    </ToolChrome>
  );
}
