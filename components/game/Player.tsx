"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createGame, elapsed, finish, GAME_KIND_LABEL, isLast, next, prev, progress, type GameState } from "@/lib/game/engine";
import type { PublicGameView } from "@/lib/game/public";
import { cn } from "@/lib/cn";
import { Cards } from "./Cards";
import { Crossword } from "./Crossword";
import { Listening } from "./Listening";
import { NameGate } from "./NameGate";
import { Quiz } from "./Quiz";
import { Result } from "./Result";
import { Sorting } from "./Sorting";

/**
 * Urinish id si — `crypto.randomUUID()`, ZAXIRA bilan (C36 Sharh R4).
 *
 * `randomUUID()` faqat XAVFSIZ kontekstda (HTTPS) va yangi brauzerlarda
 * bor (Chrome 92+/Safari 15.4+/Firefox 95+) — loyihaning brauzer
 * maqsadi (Safari 12/Chrome 64) buni qamrab olmaydi. Yo'q yoki xato
 * bersa (`SecurityError` — xavfsiz kontekst emas), `getRandomValues`
 * asosida v4 UUID quramiz; U HAM yo'q bo'lsa (juda eski brauzer),
 * `Math.random()` bilan — kriptografik emas, lekin baribir 122 bitlik
 * TASODIFIY id (bu yerda faqat TAKRORLANMASLIK kerak, bashorat qilinmaslik
 * emas — token allaqachon sir, `game-sessions.ts TOKEN_CHARS`).
 */
export function newSubmissionId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Xavfsiz kontekst emas — pastga tushamiz.
    }
  }
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40; // versiya 4
    b[8] = (b[8]! & 0x3f) | 0x80; // variant (RFC 4122)
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // So'nggi zaxira — `crypto` umuman yo'q (juda eski brauzer/WebView).
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { out += "-"; continue; }
    if (i === 14) { out += "4"; continue; }
    const r = Math.floor(Math.random() * 16);
    out += (i === 19 ? (r & 0x3) | 0x8 : r).toString(16);
  }
  return out;
}

/**
 * O'YINCHI TOMONI (AUDIT-22 WP-C) — qobiq va oqim.
 *
 * To'rt ekran: yuklanmoqda → ISM → o'yin (tur bo'yicha komponent) →
 * natija. Butun holat `lib/game/engine.ts` da (sof), bu fayl esa uni
 * tarmoq bilan bog'laydi: `GET /api/o/[token]` → `createGame` →
 * `finish()` → `POST …/submit` → `{score,total,percent}`.
 *
 * MUHIM: bu komponent BALL HISOBLAMAYDI va to'g'ri javobni KO'RMAYDI —
 * `/api/o/[token]` uni bermaydi, ball esa `submit` javobidan keladi.
 *
 * Ma'lumot sahifa HTML ida emas, KLIENTDA olinadi (`app/o/[token]`
 * izohi): ochiq HTML o'yinni CDN/brauzer keshiga tarqatardi.
 *
 * SERVER MODULI IMPORT QILINMAYDI — ochiq sahifa loginsiz ochiladi va
 * `lib/server/**` ga zanjir uni SSR da 500 qilardi
 * (`tests/client-boundary.test.mts` shu faylni kirish nuqtasi sifatida
 * qulflagan).
 */
export function GamePlayer({ token }: { token: string }) {
  const [view, setView] = useState<PublicGameView | null>(null);
  const [title, setTitle] = useState("");
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<GameState | null>(null);
  const [result, setResult] = useState<{ score: number; total: number; percent: number } | null>(null);
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  /** Taymer sekundi — FAQAT ko'rsatkich; o'yin vaqt bilan to'xtamaydi. */
  const [now, setNow] = useState(0);
  /**
   * Joriy URINISH id si (C36 UX-06) — `crypto.randomUUID()`, bitta
   * urinish uchun BIR MARTA (`start`/«Yana o'ynash» da). `useRef`:
   * qayta chizishga sabab bo'lmasin, lekin `submit()`ning retry
   * chaqiruvlari (tarmoq xatosidan keyin «Qayta yuborish») AYNI
   * qiymatni o'qishi kerak — server shu id bilan takroriy yozuvni
   * blokLaydi va BIRINCHI natijani qaytaradi.
   */
  const submissionIdRef = useRef("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/o/${token}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(loadErrorText(res.status));
        const data = (await res.json()) as { game: PublicGameView; title?: string };
        if (!alive) return;
        setView(data.game);
        setTitle(String(data.title || data.game.title || "O‘yin"));
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : LOAD_FAILED);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  // Sekund sanagichi — o'yin ketayotgandagina yuradi (natija ekranida yo'q).
  useEffect(() => {
    if (!state || state.finishedAt !== null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(
    (playerName: string) => {
      if (!view) return;
      // YANGI urinish — YANGI id (eski, tugallangan urinishning retry'i bilan aralashmasin).
      submissionIdRef.current = newSubmissionId();
      setName(playerName);
      setSendError("");
      setState(createGame(view));
      setNow(Date.now());
    },
    [view],
  );

  const submit = useCallback(async () => {
    if (!state || sending) return;
    setSending(true);
    setSendError("");
    const done = finish(state);
    setState(done.state);
    try {
      const res = await fetch(`/api/o/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, answers: done.answers, seconds: done.seconds, submissionId: submissionIdRef.current }),
      });
      const data = (await res.json().catch(() => ({}))) as { score?: number; total?: number; percent?: number; error?: string };
      if (!res.ok) throw new Error(submitErrorText(res.status, data.error));
      setResult({ score: data.score ?? 0, total: data.total ?? 0, percent: data.percent ?? 0 });
    } catch (e) {
      // Yuborilmasa o'yin YO'QOLMAYDI: holat joyida qoladi va «Qayta
      // yuborish» aynan shu javoblarni qayta jo'natadi.
      setSendError(e instanceof Error ? e.message : SUBMIT_FAILED);
      setState((s) => (s ? { ...s, finishedAt: null } : s));
    } finally {
      setSending(false);
    }
  }, [state, sending, token, name]);

  if (loadError) {
    return (
      <section className="bg-card rounded-2xl border p-6 text-center" data-game-error>
        <p className="font-medium">{loadError}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Havolani o‘qituvchingizdan qayta so‘rang — u yangi havola yarata oladi.
        </p>
      </section>
    );
  }

  if (!view) return <p className="text-muted-foreground py-8 text-center text-sm">O‘yin yuklanmoqda…</p>;

  if (result) {
    return (
      <Result
        {...result}
        name={name}
        onAgain={() => {
          // YANGI urinish — natijalar jadvaliga YANGI qator (`Result.tsx` izohi), shuning uchun YANGI id ham.
          submissionIdRef.current = newSubmissionId();
          setResult(null);
          setState(createGame(view));
          setNow(Date.now());
        }}
      />
    );
  }

  if (!state) return <NameGate title={title} kindLabel={GAME_KIND_LABEL[view.kind]} total={view.total} onStart={start} />;

  const p = progress(state);
  const left = p.total - p.done;
  const seconds = elapsed(state, now || state.startedAt);
  const perItem = state.steps > 1;

  return (
    <section className="flex flex-col gap-3">
      <header className="bg-card rounded-2xl border px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="min-w-0 truncate text-[15px] font-semibold">{title}</h1>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums" data-timer>
            {mmss(seconds)}
          </span>
        </div>
        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="bg-primary h-full transition-all" style={{ width: `${p.percent}%` }} />
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs" data-progress>
          {perItem ? `${state.index + 1} / ${state.steps} · ` : ""}
          {p.done} / {p.total} bajarildi
        </p>
      </header>

      <div className="bg-card rounded-2xl border p-4 sm:p-5">
        {view.kind === "quiz" ? <Quiz state={state} set={setState} /> : null}
        {view.kind === "crossword" ? <Crossword state={state} set={setState} /> : null}
        {view.kind === "flashcards" ? <Cards state={state} set={setState} /> : null}
        {view.kind === "sorting" ? <Sorting state={state} set={setState} /> : null}
        {view.kind === "listening" ? (
          <Listening state={state} set={setState} audioSrc={(assetId) => `/api/o/${token}/audio/${assetId}`} />
        ) : null}
      </div>

      {sendError ? (
        <p role="alert" className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm" data-send-error>
          {sendError}
        </p>
      ) : null}

      <div className="flex gap-2">
        {perItem ? (
          <button
            type="button"
            data-prev
            className="bg-card h-12 shrink-0 rounded-xl border px-4 text-[15px] disabled:opacity-40"
            disabled={state.index === 0}
            onClick={() => setState(prev(state))}
          >
            Orqaga
          </button>
        ) : null}

        {perItem && !isLast(state) ? (
          <button
            type="button"
            data-next
            className="bg-primary text-primary-foreground h-12 flex-1 rounded-xl text-[16px] font-semibold"
            onClick={() => setState(next(state))}
          >
            Keyingi
          </button>
        ) : (
          <button
            type="button"
            data-finish
            className={cn(
              "h-12 flex-1 rounded-xl text-[16px] font-semibold disabled:opacity-50",
              left > 0 ? "bg-card border" : "bg-primary text-primary-foreground",
            )}
            disabled={sending}
            onClick={() => void submit()}
          >
            {sending ? "Yuborilmoqda…" : sendError ? "Qayta yuborish" : "Yakunlash"}
          </button>
        )}
      </div>

      {left > 0 && (!perItem || isLast(state)) ? (
        <p className="text-muted-foreground text-center text-xs">{left} ta topshiriq javobsiz qoldi.</p>
      ) : null}
    </section>
  );
}

const LOAD_FAILED = "O‘yinni yuklab bo‘lmadi";
const SUBMIT_FAILED = "Natijani yuborib bo‘lmadi";

/**
 * Yuklashdagi xatolar — O'ZBEKCHA va SABABSIZ.
 *
 * 404 da «token noto'g'ri» va «muddati tugagan» FARQLANMAYDI: route ham
 * ularni ajratmaydi (havola taxmin qilishni osonlashtirmaslik uchun),
 * ekran esa serverdan ko'proq narsa bilgandek ko'rinmasin.
 */
function loadErrorText(status: number): string {
  if (status === 404) return "Havola topilmadi yoki muddati tugagan";
  if (status === 429) return "Juda ko‘p urinish — bir daqiqadan so‘ng qayta urining";
  return LOAD_FAILED;
}

function submitErrorText(status: number, serverText?: string): string {
  if (status === 429) return "Juda ko‘p urinish — bir daqiqadan so‘ng qayta yuboring";
  if (status === 404) return "Havola topilmadi yoki muddati tugagan";
  if (status === 403) return "So‘rovni yubora olmadik — sahifani yangilab, qaytadan urinib ko‘ring";
  return serverText || SUBMIT_FAILED;
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
