import type { Metadata } from "next";
import { TestsPage } from "@/components/tests/TestsPage";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata: Metadata = {
  title: "Test ishlash",
  description: "Fanlar bo‘yicha tayyor testlar: vaqt bilan ishlang, oxirida to‘g‘ri javoblarni ko‘ring",
};

export default function Page() {
  return (
    <div className="flex w-full flex-col">
      <PageHeader title="Test ishlash" subtitle="Vaqt bilan ishlang, oxirida to‘g‘ri javoblar" contentClassName="max-w-xl" />
      <TestsPage />
    </div>
  );
}
