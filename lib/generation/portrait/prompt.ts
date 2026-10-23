/**
 * Model prompt of the graduation portrait (English: the image model reads English best).
 *
 * Structure, in order of importance:
 *   1. the task is an EDIT of the attached photo, not a new picture;
 *   2. IDENTITY lock -- exact face, skin tone, hair, glasses, age; no beautifying;
 *   3. what MAY change: only clothing (gown, cap, optional stola) and background;
 *   4. camera / light (photoreal professional DSLR portrait);
 *   5. modesty + respect for the person's own head covering;
 *   6. hard bans (text, watermark, other people);
 *   7. refusal clause: no single clear face -> answer with text, draw nothing (the provider then
 *      reports "no image" and the job refunds).
 *
 * Variant B differs in framing and light only, never in identity.
 */
import {
  portraitBackgroundOf,
  portraitGownOf,
  portraitSashOf,
  type PortraitInput,
} from "./registry";

export const PORTRAIT_PRESERVE =
  "Preserve the person's exact identity: the same face shape and facial features, eyes, nose, mouth, ears, eyebrows, expression character, skin tone and skin texture, hairstyle and hair colour, facial hair, glasses (if any), apparent age and body proportions. Do not beautify, slim, smooth, whiten, retouch, age or rejuvenate the person, and do not change the head pose beyond turning naturally to the camera.";

export const PORTRAIT_ONLY_CHANGE = "Change ONLY the clothing and the background; everything about the person's face and head stays exactly as in the source photo.";

export const PORTRAIT_NO_TEXT =
  "Absolutely no text, letters, numbers, logos, signage, inscriptions, watermark or UI anywhere in the image; walls, books and surfaces carry no writing. No other people.";

export const PORTRAIT_REFUSAL =
  "The source photo must show exactly one clear human face. If it shows no clear face, several people, or something that is not a person, do NOT generate any image: reply with one short sentence in plain text explaining why.";

export const PORTRAIT_MODEST =
  "Modest, formal and respectful: a closed, high neckline under the gown, nothing revealing. If the person wears a head covering (hijab, doppi/tubeteika, turban), keep it exactly and place the mortarboard cap naturally over or on it; never remove it.";

const VARIANT_FRAMING = [
  "Variation A: classic centred portrait, shoulders-up to chest, facing the camera, soft frontal key light with gentle fill.",
  "Variation B: slightly wider waist-up portrait, shoulders turned about 20 degrees with the face toward the camera, softly directional window-style key light; the identity and clothing stay the same.",
] as const;

/** `index` is the 0-based variant number. */
export function portraitPrompt(input: Pick<PortraitInput, "gown" | "background" | "sash">, index = 0): string {
  const gown = portraitGownOf(input.gown);
  const bg = portraitBackgroundOf(input.background);
  const sash = portraitSashOf(input.sash);
  const clothing = [
    `Dress the person in a ${gown.prompt} academic graduation gown (mantiya) with proper pleats and sleeves, and a matching ${gown.prompt} square mortarboard cap (shapka) with a tassel, worn level on the head.`,
    sash.id === "none"
      ? "No stola or sash."
      : `Add a plain ${sash.prompt} graduation stola (sash) draped over both shoulders, with no embroidery and no lettering.`,
  ].join(" ");
  return [
    "Edit the attached photo into a professional university graduation portrait of the SAME person.",
    PORTRAIT_PRESERVE,
    PORTRAIT_ONLY_CHANGE,
    clothing,
    `Background: ${bg.prompt}.`,
    "Photorealistic professional portrait shot on a full-frame DSLR with an 85mm lens, soft studio lighting, natural skin with real texture, sharp focus on the eyes, vertical 4:5 composition with the whole cap and the head fully inside the frame.",
    VARIANT_FRAMING[index % VARIANT_FRAMING.length],
    PORTRAIT_MODEST,
    PORTRAIT_NO_TEXT,
    PORTRAIT_REFUSAL,
  ].join(" ");
}
