import type { Metadata } from "next";
import { PurchasesPage } from "@/components/market/PurchasesPage";

export const metadata: Metadata = { title: "Xaridlarim", robots: { index: false, follow: false } };

export default function Page() {
  return <PurchasesPage />;
}
