import type { AcademicDoc } from "./generation/types";

export type ToolId =
  | "slide"
  | "coursework"
  | "referat"
  | "essay"
  | "article"
  | "resume"
  | "thesis"
  | "translation"
  | "image"
  | "texnologik-xarita"
  | "glossary"
  | "keys"
  | "mustaqil-ish"
  | "lesson-plan";

export type ToolGroup = "umumiy" | "talaba" | "oqituvchi";

export type JobStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "REVOKED";

export type FieldKind =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "chips"
  | "language"
  | "range"
  | "design"
  | "toggle"
  | "file";

export type FieldOption = {
  value: string;
  label: string;
  hint?: string;
};

export type ToolField = {
  kind: FieldKind;
  name: string;
  legend: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: FieldOption[];
  min?: number;
  max?: number;
  suffix?: string;
  accept?: string;
  extra?: boolean;
};

export type ToolMode = {
  id: "topic" | "file";
  title: string;
  hint: string;
};

export type ToolConfig = {
  id: ToolId;
  slug: string;
  title: string;
  pageTitle: string;
  group: ToolGroup;
  icon: string;
  tc: string;
  description: string;
  submitLabel: string;
  creatingLabel: string;
  createdLabel: string;
  topicLegend?: string;
  topicPlaceholder?: string;
  topicExamples?: string[];
  modes?: ToolMode[];
  fields: ToolField[];
  extraOptional?: boolean;
  output: "docx" | "pptx" | "pdf" | "png";
  custom?: "slide" | "resume" | "translation" | "image";
  basePrice: number;
};

export type FormValues = Record<string, string | number | boolean | null>;

export type Generation = {
  id: string;
  type: ToolId;
  topic: string;
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  price: number;
  values: FormValues;
  html: string;
  fileName: string;
  format: "docx" | "pptx" | "pdf" | "png";
  progress: number;
  step: string;
  doc?: AcademicDoc;
};

export type UserProfile = {
  name: string;
  language: string;
  points: number;
  quota: number;
  balance: number;
  premium: boolean;
  plan: "free" | "pro";
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
};
