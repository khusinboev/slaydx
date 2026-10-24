import type { Metadata } from "next";
import { DomlaPage } from "@/components/domla/DomlaPage";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata: Metadata = {
  title: "Qattiqqo‘l domla",
  description: "Slaydingizni domla oldida ovoz bilan himoya qiling",
};

export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Qattiqqo‘l domla" subtitle="Slaydingizni ovoz bilan himoya qiling" contentClassName="max-w-xl" />
      <DomlaPage />
    </div>
  );
}
