/**
 * O'zbekistonga oid mashhur joy/taom/buyumlar uchun aniq vizual faktlar.
 *
 * Nega kerak: tekshiruvda aniqlandiki, rasm modeli (va uni tarjima qiluvchi
 * LLM) "Registon", "Chorsu", "palov" kabi so'zlarni umumiy "Markaziy Osiyo
 * masjidi" yoki "guruch va go'sht" darajasida tasvirlaydi — aniq tarixiy
 * tuzilma yoki taomning HAQIQIY ko'rinishini bilmaydi. Masalan, Registon
 * UCH ALOHIDA madrasadan iborat (Sherdor darvozasida yo'lbars tasviri bor),
 * lekin model bitta yagona binoni chizadi.
 *
 * Bu ro'yxat modelning bilimini to'ldirmaydi — u DETERMINISTIK ravishda
 * to'g'ri faktlarni promptga qo'shib, model taxminiga tayanishni kamaytiradi.
 */

export type GazetteerEntry = { match: RegExp; detail: string };

const ENTRIES: GazetteerEntry[] = [
  {
    match: /registon|registan/i,
    detail:
      "the real Registan ensemble in Samarkand has THREE separate grand portals standing side by side facing one open square: Ulugbek Madrasah on the left with blue geometric star-pattern tiles, Sher-Dor Madrasah on the right whose facade shows a mosaic of a striped tiger-like lion chasing a white deer beneath a human-faced rising sun, and Tilya-Kori Madrasah in the center with a gold-covered mosque interior — each portal topped by its own ribbed turquoise dome and flanked by tall freestanding minarets",
  },
  {
    match: /chorsu|чорсу/i,
    detail:
      "Chorsu Bazaar in Tashkent is one large round building with a huge turquoise ribbed dome and no signage or lettering on its facade, surrounded by open-air market stalls selling spices, dried fruit, and bread",
  },
  {
    match: /\bpalov\b|\bosh\b|plov|палов|плов/i,
    detail:
      "Uzbek plov (osh) is rice cooked together with meat, carrot, and onion in one pot until the rice itself turns a uniform golden-orange color (never plain white rice with toppings placed on top), served heaped on a large round flat lagan plate, often with a whole head of garlic and boiled chickpeas nestled into the rice",
  },
  {
    match: /\bnon\b(?!fiction)|patir|нон/i,
    detail:
      "Uzbek non is a round flatbread with a decorative stamped circular pattern (from a chekich) pressed into its thick raised outer rim, a thin golden-brown center, traditionally baked stuck to the inner wall of a clay tandir oven",
  },
  {
    match: /\batlas\b(?!\s*mountains)|adras|атлас/i,
    detail:
      "traditional Uzbek atlas silk has a bold ikat pattern with deliberately blurred, feathered edges between colors — vivid red, yellow, purple, and black in classic Margilan atlas — never a sharp, printed, or geometric pattern",
  },
  {
    match: /tandir|тандир/i,
    detail:
      "a tandir is a large egg-shaped clay oven, flatbreads stuck to its inner wall, glowing coals visible at the bottom",
  },
  {
    match: /amir\s*temur|temuriylar|амир\s*темур/i,
    detail:
      "the Amir Temur monument is a bronze equestrian statue: a robed horseman with one arm raised, riding a rearing horse, on a tall stone pedestal",
  },
  {
    match: /xiva|ichan\s*qal|itchan/i,
    detail:
      "Itchan Kala in Khiva is a walled old town of sand-colored mudbrick walls and towers, centered on the short, wide, fully turquoise-tiled Kalta Minor minaret which looks unusually stout compared to typical tall minarets",
  },
  {
    match: /buxoro|bukhara|poi\s*kalon|kalyan|бухоро/i,
    detail:
      "the Poi Kalyan ensemble in Bukhara has a tall cylindrical minaret of plain tan fired brick with horizontal decorative bands (no bright tilework on the minaret itself), standing beside a mosque with a ribbed turquoise dome",
  },
  {
    match: /choyxona|chaykhana/i,
    detail:
      "a choyxona (teahouse) has a raised wooden tapchan platform covered in carpets and low tables, people sitting cross-legged drinking green tea from small handleless piyola bowls",
  },
  {
    match: /mustaqillik\s*maydoni/i,
    detail:
      "Mustaqillik Maydoni in Tashkent is a wide open plaza with the white Ezgulik Arch (three arches topped with stylized storks) and a globe monument shaped like the map of Uzbekistan",
  },
  {
    match: /o.?zbekiston\s*bayrog|uzbek(?:istan)?\s*flag/i,
    detail:
      "the flag of Uzbekistan has three horizontal stripes (light blue, white, green) separated by thin red lines, with a white crescent moon and twelve white stars in the upper left corner — never a green-white-red vertical flag",
  },
];

/**
 * Matndan tanilgan O'zbek mavzularini topib, ularning aniq vizual
 * tafsilotlarini bitta gapga yig'adi. Hech narsa topilmasa bo'sh satr.
 */
export function groundUzbekScene(text: string): string {
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const entry of ENTRIES) {
    if (!entry.match.test(text)) continue;
    if (seen.has(entry.detail)) continue;
    seen.add(entry.detail);
    hits.push(entry.detail);
  }
  return hits.join("; ");
}
