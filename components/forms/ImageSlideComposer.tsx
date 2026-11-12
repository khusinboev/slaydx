"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { priceFor } from "@/lib/tools";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { getClientMediaPricing } from "@/lib/media/studio-pricing";
import {
  DEFAULT_IMAGE_SLIDE_AUDIENCE,
  DEFAULT_IMAGE_SLIDE_MODEL,
  DEFAULT_IMAGE_SLIDE_STYLE,
  IMAGE_SLIDE_AUDIENCES,
  IMAGE_SLIDE_DEFAULT,
  IMAGE_SLIDE_MAX,
  IMAGE_SLIDE_MIN,
  IMAGE_SLIDE_MODELS,
  IMAGE_SLIDE_STYLES,
  imageSlideCount,
  imageSlideModelOf,
  imageSlidePrice,
  imageSlideStyleOf,
  type ImageSlideModelId,
  type ImageSlideStyleId,
} from "@/lib/generation/image-slide/models";
import { AuthorRows, ClearFormButton, Field, LimitedTextarea, RangeRow, SettingsDetails, SourceFileRow, TopicRow, type SourceFileValue } from "./shared";
import { Card, Row, Segmented, SelectField } from "./compact";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";
import { SlideKindSwitch } from "./SlideKindSwitch";
import { loadMediaCatalog, STUDIO_IMAGE_PURPOSE } from "@/components/studio/studio-api";

/**
 * AI SLAYD (docs/ai-slide/SPEC.md): every slide is one picture drawn by the chosen Gemini image model.
 *
 * The price is cost × markup × rate per slide (`imageSlidePrice`), so the form needs the server's pricing block: it
 * loads the media catalog once (`setClientMediaPricing`), and the submit waits for it — a guessed rate would only
 * meet a 409 «price changed».
 */

const TOPIC_LIMIT = 300;
const EXTRA_LIMIT = 1500;
const LANGUAGE_OPTIONS = TARGET_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));
const AUTHOR_IDS = ["author", "organization", "subject"] as const;

type Ui = {
  topic: string;
  language: string;
  slideCount: number;
  imageModel: ImageSlideModelId;
  slideStyle: ImageSlideStyleId;
  audience: string;
  author: string;
  organization: string;
  subject: string;
  extra: string;
  source: SourceFileValue;
};

function emptyUi(profile: UserProfile): Ui {
  return {
    topic: "",
    language: "uz",
    slideCount: IMAGE_SLIDE_DEFAULT,
    imageModel: DEFAULT_IMAGE_SLIDE_MODEL,
    slideStyle: DEFAULT_IMAGE_SLIDE_STYLE,
    audience: DEFAULT_IMAGE_SLIDE_AUDIENCE,
    author: profile.author ?? "",
    organization: profile.university ?? "",
    subject: profile.subject ?? "",
    extra: "",
    source: { fileName: "", sourceText: "" },
  };
}

export function toImageSlideValues(ui: Ui): FormValues {
  return {
    topic: ui.topic,
    language: ui.language,
    slideCount: ui.slideCount,
    imageModel: ui.imageModel,
    slideStyle: ui.slideStyle,
    audience: ui.audience,
    author: ui.author,
    organization: ui.organization,
    subject: ui.subject,
    extra: ui.extra,
    ...(ui.source.sourceText ? { sourceText: ui.source.sourceText, fileName: ui.source.fileName } : {}),
  };
}

function uiFromValues(values: FormValues, base: Ui): Ui {
  const str = (k: string, d: string) => (typeof values[k] === "string" ? String(values[k]) : d);
  return {
    ...base,
    topic: str("topic", base.topic),
    language: str("language", base.language),
    slideCount: imageSlideCount(values),
    imageModel: imageSlideModelOf(values).id,
    slideStyle: imageSlideStyleOf(values).id,
    audience: IMAGE_SLIDE_AUDIENCES.some((a) => a.id === values.audience) ? String(values.audience) : base.audience,
    author: str("author", base.author),
    organization: str("organization", base.organization),
    subject: str("subject", base.subject),
    extra: str("extra", base.extra),
  };
}

const som = (n: number) => `${n.toLocaleString("uz-UZ").replace(/,/g, " ")} so‘m`;

export function ImageSlideComposer({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(() => emptyUi(profile));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [pricingReady, setPricingReady] = useState(() => getClientMediaPricing() !== null);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  // The server's pricing block (rate + markup): the price on the button is the price charged.
  useEffect(() => {
    let alive = true;
    loadMediaCatalog(STUDIO_IMAGE_PURPOSE)
      .then(() => alive && setPricingReady(true))
      .catch(() => alive && setError("Narxni yuklab bo‘lmadi. Sahifani yangilang."));
    return () => {
      alive = false;
    };
  }, []);

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s));
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    const { source: _source, ...rest } = ui;
    void _source;
    save(toImageSlideValues({ ...rest, source: { fileName: "", sourceText: "" } }));
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(key: K, v: Ui[K]) => setUi((s) => ({ ...s, [key]: v }));
  const values = toImageSlideValues(ui);
  const pricing = getClientMediaPricing();
  const price = pricingReady ? priceFor(tool, values) : undefined;
  const perSlide = (id: ImageSlideModelId) =>
    pricing ? imageSlidePrice({ ...values, imageModel: id, slideCount: IMAGE_SLIDE_MAX }, pricing) / IMAGE_SLIDE_MAX : null;
  const style = imageSlideStyleOf(values);

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi(profile));
  });

  async function submit() {
    setError(null);
    if (!ui.topic.trim()) {
      setError("Mavzuni kiriting");
      return;
    }
    if (!pricingReady) {
      setError("Narx hali yuklanmadi — bir lahza kuting");
      return;
    }
    if (sourceBusy) {
      setError("Fayl hali o‘qilmoqda — bir lahza kuting");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, toImageSlideValues(ui));
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  const model = imageSlideModelOf(values);
  const summary = [
    IMAGE_SLIDE_AUDIENCES.find((a) => a.id === ui.audience)?.label ?? "",
    ui.author ? "muallif bor" : "",
    ui.source.sourceText ? "fayl asosida" : "",
    ui.extra ? "qo‘shimcha istak bor" : "",
  ];

  return (
    <ToolChrome title="Pro slayd" submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <SlideKindSwitch current="ai" />
      <Card title="Mavzu">
        <TopicRow value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} limit={TOPIC_LIMIT} />
        <Row label="Til">
          <Field id="language">
            <SelectField ariaLabel="Taqdimot tili" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v)} />
          </Field>
        </Row>
      </Card>

      <Card title="Slaydlar">
        <RangeRow
          label="Slaydlar soni"
          id="slideCount"
          value={ui.slideCount}
          min={IMAGE_SLIDE_MIN}
          max={IMAGE_SLIDE_MAX}
          onChange={(v) => set("slideCount", v)}
          format={(v) => `${v} slayd`}
          {...(price !== undefined ? { price } : {})}
          rule="Har slayd alohida chiziladi — narx slaydlar soniga qarab"
        />
        <Row label="Rasm modeli" wide>
          <Field id="imageModel">
            <div role="radiogroup" aria-label="Rasm modeli" className="grid gap-2 sm:grid-cols-2">
              {IMAGE_SLIDE_MODELS.map((m) => {
                const on = m.id === ui.imageModel;
                const each = perSlide(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-model={m.id}
                    onClick={() => set("imageModel", m.id)}
                    className={`rounded-[12px] border px-3 py-2.5 text-left transition-colors ${on ? "border-accent bg-accent/10" : "border-border hover:bg-muted/60"}`}
                  >
                    <span className="block text-[14.5px] font-semibold">{m.label}</span>
                    <span className="text-muted-foreground block text-[12.5px] leading-snug">{m.hint}</span>
                    <span className="mt-1 block text-[12.5px] font-medium tabular-nums">{each ? `≈ ${som(Math.ceil(each / 100) * 100)} / slayd` : "…"}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </Row>
        <Row label="Uslub" hint={style.hint} wide>
          <Field id="slideStyle">
            <SelectField
              ariaLabel="Slayd uslubi"
              options={IMAGE_SLIDE_STYLES.map((s) => ({ value: s.id, label: s.label }))}
              value={ui.slideStyle}
              onChange={(v) => set("slideStyle", v as ImageSlideStyleId)}
            />
          </Field>
          <p className="text-muted-foreground mt-1 text-[13px]">{style.hint}</p>
        </Row>
        <Row label="Auditoriya">
          <Field id="audience">
            <Segmented ariaLabel="Auditoriya" options={IMAGE_SLIDE_AUDIENCES.map((a) => ({ value: a.id, label: a.label }))} value={ui.audience} onChange={(v) => set("audience", v)} />
          </Field>
        </Row>
      </Card>

      <SettingsDetails title="Sozlamalar" summary={summary} open={settingsOpen} onToggle={setSettingsOpen}>
        <AuthorRows ids={AUTHOR_IDS} values={values} set={(id, v) => set(id as "author" | "organization" | "subject", v)} />
        <SourceFileRow value={ui.source} onChange={(v) => set("source", v)} onBusyChange={setSourceBusy} label="Manba fayl" />
        <Row label="Qo‘shimcha istak" hint="Nimalarga urg‘u berilsin, qaysi formula yoki misollar bo‘lsin" wide>
          <Field id="extra">
            <LimitedTextarea
              value={ui.extra}
              onChange={(v) => set("extra", v)}
              limit={EXTRA_LIMIT}
              rows={3}
              ariaLabel="Qo‘shimcha istak"
              placeholder="Masalan: har bir kislotaga formula va kundalik hayotdan misol qo‘shilsin."
            />
          </Field>
        </Row>
        <p className="text-muted-foreground text-[13px]">
          {model.label}: matn rasm ichida chiziladi, shuning uchun slaydlarni keyin tahrirlab bo‘lmaydi. Chizilmagan slayd uchun pul qaytariladi.
        </p>
        <div className="mt-2">
          <ClearFormButton armed={clearConfirm.armed} onClick={clearConfirm.trigger} />
        </div>
      </SettingsDetails>
    </ToolChrome>
  );
}
