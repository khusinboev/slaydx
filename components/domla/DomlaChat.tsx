"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, Square, X } from "lucide-react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card } from "@/components/forms/compact";
import { ApiError, request } from "@/lib/api-client";
import { DOMLA_MAX_SCORE, DOMLA_TEXT_MAX_CHARS, DOMLA_VOICE_MAX_SECONDS, type Grade } from "@/lib/domla/rules";
import { headline, reactionLine } from "@/lib/domla/lines";
import { bearerHeaders } from "@/lib/session-transport";

/**
 * The «Qattiqqo'l domla» defence as a chat on the website (owner decision 2026-11-13). Reads the state of ONE session
 * from `GET /api/domla/sessions/{id}` by polling (every 2 s while the examiner is preparing, speaking or listening,
 * slower while he waits for the student, never once the defence is over): the examiner's bubbles (question text + his
 * voice), the student's bubbles (text, or «🎤 Ovozli javob» + what was heard), the score and verdict of each answer,
 * and the final grade with the weakest question. The composer sends a typed answer or a recorded voice (MediaRecorder,
 * tap to start / tap to send, at most `DOMLA_VOICE_MAX_SECONDS`; hidden where the browser cannot record).
 * «Botda davom etish» moves the defence to the bot (the bot gets the waiting question again); without a linked
 * Telegram it only explains how to link one. The ideal answer of an open question never reaches this page.
 */

export type ChatState = {
  id: string;
  status: "preparing" | "active" | "finished" | "expired" | "failed";
  topic: string;
  grade: Grade | null;
  channel: "bot" | "web";
  progress: { answered: number; total: number };
  results: { question: string; score: number; verdict: string }[];
  weakest: { question: string; mistake: string; ideal: string } | null;
  asked: { idx: number; text: string; audio: boolean }[];
  answers: { idx: number; via: "voice" | "text"; transcript: string; score: number; verdict: string }[];
  waiting: number | null;
  scoring: boolean;
  notice: string | null;
};

type Pending = { idx: number; via: "voice" | "text"; text: string };

const FAST_MS = 2_000;
const SLOW_MS = 6_000;

const errText = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : "Xatolik");

/** Whether this browser can record a voice answer (Telegram's older WebViews cannot: then only text). */
export function canRecord(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder === "function" && typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** The recording format: Ogg or WebM Opus (the server remuxes WebM to Ogg), MP4/AAC on Safari. */
function recorderMime(): string | undefined {
  const MR = window.MediaRecorder as typeof MediaRecorder & { isTypeSupported?: (t: string) => boolean };
  for (const t of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"]) {
    if (MR.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

/** The examiner's voice for one question: fetched with the session (cookie or bearer), played from a blob. */
function QuestionVoice({ sessionId, idx }: { sessionId: string; idx: number }) {
  const path = `/api/domla/sessions/${sessionId}/audio/${idx}`;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") {
      setSrc(path);
      return;
    }
    let url: string | null = null;
    let live = true;
    fetch(path, { credentials: "same-origin", headers: bearerHeaders(path) })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!live || !b) return;
        url = URL.createObjectURL(b);
        setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (!src) return null;
  return <audio controls preload="metadata" src={src} data-domla-voice={idx} className="mt-2 h-10 w-full max-w-full" />;
}

function DomlaBubble({ children, ...rest }: { children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="flex justify-start" {...rest}>
      <div className="bg-muted max-w-[88%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[15px] leading-snug">{children}</div>
    </div>
  );
}

function StudentBubble({ children, ...rest }: { children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="flex justify-end" {...rest}>
      <div className="bg-primary text-primary-foreground max-w-[88%] rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[15px] leading-snug break-words">{children}</div>
    </div>
  );
}

export function DomlaChat({
  sessionId,
  telegramLinked,
  onBot,
  onAgain,
}: {
  sessionId: string;
  telegramLinked: boolean;
  /** The defence moved to the bot (the button, or an answer sent from the bot): the page shows its bot card. */
  onBot: () => void;
  /** «Yana himoya qilish» after the end: back to the start card (and the refreshed history). */
  onAgain: () => void;
}) {
  const [chat, setChat] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [noTelegram, setNoTelegram] = useState(false);
  const [rec, setRec] = useState<{ seconds: number } | null>(null);
  const [mic] = useState(canRecord);
  const recorder = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; cancel: boolean; timer: ReturnType<typeof setInterval> | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBotRef = useRef(onBot);
  onBotRef.current = onBot;

  const load = useCallback(async (): Promise<ChatState | null> => {
    try {
      const s = await request<ChatState>(`/api/domla/sessions/${sessionId}`);
      setChat(s);
      setError(null);
      return s;
    } catch (e) {
      setError(errText(e));
      return null;
    }
  }, [sessionId]);

  // Polling: fast while something is happening on the server side, slow while the student thinks, none once closed.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await load();
      if (!live) return;
      if (s && s.channel === "bot" && (s.status === "active" || s.status === "preparing")) {
        onBotRef.current();
        return;
      }
      if (s && s.status !== "active" && s.status !== "preparing") return;
      const busy = !s || s.status === "preparing" || s.scoring || s.waiting === null;
      timer.current = setTimeout(tick, busy ? FAST_MS : SLOW_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // The local echo of an answer goes once the server has scored it.
  useEffect(() => {
    if (pending && chat?.answers.some((a) => a.idx === pending.idx)) setPending(null);
  }, [chat, pending]);

  // A recording never outlives the page.
  useEffect(
    () => () => {
      const r = recorder.current;
      if (r) {
        r.cancel = true;
        if (r.timer) clearInterval(r.timer);
        r.stream.getTracks().forEach((t) => t.stop());
        if (r.mr.state !== "inactive") r.mr.stop();
      }
    },
    [],
  );

  const post = async (body: BodyInit, echo: Pending) => {
    setSending(true);
    setError(null);
    try {
      await request(`/api/domla/sessions/${sessionId}/answer`, { method: "POST", body });
      setPending(echo);
      await load();
    } catch (e) {
      setError(errText(e));
      throw e;
    } finally {
      setSending(false);
    }
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t || sending || chat?.waiting == null) return;
    try {
      await post(JSON.stringify({ text: t }), { idx: chat.waiting, via: "text", text: t });
      setText("");
    } catch {
      // shown in `error`; the text stays for another try
    }
  };

  const startRec = async () => {
    if (rec || sending || chat?.waiting == null) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Mikrofonga ruxsat berilmadi. Ruxsat bering yoki javobni yozib yuboring.");
      return;
    }
    const mime = recorderMime();
    const mr = new window.MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    const r = { mr, stream, chunks: [] as Blob[], started: Date.now(), cancel: false, timer: null as ReturnType<typeof setInterval> | null };
    recorder.current = r;
    const idx = chat.waiting;
    mr.ondataavailable = (e) => {
      if (e.data.size) r.chunks.push(e.data);
    };
    mr.onstop = () => {
      if (r.timer) clearInterval(r.timer);
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRec(null);
      if (r.cancel) return;
      const seconds = Math.min(DOMLA_VOICE_MAX_SECONDS, (Date.now() - r.started) / 1000);
      const blob = new Blob(r.chunks, { type: mr.mimeType || mime || "audio/webm" });
      const form = new FormData();
      form.set("audio", blob, "javob");
      form.set("seconds", seconds.toFixed(1));
      void post(form, { idx, via: "voice", text: "" }).catch(() => undefined);
    };
    r.timer = setInterval(() => {
      const s = (Date.now() - r.started) / 1000;
      setRec({ seconds: Math.floor(s) });
      if (s >= DOMLA_VOICE_MAX_SECONDS && mr.state !== "inactive") mr.stop();
    }, 250);
    mr.start(1000);
    setRec({ seconds: 0 });
  };

  const stopRec = (cancel: boolean) => {
    const r = recorder.current;
    if (!r) return;
    r.cancel = cancel;
    if (r.mr.state !== "inactive") r.mr.stop();
  };

  const toBot = async () => {
    if (!telegramLinked) {
      setNoTelegram(true);
      return;
    }
    setError(null);
    try {
      await request(`/api/domla/sessions/${sessionId}/channel`, { method: "POST", body: JSON.stringify({ channel: "bot" }) });
      onBot();
    } catch (e) {
      if (e instanceof ApiError && e.data.code === "no_telegram") setNoTelegram(true);
      else setError(errText(e));
    }
  };

  if (!chat) {
    return (
      <Card title="Himoya">
        {error ? (
          <p role="alert" data-domla-chat-error className="text-destructive text-[14.5px]">
            {error}
          </p>
        ) : (
          <Loader2 className="size-6 animate-spin" aria-label="Yuklanmoqda" />
        )}
      </Card>
    );
  }

  const open = chat.status === "active" || chat.status === "preparing";
  const total = chat.progress.total;
  const answerOf = (i: number) => chat.answers.find((a) => a.idx === i);
  const canAnswer = chat.status === "active" && chat.waiting !== null && !sending && !rec;

  return (
    <Card title="Himoya" aside={<span data-domla-progress>{chat.progress.answered}/{total}</span>}>
      <p className="text-muted-foreground mb-3 text-[14px]" data-domla-chat-topic>
        «{chat.topic || "—"}»
      </p>
      <div className="flex flex-col gap-2.5" data-domla-chat={chat.id} aria-live="polite">
        {chat.status === "preparing" ? (
          <DomlaBubble data-domla-preparing>
            <Loader2 className="mr-1.5 inline size-4 animate-spin" aria-hidden />
            Domla savollarni tayyorlayapti…
          </DomlaBubble>
        ) : null}
        {chat.asked.map((q) => {
          const a = answerOf(q.idx);
          const echo = !a && pending?.idx === q.idx ? pending : null;
          return (
            <div key={q.idx} className="flex flex-col gap-2.5">
              <DomlaBubble data-domla-question={q.idx}>
                <b className="block text-[13px] opacity-80">
                  🎓 Savol {q.idx + 1}/{total}
                </b>
                {q.text}
                {q.audio ? <QuestionVoice sessionId={chat.id} idx={q.idx} /> : null}
              </DomlaBubble>
              {a ? (
                <>
                  <StudentBubble data-domla-answer={q.idx}>
                    {a.via === "voice" ? <span className="block text-[13px] opacity-85">🎤 Ovozli javob</span> : null}
                    {a.transcript ? (a.via === "voice" ? `«${a.transcript}»` : a.transcript) : "(javob eshitilmadi)"}
                  </StudentBubble>
                  <DomlaBubble data-domla-score={q.idx}>
                    <b>
                      {a.score}/{DOMLA_MAX_SCORE}
                    </b>{" "}
                    — {reactionLine(a.score)}
                    {a.verdict ? <span className="mt-1 block">{a.verdict}</span> : null}
                  </DomlaBubble>
                </>
              ) : echo ? (
                <StudentBubble data-domla-answer-pending={q.idx}>{echo.via === "voice" ? "🎤 Ovozli javob" : echo.text}</StudentBubble>
              ) : null}
            </div>
          );
        })}
        {chat.scoring ? (
          <DomlaBubble data-domla-listening>
            <Loader2 className="mr-1.5 inline size-4 animate-spin" aria-hidden />
            Domla tinglayapti…
          </DomlaBubble>
        ) : null}
        {chat.status === "active" && chat.waiting === null && !chat.scoring ? (
          <DomlaBubble data-domla-speaking>
            <Loader2 className="mr-1.5 inline size-4 animate-spin" aria-hidden />
            Domla savol beryapti…
          </DomlaBubble>
        ) : null}
        {chat.notice && open ? (
          <p role="alert" data-domla-notice className="text-destructive text-[14.5px]">
            {chat.notice}
          </p>
        ) : null}
      </div>

      {chat.status === "finished" && chat.grade ? (
        <div className="mt-4 rounded-2xl border p-3" data-domla-final>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{headline(chat.grade)}</span>
            <span className="text-[28px] font-bold" data-domla-final-grade>
              {chat.grade}
            </span>
          </div>
          <ol className="mt-2 list-decimal pl-5 text-[14px]">
            {chat.results.map((r, i) => (
              <li key={i}>
                {r.score}/{DOMLA_MAX_SCORE} — {r.question}
              </li>
            ))}
          </ol>
          {chat.weakest ? (
            <p className="mt-2 text-[14px]" data-domla-weakest>
              <b>Adashgan joyingiz:</b> {chat.weakest.question}
              {chat.weakest.mistake ? ` — ${chat.weakest.mistake}` : ""}
              <br />
              <b>To‘g‘ri javob:</b> {chat.weakest.ideal}
            </p>
          ) : null}
        </div>
      ) : null}
      {chat.status === "expired" ? (
        <p role="status" data-domla-expired className="mt-3 text-[15px]">
          Domla 30 daqiqa kutdi va ketdi. Himoya tugadi — xohlasangiz qaytadan boshlang.
        </p>
      ) : null}
      {chat.status === "failed" ? (
        <p role="status" data-domla-failed className="mt-3 text-[15px]">
          Domla savollarni tuza olmadi. To‘lov to‘liq qaytarildi — keyinroq qayta urinib ko‘ring.
        </p>
      ) : null}
      {!open ? (
        <button
          type="button"
          data-domla-again
          onClick={onAgain}
          className="bg-primary text-primary-foreground mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-[15.5px] font-semibold"
        >
          Yana himoya qilish
        </button>
      ) : null}

      {error ? (
        <p role="alert" data-domla-chat-error className="text-destructive mt-3 text-[14.5px]">
          {error}
        </p>
      ) : null}

      {chat.status === "active" ? (
        <div className="mt-4 flex flex-col gap-2" data-domla-composer>
          {rec ? (
            <div className="flex items-center gap-2" data-domla-recording>
              <span className="bg-destructive size-3 animate-pulse rounded-full" aria-hidden />
              <span className="flex-1 text-[15px] tabular-nums" data-domla-rec-seconds>
                {Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, "0")} / {Math.floor(DOMLA_VOICE_MAX_SECONDS / 60)}:00
              </span>
              <button
                type="button"
                data-domla-rec-cancel
                onClick={() => stopRec(true)}
                aria-label="Bekor qilish"
                className="border-input inline-flex size-12 items-center justify-center rounded-2xl border"
              >
                <X className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                data-domla-rec-stop
                onClick={() => stopRec(false)}
                aria-label="Yuborish"
                className="bg-primary text-primary-foreground inline-flex size-12 items-center justify-center rounded-2xl"
              >
                <Square className="size-5" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <AutoTextarea
                data-domla-text
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={DOMLA_TEXT_MAX_CHARS}
                minRows={1}
                maxRows={6}
                placeholder={chat.waiting === null ? "Domlani kuting…" : "Javobingizni yozing…"}
                aria-label="Javob matni"
                disabled={chat.waiting === null}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void sendText();
                  }
                }}
                className="border-input bg-background min-h-12 flex-1 rounded-2xl border px-3 py-3 text-[16px] outline-none"
              />
              {text.trim() || !mic ? (
                <button
                  type="button"
                  data-domla-send
                  onClick={() => void sendText()}
                  disabled={!canAnswer || !text.trim()}
                  aria-label="Javobni yuborish"
                  className="bg-primary text-primary-foreground inline-flex size-12 shrink-0 items-center justify-center rounded-2xl disabled:opacity-50"
                >
                  {sending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
                </button>
              ) : (
                <button
                  type="button"
                  data-domla-mic
                  onClick={() => void startRec()}
                  disabled={!canAnswer}
                  aria-label="Ovozli javob yozish"
                  className="bg-primary text-primary-foreground inline-flex size-12 shrink-0 items-center justify-center rounded-2xl disabled:opacity-50"
                >
                  {sending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Mic className="size-5" aria-hidden />}
                </button>
              )}
            </div>
          )}
          {mic ? (
            <p className="text-muted-foreground text-[13px]">🎙 Mikrofonni bosing, gapiring, keyin ■ bilan yuboring (ko‘pi bilan 2 daqiqa). Yoki javobni yozing.</p>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="mt-3">
          <button
            type="button"
            data-domla-to-bot
            onClick={() => void toBot()}
            className="bg-accent text-foreground inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold"
          >
            Botda davom etish
          </button>
          {noTelegram ? (
            <p role="alert" data-domla-no-telegram className="text-destructive mt-2 text-[14.5px]">
              Botda davom etish uchun avval Telegram akkauntini bog‘lang — Telegram orqali kiring. Hozircha himoyani shu yerda davom ettiring.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
