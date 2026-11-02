import { redirect } from "next/navigation";

/** `studio-voice` (the voice clone, docs/studio/P5-SPEC.md) is sold inside the Studio's «Ovoz» tab. */
export default function Page() {
  redirect("/uz/studio?tab=ovoz");
}
