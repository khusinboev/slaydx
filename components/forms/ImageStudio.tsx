"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { FormValues, ToolConfig } from "@/lib/types";
import { formatTanga, priceFor } from "@/lib/tools";
import { IMAGE_RATIOS, IMAGE_STYLES } from "@/lib/generation/image-studio";
import { cn } from "@/lib/cn";
import { runGeneration } from "./runGeneration";

const EXAMPLES = [
  "Toshkent kechasi, yomg‘irli ko‘cha, neon yorug‘lik, kino kadri",
  "O‘zbek dasturxoni, non, choy, tabiiy yorug‘lik, mahsulot fotosi",
  "Universitet kutubxonasi, talaba kitob o‘qiyapti, iliq yorug‘lik",
  "Registon maydoni erta tongda, tuman, keng kadr",
];

export function ImageStudio({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    prompt: "",
    imageStyle: "photo",
    imageRatio: "1:1",
    imageCount: 1,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = useMemo(() => priceFor(tool, values), [tool, values]);
  const ratio = IMAGE_RATIOS.find((r) => r.id === values.imageRatio) ?? IMAGE_RATIOS[0];

  async function submit() {
    setError(null);
    const prompt = String(values.prompt || "").trim();
    if (prompt.length < 3) {
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
    <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-28">
      <div className="mb-8">
        <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wider uppercase">Studio</p>
        <h1 className="text-2xl font-semibold tracking-tight">Rasm generate</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tavsif yozing, uslub va o‘lchamni tanlang — Flux rasmlarni shu nisbatda chizadi.
        </p>
      </div>

      <fieldset className="mb-6">
        <legend className="mb-2.5 text-[15px] font-medium">Nima chizamiz?</legend>
        <textarea
          value={String(values.prompt ?? "")}
          onChange={(e) => setValues((s) => ({ ...s, prompt: e.target.value }))}
          rows={5}
          className="border-input bg-card focus:ring-ring w-full rounded-2xl border px-4 py-3 text-[15px] outline-none focus:ring-2"
          placeholder="Masalan: ertalabki Buxoro ko‘chasi, quyosh nuri, odamlar yo‘q, kino uslubi..."
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="text-muted-foreground hover:text-foreground max-w-full truncate rounded-full border px-3 py-1 text-xs"
              onClick={() => setValues((s) => ({ ...s, prompt: ex }))}
            >
              {ex}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-2.5 text-[15px] font-medium">Uslub</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {IMAGE_STYLES.map((st) => {
            const on = values.imageStyle === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setValues((s) => ({ ...s, imageStyle: st.id }))}
                className={cn(
                  "rounded-2xl border p-3 text-left transition",
                  on ? "border-primary ring-primary ring-2" : "border-input hover:border-foreground/30",
                )}
              >
                <div className="mb-2 h-10 overflow-hidden rounded-lg" style={swatch(st.id)} />
                <div className="text-sm font-medium">{st.name}</div>
                <div className="text-muted-foreground text-xs">{st.blurb}</div>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <fieldset>
          <legend className="mb-2.5 text-[15px] font-medium">O‘lcham</legend>
          <div className="grid grid-cols-3 gap-2">
            {IMAGE_RATIOS.map((r) => {
              const on = values.imageRatio === r.id;
              const max = 36;
              const scale = max / Math.max(r.w, r.h);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setValues((s) => ({ ...s, imageRatio: r.id }))}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border px-2 py-3",
                    on ? "border-primary ring-primary ring-2" : "border-input hover:border-foreground/30",
                  )}
                >
                  <span
                    className="bg-muted border-foreground/15 rounded-sm border"
                    style={{ width: Math.max(10, r.w * scale), height: Math.max(10, r.h * scale) }}
                  />
                  <span className="text-sm font-medium">{r.label}</span>
                  <span className="text-muted-foreground text-[11px]">{r.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2.5 text-[15px] font-medium">Nechta rasm</legend>
          <div className="flex gap-2">
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setValues((s) => ({ ...s, imageCount: n }))}
                className={cn(
                  "h-12 flex-1 rounded-2xl border text-sm font-medium",
                  Number(values.imageCount) === n ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-sm">
            Chiqish: {ratio.w}×{ratio.h} px · tanlangan nisbatga mos
          </p>
        </fieldset>
      </div>

      {error ? <p className="text-destructive mb-4 text-sm">{error}</p> : null}

      <div className="bg-[var(--page-bg)]/90 sticky bottom-0 -mx-4 border-t px-4 py-3 backdrop-blur">
        <button
          type="button"
          disabled={loading}
          onClick={submit}
          className="bg-primary text-primary-foreground disabled:opacity-50 flex h-12 w-full items-center justify-center gap-3 rounded-2xl text-[15px] font-medium"
        >
          <Sparkles className="size-4" />
          <span>{loading ? "Chizilmoqda..." : tool.submitLabel}</span>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-sm">{formatTanga(price)}</span>
        </button>
      </div>
    </div>
  );
}

function swatch(id: string): { background: string } {
  const map: Record<string, string> = {
    photo: "linear-gradient(135deg,#0f172a,#64748b)",
    cinematic: "linear-gradient(135deg,#7c2d12,#0e7490)",
    illustration: "linear-gradient(135deg,#4f46e5,#f472b6)",
    watercolor: "linear-gradient(135deg,#38bdf8,#fde68a)",
    render3d: "linear-gradient(135deg,#111827,#22d3ee)",
    minimal: "linear-gradient(135deg,#f8fafc,#cbd5e1)",
    pencil: "linear-gradient(135deg,#e5e5e5,#525252)",
    product: "linear-gradient(135deg,#fff7ed,#9a3412)",
  };
  return { background: map[id] || map.photo };
}
