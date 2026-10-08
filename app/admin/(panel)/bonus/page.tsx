import type { Metadata } from "next";
import { BonusPage } from "@/components/admin/bonus/BonusPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Bonus kanallar" };

/** Bonus channels (docs/bonus/PLAN.md K2; permission `bonus.view`, enforced by the API). */
export default function AdminBonusRoute() {
  return <BonusPage />;
}
