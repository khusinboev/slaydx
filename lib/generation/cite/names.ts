/**
 * Muallif ismi tahlili (Maqola 2, WP5) — bitta satrdan `{family, initials}`.
 *
 * Manbalar ismni HAR XIL tartibda beradi va bu tartib satrning o'zidan
 * har doim ham bilinmaydi:
 *
 *   OpenAlex `display_name`  → «Chih-Hung Lin»          (ism → familiya)
 *   Crossref `family given`  → «Lin Chih-Hung»          (familiya → ism)
 *   O'zbek/rus yozuvi        → «Karimova Dilnoza Baxtiyorovna» (familiya → ism → otasi)
 *   Inisialli               → «Lin C.» / «C. Lin» / «Karimova, D. B.» / «Smith, John»
 *
 * Qoidalar (ketma-ket, birinchi mos kelgani):
 *   1. vergul — «Familiya, Ism»;
 *   2. inisial BOSHDA — «I. O. Familiya», inisial OXIRDA — «Familiya I.O.»;
 *   3. otasining ismi (-ovich/-ovna/-qizi/-o‘g‘li) bor — familiya BIRINCHI;
 *   4. slavyan/turkiy familiya qo'shimchasi (-ov/-ova/-yev/-in/-skiy/-zoda)
 *      bo'lgan bo'lak — familiya (qaysi o'rinda bo'lsa ham);
 *   5. hech qanday belgi yo'q — `hint` bo'yicha: Crossref `family-first`,
 *      qolganlari (OpenAlex, foydalanuvchi BibTeX) `given-first`.
 *
 * Uslub formatlari: `Familiya I.O.` (GOST), `Familiya, I. O.` (APA),
 * `I. O. Familiya` (IEEE). Ism o'zi o'zgartirilmaydi — faqat tartib va
 * inisial qisqartirish.
 */
import type { Reference } from "../article/types";

export type PersonName = {
  family: string;
  /** Inisiallar NUQTA bilan: «C.», «Sh.», «C.-H.» (defisli ism «Chih-Hung» bitta element). */
  initials: string[];
};

export type NameOrder = "family-first" | "given-first";

/**
 * Inisial: bitta bosh harf (nuqtali/nuqtasiz) YOKI nuqtali digraf
 * («Sh.», «Ch.», «Yo.», «Shch.», «O‘.» — kirilldan o'girilgan Ш/Ч/Ё/Щ/Ў),
 * ixtiyoriy defis bilan ikkinchisi («C.-H.»). Ko'p harfli shakl faqat
 * NUQTA bilan — aks holda «Lin» ham inisialga o'xshab qolardi.
 */
const INITIAL_ONE = "(?:\\p{Lu}|\\p{Lu}[\\p{Ll}‘’ʻ']{1,3}\\.)";
const INITIAL_RE = new RegExp(`^${INITIAL_ONE}\\.?(?:-${INITIAL_ONE}\\.?)?$`, "u");
/** Allaqachon inisial bo'lgan bo'lak («Sh.», «Yo.») — birinchi harfga qisqartirilmaydi. */
const DOTTED_INITIAL_RE = /^\p{Lu}[\p{Ll}‘’ʻ']{0,3}\.$/u;
/** Otasining ismi qo'shimchalari — rus/o'zbek. */
const PATRONYMIC_RE = /(ovich|evich|yevich|ovna|evna|yevna|ichna|qizi|kizi|o[‘'ʻ’`]g[‘'ʻ’`]li|ugli|o‘g‘li|ович|евич|овна|евна|ична|қизи|ўғли)$/iu;
/** Familiya qo'shimchalari — slavyan/turkiy; kichik harfda tekshiriladi. */
/*
 * «-in/-ина» ATAYLAB yo'q: Martin, Kevin, Konstantin (Константин) kabi
 * ISMLAR ham shunday tugaydi — familiya deb olinib ketardi; «Ilyin» esa
 * manba tartibi (5-qoida) bilan baribir to'g'ri chiqadi.
 */
const SURNAME_RE = /(ov|ova|ev|eva|yev|yeva|iev|ieva|ski|skiy|sky|skaya|skii|tsky|zoda|zade|ов|ова|ев|ева|ский|ская|заде|зода)$/iu;

function clean(s: string): string {
  // «И.И.» / «D.B.» / «Sh.Sh.» — yopishgan inisiallar ajratiladi («C.-H.» defisli — tegilmaydi).
  return s.replace(/(\p{Lu}[\p{Ll}‘’ʻ']{0,3}\.)(?=\p{Lu})/gu, "$1 ").replace(/\s+/g, " ").trim();
}

/** «Chih-Hung» → «C.-H.», «Dilnoza» → «D.», «C.» → «C.», «Sh.» → «Sh.», «C.-H.» → «C.-H.» */
function initialOf(token: string): string {
  const parts = token.split("-").filter((p) => p.replace(/\./g, ""));
  return parts
    .map((p) => {
      // Manba o'zi nuqtali inisial bergan («Sh.», «Yo.») — qisqartirilmaydi; «John» → «J.».
      if (DOTTED_INITIAL_RE.test(p)) return p;
      return p.replace(/\./g, "").charAt(0).toUpperCase() + ".";
    })
    .join("-");
}

function fromTokens(family: string[], given: string[]): PersonName {
  return { family: family.join(" "), initials: given.map(initialOf).filter(Boolean) };
}

/** Manba turi bo'yicha noaniq holat uchun tartib: Crossref `family given` beradi, OpenAlex `display_name`. */
export function nameOrderOf(ref: Pick<Reference, "verified">): NameOrder {
  return ref.verified === "crossref" ? "family-first" : "given-first";
}

export function parseAuthor(raw: string, hint: NameOrder = "given-first"): PersonName {
  const s = clean(raw);
  if (!s) return { family: "", initials: [] };
  // 1. «Smith, John» / «Karimova, D. B.»
  const comma = s.indexOf(",");
  if (comma > 0) {
    const family = clean(s.slice(0, comma));
    const given = clean(s.slice(comma + 1)).split(" ").filter(Boolean);
    return fromTokens([family], given);
  }
  const tokens = s.split(" ").filter(Boolean);
  if (tokens.length === 1) return { family: tokens[0].replace(/\.+$/, ""), initials: [] };
  const isInit = tokens.map((t) => INITIAL_RE.test(t));
  // 2. inisiallar boshda — «C. Lin», «J. R. R. Tolkien»; oxirda — «Lin C.», «Karimova D. B.»
  if (isInit[0] && !isInit[tokens.length - 1]) {
    const k = isInit.findIndex((x) => !x);
    return fromTokens(tokens.slice(k), tokens.slice(0, k));
  }
  if (!isInit[0] && isInit[tokens.length - 1]) {
    const k = isInit.findIndex((x) => x);
    return fromTokens(tokens.slice(0, k), tokens.slice(k));
  }
  if (isInit.every(Boolean)) return { family: tokens.join(" "), initials: [] };
  // 3. otasining ismi — «Karimova Dilnoza Baxtiyorovna»: familiya birinchi.
  if (tokens.some((t) => PATRONYMIC_RE.test(t))) return fromTokens([tokens[0]], tokens.slice(1));
  // 4. familiya qo'shimchasi — «Dilnoza Karimova» ham, «Karimova Dilnoza» ham.
  const si = tokens.findIndex((t) => SURNAME_RE.test(t) && t.length > 4);
  if (si >= 0) return fromTokens([tokens[si]], tokens.filter((_, i) => i !== si));
  // 5. belgi yo'q — manba tartibi.
  if (hint === "family-first") return fromTokens([tokens[0]], tokens.slice(1));
  // «Ludwig van Beethoven» — zarrachalar familiyaga qo'shiladi.
  const particle = /^(van|von|de|der|del|da|di|la|le|al|bin|ibn)$/i;
  let k = tokens.length - 1;
  while (k > 1 && particle.test(tokens[k - 1])) k--;
  return fromTokens(tokens.slice(k), tokens.slice(0, k));
}

/** «Lin C.H.» / «Karimova D.B.» — GOST (inisiallar orasida bo'shliq yo'q). */
export function familyInitials(n: PersonName): string {
  return n.initials.length ? `${n.family} ${n.initials.join("")}` : n.family;
}

/** «Lin, C. H.» — APA 7. */
export function familyCommaInitials(n: PersonName): string {
  return n.initials.length ? `${n.family}, ${n.initials.join(" ")}` : n.family;
}

/** «C. H. Lin» — IEEE. */
export function initialsFamily(n: PersonName): string {
  return n.initials.length ? `${n.initials.join(" ")} ${n.family}` : n.family;
}

/** Manba mualliflari — tahlil qilingan, bo'shlari tashlangan. */
export function authorsOf(ref: Pick<Reference, "authors" | "verified">): PersonName[] {
  const hint = nameOrderOf(ref);
  return (ref.authors ?? [])
    .map((a) => parseAuthor(String(a ?? ""), hint))
    .filter((n) => n.family);
}
