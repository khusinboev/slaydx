"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { priceFor } from "@/lib/tools";
import { formatSom } from "@/lib/format";
import { WORK_LIMITS } from "@/lib/generation/work/types";
import { KONSPEKT_PAGES } from "@/lib/generation/work/registry";
import { HAND_FIELD_OF, handCapsOf } from "@/lib/generation/work/handwriting";
import { KONSPEKT_HAND_DEFAULTS, konspektInputFromValues, konspektWordsPerPage } from "@/lib/generation/konspekt/input";
import { Card, Row, Segmented } from "./compact";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";
import { Field, LimitedTextarea, SourceFileRow, TopicRow } from "./shared";
import { HandRows, handFormOf, type HandForm } from "./HandRows";

/**
 * Konspekt (lecture notes) form: a topic and/or a source file, the language, the volume tier and the
 * handwriting choices (`HAND_SERVICE_CAPS.konspekt`). One screen, no hidden fields: every registry id
 * (`lib/generation/konspekt/params.ts`) is rendered with `data-field`.
 *
 * Form values ↔ engine input go through `konspektInputFromValues` (the SAME function the engine reads), so
 * the draft restore and the submitted values can never drift from what is written.
 */

const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbek" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

type Ui = {
  topic: string;
  language: string;
  pages: string;
  extra: string;
  fileName: string;
  sourceText: string;
  hand: HandForm;
};

const D = KONSPEKT_HAND_DEFAULTS;
function emptyUi(): Ui {
  return {
    topic: "",
    language: "uz",
    pages: "10-20",
    extra: "",
    fileName: "",
    sourceText: "",
    hand: { ink: D.ink, paper: D.paper, font: D.font, lively: D.lively, headings: "plain", cover: "plain", underline: "on", format: D.format, margin: D.margin, cells: D.cells },
  };
}

function uiFromValues(values: FormValues): Ui {
  const input = konspektInputFromValues(values);
  return { topic: input.topic, language: input.language, pages: input.pages, extra: input.extra, fileName: String(values.fileName ?? ""), sourceText: input.sourceText, hand: { ...handFormOf(input.hand), headings: "plain", cover: "plain", underline: "on" } };
}

function toValues(ui: Ui): FormValues {
  const v: Record<string, unknown> = { topic: ui.topic.trim() || ui.fileName.replace(/\.[^.]+$/, ""), language: ui.language, pages: ui.pages, extra: ui.extra, sourceText: ui.sourceText, fileName: ui.fileName };
  for (const id of handCapsOf("konspekt")!) v[HAND_FIELD_OF[id]] = ui.hand[id];
  return v as FormValues;
}

export function KonspektComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(emptyUi);
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi(uiFromValues(draft));
  }, [ready, draft, restored]);
  useEffect(() => {
    if (restored) save(toValues(ui));
  }, [ui, restored, save]);

  const values = toValues(ui);
  const price = priceFor(tool, values);
  const caps = handCapsOf("konspekt")!;
  const perPage = konspektWordsPerPage(konspektInputFromValues(values).hand, ui.language);
  const set = <K extends keyof Ui>(k: K, v: Ui[K]) => setUi((s) => ({ ...s, [k]: v }));
  const setHand = <K extends keyof HandForm>(k: K, v: HandForm[K]) => setUi((s) => ({ ...s, hand: { ...s.hand, [k]: v } }));

  async function submit() {
    setError(null);
    if (!values.topic) {
      setError("Mavzuni kiriting yoki fayl yuklang");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, values);
      void clear();
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} disabled={fileBusy} onSubmit={submit} error={error}>
      <Card title="Mavzu va manba">
        <TopicRow value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} limit={WORK_LIMITS.topicChars} />
        <SourceFileRow
          value={{ fileName: ui.fileName, sourceText: ui.sourceText }}
          onChange={({ fileName, sourceText }) => setUi((s) => ({ ...s, fileName, sourceText }))}
          onBusyChange={setFileBusy}
          label="Fayl"
          hint="Ma’ruza fayli (PPTX, DOCX, PDF, TXT) — konspekt faqat shu fayldagi ma’lumotga tayanadi"
        />
        <Row label="Til">
          <Field id="language">
            <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v)} />
          </Field>
        </Row>
        <Row label="Hajm" hint={`Daftar sahifasi hisobida; bir sahifaga taxminan ${perPage} so‘z sig‘adi (qog‘oz, format va qator oralig‘iga qarab)`} wide>
          <Field id="pages">
            <Segmented
              ariaLabel="Hajm"
              options={KONSPEKT_PAGES.map((p) => ({ value: p, label: `${p} varaq · ${formatSom(priceFor(tool, { ...values, pages: p }))}` }))}
              value={ui.pages}
              onChange={(v) => set("pages", v)}
            />
          </Field>
        </Row>
      </Card>
      <Card title="Daftar ko‘rinishi">
        <HandRows caps={caps} value={ui.hand} onChange={setHand} />
      </Card>
      <Card title="Qo‘shimcha">
        <Row label="Istaklar" hint="Nimani ta’kidlash yoki qoldirib ketish (ixtiyoriy)" wide>
          <span data-field="extra" id="extra" className="block">
            <LimitedTextarea value={ui.extra} onChange={(v) => set("extra", v)} limit={WORK_LIMITS.extraChars} placeholder="Masalan: faqat sana va ismlarga e’tibor ber" />
          </span>
        </Row>
      </Card>
    </ToolChrome>
  );
}
