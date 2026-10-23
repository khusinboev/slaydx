"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { priceFor } from "@/lib/tools";
import {
  PORTRAIT_BACKGROUNDS,
  PORTRAIT_GOWNS,
  PORTRAIT_SASHES,
  PORTRAIT_VARIANTS,
  encodePortraitValues,
  portraitInputFromValues,
  type PortraitInput,
} from "@/lib/generation/portrait/registry";
import { ColorDots, Field } from "./shared";
import { Card, Row, Segmented } from "./compact";
import { PhotoField } from "./PhotoField";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * BITIRUVCHI PORTRETI (program-17 item 14) -- selfie -> xalat va shapkali portret.
 *
 * Registry contract (`lib/generation/portrait-params.ts`): every `PORTRAIT_PARAMS.id` is drawn here once
 * with `data-field={id}` (`tests/ui/portrait-composer.test.mts`) -- no decorative field.
 *
 * Price comes ONLY from `priceFor` (per variant). The selfie id is kept OUT of the form draft: the server
 * deletes the selfie after a successful job, so a restored draft must never point at a removed photo.
 */

const GOWN_OPTIONS = PORTRAIT_GOWNS.map((g) => ({ id: g.id, hex: g.hex, label: g.label }));
const SASH_OPTIONS = PORTRAIT_SASHES.filter((s) => s.id !== "none").map((s) => ({ id: s.id, hex: s.hex, label: s.label }));

function emptyInput(): PortraitInput {
  return portraitInputFromValues({});
}

export function PortraitComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [input, setInput] = useState<PortraitInput>(emptyInput);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { draft, ready, save, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setInput((s) => ({ ...portraitInputFromValues(draft), photoAssetId: s.photoAssetId }));
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save({ ...encodePortraitValues({ ...input, photoAssetId: "" }) });
  }, [input, restored, save]);

  const set = <K extends keyof PortraitInput>(key: K, v: PortraitInput[K]) => setInput((s) => ({ ...s, [key]: v }));

  const values: FormValues = encodePortraitValues(input);
  const price = priceFor(tool, values);

  async function submit() {
    setError(null);
    if (!input.photoAssetId) {
      setError("Avval suratingizni yuklang");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, encodePortraitValues(input));
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Sizning suratingiz">
        <Row label="Surat" hint="Yuzingiz aniq ko‘rinadigan, yolg‘iz o‘zingiz tushgan, yorug‘ surat. Ko‘zoynak va soch yangi portretda ham aynan shunday qoladi." wide>
          <Field id="photoAssetId">
            <PhotoField
              assetId={input.photoAssetId}
              originalAssetId=""
              shape="square"
              keepOriginal={false}
              alt="Sizning suratingiz"
              hint="Yuzingiz markazda bo‘lsin · PNG yoki JPEG, 5 MB gacha"
              onChange={(v) => set("photoAssetId", v.assetId)}
            />
          </Field>
          <p className="text-muted-foreground mt-1 text-[13px]">Surat portret tayyor bo‘lgach serverdan o‘chiriladi.</p>
        </Row>
      </Card>

      <Card title="Portret">
        <Row label="Xalat rangi" wide>
          <Field id="gown">
            <ColorDots options={GOWN_OPTIONS} value={input.gown} onChange={(v) => set("gown", v as PortraitInput["gown"])} ariaLabel="Xalat rangi" />
          </Field>
        </Row>
        <Row label="Fon" wide>
          <Field id="background">
            <Segmented
              ariaLabel="Fon"
              options={PORTRAIT_BACKGROUNDS.map((b) => ({ value: b.id, label: b.label }))}
              value={input.background}
              onChange={(v) => set("background", v as PortraitInput["background"])}
            />
          </Field>
        </Row>
        <Row label="Stola" hint="Yelkadan tushadigan bitiruv lentasi — ixtiyoriy" wide>
          <Field id="sash">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                ariaLabel="Stola"
                options={[{ value: "none", label: "Yo‘q" }]}
                value={input.sash === "none" ? "none" : ""}
                onChange={() => set("sash", "none")}
              />
              <ColorDots options={SASH_OPTIONS} value={input.sash} onChange={(v) => set("sash", v as PortraitInput["sash"])} ariaLabel="Stola rangi" />
            </div>
          </Field>
        </Row>
        <Row label="Variantlar" hint="Har variant alohida hisoblanadi">
          <Field id="variants">
            <Segmented
              ariaLabel="Variantlar soni"
              options={PORTRAIT_VARIANTS.map((n) => ({ value: String(n), label: `${n} ta` }))}
              value={String(input.variants)}
              onChange={(v) => set("variants", Number(v) === 2 ? 2 : 1)}
            />
          </Field>
        </Row>
      </Card>
    </ToolChrome>
  );
}
