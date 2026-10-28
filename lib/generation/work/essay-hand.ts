/**
 * The `doc.work` model that carries the HAND LAYOUT of a handwritten essay.
 *
 * The essay engine owns the text (`doc.sections[0]`, `doc.essay`); the hand renderer, viewer and downloads
 * read `doc.work`, so a hand essay attaches this minimal model (genre `essay`, kind `handwritten`, shape
 * `notes`). `planWork` draws the single section under the title; nothing else of a student work (cover,
 * contents, references) exists here.
 */
import type { WorkHand } from "./handwriting";
import type { WorkModel } from "./types";

export function essayHandWork(title: string, language: string, hand: WorkHand): WorkModel {
  return {
    v: 1,
    genre: "essay",
    kind: "handwritten",
    subject: "humanities",
    language,
    title,
    university: "",
    faculty: "",
    department: "",
    subjectName: "",
    group: "",
    course: "",
    author: "",
    teacher: "",
    city: "",
    ministry: "oliy",
    chapters: [],
    intro: { parts: { relevance: false, aim: false, tasks: false, object: false, subject: false, methods: false, structure: false, novelty: false, significance: false } },
    references: [],
    figures: [],
    refsMin: 0,
    hand: { ...hand, headings: "plain" },
  };
}
