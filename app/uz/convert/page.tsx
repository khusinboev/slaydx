import type { Metadata } from "next";
import { ConvertPage } from "@/components/convert/ConvertPage";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata: Metadata = {
  title: "Fayl konvertatsiya",
  description: "Word, PowerPoint, PDF va rasmlarni tekin o'giring",
};

export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Konvertatsiya" subtitle="Fayl formatini tekin o‘zgartiring" contentClassName="max-w-xl" />
      <ConvertPage />
    </div>
  );
}
