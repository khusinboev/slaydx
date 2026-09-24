"use client";

import Link from "next/link";
import { useEffect } from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";

/**
 * Klient xatosi uchun chegara.
 *
 * Ilgari `error.tsx` yo'q edi: har qanday render xatosi butun sahifani
 * oq ekranga aylantirardi va foydalanuvchi hech narsa qila olmasdi.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // W4-D R1: deploydan keyin eski bo'lak yo'q — `reset()` emas, BIR MARTA to'liq qayta yuklash.
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    console.error("[ui]", error.message, error.digest ?? "");
    reloadOnceForChunkError(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Nimadir noto&apos;g&apos;ri ketdi</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {chunk
          ? "Saytning yangi versiyasi chiqdi — sahifa yangilanmoqda. Yangilanmasa, «Qayta urinish» ni bosing."
          : "Sahifani yuklashda xatolik yuz berdi. Qayta urinib ko‘ring."}
      </p>
      {error.digest ? (
        <p className="text-muted-foreground mt-1 font-mono text-xs">Kod: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          // Bo'lak xatosida `reset()` keshlangan xatoni qayta otadi — to'liq qayta yuklash kerak.
          onClick={chunk ? () => window.location.reload() : reset}
          className="bg-primary text-primary-foreground h-10 rounded-full px-5 text-sm font-medium"
        >
          Qayta urinish
        </button>
        <Link href="/uz" className="bg-card h-10 rounded-full border px-5 text-sm leading-10 font-medium">
          Bosh sahifa
        </Link>
      </div>
    </div>
  );
}
