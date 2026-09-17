"use client";

import { useEffect, useState } from "react";
import type { PublicGameView } from "@/lib/game/public";

/**
 * O'YINCHI TOMONI (AUDIT-22 R0 — SKELET).
 *
 * R0 da bu komponent uchta ekranni biladi: yuklanmoqda → ism → o'yin
 * (hozircha faqat «nima o'ynalishi» ni ko'rsatadi) → natija. Har tur
 * uchun haqiqiy o'yin ekranlari (`Sorting`, `Listening`, `Quiz`,
 * `Crossword`, `Cards`) va holat mashinasi (`lib/game/engine.ts`) —
 * WP-C da; ular shu qobiqqa ulanadi va `submit` chaqiruvi o'zgarmaydi.
 *
 * NEGA SKELET BO'LSA HAM HOZIR: ochiq route va sessiya HOZIR yozilyapti
 * (WP-B), va ularni faqat haqiqiy sahifa bilan sinab ko'rish mumkin —
 * «havola → ism → natija» oqimi R0 dayoq uchidan-uchiga ishlaydi.
 *
 * MUHIM: bu komponent BALL HISOBLAMAYDI va to'g'ri javobni KO'RMAYDI —
 * `/api/o/[token]` uni bermaydi, ball esa `submit` javobidan keladi.
 */
export function GamePlayer({ token }: { token: string }) {
  const [view, setView] = useState<PublicGameView | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [started, setStarted] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [result, setResult] = useState<{ score: number; total: number; percent: number } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/o/${token}`, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Havola topilmadi yoki muddati tugagan" : "O‘yinni yuklab bo‘lmadi");
        return r.json() as Promise<{ game: PublicGameView; title: string }>;
      })
      .then((d) => {
        if (!alive) return;
        setView(d.game);
        setTitle(d.title);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [token]);

  async function submit() {
    if (sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/o/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          // WP-C: haqiqiy javoblar (`element id → tanlov`). R0 da bo'sh —
          // natija 0 ball bo'ladi, lekin butun yo'l (token → ball →
          // egasining jadvali) ishlayotgani ko'rinadi.
          answers: {},
          seconds: Math.round((Date.now() - startedAt) / 1000),
        }),
      });
      const data = (await res.json()) as { score?: number; total?: number; percent?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Natijani yuborib bo‘lmadi");
      setResult({ score: data.score ?? 0, total: data.total ?? 0, percent: data.percent ?? 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!view) return <p className="text-sm text-black/50">O‘yin yuklanmoqda…</p>;

  if (result) {
    return (
      <section className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">Natija</h1>
        <p className="text-3xl font-bold">
          {result.score} / {result.total}
        </p>
        <p className="mt-1 text-sm text-black/60">{result.percent}%</p>
        <p className="mt-4 text-xs text-black/40">Natijangiz o‘qituvchingizga yuborildi.</p>
      </section>
    );
  }

  if (!started) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold">{title || "O‘yin"}</h1>
        <p className="mb-4 text-sm text-black/60">{KIND_LABEL[view.kind]} · {view.total} ta topshiriq</p>
        <label className="mb-2 block text-sm font-medium" htmlFor="player-name">
          Ismingiz
        </label>
        <input
          id="player-name"
          className="mb-4 w-full rounded-lg border border-black/15 px-3 py-2 text-[15px]"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ism familiya"
        />
        <button
          type="button"
          className="w-full rounded-lg bg-black px-4 py-2.5 text-[15px] font-medium text-white disabled:opacity-40"
          disabled={!name.trim()}
          onClick={() => {
            setStarted(true);
            setStartedAt(Date.now());
          }}
        >
          Boshlash
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-lg font-semibold">{title || "O‘yin"}</h1>
      <p className="mb-4 text-sm text-black/60">
        {KIND_LABEL[view.kind]} · {view.total} ta topshiriq
      </p>
      {/*
       * WP-C: shu joyga tur bo'yicha ekran qo'yiladi
       * (`Sorting`/`Listening`/`Quiz`/`Crossword`/`Cards`). Qobiq
       * o'zgarmaydi: ism, vaqt hisobi va `submit` shu yerda qoladi.
       */}
      <p className="mb-4 rounded-lg bg-black/[0.04] px-3 py-2 text-sm text-black/60">O‘yin ekrani tayyorlanmoqda.</p>
      <button
        type="button"
        className="w-full rounded-lg bg-black px-4 py-2.5 text-[15px] font-medium text-white disabled:opacity-40"
        disabled={sending}
        onClick={submit}
      >
        {sending ? "Yuborilmoqda…" : "Yakunlash"}
      </button>
    </section>
  );
}

const KIND_LABEL: Record<PublicGameView["kind"], string> = {
  quiz: "Test",
  crossword: "Krossvord",
  flashcards: "Flesh kartalar",
  sorting: "Saralash",
  listening: "Tinglash",
};
