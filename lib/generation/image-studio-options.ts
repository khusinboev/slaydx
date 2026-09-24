/**
 * Rasm vositasi KATALOGI — uslublar va nisbatlar (audit W4-A R1).
 *
 * Alohida modul, chunki uni KLIENT komponentlari ham o'qiydi
 * (`components/forms/ImageStudio.tsx`, `components/viewers/ImageViewer.tsx`).
 * `image-studio.ts` esa server yo'li: provayder, `safe-fetch` (`node:dns`),
 * sarf hisoblagichi (`node:async_hooks`) — klient to'plamiga tushsa
 * `next build` yiqiladi. Bu fayl HECH NARSA import qilmasin (faqat
 * ma'lumot va sof funksiyalar); `tests/client-bundle-guard.test.mts`
 * klient grafigida `node:*` yo'qligini qulflaydi.
 */
/**
 * Uslub tavsiflari — har biri o'ziga xos VOSITA (medium) so'zlari va
 * "bu FOTO EMAS" kabi inkor bilan yozilgan.
 *
 * Sababi: jonli tekshiruvda (`scripts/image-lab.mts`) bir xil sahna va
 * seed bilan 8 ta uslubning 6 tasi (foto, kino, illyustratsiya, 3D,
 * minimal, mahsulot) DEYARLI BIR XIL fotografik rasm chiqargani
 * aniqlandi — foydalanuvchi xabar qilgan xato aynan shu edi. Sabab:
 * `flux/schnell` past qadam sonida ("standard" = 4) tavsifni yuzaki
 * o'qiydi va standart holatga (fotorealizm) qaytadi; "3D render" yoki
 * "digital illustration" kabi yumshoq ishoralar buni yengolmaydi.
 * Faqat kuchli, aniq lug'aviy signal ("bu FOTO EMAS", qog'oz donadorligi,
 * moybo'yoq siljishi kabi) va inkor ishlaydi — "qalam" uslubi shu
 * tarzda yozilgani uchun ilgari ham to'g'ri chiqqan edi.
 *
 * 2026-09-22 dan rasm Gemini lite'da; uslub suffikslari o'z holida saqlanadi.
 */
export const IMAGE_STYLES = [
  {
    id: "photo",
    name: "Foto",
    blurb: "Haqiqiy surat",
    suffix:
      "Render as a photoreal photograph of THIS scene only, shot on a full-frame DSLR, natural light, realistic skin and material textures, sharp focus.",
  },
  {
    id: "cinematic",
    name: "Kino",
    blurb: "Film kadri",
    suffix:
      "Render as a still frame from a live-action movie: anamorphic lens flare, shallow depth of field with soft bokeh, teal-and-orange color grade, subtle film grain, slightly desaturated shadows, letterboxed cinematic framing of THIS scene only.",
  },
  {
    id: "illustration",
    name: "Illustratsiya",
    blurb: "Chizma uslub",
    suffix:
      "This is NOT a photograph. Render as a FLAT DIGITAL VECTOR ILLUSTRATION of THIS scene: bold clean black outlines, simplified geometric shapes, a limited flat color palette with no photographic gradients, poster-art style, zero camera grain or realistic lighting.",
  },
  {
    id: "watercolor",
    name: "Akvarel",
    blurb: "Suv bo‘yoq",
    suffix:
      "This is NOT a photograph. Render as a HAND-PAINTED WATERCOLOR of THIS scene on visibly textured cold-press paper: soft diffused pigment bleeds at every edge, dry-brush texture, visible paper grain showing through thin washes, muted pastel colors, no sharp photographic detail anywhere.",
  },
  {
    id: "render3d",
    name: "3D",
    blurb: "Render",
    suffix:
      "This is NOT a photograph. Render as a STYLIZED 3D COMPUTER-GENERATED image of THIS scene (Blender/Octane look): smooth clay-like or matte plastic materials, visible ray-traced soft shadows, clean studio three-point lighting, slightly simplified low-poly geometry, no photographic skin or fabric texture.",
  },
  {
    id: "minimal",
    name: "Minimal",
    blurb: "Toza kompozitsiya",
    suffix:
      "Render as a minimalist studio photograph of THIS scene: single flat pastel or seamless paper backdrop replacing any busy background, one subject small and centered, huge clean negative space around it, soft even studio lighting, no clutter, no crowd.",
  },
  {
    id: "pencil",
    name: "Qalam",
    blurb: "Sketch",
    suffix:
      "This is NOT a photograph and NOT color. Render THIS exact scene as a full-page black-and-white graphite pencil illustration on white paper: visible hatching and cross-hatching strokes, uneven pencil pressure, paper tooth texture, zero color, zero photographic lighting. No artist signature, no monogram, no scribbled text anywhere in the image. Not a random sketch study. Not an animal unless the scene names one.",
  },
  {
    /*
     * «Doska» — slayd uslublari (`SLIDE_IMAGE_STYLES`) uchun qo'shildi:
     * dars taqdimotining eng tabiiy vositasi, va foto bo'lmagan uslublar
     * ichida `pencil` dan aniq farqlanadi (rang bor, fon to'q, sirt
     * boshqa). Bu `SLIDE_THEME_IDS` dagi `chalk` TEMASI emas — boshqa
     * namespace, tasodifiy nom mosligi.
     */
    id: "chalk",
    name: "Doska",
    blurb: "Bo‘r chizma",
    suffix:
      "This is NOT a photograph. Render THIS scene as white and pale-yellow chalk drawing on a dark green classroom chalkboard: visible chalk dust, slightly smudged strokes, uneven hand-drawn lines, flat matte board texture, no photographic lighting.",
  },
  {
    id: "product",
    name: "Mahsulot",
    blurb: "Katalog",
    suffix:
      "Render as studio product photography of the named object only, isolated on a plain seamless white or neutral backdrop with no environment or background scene, soft even softbox lighting from multiple angles, sharp catalog-style focus.",
  },
] as const;

export const IMAGE_RATIOS = [
  { id: "1:1", label: "1:1", hint: "Post", w: 1024, h: 1024 },
  { id: "16:9", label: "16:9", hint: "Slayd", w: 1024, h: 576 },
  { id: "9:16", label: "9:16", hint: "Stories", w: 576, h: 1024 },
  { id: "4:3", label: "4:3", hint: "Klassik", w: 1024, h: 768 },
  { id: "3:4", label: "3:4", hint: "Portret", w: 768, h: 1024 },
  { id: "3:2", label: "3:2", hint: "Foto", w: 1024, h: 688 },
] as const;

export function imageStyleById(id: string) {
  return IMAGE_STYLES.find((s) => s.id === id) ?? IMAGE_STYLES[0];
}

export function imageRatioById(id: string) {
  return IMAGE_RATIOS.find((s) => s.id === id) ?? IMAGE_RATIOS[0];
}
