import type { Metadata } from "next";
import { PricingPage } from "@/components/admin/pricing/PricingPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Narxlar" };

/** S20: pricing and unit economics (permission `pricing.view`, enforced by the API). */
export default function AdminPricingRoute() {
  return <PricingPage />;
}
