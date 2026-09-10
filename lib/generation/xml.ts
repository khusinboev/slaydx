/**
 * XML matn yordamchilari — OOXML yozuvchilari uchun umumiy.
 *
 * Nega alohida fayl: `xmlEscape` ilgari `render-pptx-template.ts` ichida
 * turardi va u fayl butun PPTX shablon yozuvchisini (JSZip, slayd modeli,
 * rasm yuklash) tortib keladi. Tarjima adapterlari (`translate/docx.ts`,
 * `pptx.ts`, `xlsx.ts`) esa faqat SHU ikki funksiyaga muhtoj — ular
 * izomorf bo'lishi va og'ir bog'liqliklarsiz yuklanishi kerak. Shuning
 * uchun eng past qatlam shu yerga ajratildi; `render-pptx-template.ts`
 * uni re-eksport qiladi, ya'ni mavjud importlar (va testlar) o'zgarmaydi.
 */

/**
 * XML 1.0 da taqiqlangan boshqaruv belgilari.
 *
 * Regexp ATAYIN `\u` qochish ketma-ketligi bilan yozilgan: ilgari u
 * manba faylida XOM boshqaruv belgilari bilan turardi va butun
 * `render-pptx-template.ts` faylini `grep` ikkilik (binary) deb hisoblab
 * hech narsa topmasdi — kod izlashda jimgina yo'qoladigan fayl.
 */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * Matnni XML ichiga yozish uchun xavfsiz holga keltiradi.
 *
 * Boshqaruv belgilari OLIB TASHLANADI: Word/PowerPoint ular bor faylni
 * «buzilgan» deb ochmaydi.
 */
export function xmlEscape(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(FORBIDDEN, "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * XML entity larni ochadi (`&amp;` → `&`, `&#8217;` → `’`).
 *
 * Segment matni MODELGA boradi va keyin qayta yoziladi. Agar entity
 * ochilmasa, model `&amp;` ni matn deb tarjima qilishi mumkin; qayta
 * yozishda esa `xmlEscape` uni yana bir marta qochirib `&amp;amp;`
 * qilardi — hujjatda ko'rinadigan nuqson.
 */
export function xmlDecode(s: string): string {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      // Surrogat juftlar `fromCodePoint` da xato beradi.
      if (code >= 0xd800 && code <= 0xdfff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}
