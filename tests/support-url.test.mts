import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORT_URL, resolveSupportUrl, supportHandle } from "../lib/support.ts";

/**
 * One source of truth for «contact an admin» (owner request 2026-10-10): the support GROUP.
 * Mutation: loosen the regex to accept any host → «override must be an https://t.me/ URL» turns red.
 */
test("SUPPORT_URL is the group; handle is the scheme-less form", () => {
  assert.equal(SUPPORT_URL, "https://t.me/SlaydX_support");
  assert.equal(supportHandle(), "t.me/SlaydX_support");
});

test("override must be an https://t.me/ URL, otherwise the default", () => {
  assert.equal(resolveSupportUrl(undefined), SUPPORT_URL);
  assert.equal(resolveSupportUrl(""), SUPPORT_URL);
  assert.equal(resolveSupportUrl(" https://t.me/other_group "), "https://t.me/other_group");
  for (const bad of ["http://t.me/x_group", "https://evil.example/x_group", "https://t.me/", "https://t.me/a b", "javascript:alert(1)", "@SlaydX_support"]) {
    assert.equal(resolveSupportUrl(bad), SUPPORT_URL, bad);
  }
});

test("user-facing texts that mention the group agree with SUPPORT_URL", () => {
  const engine = readFileSync(new URL("../lib/generation/audio/engine.ts", import.meta.url), "utf8");
  assert.ok(engine.includes(`Yordam xizmatiga murojaat qiling: ${supportHandle()} — to‘lov qaytarildi.`));
  assert.ok(!/Administrator bilan bog/.test(engine));
});
