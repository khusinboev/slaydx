import type { Metadata } from "next";
import { AiPage } from "@/components/admin/ai/AiPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "AI xarajat" };

/** S11: AI cost and provider health (permission `ai.view`, enforced by the API). */
export default function AdminAiRoute() {
  return <AiPage />;
}
