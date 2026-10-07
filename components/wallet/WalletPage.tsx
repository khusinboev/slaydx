"use client";

import { PurchasePage } from "@/components/purchase/PurchasePage";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * Hamyon (`/uz/wallet`) — interim page laid by the shell package (F0): the
 * existing top-up page (`PurchasePage`: `?order=` return banners, top-up card
 * → PayDialog, recent orders) under the tab's `PageHeader`. Package W3
 * replaces it (balance hero, packages, ledger, referral).
 */
export function WalletPage() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Hamyon" subtitle="Balans va to‘ldirish" contentClassName="max-w-5xl" />
      <PurchasePage />
    </div>
  );
}
