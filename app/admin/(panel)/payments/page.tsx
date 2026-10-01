import type { Metadata } from "next";
import { PaymentsPage } from "@/components/admin/payments/PaymentsPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "To'lovlar" };

/** S8: Click and Payme orders (permission `payments.view`, enforced by the API). */
export default function AdminPaymentsRoute() {
  return <PaymentsPage />;
}
