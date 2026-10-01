import type { Metadata } from "next";
import { GenerationDetail } from "@/components/admin/generations/GenerationDetail";
import { adminToolOptions } from "@/lib/server/admin-generations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Generatsiya" };

/** S7: one job (permission `jobs.view`, enforced by the API; a bad id is the API's 404). */
export default async function AdminGenerationRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GenerationDetail id={id} tools={adminToolOptions()} />;
}
