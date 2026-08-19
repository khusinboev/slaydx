"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { ChipGroup, Legend, TextArea, TextInput } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";

const STEPS = ["Shaxsiy", "Lavozim", "Tajriba", "Ta'lim", "Ko'nikmalar"];

export function ResumeWizard({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>({
    fullName: "",
    location: "Toshkent",
    email: "",
    phone: "",
    targetRole: "",
    summary: "",
    experience: "",
    education: "",
    skills: "",
    tone: "professional",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (name: string, v: string) => setValues((s) => ({ ...s, [name]: v }));

  async function submit() {
    setError(null);
    if (!String(values.fullName).trim() || !String(values.targetRole).trim()) {
      setError("Ism va maqsadli lavozim kiritilishi shart");
      setStep(0);
      return;
    }
    setLoading(true);
    try {
      const id = await runGeneration(tool, { ...values, topic: String(values.targetRole) });
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome
      title="Rezyume yaratuvchi"
      submitLabel={step < STEPS.length - 1 ? "Davom etish" : tool.submitLabel}
      price={tool.basePrice}
      loading={loading}
      onSubmit={() => {
        if (step < STEPS.length - 1) setStep((s) => s + 1);
        else void submit();
      }}
      error={error}
    >
      <p className="text-muted-foreground mb-6 text-sm">{tool.description}</p>
      <div className="mb-6 flex gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>
      <p className="mb-4 text-sm font-medium">
        {step + 1}/{STEPS.length} · {STEPS[step]}
      </p>

      {step === 0 ? (
        <>
          <fieldset className="mb-4">
            <Legend>To&apos;liq ism</Legend>
            <TextInput value={String(values.fullName)} onChange={(v) => set("fullName", v)} placeholder="Aliyev Ali" />
          </fieldset>
          <fieldset className="mb-4">
            <Legend>Manzil</Legend>
            <TextInput value={String(values.location)} onChange={(v) => set("location", v)} />
          </fieldset>
          <fieldset className="mb-4">
            <Legend>Email</Legend>
            <TextInput type="email" value={String(values.email)} onChange={(v) => set("email", v)} />
          </fieldset>
          <fieldset className="mb-4">
            <Legend>Telefon</Legend>
            <TextInput value={String(values.phone)} onChange={(v) => set("phone", v)} placeholder="+998" />
          </fieldset>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <fieldset className="mb-4">
            <Legend>Maqsadli lavozim</Legend>
            <TextInput
              value={String(values.targetRole)}
              onChange={(v) => set("targetRole", v)}
              placeholder="Frontend dasturchi"
            />
          </fieldset>
          <fieldset className="mb-4">
            <Legend>Qisqacha o&apos;zingiz haqingizda</Legend>
            <TextArea value={String(values.summary)} onChange={(v) => set("summary", v)} />
          </fieldset>
          <fieldset className="mb-4">
            <Legend>Yozuv stili</Legend>
            <ChipGroup
              options={[
                { value: "professional", label: "Professional" },
                { value: "qisqa", label: "Qisqa" },
                { value: "ijodiy", label: "Ijodiy" },
              ]}
              value={String(values.tone)}
              onChange={(v) => set("tone", v)}
            />
          </fieldset>
        </>
      ) : null}

      {step === 2 ? (
        <fieldset className="mb-4">
          <Legend>Ish tajribasi</Legend>
          <TextArea
            value={String(values.experience)}
            onChange={(v) => set("experience", v)}
            placeholder="Kompaniya, yil, vazifalar..."
          />
        </fieldset>
      ) : null}

      {step === 3 ? (
        <fieldset className="mb-4">
          <Legend>Universitet, kurslar va sertifikatlar</Legend>
          <TextArea value={String(values.education)} onChange={(v) => set("education", v)} />
        </fieldset>
      ) : null}

      {step === 4 ? (
        <fieldset className="mb-4">
          <Legend>Texnik va yumshoq ko&apos;nikmalar</Legend>
          <TextArea
            value={String(values.skills)}
            onChange={(v) => set("skills", v)}
            placeholder="React, muloqot, jamoa..."
          />
        </fieldset>
      ) : null}

      {step > 0 ? (
        <button type="button" className="text-muted-foreground mb-4 text-sm" onClick={() => setStep((s) => s - 1)}>
          Ortga
        </button>
      ) : null}
    </ToolChrome>
  );
}
