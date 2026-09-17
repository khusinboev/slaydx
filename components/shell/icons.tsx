import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Boxes,
  Briefcase,
  Gift,
  Headphones,
  Mic,
  FileSpreadsheet,
  FileText,
  Files,
  GraduationCap,
  Image,
  KeyRound,
  Languages,
  Layers,
  ListChecks,
  Newspaper,
  PenTool,
  PieChart,
  Presentation,
  Puzzle,
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
  /*
   * `list-checks` AUDIT-20 da `test` vositasiga berilgan, lekin bu
   * jadvalga QO'SHILMAGAN edi: `CreateGrid`/`Sidebar` `TOOL_ICONS[t.icon]`
   * ni o'qiydi va topilmasa ikonkani jimgina tushirib qoldiradi — test
   * kartochkasi bo'sh doira bilan chiqardi.
   */
  "list-checks": ListChecks,
  /* AUDIT-22: interaktiv o'yinlar (saralash, tinglash) va Media bo'limi. */
  boxes: Boxes,
  headphones: Headphones,
  mic: Mic,
  gift: Gift,
  /* AUDIT-21: krossvord, flesh kartalar, infografika. */
  puzzle: Puzzle,
  layers: Layers,
  "pie-chart": PieChart,
};
