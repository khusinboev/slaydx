import type { Metadata } from "next";
import { OrderDetailPage } from "@/components/admin/payments/OrderDetailPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Buyurtma" };

/** S9: one order (permission `payments.view`, enforced by the API). The id is validated by the client and the API. */
export default async function AdminOrderRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailPage id={id} />;
}
