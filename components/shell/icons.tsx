import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Briefcase,
  FileSpreadsheet,
  FileText,
  Files,
  GraduationCap,
  Image,
  KeyRound,
  Languages,
  Newspaper,
  PenTool,
  Presentation,
} from "lucide-react";

export const TOOL_ICONS: Record<string, LucideIcon> = {
  presentation: Presentation,
  image: Image,
  "file-text": FileText,
  "book-open": BookOpen,
  "pen-tool": PenTool,
  newspaper: Newspaper,
  briefcase: Briefcase,
  "graduation-cap": GraduationCap,
  languages: Languages,
  "file-spreadsheet": FileSpreadsheet,
  "key-round": KeyRound,
  files: Files,
};
