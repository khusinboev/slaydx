import type { Metadata } from "next";
import { AlifboPage } from "@/components/alifbo/AlifboPage";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata: Metadata = {
  title: "Alifbo: Kirill ↔ Lotin ↔ Yangi lotin — tekin",
  description: "O'zbek matnini Kirill, Lotin va yangi Lotin alifbolari orasida tekin o'giring",
};

export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Alifbo" subtitle="Kirill ↔ Lotin ↔ Yangi lotin — tekin" contentClassName="max-w-2xl" />
      <AlifboPage />
    </div>
  );
}
