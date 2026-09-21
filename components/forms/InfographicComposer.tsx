"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import type { DocMeta } from "@/lib/generation/types";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { priceFor } from "@/lib/tools";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { INFOGRAPHIC_LIMITS, INFOGRAPHIC_SIZES, PALETTES, type InfographicSize, type InfographicTypeId, type PaletteId } from "@/lib/generation/infographic/types";
import { infographicDefaultTypeId, infographicTypes, infographicTypeOf, normalizeBlockCountFor } from "@/lib/generation/infographic/registry";
import { infographicInputFromValues, encodeInfographicValues, type InfographicInput } from "@/lib/generation/infographic/input";
import { SettingsDetails, Field, TopicRow, LimitedTextarea, ColorDots, ClearFormButton } from "./shared";
import { Card, Row, Segmented, SelectField } from "./compact";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * INFOGRAFIKA (Formalar 3 / AUDIT-24, WP-D2b) — bir betlik ta'lim plakati.
 *
 * `infographicInputFromValues`/`encodeInfographicValues` bitta manba
 * (`MediaComposer`/`EssayComposer` naqshi): forma holati DVIGATEL bilan
 * bir qoidadan normallashadi — tur almashsa blok soni SHU YERDA emas,
 * `normalizeBlockCountFor` orqali reyestr chegarasiga tushadi (masalan
 * `process` turida 8 blok yo'q — 6 ga qisqaradi).
 *
 * Reyestr shartnomasi: `lib/generation/infographic-params.ts` dagi HAR
 * `INFOGRAPHIC_PARAMS.id` shu yerda `data-field={id}` bilan chizilgan
 * bo'lishi SHART (`tests/ui/infographic-composer.test.mts` qamrov
 * testi) — «bezak maydon yo'q». `sourceText` reyestrda YO'Q: infografika
 * fayl/manba rejimini bilmaydi (`tool.modes` yo'q), shuning uchun
 * formada ham ko'rinmaydi.
 *
 * NARX O'ZGARMAYDI (mahsulot egasi qarori 6): tekis 2 000 — tur, blok
 * soni, palitra va o'lcham `priceFor`ga ta'sir qilmaydi.
 */

const FAKE_META = {} as unknown as DocMeta;

type Ui = {
  topic: string;
  infographicType: InfographicTypeId;
  blockCount: number;
  palette: PaletteId;
  size: InfographicSize;
  language: string;
  extra: string;
};

const LANGUAGE_OPTIONS = TARGET_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));
const SIZE_OPTIONS = INFOGRAPHIC_SIZES.map((s) => ({ value: s, label: `${s} (portret)` }));
const PALETTE_OPTIONS = PALETTES.map((p) => ({ id: p.id, hex: p.dominant, label: p.label.uz }));

function emptyUi(): Ui {
  const type = infographicTypeOf(infographicDefaultTypeId());
  return {
    topic: "",
    infographicType: type.id,
    blockCount: type.limits.blocksDefault,
    palette: PALETTES[0]!.id,
    size: "A4",
    language: "uz",
    extra: "",
  };
}

/** Qoralama/normallashtirish yo'li — SERVER funksiyasidan (`infographicInputFromValues`) o'tadi. */
function uiFromValues(values: FormValues, base: Ui): Ui {
  const input = infographicInputFromValues(FAKE_META, values);
  return {
    ...base,
    topic: input.topic,
    infographicType: input.type,
    blockCount: input.blockCount,
    palette: input.palette,
    size: input.size,
    language: input.language,
    extra: input.extra,
  };
}

/** Forma holati → yuboriladigan `FormValues` — `encodeInfographicValues` bitta manba. */
function toValues(ui: Ui): FormValues {
  const input: InfographicInput = {
    type: ui.infographicType,
    topic: ui.topic,
    blockCount: ui.blockCount,
    palette: ui.palette,
    size: ui.size,
    language: ui.language,
    extra: ui.extra,
    sourceText: "",
  };
  return encodeInfographicValues(input);
}

export function InfographicComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(emptyUi);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s));
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(toValues(ui));
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(key: K, v: Ui[K]) => setUi((s) => ({ ...s, [key]: v }));

  function onTypeChange(id: string) {
    const typeId = id as InfographicTypeId;
    setUi((s) => ({ ...s, infographicType: typeId, blockCount: normalizeBlockCountFor(typeId, s.blockCount) }));
  }

  const type = infographicTypeOf(ui.infographicType);
  const blockOptions = INFOGRAPHIC_LIMITS.blockCounts.filter((n) => n >= type.limits.blocks[0] && n <= type.limits.blocks[1]);
  const palette = PALETTES.find((p) => p.id === ui.palette) ?? PALETTES[0]!;
  const values = toValues(ui);
  const price = priceFor(tool, values);

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi());
  });

  async function submit() {
    setError(null);
    if (!ui.topic.trim()) {
      setError("Mavzuni kiriting");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, toValues(ui));
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  const summary = [`${ui.blockCount} blok`, palette.label.uz, ui.size, ui.extra ? "qo‘shimcha ma'lumot bor" : ""];

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Mavzu">
        <TopicRow value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} limit={INFOGRAPHIC_LIMITS.topicChars} />
        <Row label="Til">
          <Field id="language">
            <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v)} />
          </Field>
        </Row>
      </Card>

      <Card title="Plakat">
        <Row label="Tur" hint={type.hint} wide>
          <Field id="infographicType">
            <SelectField ariaLabel="Plakat turi" options={infographicTypes().map((t) => ({ value: t.id, label: t.label.uz }))} value={ui.infographicType} onChange={onTypeChange} />
          </Field>
          <p className="text-muted-foreground mt-1 text-[11px]">{type.hint}</p>
        </Row>
        <Row label="Blok soni">
          <Field id="blockCount">
            <Segmented
              ariaLabel="Blok soni"
              options={blockOptions.map((n) => ({ value: String(n), label: `${n} blok` }))}
              value={String(ui.blockCount)}
              onChange={(v) => set("blockCount", Number(v))}
            />
          </Field>
        </Row>
        <Row label="Palitra" wide>
          <Field id="palette">
            <ColorDots options={PALETTE_OPTIONS} value={ui.palette} onChange={(v) => set("palette", v as PaletteId)} ariaLabel="Rang palitrasi" />
          </Field>
        </Row>
        <Row label="O‘lcham">
          <Field id="size">
            <Segmented ariaLabel="O‘lcham" options={SIZE_OPTIONS} value={ui.size} onChange={(v) => set("size", v as InfographicSize)} />
          </Field>
        </Row>
      </Card>

      <SettingsDetails title="Sozlamalar" summary={summary} open={settingsOpen} onToggle={setSettingsOpen}>
        <Row label="Qo‘shimcha ma'lumot" hint="Statistika/manba FAQAT shu yerdan (yoki mavzudan) olinadi — AI raqam o‘ylab topmaydi" wide>
          <Field id="extra">
            <LimitedTextarea
              value={ui.extra}
              onChange={(v) => set("extra", v)}
              limit={INFOGRAPHIC_LIMITS.extraChars}
              rows={3}
              ariaLabel="Qo‘shimcha ma'lumot"
              placeholder="Yer yuzasining 71% i suv bilan qoplangan (manba: darslik, 6-sinf)."
            />
          </Field>
        </Row>
        <div className="mt-2">
          <ClearFormButton armed={clearConfirm.armed} onClick={clearConfirm.trigger} />
        </div>
      </SettingsDetails>
    </ToolChrome>
  );
}
