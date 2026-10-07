import { Suspense } from "react";
import type { Metadata } from "next";
import { HomeFiles } from "@/components/home/HomeFiles";

export const metadata: Metadata = { title: "Ishlarim" };

/** Ishlarim — the file list tab (moved from `/uz`); its view state lives in the URL (`?filter&sort&desc`). */
export default function FilesPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-[15px]">Yuklanmoqda...</div>}>
      <HomeFiles />
    </Suspense>
  );
}
