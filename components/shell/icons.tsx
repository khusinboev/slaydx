import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BookOpen,
  Boxes,
  Briefcase,
  ClipboardCheck,
  FileOutput,
  MessageCircle,
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
  NotebookPen,
  PenTool,
  PieChart,
  Presentation,
  Puzzle,
  Video,
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
  "notebook-pen": NotebookPen,
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
  video: Video,
  /* AUDIT-21: krossvord, flesh kartalar, infografika. */
  puzzle: Puzzle,
  layers: Layers,
  "pie-chart": PieChart,
  /* Link-only services (lib/services.ts): chat, converter, script converter, tests. */
  "message-circle": MessageCircle,
  "file-output": FileOutput,
  "arrow-left-right": ArrowLeftRight,
  "clipboard-check": ClipboardCheck,
};
