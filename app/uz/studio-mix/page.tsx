import { redirect } from "next/navigation";

/**
 * `studio-mix` is the «Montaj» mode of the Studio's «Audio» tab (docs/studio/P8-SPEC.md «P8c»), not a page of its own:
 * links to the tool's slug (a result page's «Qayta», a bot link) land on the tab.
 */
export default function Page() {
  redirect("/uz/studio?tab=audio");
}
