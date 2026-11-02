import { redirect } from "next/navigation";

/**
 * `studio-speech` is the Studio's «Ovoz» tab (docs/studio/P5-SPEC.md), not a page of its own: links to the tool's slug
 * (a result page's «Qayta», a bot link) land on the tab.
 */
export default function Page() {
  redirect("/uz/studio?tab=ovoz");
}
