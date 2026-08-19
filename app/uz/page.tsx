import { Suspense } from "react";
import { HomeFiles } from "@/components/home/HomeFiles";

export default function UzHomePage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>}>
      <HomeFiles />
    </Suspense>
  );
}
