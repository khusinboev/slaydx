import { redirect } from "next/navigation";

/**
 * `studio-video` is the Studio's «Video» tab (docs/studio/P3-SPEC.md), not a page of its own: links to the tool's slug
 * (a result page's «Qayta», a bot link) land on the tab.
 */
export default function Page() {
  redirect("/uz/studio?tab=video");
}
