"use client";

import { useState } from "react";

/**
 * ISM DARVOZASI (AUDIT-22 WP-C) — egasi qarori 8: «loginsiz, ism kiritiladi».
 *
 * Bu o'yinning YAGONA identifikatori: o'qituvchi natijalar jadvalida
 * aynan shu qatorni ko'radi. Shuning uchun ism BO'SH bo'lolmaydi
 * (tugma o'chiq) va 40 belgi bilan cheklanadi — server ham
 * (`PLAYER_NAME_MAX`) shu songa kesadi, ya'ni o'quvchi yozgan uzun matn
 * jimgina qirqilib ketmasin, u buni HOZIR ko'rsin.
 *
 * Parol, telefon yoki sinf so'ralmaydi: ochiq havolada yig'ilgan har
 * qanday qo'shimcha ma'lumot — loginsiz xizmatda himoyasiz ma'lumot.
 */
export const PLAYER_NAME_MAX = 40;

export function NameGate({
  title,
  kindLabel,
  total,
  onStart,
}: {
  title: string;
  kindLabel: string;
  total: number;
  onStart: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const ready = name.trim().length > 0;

  return (
    <form
      className="bg-card rounded-2xl border p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onStart(name.trim());
      }}
    >
      <h1 className="text-xl font-semibold text-balance">{title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {kindLabel} · {total} ta topshiriq
      </p>

      <label className="mt-5 mb-2 block text-sm font-medium" htmlFor="player-name">
        Ismingiz
      </label>
      <input
        id="player-name"
        name="player-name"
        autoComplete="name"
        className="border-input bg-background focus:border-primary h-12 w-full rounded-xl border px-4 text-[16px] outline-none"
        maxLength={PLAYER_NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ism familiya"
      />
      <p className="text-muted-foreground mt-1.5 text-xs">
        Natijangiz shu ism bilan o‘qituvchingizga ko‘rinadi.
      </p>

      <button
        type="submit"
        className="bg-primary text-primary-foreground mt-5 h-12 w-full rounded-xl text-[16px] font-semibold disabled:opacity-40"
        disabled={!ready}
      >
        Boshlash
      </button>
    </form>
  );
}
