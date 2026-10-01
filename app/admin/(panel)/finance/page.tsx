import type { Metadata } from "next";
import { FinancePage } from "@/components/admin/finance/FinancePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moliya" };

/** S10: revenue summary, global ledger, reconciliation (permission `finance.view`, enforced by the API). */
export default function AdminFinanceRoute() {
  return <FinancePage />;
}
