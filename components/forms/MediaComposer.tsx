"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import type { DocMeta } from "@/lib/generation/types";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { priceFor } from "@/lib/tools";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { AUDIO_LIMITS, audioWordBudget, type AudioKind } from "@/lib/generation/audio/types";
import { audioDefaultTypeId, audioKindOf, audioTypeOf, audioTypesOf, type GreetingTypeSpec } from "@/lib/generation/audio/registry";
import { audioInputFromValues, encodeAudioValues, type AudioInput, type AudioMode } from "@/lib/generation/audio/input";
import { SettingsDetails, Field, TopicRow, LimitedTextarea, SourceFileRow, RangeRow, ClearFormButton, type SourceFileValue } from "./shared";
import { Card, Row, Segmented, SelectField } from "./compact";
import { TextInput } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * MEDIA (Formalar 3 / AUDIT-24, WP-D2a) — podkast va tabriknoma
 * BITTA composerga tushadi: ikkalasi ham `doc.audio` modeliga yoziladi
 * (`audio/types.ts` izohi — «hujjat MATNI aytiladigan matn»), farq
 * faqat `kind` (`audioKindOf(tool.id)`) va reyestr TURI (janr) bilan.
 *
 * `audioInputFromValues`/`encodeAudioValues` (`audio/input.ts`) —
 * FormValues bilan forma holati orasidagi YAGONA ko'prik (`EssayComposer`
 * naqshi): qoralama tiklanganda ham, `onType` almashganda ham forma
 * DVIGATEL bilan bitta qoidadan normallashadi. `FAKE_META` — `TeacherComposer`
 * naqshi: input funksiyasi `DocMeta`ni faqat FALLBACK sifatida o'qiydi,
 * composer esa har doim TO'LIQ `values` yuboradi, shuning uchun bo'sh
 * obyekt xavfsiz.
 *
 * Reyestr shartnomasi: `lib/generation/audio-params.ts` dagi HAR
 * `AUDIO_PARAMS.id` (o'z `kinds`i bo'yicha) shu yerda `data-field={id}`
 * bilan chizilgan bo'lishi SHART (`tests/ui/media-composer.test.mts`
 * qamrov testi) — «bezak maydon yo'q».
 *
 * NARX O'ZGARMAYDI (mahsulot egasi qarori 6): ikkala vosita ham tekis
 * 4 000 — tur ham, davomiylik ham `priceFor` ga ta'sir qilmaydi. Shuning
 * uchun `RangeRow`ga uzatilgan `price` HAR doim bir xil qiymat, faqat
 * KO'RSATILADI.
 */

const FAKE_META = {} as unknown as DocMeta;

type Ui = {
  mode: AudioMode;
  topic: string;
  sourceText: string;
  fileName: string;
  podcastType: string;
  recipient: string;
  relation: string;
  relationCustom: boolean;
  occasion: string;
  durationMin: number;
  language: string;
  extra: string;
};

const LANGUAGE_OPTIONS = TARGET_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));

const MODE_LABEL: Record<AudioMode, string> = { topic: "Mavzu", text: "Matn", file: "Fayl" };

const RELATION_PRESETS = [
  { value: "ustozim", label: "Ustozim" },
  { value: "do'stim", label: "Do'stim" },
  { value: "hamkasbim", label: "Hamkasbim" },
  { value: "rahbarim", label: "Rahbarim" },
  { value: "oila a'zom", label: "Oila a'zom" },
];

function emptyUi(kind: AudioKind): Ui {
  return {
    mode: "topic",
    topic: "",
    sourceText: "",
    fileName: "",
    podcastType: audioDefaultTypeId("podcast"),
    recipient: "",
    relation: "",
    relationCustom: false,
    occasion: audioDefaultTypeId("greeting"),
    durationMin: kind === "podcast" ? AUDIO_LIMITS.podcastMinutesDefault : AUDIO_LIMITS.greetingMinutesDefault,
    language: "uz",
    extra: "",
  };
}

/** Qoralama/normallashtirish yo'li — SERVER funksiyasidan (`audioInputFromValues`) o'tadi. */
function uiFromValues(values: FormValues, base: Ui, kind: AudioKind): Ui {
  const input = audioInputFromValues(kind, FAKE_META, values);
  const relationKnown = RELATION_PRESETS.some((p) => p.value === input.relation);
  return {
    ...base,
    mode: input.mode,
    topic: input.topic,
    sourceText: input.sourceText,
    podcastType: kind === "podcast" ? input.type : base.podcastType,
    occasion: kind === "greeting" ? input.type : base.occasion,
    recipient: input.recipient,
    relation: input.relation,
    relationCustom: Boolean(input.relation) && !relationKnown,
    durationMin: input.minutes,
    language: input.language,
    extra: input.extra,
    fileName: typeof values.fileName === "string" ? values.fileName : base.fileName,
  };
}

/** Forma holati → yuboriladigan `FormValues` — `encodeAudioValues` bitta manba. */
function toValues(ui: Ui, kind: AudioKind): FormValues {
  const typeId = kind === "podcast" ? ui.podcastType : ui.occasion;
  const spec = audioTypeOf(kind, typeId);
  const input: AudioInput = {
    kind,
    type: spec.id,
    language: ui.language,
    minutes: ui.durationMin,
    wordBudget: audioWordBudget(ui.durationMin),
    speakers: spec.speakers,
    mode: kind === "podcast" ? ui.mode : "topic",
    topic: ui.topic,
    sourceText: ui.sourceText,
    recipient: ui.recipient,
    relation: ui.relation,
    occasion: kind === "greeting" ? (spec as GreetingTypeSpec).occasion : "",
    extra: ui.extra,
  };
  const out = encodeAudioValues(input);
  if (ui.fileName) out.fileName = ui.fileName;
  return out;
}

export function MediaComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const kind: AudioKind = audioKindOf(tool.id) ?? "podcast";
  const [ui, setUi] = useState<Ui>(() => emptyUi(kind));
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s, kind));
    // `kind` — vosita (`tool.id`) bilan bir marta hisoblanadi, mount paytida yetarli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(toValues(ui, kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(key: K, v: Ui[K]) => setUi((s) => ({ ...s, [key]: v }));

  const podcastType = audioTypeOf("podcast", ui.podcastType);
  const occasionType = audioTypeOf("greeting", ui.occasion) as GreetingTypeSpec;
  const values = toValues(ui, kind);
  const price = priceFor(tool, values);
  const durationOptions = kind === "podcast" ? AUDIO_LIMITS.podcastMinutes : AUDIO_LIMITS.greetingMinutes;
  const durationMin = durationOptions[0]!;
  const durationMax = durationOptions[durationOptions.length - 1]!;

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi(kind));
  });

  function onSourceFile(next: SourceFileValue) {
    setUi((s) => ({ ...s, fileName: next.fileName, sourceText: next.sourceText, topic: s.topic.trim() || next.fileName.replace(/\.[^.]+$/, "") }));
  }

  function onRelationPreset(v: string) {
    if (v === "custom") {
      setUi((s) => ({ ...s, relationCustom: true }));
      return;
    }
    setUi((s) => ({ ...s, relation: v, relationCustom: false }));
  }

  async function submit() {
    setError(null);
    if (fileBusy) {
      setError("Fayl hali o‘qilmoqda");
      return;
    }
    if (kind === "podcast") {
      if (ui.mode === "topic" && !ui.topic.trim()) {
        setError("Mavzuni kiriting");
        return;
      }
      if (ui.mode === "text" && !ui.sourceText.trim()) {
        setError("Manba matnini kiriting");
        return;
      }
      if (ui.mode === "file" && !ui.sourceText.trim()) {
        setError("Avval fayl tanlang — matn olingandan keyin yaratish boshlanadi.");
        return;
      }
    } else if (!ui.recipient.trim()) {
      setError("«Kimga?» maydonini to‘ldiring");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, toValues(ui, kind));
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  const summary =
    kind === "podcast"
      ? [podcastType.label.uz, `${ui.durationMin} daqiqa`, ui.extra ? "qo‘shimcha talab bor" : ""]
      : [occasionType.label.uz, ui.relation ? ui.relation : "", `${ui.durationMin} daqiqa`, ui.extra ? "qo‘shimcha talab bor" : ""];

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title={kind === "podcast" ? "Mavzu va rejim" : "Kimga va sabab"}>
        {kind === "podcast" ? (
          <>
            <Row label="Rejim" wide>
              <Field id="mode">
                <Segmented
                  ariaLabel="Rejim"
                  options={(tool.modes ?? []).map((m) => ({ value: m.id, label: MODE_LABEL[m.id as AudioMode] ?? m.title }))}
                  value={ui.mode}
                  onChange={(v) => set("mode", v as AudioMode)}
                />
              </Field>
              <p className="text-muted-foreground mt-1 text-[11px]">{tool.modes?.find((m) => m.id === ui.mode)?.hint}</p>
            </Row>
            {ui.mode === "topic" ? (
              <TopicRow value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} limit={AUDIO_LIMITS.topicChars} />
            ) : ui.mode === "text" ? (
              <Row label="Manba matni" wide>
                <Field id="sourceText">
                  <LimitedTextarea
                    value={ui.sourceText}
                    onChange={(v) => set("sourceText", v)}
                    limit={AUDIO_LIMITS.sourceTextChars}
                    rows={5}
                    ariaLabel="Manba matni"
                    placeholder="Podkast tuziladigan tayyor matnni shu yerga qo‘ying"
                  />
                </Field>
              </Row>
            ) : (
              <SourceFileRow value={{ fileName: ui.fileName, sourceText: ui.sourceText }} onChange={onSourceFile} onBusyChange={setFileBusy} />
            )}
          </>
        ) : (
          <>
            <Row label="Kimga?" wide>
              <Field id="recipient">
                <TextInput value={ui.recipient} onChange={(v) => set("recipient", v.slice(0, AUDIO_LIMITS.recipientChars))} placeholder="Dilnoza opa" />
              </Field>
            </Row>
            <Row label="Kim bo‘ladi?" hint="Murojaat ohangi shunga qarab tanlanadi" wide>
              <Field id="relation">
                <div className="space-y-1.5">
                  <Segmented
                    ariaLabel="Kim bo‘ladi?"
                    options={[...RELATION_PRESETS, { value: "custom", label: "Boshqa" }]}
                    value={ui.relationCustom ? "custom" : ui.relation}
                    onChange={onRelationPreset}
                  />
                  {ui.relationCustom ? (
                    <TextInput value={ui.relation} onChange={(v) => set("relation", v.slice(0, AUDIO_LIMITS.relationChars))} placeholder="masalan: qo‘shnim" />
                  ) : null}
                </div>
              </Field>
            </Row>
            <Row label="Sabab" wide>
              <Field id="occasion">
                <SelectField ariaLabel="Sabab" options={audioTypesOf("greeting").map((t) => ({ value: t.id, label: t.label.uz }))} value={ui.occasion} onChange={(v) => set("occasion", v)} />
              </Field>
              <p className="text-muted-foreground mt-1 text-[11px]">{occasionType.hint}</p>
            </Row>
          </>
        )}
      </Card>

      <Card title="Audio">
        {kind === "podcast" ? (
          <Row label="Tur" hint={podcastType.hint} wide>
            <Field id="podcastType">
              <Segmented
                ariaLabel="Podkast turi"
                options={audioTypesOf("podcast").map((t) => ({ value: t.id, label: t.label.uz }))}
                value={ui.podcastType}
                onChange={(v) => set("podcastType", v)}
              />
            </Field>
          </Row>
        ) : null}
        <RangeRow
          label="Davomiyligi"
          id="durationMin"
          value={ui.durationMin}
          min={durationMin}
          max={durationMax}
          step={1}
          onChange={(v) => set("durationMin", v)}
          format={(v) => `${v} daqiqa`}
          price={price}
          rule="Narx davomiylikka bog‘liq emas — istalgan daqiqa bir xil narxda."
        />
        <Row label="Til">
          <Field id="language">
            <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v)} />
          </Field>
        </Row>
      </Card>

      <SettingsDetails title="Sozlamalar" summary={summary} open={settingsOpen} onToggle={setSettingsOpen}>
        <Row label="Qo‘shimcha" hint="Modelga alohida talab" wide>
          <Field id="extra">
            <LimitedTextarea value={ui.extra} onChange={(v) => set("extra", v)} limit={AUDIO_LIMITS.extraChars} rows={3} ariaLabel="Qo‘shimcha" placeholder="Ixtiyoriy" />
          </Field>
        </Row>
        <div className="mt-2">
          <ClearFormButton armed={clearConfirm.armed} onClick={clearConfirm.trigger} />
        </div>
      </SettingsDetails>
      {fileBusy ? <p className="text-muted-foreground -mt-2 mb-4 text-[11px]">Fayl o‘qilmoqda…</p> : null}
    </ToolChrome>
  );
}
