import type { Metadata } from "next";
import { GamePlayer } from "@/components/game/Player";

/**
 * OCHIQ O'YIN SAHIFASI (AUDIT-22 R0) — loginsiz, egasi qarori 8.
 *
 * `noindex, nofollow` MAJBURIY: havola o'qituvchi tarqatgan sinfga
 * tegishli, qidiruv tizimida chiqib ketishi kerak emas (o'yin javoblari
 * bo'lmasa ham, o'quvchilar ismlari bilan natijalar to'planadigan
 * sahifa). `robots` meta — sahifa darajasida, `/o/` yo'li esa
 * `app/robots.ts` da ham yopilishi mumkin (R bosqichi).
 *
 * Sahifa SERVER komponenti, lekin ma'lumotni O'ZI olmaydi: token
 * brauzerda `/api/o/[token]` orqali so'raladi (`GamePlayer`). Sabab —
 * ochiq HTML ga o'yin ma'lumotini qo'yish uni keshlarga (CDN, brauzer
 * tarixi) tarqatardi, JSON esa `private, no-store` bilan keladi.
 */
export const metadata: Metadata = {
  title: "O'yin",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function PublicGamePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <GamePlayer token={token} />
    </main>
  );
}
