/**
 * Bu marshrut DINAMIK (`ƒ`) — har navigatsiyada serverdan RSC ma'lumoti
 * so'raladi, static sahifalar kabi oldindan yuklab (prefetch) bo'lmaydi.
 *
 * Next.js bu faylni navigatsiya BOSHLANGAN zahoti (server javobini
 * kutmasdan) ko'rsatadi — shu fayl bo'lmasa, bosishdan haqiqiy sahifa
 * chizilgunga qadar EKRANDA HECH NARSA o'zgarmasdi: foydalanuvchiga
 * tugma "ishlamayotgandek" tuyulardi, so'ng birdaniga sahifa ochilardi.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="border-muted-foreground/30 border-t-primary mx-auto size-6 animate-spin rounded-full border-2" />
      <p className="text-muted-foreground mt-4 text-sm">Yuklanmoqda…</p>
    </div>
  );
}
