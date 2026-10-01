import test from "node:test";
import assert from "node:assert/strict";
import { maskPhone, maskValues } from "../lib/server/admin-mask.ts";

/** `lib/server/admin-mask.ts` — PII masking without `users.pii` (plan §6.0 "Masking"). */

test("maskPhone: canonical Uzbek number", () => {
  assert.equal(maskPhone("+998901234567"), "+998 ** *** ** 67");
  assert.equal(maskPhone("998901234567"), "+998 ** *** ** 67");
  assert.equal(maskPhone("+998 90 123-45-67"), "+998 ** *** ** 67");
  assert.equal(maskPhone("(+998) 90 123 45 67"), "+998 ** *** ** 67");
});

test("maskPhone: only the last two digits ever survive", () => {
  const out = maskPhone("+998901234567")!;
  assert.doesNotMatch(out, /90123|1234|901/);
  assert.equal(out.replace(/\D/g, ""), "99867", "country code and last two digits only");
});

test("maskPhone: null / empty / non-string input is safe", () => {
  assert.equal(maskPhone(null), null);
  assert.equal(maskPhone(undefined), null);
  assert.equal(maskPhone(""), null);
  assert.equal(maskPhone("   "), null);
  assert.equal(maskPhone("no digits"), null);
  assert.equal(maskPhone(998901234567), null);
  assert.equal(maskPhone({}), null);
  assert.equal(maskPhone([]), null);
  assert.equal(maskPhone(true), null);
});

test("maskPhone: short or odd numbers reveal nothing they should not", () => {
  assert.equal(maskPhone("1"), "***");
  assert.equal(maskPhone("123"), "***");
  assert.equal(maskPhone("1234"), "+**34");
  assert.equal(maskPhone("+7 912 345-67-89"), "+*********89");
  // 13 digits starting with 998 is not a valid Uzbek number: generic masking
  assert.equal(maskPhone("9989012345673"), "+***********73");
  // a local id that is not a phone is still masked, not echoed
  assert.doesNotMatch(maskPhone("ali_valiyev_99")!, /ali|valiyev/);
  // a huge string cannot make the output long
  assert.ok(maskPhone("9".repeat(10_000))!.length <= 20);
});

test("maskValues: reveal returns the input untouched", () => {
  const v = { topic: "Iqtisod", university: "TDIU", n: 3, list: ["a", "b"] };
  assert.equal(maskValues(v, { reveal: true }), v);
  assert.equal(maskValues("raw", { reveal: true }), "raw");
  assert.equal(maskValues(null, { reveal: true }), null);
});

test("maskValues: keys and `topic` survive, all other values are masked", () => {
  const out = maskValues(
    { topic: "Raqamli iqtisodiyot", fullName: "Ali Valiyev", phone: "+998901234567", pages: 12, flag: true, empty: null, deep: { a: "secret", b: [1, "x", { c: "y" }] } },
    { reveal: false },
  );
  assert.deepEqual(out, {
    topic: "Raqamli iqtisodiyot",
    fullName: "•••",
    phone: "•••",
    pages: "•••",
    flag: "•••",
    empty: null,
    deep: { a: "•••", b: ["•••", "•••", { c: "•••" }] },
  });
});

test("maskValues: no string or number from the input appears anywhere in the output", () => {
  const input = {
    topic: "T",
    a: "SECRET-A",
    n: 987654321,
    nested: { list: ["SECRET-B", 424242, { k: "SECRET-C" }], more: { even: { deeper: "SECRET-D" } } },
    arr: [["SECRET-E"], 31337],
  };
  const json = JSON.stringify(maskValues(input, { reveal: false }));
  for (const leak of ["SECRET-A", "987654321", "SECRET-B", "424242", "SECRET-C", "SECRET-D", "SECRET-E", "31337"]) assert.ok(!json.includes(leak), leak);
  // keys are kept
  for (const key of ["a", "n", "nested", "list", "more", "even", "deeper", "arr", "k"]) assert.ok(json.includes(`"${key}"`), key);
});

test("maskValues: `topic` is kept only when it is a top-level string", () => {
  assert.deepEqual(maskValues({ topic: 42 }, { reveal: false }), { topic: "•••" });
  assert.deepEqual(maskValues({ topic: { x: "secret" } }, { reveal: false }), { topic: { x: "•••" } });
  assert.deepEqual(maskValues({ topic: ["a"] }, { reveal: false }), { topic: ["•••"] });
  assert.deepEqual(maskValues({ nested: { topic: "leak?" } }, { reveal: false }), { nested: { topic: "•••" } });
});

test("maskValues: array shape (length) is preserved, and non-object roots are handled", () => {
  assert.deepEqual(maskValues(["a", 1, null, ["b"]], { reveal: false }), ["•••", "•••", null, ["•••"]]);
  assert.deepEqual(maskValues("text", { reveal: false }), "•••");
  assert.deepEqual(maskValues(5, { reveal: false }), "•••");
  assert.equal(maskValues(null, { reveal: false }), null);
  assert.equal(maskValues(undefined, { reveal: false }), "•••");
  assert.deepEqual(maskValues({}, { reveal: false }), {});
  assert.deepEqual(maskValues([], { reveal: false }), []);
});

test("maskValues: does not mutate its input", () => {
  const input = { topic: "t", a: { b: "secret" }, c: ["x"] };
  const copy = structuredClone(input);
  maskValues(input, { reveal: false });
  assert.deepEqual(input, copy);
});

test("maskValues: a hostile `__proto__` key stays an own, masked property", () => {
  const input = JSON.parse('{"__proto__": {"polluted": "yes"}, "topic": "t", "constructor": "c"}') as unknown;
  const out = maskValues(input, { reveal: false }) as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(out), Object.prototype, "prototype untouched");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(out).sort(), ["__proto__", "constructor", "topic"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(out, "__proto__")!.value, { polluted: "•••" });
  assert.equal(out.constructor, "•••");
});

test("maskValues: very deep nesting is cut off instead of recursing without bound", () => {
  let deep: unknown = "leaf-secret";
  for (let i = 0; i < 5_000; i++) deep = { k: deep };
  const json = JSON.stringify(maskValues({ deep }, { reveal: false }));
  assert.ok(!json.includes("leaf-secret"));
  assert.ok(json.includes("•••"));
});
