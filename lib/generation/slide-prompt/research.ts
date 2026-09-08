import { sourceBlock } from "../prompts";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Manba — foydalanuvchi fayli (`sourceBlock`) va internet tadqiqoti.
 * WP-D: `ctx.research` faktlari va manbalari shu yerga kiradi.
 */
export function researchLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  void ctx;
  return [sourceBlock(meta)];
}
