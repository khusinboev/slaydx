"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { ApiError, request } from "@/lib/api-client";
import { CHAT_MESSAGE_MAX, freeLine, type ChatCard, type ChatMessageView, type ChatReply, type ChatStatus } from "@/lib/chat/types";
import { formatSom } from "@/lib/format";

/**
 * AI chat page (`/uz/chat`, owner request 8) -- mobile first, Mini App friendly.
 *
 * All rules are the server's (`lib/server/chat`): this page sends text, renders replies and proposal cards, and posts the
 * tap on «Tasdiqlash» with the card's token. It never decides a price or a quota. A retried send reuses its client id, so
 * a lost response cannot charge twice.
 */

type Item = ChatMessageView & { pending?: boolean; failed?: boolean };
type CardUi = { busy?: boolean; error?: string; topUp?: string; done?: { id: string }; cancelled?: boolean; state?: "open" | "used" | "expired" };

const SUGGESTIONS = ["Slayd narxi qancha?", "Bonus qanday olinadi?", "Menga 'Suv aylanishi' haqida 10 slaydli taqdimot qil"];

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; topUp?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<Record<string, CardUi>>({});
  const retry = useRef<{ text: string; id: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    request<{ status: ChatStatus; messages: ChatMessageView[] }>("/api/chat").then(
      (d) => {
        if (!alive) return;
        setStatus(d.status);
        setItems(d.messages);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError({ text: e instanceof ApiError ? e.message : "Chatni yuklab bo'lmadi" });
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [items.length, busy]);

  const send = useCallback(
    async (raw: string) => {
      const body = raw.trim();
      if (!body || busy) return;
      const reuse = retry.current && retry.current.text === body ? retry.current.id : null;
      const clientId = reuse ?? newId();
      retry.current = { text: body, id: clientId };
      setBusy(true);
      setError(null);
      setText("");
      const mine: Item = { id: `local-${clientId}`, role: "user", content: body, createdAt: new Date().toISOString(), pending: true };
      setItems((prev) => [...prev.filter((m) => m.id !== mine.id), mine]);
      try {
        const r = await request<ChatReply>("/api/chat", { method: "POST", body: JSON.stringify({ text: body, clientId }), timeoutMs: 60_000 });
        retry.current = null;
        setStatus(r.status);
        setItems((prev) => [...prev.filter((m) => m.id !== mine.id), { ...mine, id: `u-${r.reply.id}`, pending: false }, r.reply]);
      } catch (e) {
        const api = e instanceof ApiError ? e : null;
        setItems((prev) => prev.map((m) => (m.id === mine.id ? { ...m, pending: false, failed: true } : m)));
        if (api?.status === 402 || api?.status === 429) retry.current = null;
        const topUp = api && typeof api.data?.topUp === "string" ? api.data.topUp : undefined;
        setError({ text: api?.message ?? "Xabar yuborilmadi. Qayta urinib ko'ring.", topUp: api?.status === 402 ? (topUp ?? "/uz/wallet") : undefined });
        if (api?.status === 402 || api?.status === 429) setText(body);
        void request<{ status: ChatStatus }>("/api/chat").then((d) => setStatus(d.status), () => undefined);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const patchCard = (token: string, patch: CardUi) => setCards((prev) => ({ ...prev, [token]: { ...prev[token], ...patch } }));

  const confirm = async (card: Extract<ChatCard, { kind: "confirm" }>) => {
    patchCard(card.token, { busy: true, error: undefined, topUp: undefined });
    try {
      const r = await request<{ id: string }>("/api/chat/confirm", { method: "POST", body: JSON.stringify({ token: card.token, hash: card.hash }) });
      patchCard(card.token, { busy: false, done: { id: r.id } });
      void request<{ status: ChatStatus }>("/api/chat").then((d) => setStatus(d.status), () => undefined);
    } catch (e) {
      const api = e instanceof ApiError ? e : null;
      const used = api?.status === 409 && api.data?.code === "used";
      patchCard(card.token, {
        busy: false,
        error: api?.message ?? "Tasdiqlab bo'lmadi",
        topUp: api?.status === 402 ? (typeof api.data?.topUp === "string" ? api.data.topUp : "/uz/wallet") : undefined,
        state: used ? "used" : api?.status === 410 ? "expired" : undefined,
      });
    }
  };

  const cancel = async (card: Extract<ChatCard, { kind: "confirm" }>) => {
    patchCard(card.token, { busy: true });
    await request("/api/chat/cancel", { method: "POST", body: JSON.stringify({ token: card.token }) }).catch(() => undefined);
    patchCard(card.token, { busy: false, cancelled: true });
  };

  const off = status ? !status.enabled : false;
  const paid = status ? status.freeLeft === 0 : false;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4" data-chat>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]" data-chat-meta>
        <span data-chat-free aria-live="polite">
          {status ? freeLine(status) : "…"}
        </span>
        {status && paid && status.enabled ? (
          <span data-chat-price>Keyingi xabar: {formatSom(status.pricePerMessage)}</span>
        ) : null}
      </div>

      <div className="flex min-h-[46dvh] flex-1 flex-col gap-3 pb-4" data-chat-list role="log" aria-label="Suhbat">
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 text-[15px]">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Yuklanmoqda…
          </p>
        ) : null}
        {!loading && items.length === 0 ? (
          <div className="bg-card flex flex-col gap-3 rounded-[20px] border p-4" data-chat-empty>
            <p className="flex items-center gap-2 text-[15.5px] font-semibold">
              <Sparkles className="size-5" aria-hidden /> SlaydX yordamchisi
            </p>
            <p className="text-muted-foreground text-[14.5px]">
              Xizmatlar, narxlar, bonuslar haqida so&apos;rang — yoki hujjat yaratishni so&apos;rang, men tasdiqlash kartasini tayyorlayman.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  data-chat-suggestion
                  onClick={() => setText(s)}
                  className="bg-muted/70 hover:bg-accent focus-visible:ring-ring min-h-11 rounded-2xl px-3 py-2 text-left text-[14px] outline-none focus-visible:ring-2"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {items.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex flex-col items-end gap-1" : "flex flex-col items-start gap-2"} data-chat-msg={m.role}>
            <div
              className={
                m.role === "user"
                  ? "bg-primary text-primary-foreground max-w-[88%] rounded-[18px] rounded-br-md px-3.5 py-2.5 text-[15.5px] break-words whitespace-pre-wrap"
                  : "bg-card max-w-[92%] rounded-[18px] rounded-bl-md border px-3.5 py-2.5 text-[15.5px] break-words whitespace-pre-wrap"
              }
              data-pending={m.pending ? "1" : undefined}
            >
              {m.content}
            </div>
            {m.failed ? (
              <button type="button" data-chat-retry className="text-destructive text-[13px] underline" onClick={() => void send(m.content)}>
                Yuborilmadi — qayta yuborish
              </button>
            ) : null}
            {m.card ? <CardView card={m.card} ui={cards[m.card.kind === "confirm" ? m.card.token : ""] ?? {}} onConfirm={confirm} onCancel={cancel} /> : null}
          </div>
        ))}

        {busy ? (
          <p className="text-muted-foreground flex items-center gap-2 text-[14px]" data-chat-typing>
            <Loader2 className="size-4 animate-spin" aria-hidden /> Yozmoqda…
          </p>
        ) : null}
        <div ref={bottom} />
      </div>

      {error ? (
        <div role="alert" data-chat-error className="text-destructive mb-2 flex flex-col gap-1 text-[14.5px]">
          <span>{error.text}</span>
          {error.topUp ? (
            <Link href={error.topUp} data-chat-topup className="text-primary underline">
              Hamyonni to&apos;ldirish
            </Link>
          ) : null}
        </div>
      ) : null}

      {off ? (
        <p role="status" data-chat-off className="text-muted-foreground pb-6 text-[15px]">
          AI chat hozircha o&apos;chirilgan.
        </p>
      ) : (
        <form
          data-chat-form
          className="bg-background sticky bottom-0 flex items-end gap-2 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <AutoTextarea
            data-chat-input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, CHAT_MESSAGE_MAX))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(text);
              }
            }}
            minRows={1}
            maxRows={5}
            placeholder="Xabar yozing…"
            aria-label="Xabar"
            className="border-input bg-card focus:ring-ring min-h-12 w-full rounded-[18px] border px-3.5 py-3 text-[16px] leading-snug outline-none focus:ring-2"
          />
          <button
            type="submit"
            data-chat-send
            disabled={busy || !text.trim()}
            aria-label="Yuborish"
            className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex size-12 shrink-0 items-center justify-center rounded-2xl outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
          </button>
        </form>
      )}
    </div>
  );
}

function CardView({
  card,
  ui,
  onConfirm,
  onCancel,
}: {
  card: ChatCard;
  ui: CardUi;
  onConfirm: (c: Extract<ChatCard, { kind: "confirm" }>) => void;
  onCancel: (c: Extract<ChatCard, { kind: "confirm" }>) => void;
}) {
  if (card.kind === "adjust") {
    return (
      <div className="bg-card w-full max-w-[92%] rounded-[18px] border border-amber-500/50 p-3.5" data-chat-card="adjust">
        <p className="text-[15px] font-semibold">{card.toolTitle}: ma&apos;lumotni to&apos;g&apos;rilash kerak</p>
        <ul className="text-muted-foreground mt-1.5 list-disc pl-5 text-[14px]" data-chat-issues>
          {card.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-2 text-[13.5px]">Yetishmayotgan yoki noto&apos;g&apos;ri qiymatni yozing — men kartani qayta tayyorlayman.</p>
      </div>
    );
  }
  const state = ui.state ?? card.state ?? "open";
  const closed = ui.cancelled || ui.done || state !== "open";
  return (
    <div className="bg-card w-full max-w-[92%] rounded-[18px] border p-3.5" data-chat-card="confirm" data-card-state={ui.done ? "done" : ui.cancelled ? "cancelled" : state}>
      <p className="text-[15px] font-semibold" data-chat-card-title>
        {card.toolTitle}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14.5px]" data-chat-card-params>
        {card.params.map((p) => (
          <div key={p.label} className="contents">
            <dt className="text-muted-foreground">{p.label}</dt>
            <dd className="break-words">{p.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[16px] font-semibold" data-chat-card-price>
        Narx: {formatSom(card.price)}
      </p>
      {ui.done ? (
        <p className="mt-2 text-[14.5px]" data-chat-card-done>
          <Check className="mr-1 inline size-4" aria-hidden />
          Boshlandi. <Link href={`/uz/files/${ui.done.id}`} className="text-primary underline">Ishlarim</Link> bo&apos;limida kuzating.
        </p>
      ) : ui.cancelled ? (
        <p className="text-muted-foreground mt-2 text-[14px]">Bekor qilindi.</p>
      ) : state === "used" ? (
        <p className="text-muted-foreground mt-2 text-[14px]">Bu taklif ishlatilgan.</p>
      ) : state === "expired" ? (
        <p className="text-muted-foreground mt-2 text-[14px]">Taklif muddati tugadi — qaytadan so&apos;rang.</p>
      ) : null}
      {!closed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-chat-confirm
            disabled={ui.busy}
            onClick={() => onConfirm(card)}
            className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            {ui.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            Tasdiqlash
          </button>
          <button
            type="button"
            data-chat-cancel
            disabled={ui.busy}
            onClick={() => onCancel(card)}
            className="bg-muted/70 hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            <X className="size-4" aria-hidden />
            Bekor qilish
          </button>
        </div>
      ) : null}
      {ui.error ? (
        <div role="alert" data-chat-card-error className="text-destructive mt-2 flex flex-col gap-1 text-[14px]">
          <span>{ui.error}</span>
          {ui.topUp ? (
            <Link href={ui.topUp} data-chat-topup className="text-primary underline">
              Hamyonni to&apos;ldirish
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
