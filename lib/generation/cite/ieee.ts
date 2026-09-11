/**
 * IEEE ro'yxat satri (Maqola 2, WP5) — `ieee` profili.
 *
 *   Maqola: C. Lin, A. Huang, and O. Lu, “Sarlavha,” Venue, pp. 45–67, 2023, doi: 10.….
 *   Kitob:  A. Karimov, Sarlavha. Toshkent: Fan, 2022.
 *
 * Qoidalar (IEEE Reference Guide 2022):
 *   • muallif «I. O. Familiya», ikkitasi «A and B», ko'p — «A, B, and C»
 *     (Oxford vergul); 7+ muallif → birinchi + «et al.»;
 *   • sarlavha ingliz qo'shtirnog'ida, vergul ICHIDA: “Sarlavha,”;
 *   • jild/son `Reference` da yo'q — tushiriladi; sahifa «pp. 45–67»,
 *     bitta sahifa «p. 12»;
 *   • yil oxirida, DOI «doi: 10.…» kichik harfda, satr nuqta bilan tugaydi;
 *   • raqam «[1]» ro'yxatda `layout.ts` qo'yadi (bu yerda yo'q).
 * Til: IEEE inglizcha uslub — «and»/«pp.» tilga qarab o'zgarmaydi
 * (rus/o'zbek jurnallari IEEE talab qilsa ham aynan shu shaklni kutadi).
 */
import type { Reference } from "../article/types";
import { authorsOf, initialsFamily } from "./names";
import { isPageRange, normalizePages } from "./gost";

/** «C. Lin, A. Huang, and O. Lu» — 7+ → «C. Lin et al.» */
export function ieeeAuthors(ref: Reference): string {
  const names = authorsOf(ref).map(initialsFamily);
  if (!names.length) return "";
  if (names.length > 6) return `${names[0]} et al.`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function formatIeee(ref: Reference): string {
  const who = ieeeAuthors(ref);
  const title = ref.title.trim().replace(/[.,\s]+$/, "");
  const venue = ref.venue?.trim().replace(/[.\s]+$/, "");
  const place = ref.place?.trim();
  const publisher = ref.publisher?.trim();
  const year = ref.year ? String(ref.year) : "";
  const pages = normalizePages(ref.pages);
  const tail: string[] = [];
  if (venue) {
    // Maqola: “Sarlavha,” Venue, pp. 45–67, 2023, doi: ….
    const items = [who && `${who},`, `“${title},”`, `${venue},`].filter(Boolean) as string[];
    if (pages) tail.push(isPageRange(pages) ? `pp. ${pages}` : `p. ${pages}`);
    if (year) tail.push(year);
    if (ref.doi) tail.push(`doi: ${ref.doi.trim()}`);
    else if (ref.url) tail.push(`[Online]. Available: ${ref.url.trim()}`);
    const body = tail.length ? `${items.join(" ")} ${tail.join(", ")}` : items.join(" ").replace(/,$/, "");
    return `${body}.`;
  }
  // Kitob: A. Karimov, Sarlavha. Toshkent: Fan, 2022.
  const head = [who && `${who},`, `${title}.`].filter(Boolean).join(" ");
  const imprint = [place && publisher ? `${place}: ${publisher}` : place || publisher || "", year].filter(Boolean).join(", ");
  const rest = [imprint, ref.doi ? `doi: ${ref.doi.trim()}` : ""].filter(Boolean).join(", ");
  return rest ? `${head} ${rest}.` : head;
}
