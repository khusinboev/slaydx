import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ResumeTemplateDialog } from "../../components/forms/ResumeTemplateDialog.tsx";
import { PHOTOLESS_TEMPLATE_IDS, PHOTO_TEMPLATE_IDS } from "../../lib/generation/resume/templates.ts";

/**
 * Shablon galereyasi (AUDIT-16): ikki guruh — SURATSIZ (4) va SURATLI (6).
 * Guruh shablonning o'zgarmas xususiyati: suratsiz kartada surat umuman yo'q,
 * suratli kartada namunaviy surat doim bor (foydalanuvchi surati bo'lmasa ham).
 */
afterEach(() => cleanup());

function open(onPick: (t: string, p: string) => void = () => {}, onClose = () => {}) {
  return render(h(ResumeTemplateDialog, { template: "modern", palette: "ember", withPhoto: false, onClose, onPick }));
}

test("galereya ikki guruh: suratsiz 4 ta, suratli 6 ta karta", () => {
  open();
  const photoless = document.querySelectorAll('[data-template-group="photoless"] [data-template-card]');
  const photo = document.querySelectorAll('[data-template-group="photo"] [data-template-card]');
  assert.equal(photoless.length, 4);
  assert.equal(photo.length, 6);
  assert.deepEqual(
    Array.from(photoless).map((el) => el.getAttribute("data-template-card")),
    [...PHOTOLESS_TEMPLATE_IDS],
  );
  assert.deepEqual(Array.from(photo).map((el) => el.getAttribute("data-template-card")), [...PHOTO_TEMPLATE_IDS]);
});

test("suratsiz kartada <img> yo'q, suratli kartada foydalanuvchi surati bo'lmasa ham namunaviy surat bor", () => {
  open();
  for (const el of document.querySelectorAll('[data-template-group="photoless"] [data-template-card]')) {
    assert.equal(el.querySelectorAll("img").length, 0, `${el.getAttribute("data-template-card")}: suratsiz shablonda surat chiqdi`);
  }
  for (const el of document.querySelectorAll('[data-template-group="photo"] [data-template-card]')) {
    assert.equal(el.querySelectorAll("img").length, 1, `${el.getAttribute("data-template-card")}: suratli shablonda surat yo'q`);
  }
});

test("karta bosilsa tanlangan palitra bilan `onPick` chaqiriladi", () => {
  const picks: [string, string][] = [];
  open((t, p) => picks.push([t, p]));
  fireEvent.click(document.querySelector('[aria-label="Ocean"]')!);
  fireEvent.click(document.querySelector('[data-template-card="timeline"]')!);
  assert.deepEqual(picks, [["timeline", "ocean"]]);
});
