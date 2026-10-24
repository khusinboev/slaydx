"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, Timer, XCircle, ZoomIn } from "lucide-react";
import { Card } from "@/components/forms/compact";
import { ApiError, request } from "@/lib/api-client";
import { formatPoints } from "@/lib/referral";

/**
 * «Test ishlash» page (`/uz/tests`, owner request 7). Three screens on one route:
 *   - the list: subjects + «Hammasi», the server's price, «Boshlash», the open attempt and the history;
 *   - the running attempt: one question at a time (image or text), A-D buttons, progress, a timer that follows the
 *     SERVER deadline (clock skew corrected), «Keyingi» / «Tugatish»;
 *   - the result: score, per-question correctness, the correct letter and the explanation.
 * The page never holds an answer key while the attempt runs -- the API does not send one. The price and the time
 * limits come from the server only; the start request carries no price.
 */

type Subject = { code: string; name: string; questions: number; minutes: number; available: boolean };
type HistoryItem = { id: string; mode: "subject" | "all"; subject: string | null; status: "active" | "finished"; total: number; correct?: number; score?: number; startedAt: string };
type Overview = {
  enabled: boolean;
  price: number;
  firstFree: boolean;
  pointsPerCorrect: number;
  subjects: Subject[];
  all: { questions: number; minutes: number; available: boolean };
  open: { id: string; mode: "subject" | "all"; subject: string | null; deadlineAt: string } | null;
  history: HistoryItem[];
};
type Question = { id: number; position: number; subject: string; text: string | null; options: string[] | null; imageUrl: string | null };
type Active = {
  state: "active";
  id: string;
  mode: "subject" | "all";
  subject: string | null;
  total: number;
  deadlineAt: string;
  serverNow: string;
  questions: Question[];
  answers: Record<string, number>;
};
type ReviewItem = Omit<Question, "position"> & {
  position: number;
  chosen: number | null;
  chosenLetter: string | null;
  correct: number;
  correctLetter: string;
  isCorrect: boolean;
  explanation: string | null;
};
type Finished = {
  state: "finished";
  id: string;
  mode: "subject" | "all";
  subject: string | null;
  total: number;
  correct: number;
  score: number;
  reason: "manual" | "timeout";
  bySubject: { subject: string; correct: number; total: number }[];
  review: ReviewItem[];
};
type View = Active | Finished;

const LETTERS = ["A", "B", "C", "D"] as const;
const num = (n: number): string => String(Number(n.toFixed(2))).replace(".", ",");
const dateText = (iso: string): string => new Date(iso).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });
const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const msg = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : "Xatolik");
const label = (h: { mode: "subject" | "all"; subject: string | null }): string => (h.mode === "all" ? "Hammasi" : (h.subject ?? "Fan"));

/** A question image: lazy, and a tap opens it large (a second tap zooms to full width, scrolling inside). */
function Stem({ q }: { q: Pick<Question, "imageUrl" | "text"> }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      {q.imageUrl ? (
        <button
          type="button"
          data-tests-zoom
          aria-label="Rasmni kattalashtirish"
          onClick={() => {
            setFull(false);
            setOpen(true);
          }}
          className="bg-card relative block w-full overflow-hidden rounded-2xl border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-tests-image src={q.imageUrl} alt="Savol rasmi" loading="lazy" className="mx-auto max-h-[60vh] w-full object-contain" />
          <ZoomIn className="text-muted-foreground absolute right-2 bottom-2 size-5" aria-hidden />
        </button>
      ) : null}
      {q.text ? (
        <p data-tests-text className="text-[16px] leading-relaxed whitespace-pre-wrap">
          {q.text}
        </p>
      ) : null}
      {open && q.imageUrl ? (
        <div role="dialog" aria-modal="true" aria-label="Savol rasmi" data-tests-lightbox className="fixed inset-0 z-50 overflow-auto bg-black/85" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={q.imageUrl}
            alt="Savol rasmi"
            data-tests-lightbox-image
            onClick={(e) => {
              e.stopPropagation();
              setFull((f) => !f);
            }}
            className={full ? "max-w-none" : "mx-auto max-h-screen max-w-full object-contain"}
            style={full ? { width: "200vw" } : undefined}
          />
          <button type="button" data-tests-lightbox-close className="absolute top-3 right-3 min-h-11 rounded-full bg-white/90 px-4 text-[14px] font-semibold text-black" onClick={() => setOpen(false)}>
            Yopish
          </button>
        </div>
      ) : null}
    </>
  );
}

function Runner({ attempt, onDone, onExit }: { attempt: Active; onDone: (f: Finished) => void; onExit: () => void }) {
  const skew = useRef(Date.parse(attempt.serverNow) - Date.now());
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>(attempt.answers);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(() => Date.parse(attempt.deadlineAt) - (Date.now() + skew.current));
  const finishing = useRef(false);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    try {
      onDone(await request<Finished>(`/api/tests/attempts/${attempt.id}/finish`, { method: "POST", body: "{}" }));
    } catch (e) {
      finishing.current = false;
      setError(msg(e));
      setBusy(false);
    }
  }, [attempt.id, onDone]);

  useEffect(() => {
    const tick = () => setLeft(Date.parse(attempt.deadlineAt) - (Date.now() + skew.current));
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [attempt.deadlineAt]);
  useEffect(() => {
    if (left <= 0) void finish();
  }, [left, finish]);

  const q = attempt.questions[index]!;
  const chosen = answers[String(q.id)];
  const last = index === attempt.questions.length - 1;

  const pick = async (choice: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request(`/api/tests/attempts/${attempt.id}/answer`, { method: "POST", body: JSON.stringify({ questionId: q.id, choice }) });
      setAnswers((a) => ({ ...a, [String(q.id)]: choice }));
    } catch (e) {
      if (e instanceof ApiError && (e.data.code === "expired" || e.data.code === "finished")) {
        finishing.current = false;
        void finish();
        return;
      }
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const answered = Object.keys(answers).length;
  return (
    <div data-tests-run className="mx-auto w-full max-w-xl px-4 pb-8">
      <div className="mb-3 flex items-center justify-between gap-3 text-[14px]">
        <span data-tests-progress className="font-semibold">
          {index + 1} / {attempt.questions.length}
        </span>
        <span data-tests-timer className={`inline-flex items-center gap-1 font-semibold tabular-nums ${left < 60_000 ? "text-destructive" : ""}`} role="timer" aria-label="Qolgan vaqt">
          <Timer className="size-4" aria-hidden />
          {clock(left)}
        </span>
      </div>
      <div className="bg-muted mb-4 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={attempt.questions.length} aria-valuenow={answered}>
        <div className="bg-primary h-full" style={{ width: `${(answered / attempt.questions.length) * 100}%` }} />
      </div>

      <section data-tests-question={q.id} className="bg-card flex flex-col gap-3 rounded-[20px] border p-4">
        {attempt.mode === "all" ? <p className="text-muted-foreground text-[13px] font-semibold uppercase">{q.subject}</p> : null}
        <Stem q={q} />
        <div role="radiogroup" aria-label="Javob variantlari" className={q.options ? "flex flex-col gap-2" : "grid grid-cols-4 gap-2"}>
          {LETTERS.map((L, i) => (
            <button
              key={L}
              type="button"
              role="radio"
              aria-checked={chosen === i}
              data-tests-choice={L}
              disabled={busy}
              onClick={() => pick(i)}
              className={`min-h-12 rounded-2xl border px-3 py-2 text-left text-[15.5px] font-semibold disabled:opacity-60 ${chosen === i ? "border-primary bg-accent" : "border-input"} ${q.options ? "" : "text-center"}`}
            >
              {q.options ? (
                <>
                  <span className="mr-2">{L}.</span>
                  <span className="font-normal">{q.options[i]}</span>
                </>
              ) : (
                L
              )}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <p role="alert" data-tests-error className="text-destructive mt-3 text-[14.5px]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        {last ? (
          <button
            type="button"
            data-tests-finish
            disabled={busy || chosen === undefined}
            onClick={() => void finish()}
            className="bg-primary text-primary-foreground inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ClipboardCheck className="size-5" aria-hidden />}
            Tugatish
          </button>
        ) : (
          <button
            type="button"
            data-tests-next
            disabled={busy || chosen === undefined}
            onClick={() => setIndex((i) => i + 1)}
            className="bg-primary text-primary-foreground inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl px-4 text-[15.5px] font-semibold disabled:opacity-50"
          >
            Keyingi
          </button>
        )}
      </div>
      <button type="button" data-tests-exit onClick={onExit} className="text-muted-foreground mt-3 min-h-11 w-full text-[14px]">
        Keyinroq davom etaman
      </button>
    </div>
  );
}

function Result({ r, onBack }: { r: Finished; onBack: () => void }) {
  return (
    <div data-tests-result className="mx-auto w-full max-w-xl px-4 pb-8">
      <Card title={r.mode === "all" ? "Natija — Hammasi" : `Natija — ${r.subject ?? ""}`}>
        <p className="text-[34px] leading-none font-bold" data-tests-score>
          {num(r.score)} <span className="text-muted-foreground text-[16px] font-semibold">ball</span>
        </p>
        <p className="mt-1 text-[15px]" data-tests-correct-count>
          {r.correct} / {r.total} ta to‘g‘ri
        </p>
        {r.reason === "timeout" ? (
          <p role="status" data-tests-timeout className="text-muted-foreground mt-2 text-[14px]">
            Vaqt tugadi — keyingi javoblar hisobga olinmadi.
          </p>
        ) : null}
        {r.bySubject.length > 1 ? (
          <ul className="mt-3 flex flex-col gap-1 text-[14.5px]" data-tests-by-subject>
            {r.bySubject.map((s) => (
              <li key={s.subject}>
                {s.subject}: {s.correct} / {s.total}
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" data-tests-back onClick={onBack} className="bg-primary text-primary-foreground mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-[15.5px] font-semibold">
          Yana test ishlash
        </button>
      </Card>

      <Card title="To‘g‘ri javoblar">
        <ol className="flex flex-col gap-3">
          {r.review.map((it) => (
            <li key={it.id} data-tests-review-item={it.position} data-correct={it.isCorrect ? "true" : "false"} className="rounded-2xl border p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-[14px] font-semibold">
                <span>
                  {it.position}-savol{r.mode === "all" ? ` · ${it.subject}` : ""}
                </span>
                {it.isCorrect ? (
                  <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="size-4" aria-hidden /> To‘g‘ri
                  </span>
                ) : (
                  <span className="text-destructive inline-flex items-center gap-1">
                    <XCircle className="size-4" aria-hidden /> {it.chosen === null ? "Javob berilmadi" : "Noto‘g‘ri"}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Stem q={it} />
              </div>
              <p className="mt-2 text-[14.5px]">
                {it.chosenLetter ? (
                  <>
                    Sizning javobingiz: <b data-tests-chosen-letter>{it.chosenLetter}</b>
                    {it.options ? ` — ${it.options[it.chosen!]}` : ""}
                    <br />
                  </>
                ) : null}
                To‘g‘ri javob: <b data-tests-correct-letter>{it.correctLetter}</b>
                {it.options ? ` — ${it.options[it.correct]}` : ""}
              </p>
              {it.explanation ? (
                <p data-tests-explanation className="bg-muted mt-2 rounded-xl p-2.5 text-[14px] whitespace-pre-wrap">
                  {it.explanation}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

export function TestsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const startKey = useRef<string | null>(null);

  const load = useCallback(() => {
    request<Overview>("/api/tests").then(
      (o) => {
        setOv(o);
        setLoadError(null);
        setPick((cur) => cur ?? (o.subjects.find((s) => s.available)?.code ?? null));
      },
      (e: unknown) => setLoadError(msg(e)),
    );
  }, []);
  useEffect(load, [load]);

  const openAttempt = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setView(await request<View>(`/api/tests/attempts/${id}`));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!pick || busy || !ov) return;
    setBusy(true);
    setError(null);
    startKey.current ??= crypto.randomUUID();
    try {
      const body = pick === "all" ? { mode: "all", key: startKey.current } : { mode: "subject", subject: pick, key: startKey.current };
      const r = await request<{ attemptId: string }>("/api/tests/start", { method: "POST", body: JSON.stringify(body) });
      startKey.current = null;
      setView(await request<View>(`/api/tests/attempts/${r.attemptId}`));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) startKey.current = null;
      setError(msg(e));
      if (e instanceof ApiError && e.data.code === "open_attempt") load();
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setView(null);
    setError(null);
    load();
  };

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        <p role="alert" data-tests-load-error className="text-destructive text-[14.5px]">
          {loadError}
        </p>
      </div>
    );
  }
  if (view?.state === "active") return <Runner key={view.id} attempt={view} onDone={setView} onExit={back} />;
  if (view?.state === "finished") return <Result r={view} onBack={back} />;
  if (!ov) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pb-8" data-tests-loading>
        <Loader2 className="size-6 animate-spin" aria-label="Yuklanmoqda" />
      </div>
    );
  }

  const options: { code: string; name: string; questions: number; minutes: number; available: boolean }[] = [
    ...ov.subjects,
    ...(ov.subjects.length ? [{ code: "all", name: "Hammasi", ...ov.all }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-8" data-tests>
      {!ov.enabled ? (
        <Card title="Test ishlash">
          <p role="status" data-tests-off className="text-muted-foreground text-[15px]">
            Testlar hozircha yopiq. Birozdan keyin qayting.
          </p>
        </Card>
      ) : ov.open ? (
        <Card title="Davom etayotgan test">
          <p data-tests-open className="text-[15px]">
            {label(ov.open)} testi tugallanmagan.
          </p>
          <button
            type="button"
            data-tests-resume
            disabled={busy}
            onClick={() => void openAttempt(ov.open!.id)}
            className="bg-primary text-primary-foreground mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-[15.5px] font-semibold disabled:opacity-50"
          >
            Davom etish
          </button>
          {error ? (
            <p role="alert" data-tests-error className="text-destructive mt-3 text-[14.5px]">
              {error}
            </p>
          ) : null}
        </Card>
      ) : (
        <Card
          title="Testni tanlang"
          aside={
            <span data-tests-price>
              {ov.firstFree ? "Birinchi urinish bepul" : ov.price === 0 ? "Bepul" : `${formatPoints(ov.price)} so‘m`}
            </span>
          }
        >
          {options.length === 0 ? (
            <p data-tests-none className="text-muted-foreground text-[15px]">
              Savollar hali tayyor emas.
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-label="Fan" className="flex flex-col gap-2">
                {options.map((o) => (
                  <button
                    key={o.code}
                    type="button"
                    role="radio"
                    aria-checked={pick === o.code}
                    disabled={!o.available}
                    data-tests-subject={o.code}
                    onClick={() => setPick(o.code)}
                    className={`min-h-12 rounded-2xl border px-3 py-2 text-left text-[15px] disabled:opacity-50 ${pick === o.code ? "border-primary bg-accent" : "border-input"}`}
                  >
                    <span className="font-medium">{o.name}</span>
                    <span className="text-muted-foreground block text-[13px]">
                      {o.questions} ta savol · {o.minutes} daqiqa
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground mt-3 text-[13.5px]" data-tests-rules>
                Har to‘g‘ri javob uchun {num(ov.pointsPerCorrect)} ball, noto‘g‘ri javob ball ayirmaydi. To‘g‘ri javoblar test tugagach ko‘rsatiladi.
              </p>
              <button
                type="button"
                data-tests-start
                disabled={!pick || busy}
                onClick={() => void start()}
                className="bg-primary text-primary-foreground mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ClipboardCheck className="size-5" aria-hidden />}
                Boshlash
              </button>
            </>
          )}
          {error ? (
            <p role="alert" data-tests-error className="text-destructive mt-3 text-[14.5px]">
              {error}
            </p>
          ) : null}
        </Card>
      )}

      <Card title="Tarix">
        {ov.history.length === 0 ? (
          <p data-tests-history-empty className="text-muted-foreground text-[15px]">
            Hali test ishlamagansiz.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-tests-history>
            {ov.history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  data-tests-history-item={h.id}
                  disabled={busy}
                  onClick={() => void openAttempt(h.id)}
                  className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left"
                >
                  <span>
                    <span className="font-medium">{label(h)}</span>
                    <span className="text-muted-foreground block text-[13px]">{dateText(h.startedAt)}</span>
                  </span>
                  <span className="text-[15px] font-semibold">
                    {h.status === "finished" ? `${num(h.score ?? 0)} ball · ${h.correct ?? 0}/${h.total}` : "tugallanmagan"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
