import test from "node:test";
import assert from "node:assert/strict";

/**
 * An admin tries a `defaultOff` model on their own account before it is switched on for everyone (docs/studio/P11-SPEC.md).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `inPreview` ignores the stored switch            -> «an explicit off stays off»;
 *   2. `modelAvailable` default `preview` is always true -> «a user never sees a hidden model»;
 *   3. the preview context leaks past its scope          -> «a user never sees a hidden model».
 */

process.env.KLING_API_KEY = "klingtestkey";
process.env.FAL_KEY = "id-value:secret-value";
const { MEDIA_CATALOG } = await import("../lib/media/catalog.ts");
const { inPreview, modelAvailable, modelSwitchedOn } = await import("../lib/server/media/availability.ts");
const { inAdminPreview, withLogContext } = await import("../lib/server/log.ts");

const HIDDEN = "kling/effects";
const none = new Map();
const row = (enabled: boolean | null) => new Map([[HIDDEN, { enabled, markup: null, updatedBy: null, updatedAt: "" }]]);

test("a user never sees a hidden model; the scope ends with its function", () => {
  assert.equal(inAdminPreview(), false);
  assert.equal(modelAvailable(HIDDEN, none), false);
  withLogContext({ userId: "1" }, () => assert.equal(modelAvailable(HIDDEN, none), false));
  withLogContext({ adminPreview: true }, () => assert.equal(modelAvailable(HIDDEN, none), true));
  assert.equal(modelAvailable(HIDDEN, none), false, "no leak after the scope");
});

test("an explicit off stays off, even for an admin; an on model needs no preview", () => {
  const off = row(false);
  withLogContext({ adminPreview: true }, () => assert.equal(modelAvailable(HIDDEN, off), false));
  assert.equal(modelAvailable(HIDDEN, row(true)), true);
  assert.equal(inPreview(MEDIA_CATALOG.byId(HIDDEN)!, undefined), true);
  assert.equal(inPreview(MEDIA_CATALOG.byId(HIDDEN)!, false), false);
  assert.equal(inPreview(MEDIA_CATALOG.byId("kling/kling-4")!, undefined), false, "not a defaultOff model");
});

test("the admin overview reports what users get: the third argument turns preview off", () => {
  withLogContext({ adminPreview: true }, () => {
    assert.equal(modelAvailable(HIDDEN, none, false), false);
    assert.equal(modelSwitchedOn(MEDIA_CATALOG.byId(HIDDEN)!, undefined), false);
  });
});
