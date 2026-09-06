/**
 * Rasm studiyasini jonli tekshirish — turli parametrlar bilan.
 *
 * Bazaga yozmaydi, navbatga qo'ymaydi: `image-studio.ts` dagi haqiqiy
 * `composePrompt` funksiyasini TO'G'RIDAN-TO'G'RI chaqiradi (xuddi
 * `live-engine.mts` kabi), natijalarni diskka yozadi — ko'z bilan
 * tekshirish uchun. Har doim `premium` yo'ldan ishlaydi, chunki
 * ishlab chiqarishdagi `buildImageArtifact` ham shunday ishlaydi.
 *
 * Foydalanish: npm run image-lab
 */
import { writeFile, mkdir } from "node:fs/promises";
import { generateFalImage, fetchImageBytes } from "../lib/generation/slide-images.ts";
import { IMAGE_STYLES, composePrompt } from "../lib/generation/image-studio.ts";

const OUT = "eval-out/image-lab";
await mkdir(OUT, { recursive: true });

async function save(name: string, prompt: string, w: number, h: number, seed?: number) {
  const im = await generateFalImage(prompt, { width: w, height: h }, undefined, {
    premium: true,
    ...(seed == null ? {} : { seed }),
  });
  if (!im) {
    console.log(`  ✘ ${name}: rasm qaytmadi`);
    return;
  }
  const bytes = await fetchImageBytes(im.url);
  if (!bytes) {
    console.log(`  ✘ ${name}: yuklab bo'lmadi`);
    return;
  }
  const buf = Buffer.from(bytes.data.split("base64,")[1], "base64");
  await writeFile(`${OUT}/${name}.${bytes.type}`, buf);
  console.log(`  ✔ ${name}.${bytes.type}  (${bytes.w}x${bytes.h})`);
}

console.log("== 1) Bir xil sahna, TURLI uslub, BIR XIL seed (uslub farqini izolyatsiya qilish) ==");
const scene1 =
  "Registan Square in Samarkand at sunrise, ancient madrasas with blue tiled domes and mosaic arches, wide empty square, morning mist";
const seed1 = 424242;
for (const st of IMAGE_STYLES) {
  await save(`1-style-${st.id}`, composePrompt(scene1, st.id, 1024, 1024), 1024, 1024, seed1);
}

console.log("\n== 2) O'zbek mavzulari — modelning haqiqiy bilimini tekshirish ==");
const uzScenes: [string, string][] = [
  ["registon", "Registan Square in Samarkand at sunrise, ancient madrasas with blue tiled domes and mosaic arches"],
  ["chorsu", "Chorsu Bazaar in Tashkent, large round blue-domed building, market stalls, fruit and spices"],
  ["palov", "traditional Uzbek plov (osh) served on a large flat plate, rice with carrots, meat, and chickpeas"],
  ["atlas", "traditional Uzbek atlas silk fabric with vivid ikat pattern, folded rolls of colorful cloth"],
  ["non", "traditional round Uzbek bread (non) with stamped center pattern, fresh from a clay tandir oven"],
];
for (const [id, scene] of uzScenes) {
  await save(`2-uz-${id}`, composePrompt(scene, "photo", 1024, 1024), 1024, 1024);
}

console.log("\nTayyor:", OUT);
