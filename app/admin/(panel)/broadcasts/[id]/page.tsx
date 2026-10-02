import type { Metadata } from "next";
import { BroadcastDetail } from "@/components/admin/broadcasts/BroadcastDetail";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Xabar" };

/** S13 detail: delivery progress and cancel (permission `broadcasts.view`; a bad id is the API's 404). */
export default async function AdminBroadcastRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BroadcastDetail id={id} />;
}
