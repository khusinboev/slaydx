import test from "node:test";
import assert from "node:assert/strict";
import { parseByteRange } from "../lib/server/http-range.ts";

/**
 * HTTP Range for stored media (video needs 206 for iOS Safari and for seeking).
 * Mutation (restored): the suffix form `bytes=-n` returning the FIRST n bytes -> «suffix range» goes red.
 */
test("parseByteRange: start-end, open end, suffix, clamped end", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 }, "MUTATSIYA: suffix range oxirgi n bayt bo'lishi kerak");
  assert.deepEqual(parseByteRange("bytes=-5000", 1000), { start: 0, end: 999 }, "a suffix longer than the file is the whole file");
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange("BYTES=0-0", 1000), { start: 0, end: 0 });
});

test("parseByteRange: no / unusable header -> null (full 200); outside the file -> unsatisfiable (416)", () => {
  for (const h of [null, undefined, "", "bytes=", "bytes=-", "items=0-5", "bytes=0-5,10-20", "bytes=abc-def", "bytes=9-3"]) assert.equal(parseByteRange(h as string, 1000), null, String(h));
  assert.equal(parseByteRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=5000-6000", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=-0", 1000), "unsatisfiable");
  assert.equal(parseByteRange("bytes=0-5", 0), null, "an empty file has no ranges");
});
