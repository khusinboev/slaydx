"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type * as api from "@/lib/api-client";
import { TOOL_BY_ID } from "@/lib/tools";
import { progressKindOf, stageIndexAt, stagesFor } from "@/lib/progress-stages";
import { etaLabel, etaState, smoothProgress } from "@/lib/progress-smooth";
import { GenerationArt } from "./GenerationArt";

/** `1:05` / `12:30` — elapsed clock of the running panel. */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** «Navbatdagi o'rin … boshlanishigacha taxminan N» — queue wait text (kept from the old card). */
function queueEta(sec: number): string {
  if (sec < 60) return "1 daqiqadan kam";
  const min = Math.round(sec / 60);
  return min < 90 ? `${min} daqiqa` : `${Math.round(min / 60)} soat`;
}

/**
 * Running (and queued) job panel for every tool without a live deck: big percentage, moving bar,
 * the tool's stage checklist, the engine's own step text, elapsed time and a coarse ETA.
 *
 * The shown percentage = server value, creeping toward the end of the CURRENT stage while the
 * engine is inside one long call (`lib/progress-smooth.ts`) — never below the server value, never
 * backwards, never past the next stage mark. First render shows the server value exactly.
 */
export function GenerationProgress({ gen }: { gen: api.GenerationDetail }) {
  const tool = TOOL_BY_ID[gen.type];
  const kind = progressKindOf(gen.type);
  const stages = stagesFor(gen.type);
  const queued = gen.status === "QUEUED";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // "Adjust state while rendering": when the server value / clock sample changes, restart the creep / re-anchor.
  const [mark, setMark] = useState({ progress: gen.progress, at: now });
  if (!Object.is(mark.progress, gen.progress)) setMark({ progress: gen.progress, at: now });
  const [anchor, setAnchor] = useState({ sec: gen.runningSec, at: now });
  if (anchor.sec !== gen.runningSec) {
    // The displayed clock only moves forward: a poll can land up to 1 s "behind" the last tick.
    const current = typeof anchor.sec === "number" ? anchor.sec + (now - anchor.at) / 1000 : 0;
    setAnchor({ sec: typeof gen.runningSec === "number" ? Math.max(gen.runningSec, current) : gen.runningSec, at: now });
  }
  const [peak, setPeak] = useState(0);

  const shown = queued
    ? 0
    : smoothProgress({ server: gen.progress, stages, sinceChangeMs: now - mark.at, typicalSec: gen.typicalSec, prev: peak });
  if (shown > peak) setPeak(shown);

  const stageIdx = stageIndexAt(stages, queued ? 0 : shown);
  const elapsedSec = typeof anchor.sec === "number" ? anchor.sec + (now - anchor.at) / 1000 : null;
  const eta = elapsedSec === null || queued ? ({ kind: "none" } as const) : etaState({ elapsedSec, typicalSec: gen.typicalSec, progress: shown });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="bg-card rounded-2xl border p-5 sm:p-6" data-generation-progress data-kind={kind} data-stage={queued ? undefined : stageIdx}>
        <div className="flex items-center gap-3 sm:gap-4">
          <GenerationArt kind={kind} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{tool?.creatingLabel ?? "Yaratilmoqda..."}</p>
            <p className="text-muted-foreground mt-0.5 text-sm break-words" data-progress-step>
              {gen.step || (queued ? "Navbat kutilmoqda" : "")}
            </p>
          </div>
          {queued ? null : (
            <p className="text-primary shrink-0 text-3xl font-semibold tabular-nums sm:text-4xl" data-progress-percent>
              {shown}
              <span className="text-xl sm:text-2xl">%</span>
            </p>
          )}
        </div>

        <div
          className="bg-muted relative mt-4 h-2.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-label={tool?.creatingLabel ?? "Yaratilmoqda"}
          aria-valuenow={queued ? undefined : shown}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={queued ? "Navbatda" : gen.step ? `${shown}% · ${gen.step}` : `${shown}%`}
        >
          <div
            className="bg-primary relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${queued ? 8 : Math.max(4, shown)}%` }}
          >
            <span className="slx-bar-sheen absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          </div>
        </div>

        {/*
          UX-07: navbatdagi o'rin va taxminiy kutish — server bersagina
          (W2-B, ixtiyoriy maydonlar). Aks holda yangi ish va 15 daqiqa
          navbatda turgan ish bir xil ko'rinardi.
        */}
        {queued && typeof gen.queuePosition === "number" && gen.queuePosition > 0 ? (
          <p className="mt-4 text-sm" data-queue-position>
            Navbatdagi o‘rningiz: <b>{gen.queuePosition}</b>
            {typeof gen.etaSec === "number" && gen.etaSec > 0 ? ` · boshlanishiga taxminan ${queueEta(gen.etaSec)}` : null}
          </p>
        ) : null}

        {!queued && (elapsedSec !== null || eta.kind !== "none") ? (
          <p className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 text-xs tabular-nums" data-progress-time>
            {elapsedSec !== null ? <span>Ketdi: {clockText(elapsedSec)}</span> : null}
            {eta.kind === "left" ? <span data-eta="left">Taxminan {etaLabel(eta.sec)} qoldi</span> : null}
            {eta.kind === "slow" ? <span data-eta="slow">Odatdagidan biroz uzoqroq — ish davom etmoqda</span> : null}
          </p>
        ) : null}

        {queued ? null : (
          <ol className="mt-4 space-y-2" aria-label="Bosqichlar">
            {stages.map((st, i) => {
              const state = i < stageIdx ? "done" : i === stageIdx ? "current" : "todo";
              return (
                <li
                  key={st.label}
                  data-stage-state={state}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn("flex items-center gap-2.5 text-sm", state === "todo" ? "text-muted-foreground/60" : state === "done" ? "text-muted-foreground" : "font-medium")}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      state === "done" && "bg-primary border-primary text-primary-foreground",
                      state === "current" && "border-primary",
                    )}
                  >
                    {state === "done" ? <Check className="size-3" strokeWidth={3} /> : null}
                    {state === "current" ? <span className="slx-typing bg-primary block size-2 rounded-full" /> : null}
                  </span>
                  {st.label}
                </li>
              );
            })}
          </ol>
        )}

        <p className="text-muted-foreground mt-5 text-xs">
          Sahifani yopsangiz ham ish davom etadi — keyin «Ishlarim» dan ochasiz.
        </p>
      </div>
    </div>
  );
}
