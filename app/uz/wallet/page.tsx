import { Suspense } from "react";
import type { Metadata } from "next";
import { WalletPage } from "@/components/wallet/WalletPage";

export const metadata: Metadata = {
  title: "Hamyon",
  description: "Balans va to'ldirish — Click yoki Payme orqali; har bir hujjat alohida to'lanadi",
};

export default function Page() {
  // `useSearchParams` (payment return `?order=`) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-[15px]">Yuklanmoqda...</div>}>
      <WalletPage />
    </Suspense>
  );
}
