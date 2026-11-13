"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, GraduationCap, Loader2, Mic } from "lucide-react";
import { Card } from "@/components/forms/compact";
import { ApiError, request } from "@/lib/api-client";
import { formatPoints } from "@/lib/referral";
import { getTelegramWebApp } from "@/lib/telegram-webapp";
import { DomlaChat } from "./DomlaChat";

/**
 * «Qattiqqo'l domla» page (`/uz/domla`, owner request 15): pick one of your finished slide works, press
 * «Himoyani boshlash» (the server charges `domla.price` and queues the questions). Since 2026-11-13 the defence runs
 * HERE as a chat (`DomlaChat`, channel `web`) and can move to the bot and back at any moment, continuing from the same
 * question: a defence living in the bot shows its card with «Saytda davom etish»; the bot's own «Saytda davom etish»
 * button opens this page with `?davom=web`, which moves it here. The page also shows the history of grades. The price
 * comes from the server only; the ideal answers of unanswered questions never reach the page.
 */

type Work = { id: string; toolId: string; topic: string; slides: number; createdAt: string };
type Result = { question: string; score: number; verdict: string };
type Session = {
  id: string;
  status: "preparing" | "active" | "finished" | "expired" | "failed";
  topic: string;
  grade: 2 | 3 | 4 | 5 | null;
  createdAt: string;
  progress: { answered: number; total: number };
  results: Result[];
  weakest: { question: string; mistake: string; ideal: string } | null;
  /** Only on the open defence: where it runs now (older servers: absent = bot). */
  channel?: "bot" | "web";
};

/** `?davom=web` (the bot's «Saytda davom etish»): read once, then dropped from the address bar. */
function takeContinueParam(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("davom") !== "web") return false;
  url.searchParams.delete("davom");
  try {
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // An address bar that cannot be rewritten changes nothing here.
  }
  return true;
}
type State = {
  enabled: boolean;
  price: number;
  telegramLinked: boolean;
  botUrl: string | null;
  works: Work[];
  open: Session | null;
  history: Session[];
};

const dateText = (iso: string): string => new Date(iso).toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric" });

function BotLink({ url }: { url: string | null }) {
  if (!url) return null;
  const open = (e: React.MouseEvent) => {
    const app = getTelegramWebApp();
    if (app?.openTelegramLink) {
      e.preventDefault();
      app.openTelegramLink(url);
    }
  };
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={open}
      data-domla-bot-link
      className="bg-accent text-foreground mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold"
    >
      <Mic className="size-5" aria-hidden />
      Botda davom eting
    </a>
  );
}

export function DomlaPage() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ again: boolean } | null>(null);
  /** The defence shown as the web chat (set while it runs on the web, kept after it ends until «Yana himoya qilish»). */
  const [chatId, setChatId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const wantsWeb = useRef<boolean | null>(null);

  const toWeb = useCallback(async (sessionId: string) => {
    setMoving(true);
    setError(null);
    try {
      await request(`/api/domla/sessions/${sessionId}/channel`, { method: "POST", body: JSON.stringify({ channel: "web" }) });
      setChatId(sessionId);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Xatolik");
    } finally {
      setMoving(false);
    }
  }, []);

  const load = useCallback(() => {
    if (wantsWeb.current === null) wantsWeb.current = takeContinueParam();
    request<State>("/api/domla").then(
      (s) => {
        setState(s);
        setLoadError(null);
        setPick((cur) => cur ?? s.works[0]?.id ?? null);
        if (s.open && s.open.channel === "web") setChatId(s.open.id);
        else if (s.open && wantsWeb.current) void toWeb(s.open.id);
        wantsWeb.current = false;
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : "Yuklab bo‘lmadi"),
    );
  }, [toWeb]);
  useEffect(load, [load]);

  const start = async () => {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ alreadyOpen: boolean; sessionId?: string; channel?: "bot" | "web" }>("/api/domla", { method: "POST", body: JSON.stringify({ generationId: pick }) });
      setStarted({ again: r.alreadyOpen });
      // A web start runs here; an already open BOT defence of the same work stays in the bot (its card offers the move).
      if (r.sessionId && r.channel !== "bot") setChatId(r.sessionId);
      load();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Xatolik");
    } finally {
      setBusy(false);
    }
  };

  const backFromChat = () => {
    setChatId(null);
    setStarted(null);
    load();
  };

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        <p role="alert" data-domla-load-error className="text-destructive text-[14.5px]">
          {loadError}
        </p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pb-8" data-domla-loading>
        <Loader2 className="size-6 animate-spin" aria-label="Yuklanmoqda" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-8" data-domla>
      {!state.enabled ? (
        <Card title="Qattiqqo‘l domla">
          <p role="status" data-domla-off className="text-muted-foreground text-[15px]">
            Domla hozircha dam olyapti. Birozdan keyin qayting.
          </p>
        </Card>
      ) : chatId ? (
        <>
          {started ? (
            <p role="status" data-domla-started className="mb-3 text-[15px]">
              {started.again ? "Bu himoya allaqachon boshlangan — qayta to‘lov yechilmadi." : "Boshlandi! Domla savollarni tayyorlayapti — savollar shu yerda chiqadi."}
            </p>
          ) : null}
          <DomlaChat
            key={chatId}
            sessionId={chatId}
            telegramLinked={state.telegramLinked}
            onBot={() => {
              setChatId(null);
              setStarted(null);
              load();
            }}
            onAgain={backFromChat}
          />
        </>
      ) : state.open ? (
        <Card title="Davom etayotgan himoya" aside={<span data-domla-progress>{state.open.progress.answered}/{state.open.progress.total}</span>}>
          <p className="text-[15px]" data-domla-open>
            «{state.open.topic || "—"}» —{" "}
            {state.open.status === "preparing" ? "domla savollarni tayyorlayapti…" : "javoblarni botda ovozli xabar bilan yuboring."}
          </p>
          <BotLink url={state.botUrl} />
          <button
            type="button"
            data-domla-to-web
            disabled={moving}
            onClick={() => void toWeb(state.open!.id)}
            className="border-input mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border px-4 text-[15.5px] font-semibold disabled:opacity-50"
          >
            {moving ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Globe className="size-5" aria-hidden />}
            Saytda davom etish
          </button>
          {error ? (
            <p role="alert" data-domla-error className="text-destructive mt-3 text-[14.5px]">
              {error}
            </p>
          ) : null}
        </Card>
      ) : (
        <Card title="Himoyani boshlash" aside={<span data-domla-price>{formatPoints(state.price)} so‘m</span>}>
          <p className="text-muted-foreground mb-3 text-[14.5px]">
            Domla 5 ta savolni OVOZ bilan so‘raydi, siz shu yerda ovozli yoki yozma javob berasiz (xohlasangiz botda davom etasiz). Oxirida baho va adashgan joyingiz.
          </p>
          {!state.telegramLinked ? (
            <p data-domla-web-only className="text-muted-foreground mb-3 text-[14px]">
              Telegram bog‘lanmagan — himoya shu sahifada o‘tadi.
            </p>
          ) : null}
          {state.works.length === 0 ? (
            <p data-domla-no-works className="text-muted-foreground text-[15px]">
              Himoya qilish uchun tayyor slayd yo‘q. Avval slayd yarating.
            </p>
          ) : (
            <>
              <div role="radiogroup" aria-label="Qaysi ishni himoya qilamiz" className="flex flex-col gap-2" data-domla-works>
                {state.works.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={pick === w.id}
                    data-domla-work={w.id}
                    onClick={() => setPick(w.id)}
                    className={`min-h-12 rounded-2xl border px-3 py-2 text-left text-[15px] ${pick === w.id ? "border-primary bg-accent" : "border-input"}`}
                  >
                    <span className="font-medium">{w.topic || "—"}</span>
                    <span className="text-muted-foreground block text-[13px]">
                      {w.toolId === "pro-slide" ? "Pro slayd" : "Slayd"} · {w.slides} ta · {dateText(w.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                data-domla-start
                disabled={!pick || busy}
                onClick={start}
                className="bg-primary text-primary-foreground focus-visible:ring-ring mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <GraduationCap className="size-5" aria-hidden />}
                Himoyani boshlash
              </button>
            </>
          )}
          {error ? (
            <p role="alert" data-domla-error className="text-destructive mt-3 text-[14.5px]">
              {error}
            </p>
          ) : null}
          {started ? (
            <div role="status" data-domla-started className="mt-3 text-[15px]">
              {started.again ? "Bu himoya allaqachon boshlangan — qayta to‘lov yechilmadi." : "Boshlandi! Domla savollarni tayyorlayapti…"}
              {started.again ? <BotLink url={state.botUrl} /> : null}
            </div>
          ) : null}
        </Card>
      )}

      <Card title="Tarix">
        {state.history.length === 0 ? (
          <p data-domla-history-empty className="text-muted-foreground text-[15px]">
            Hali himoya qilmagansiz.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-domla-history>
            {state.history.map((h) => (
              <li key={h.id} data-domla-item={h.id} className="rounded-2xl border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{h.topic || "—"}</span>
                  <span className="text-[22px] font-bold" data-domla-grade>
                    {h.grade ?? "—"}
                  </span>
                </div>
                <p className="text-muted-foreground text-[13px]">
                  {dateText(h.createdAt)}
                  {h.status === "expired" ? " · muddati tugagan" : ""}
                </p>
                {h.results.length ? (
                  <ol className="mt-2 list-decimal pl-5 text-[14px]">
                    {h.results.map((r, i) => (
                      <li key={i}>
                        {r.score}/5 — {r.question}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {h.weakest ? (
                  <p className="mt-2 text-[14px]" data-domla-weakest>
                    <b>Adashgan joyingiz:</b> {h.weakest.question}
                    {h.weakest.mistake ? ` — ${h.weakest.mistake}` : ""}
                    <br />
                    <b>To‘g‘ri javob:</b> {h.weakest.ideal}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
