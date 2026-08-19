import type { ToolId } from "@/lib/types";

export type ViewerKind =
  | "academic"
  | "essay"
  | "article"
  | "resume"
  | "slides"
  | "lesson"
  | "table"
  | "glossary"
  | "keys"
  | "translation"
  | "image";

export function viewerKind(id: ToolId): ViewerKind {
  switch (id) {
    case "slide":
      return "slides";
    case "resume":
      return "resume";
    case "lesson-plan":
      return "lesson";
    case "texnologik-xarita":
      return "table";
    case "glossary":
      return "glossary";
    case "keys":
      return "keys";
    case "translation":
      return "translation";
    case "image":
      return "image";
    case "essay":
      return "essay";
    case "article":
      return "article";
    default:
      return "academic";
  }
}
