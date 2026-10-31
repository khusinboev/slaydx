"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { priceFor } from "@/lib/tools";
import {
  VIDEO_ASPECTS,
  VIDEO_PROMPT_MAX,
  VIDEO_PROVIDERS,
  encodeVideoValues,
  offeredVideoProviders,
  videoInputFromValues,
  videoProviderById,
  type VideoInput,
} from "@/lib/generation/video/registry";
import { Field, LimitedTextarea } from "./shared";
import { Card, Row, Segmented } from "./compact";
import { PhotoField } from "./PhotoField";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * VIDEO YARATISH (program-17 item 5) -- text (or a start picture) -> a short video made by an AI provider.
 *
 * Registry contract (`lib/generation/video-params.ts`): every `VIDEO_PARAMS.id` is drawn here once with
 * `data-field={id}` (`tests/ui/video-composer.test.mts`) -- no decorative field.
 *
 * Providers: only the ones the server offers (`features.videoProviders`: enabled AND keyed); a single provider hides
 * the selector. The price comes ONLY from `priceFor` (per second, by provider). Bonus so'm cannot pay for video, so
 * `ToolChrome` checks the PAID balance (`paidOnly`). The picture id is kept out of the draft (a stale id must not
 * point at a purged upload).
 */

function emptyInput(): VideoInput {
  return videoInputFromValues({});
}

/*
 * Form state = a `VideoInput` whose settings are normalized on every change, but whose `prompt` is the text EXACTLY AS
 * TYPED. Running the prompt through `videoInputFromValues` per keystroke deleted the trailing space the moment it was
 * typed, so two words could not be separated. The normalized view (`effective`) is what the price, the validation, the
 * draft and the request use.
 */

export function VideoComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const offered = offeredVideoProviders(useAppStore((s) => s.features?.videoProviders));
  const [input, setInput] = useState<VideoInput>(emptyInput);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { draft, ready, save, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setInput((s) => ({ ...videoInputFromValues(draft), imageAssetId: s.imageAssetId }));
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(encodeVideoValues(videoInputFromValues({ ...encodeVideoValues(input), imageAssetId: "" })));
  }, [input, restored, save]);

  // A provider that is no longer offered (key removed, switched off) falls back to the first available one.
  const provider = offered.includes(input.provider) ? input.provider : (offered[0] ?? input.provider);
  const effective: VideoInput = videoInputFromValues({ ...encodeVideoValues(input), provider });
  const spec = videoProviderById(effective.provider);

  const setPrompt = (v: string) => setInput((s) => ({ ...s, prompt: v }));
  const set = <K extends Exclude<keyof VideoInput, "prompt">>(key: K, v: VideoInput[K]) =>
    setInput((s) => ({ ...videoInputFromValues({ ...encodeVideoValues(s), provider: effective.provider, [key]: v }), prompt: s.prompt }));
  const setProvider = (id: string) => setInput((s) => ({ ...videoInputFromValues({ ...encodeVideoValues(s), provider: id }), prompt: s.prompt }));

  const values: FormValues = encodeVideoValues(effective);
  const price = priceFor(tool, values);
  // Kling's image-to-video takes the picture's own proportions: the aspect row would do nothing there.
  const aspectApplies = !(effective.provider === "kling" && effective.imageAssetId);

  async function submit() {
    setError(null);
    if (effective.prompt.length < 5) {
      setError("Videoda nima bo‘lishini yozing");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, encodeVideoValues(effective));
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error} paidOnly>
      <Card title="Video">
        <Row label="Tavsif" hint="Kim, qayerda, nima qiladi, kamera qanday harakatlanadi" wide>
          <Field id="prompt">
            <LimitedTextarea
              value={input.prompt}
              onChange={setPrompt}
              limit={VIDEO_PROMPT_MAX}
              placeholder={tool.topicPlaceholder}
              rows={3}
              ariaLabel="Video tavsifi"
            />
          </Field>
        </Row>
        {offered.length > 1 ? (
          <Row label="Provayder" hint="Narx har soniya uchun, provayderga qarab" wide>
            <Field id="provider">
              <Segmented
                ariaLabel="Provayder"
                options={VIDEO_PROVIDERS.filter((p) => offered.includes(p.id)).map((p) => ({ value: p.id, label: `${p.short} · ${p.soumPerSecond.toLocaleString("uz-UZ")} so‘m/s` }))}
                value={effective.provider}
                onChange={setProvider}
              />
            </Field>
          </Row>
        ) : null}
        <Row label="Davomiyligi">
          <Field id="seconds">
            <Segmented
              ariaLabel="Davomiyligi"
              options={spec.seconds.map((n) => ({ value: String(n), label: `${n} soniya` }))}
              value={String(effective.seconds)}
              onChange={(v) => set("seconds", Number(v))}
            />
          </Field>
        </Row>
        <Row label="Tomonlar nisbati" hint={aspectApplies ? undefined : "Surat bilan boshlanganda nisbat suratdan olinadi"}>
          <Field id="aspect">
            <Segmented
              ariaLabel="Tomonlar nisbati"
              options={VIDEO_ASPECTS.map((a) => ({ value: a, label: a === "16:9" ? "16:9 (keng)" : "9:16 (vertikal)", disabled: !aspectApplies }))}
              value={effective.aspect}
              onChange={(v) => set("aspect", v === "9:16" ? "9:16" : "16:9")}
            />
          </Field>
        </Row>
      </Card>

      <Card title="Boshlang‘ich surat (ixtiyoriy)">
        <Row label="Surat" wide>
          <Field id="imageAssetId">
            <PhotoField
              assetId={effective.imageAssetId}
              originalAssetId=""
              shape="square"
              keepOriginal={false}
              alt="Boshlang‘ich surat"
              hint="PNG yoki JPEG, 5 MB gacha"
              onChange={(v) => set("imageAssetId", v.assetId)}
            />
          </Field>
          <p className="text-muted-foreground mt-1 text-[13px]">Surat berilsa video shu suratdan boshlanadi va u jonlantiriladi.</p>
        </Row>
      </Card>
      <p className="text-muted-foreground mb-4 text-[13px]" data-video-note>
        Video bir necha daqiqada tayyor bo‘ladi — sahifani yopsangiz ham davom etadi. Video faqat to‘langan balans bilan yaratiladi (bonus so‘m ishlamaydi);
        provayder rad etsa yoki tayyorlay olmasa, pul to‘liq qaytariladi.
      </p>
    </ToolChrome>
  );
}
