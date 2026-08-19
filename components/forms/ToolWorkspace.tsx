"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { priceFor } from "@/lib/tools";
import { useAppStore, writerProfile } from "@/lib/store";
import { useUi } from "@/lib/ui";
import type { UserProfile } from "@/lib/types";
import { FieldBlock, ModeSwitch, TextInput, Legend } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { SlideForm } from "./SlideForm";
import { ResumeWizard } from "./ResumeWizard";
import { TranslationForm } from "./TranslationForm";
import { ImageStudio } from "./ImageStudio";
import { SourceFileField } from "./SourceFileField";

function defaultsFor(tool: ToolConfig, profile: UserProfile): FormValues {
  const v: FormValues = {
    language: "uz",
    mode: tool.modes ? "topic" : "topic",
    topic: "",
    extra: "",
    design: "iris",
    pages:
      tool.id === "essay"
        ? "2"
        : tool.id === "article" || tool.id === "thesis"
          ? "3-5"
          : tool.id === "coursework"
            ? "20-25"
            : "10-15",
    grade: 8,
    duration: "45",
    kind: "standard",
    annotationLangs: "same",
    ministry: "oliy",
    tocMethod: "ai",
    images: "yes",
    quality: "standard",
    titleSlide: true,
    weeklyHours: 4,
    totalHours: 136,
    university: profile.university,
    faculty: profile.faculty,
    department: profile.department,
    author: profile.author || profile.name,
    subject: profile.subject,
    teacher: profile.teacher,
    city: profile.city || "Toshkent",
  };
  return v;
}

export function ToolWorkspace({ tool }: { tool: ToolConfig }) {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const user = useAppStore((s) => s.user);
  const open = useUi((s) => s.open);

  // Sessiya serverdan tasdiqlanmaguncha login modalini ochmaymiz —
  // aks holda kirgan foydalanuvchiga ham bir lahza "kiring" chiqardi.
  useEffect(() => {
    if (sessionChecked && !loggedIn) {
      open("login", { returnTo: `/uz/${tool.slug}` });
    }
  }, [sessionChecked, loggedIn, open, tool.slug]);

  if (!sessionChecked) {
    return <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;
  }

  if (tool.custom === "slide") return <SlideForm tool={tool} />;
  if (tool.custom === "resume") return <ResumeWizard tool={tool} />;
  if (tool.custom === "translation") return <TranslationForm tool={tool} />;
  if (tool.custom === "image") return <ImageStudio tool={tool} />;

  return <StandardForm tool={tool} profile={writerProfile(user)} />;
}

function StandardForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => defaultsFor(tool, profile));
  const [extraOpen, setExtraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (name: string, v: string | number | boolean) =>
    setValues((s) => ({ ...s, [name]: v }));

  const mainFields = tool.fields.filter((f) => !f.extra);
  const extraFields = tool.fields.filter((f) => f.extra);
  const needsTopic = Boolean(tool.topicLegend);
  const fileMode = tool.modes && values.mode === "file";
  const price = useMemo(() => priceFor(tool, values), [tool, values]);

  async function submit() {
    setError(null);
    if (reading) {
      setError("Fayl hali o‘qilmoqda");
      return;
    }
    if (fileMode && !String(values.sourceText || "").trim()) {
      setError("Avval fayl tanlang — matn olingandan keyin yaratish boshlanadi.");
      return;
    }
    if (needsTopic && !fileMode && !String(values.topic || "").trim()) {
      setError("Mavzu kiritilishi shart");
      return;
    }
    const required = tool.fields.filter((f) => f.required && !f.extra);
    for (const f of required) {
      if (!String(values[f.name] ?? "").trim()) {
        setError(`${f.legend} to‘ldirilishi kerak`);
        return;
      }
    }
    setLoading(true);
    try {
      const id = await runGeneration(tool, values);
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome
      title={tool.pageTitle}
      extra={
        extraFields.length ? (
          <>
            {extraFields.map((f) => (
              <FieldBlock key={f.name} field={f} values={values} set={set} />
            ))}
            <fieldset className="mb-4">
              <Legend>Qo&apos;shimcha talablar</Legend>
              <textarea
                value={String(values.extra ?? "")}
                onChange={(e) => set("extra", e.target.value)}
                className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
                rows={3}
                placeholder="Mavzu, yo'nalish va boshqa qo'shimchalar"
              />
            </fieldset>
          </>
        ) : tool.extraOptional ? (
          <fieldset>
            <Legend>Qo&apos;shimcha talablar</Legend>
            <textarea
              value={String(values.extra ?? "")}
              onChange={(e) => set("extra", e.target.value)}
              className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
              rows={3}
            />
          </fieldset>
        ) : null
      }
      extraOpen={extraOpen}
      onExtra={() => setExtraOpen((v) => !v)}
      submitLabel={tool.submitLabel}
      price={price}
      loading={loading}
      onSubmit={submit}
      error={error}
    >
      {tool.modes ? (
        <ModeSwitch
          modes={tool.modes}
          value={String(values.mode ?? "topic")}
          onChange={(v) => set("mode", v)}
        />
      ) : null}

      {fileMode ? (
        <SourceFileField
          fileName={String(values.fileName ?? "")}
          sourceText={String(values.sourceText ?? "")}
          onBusyChange={setReading}
          onChange={({ fileName, sourceText }) =>
            setValues((s) => ({
              ...s,
              fileName,
              sourceText,
              topic: String(s.topic || "").trim() || fileName.replace(/\.[^.]+$/, ""),
            }))
          }
        />
      ) : needsTopic ? (
        <fieldset className="mb-6">
          <Legend>{tool.topicLegend}</Legend>
          <TextInput
            value={String(values.topic ?? "")}
            placeholder={tool.topicPlaceholder}
            onChange={(v) => set("topic", v)}
          />
          {tool.topicExamples?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {tool.topicExamples.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                  onClick={() => set("topic", ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {mainFields.map((f) => (
        <FieldBlock key={f.name} field={f} values={values} set={set} />
      ))}
    </ToolChrome>
  );
}
