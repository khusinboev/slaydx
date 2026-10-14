import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../lib/tools.ts";
import { PROGRESS_KINDS, PROGRESS_TOOL_IDS, progressKindOf, stageCeiling, stageIndexAt, stagesFor } from "../lib/progress-stages.ts";
import { etaLabel, etaState, smoothProgress } from "../lib/progress-smooth.ts";

/**
 * Running-panel math (display only; the server value stays the truth):
 *   - every registry tool has a stage list; marks start at 0, strictly ascend, stay <= 96;
 *   - the shown percentage is never below the server value, never goes backwards, never passes
 *     the next stage mark and never reaches 99+;
 *   - ETA is coarse and says "slow" instead of a stuck zero.
 *
 * MUTATIONS checked: drop the `ceiling` clamp -> "never past the stage ceiling" fails; drop `prev`
 * -> "never backwards" fails; drop the `Math.max(server, …)` floor -> "never below server" fails;
 * remove a tool from KIND_BY_TOOL -> coverage test (and tsc) fails.
 */

test("every registry tool has a progress stage list and every list belongs to a registry tool", () => {
  const ids = TOOLS.map((t) => t.id).sort();
  assert.deepEqual([...PROGRESS_TOOL_IDS].sort(), ids);
  for (const id of ids) assert.ok(stagesFor(id).length >= 3, `${id}: stage list`);
});

test("stage marks: first at 0, strictly ascending, <= 96, unique labels", () => {
  for (const kind of PROGRESS_KINDS) {
    const tool = PROGRESS_TOOL_IDS.find((id) => progressKindOf(id) === kind);
    assert.ok(tool, `${kind}: used by some tool`);
    const stages = stagesFor(tool);
    assert.equal(stages[0].from, 0, `${kind}: starts at 0`);
    stages.forEach((s, i) => {
      assert.ok(s.from <= 96, `${kind}: mark ${s.from}`);
      if (i > 0) assert.ok(s.from > stages[i - 1].from, `${kind}: ascending at ${s.label}`);
    });
    assert.equal(new Set(stages.map((s) => s.label)).size, stages.length, `${kind}: labels unique`);
  }
});

test("stageIndexAt / stageCeiling", () => {
  const st = stagesFor("coursework");
  assert.equal(stageIndexAt(st, 0), 0);
  assert.equal(stageIndexAt(st, 9), 0);
  assert.equal(stageIndexAt(st, 10), 1);
  assert.equal(stageIndexAt(st, 59), 2);
  assert.equal(stageIndexAt(st, 99), st.length - 1);
  assert.equal(stageCeiling(st, 2), 59, "one below the next mark");
  assert.equal(stageCeiling(st, st.length - 1), 98, "last stage stops short of 99");
  assert.equal(progressKindOf("no-such-tool"), "doc", "unknown tool falls back");
});

const LESSON = stagesFor("lesson-plan"); // 8 -> 65 is one long LLM call

test("smooth: first render and zero elapsed show the server value exactly", () => {
  for (const server of [0, 8, 31, 65, 95]) {
    assert.equal(smoothProgress({ server, stages: LESSON, sinceChangeMs: 0 }), server);
  }
});

test("smooth: creeps up inside a long stage but never past the stage ceiling", () => {
  const shown = smoothProgress({ server: 10, stages: LESSON, sinceChangeMs: 5 * 60_000 });
  assert.ok(shown > 40, `creep ${shown}`);
  assert.ok(shown <= 59, `ceiling: ${shown}`);
  const early = smoothProgress({ server: 10, stages: LESSON, sinceChangeMs: 10_000 });
  assert.ok(early > 10 && early < shown, `monotone in time: ${early} < ${shown}`);
});

test("smooth: never below the server value, never reaches 99, never backwards", () => {
  assert.equal(smoothProgress({ server: 59, stages: LESSON, sinceChangeMs: 60_000 }), 59, "already at the ceiling");
  assert.ok(smoothProgress({ server: 97, stages: LESSON, sinceChangeMs: 10 * 60_000 }) <= 98);
  assert.ok(smoothProgress({ server: 99, stages: LESSON, sinceChangeMs: 10 * 60_000 }) <= 99);
  // The server catches up lower than what was shown: the shown value holds.
  assert.equal(smoothProgress({ server: 20, stages: LESSON, sinceChangeMs: 0, prev: 37 }), 37);
  // …but a server value above prev always wins.
  assert.equal(smoothProgress({ server: 50, stages: LESSON, sinceChangeMs: 0, prev: 37 }), 50);
  assert.equal(smoothProgress({ server: -5, stages: LESSON, sinceChangeMs: 0 }), 0);
  assert.equal(smoothProgress({ server: Number.NaN, stages: LESSON, sinceChangeMs: 0 }), 0);
});

test("smooth: a short typical duration creeps faster than a long one", () => {
  const fast = smoothProgress({ server: 10, stages: LESSON, sinceChangeMs: 15_000, typicalSec: 30 });
  const slow = smoothProgress({ server: 10, stages: LESSON, sinceChangeMs: 15_000, typicalSec: 600 });
  assert.ok(fast > slow, `${fast} > ${slow}`);
});

test("eta: needs a typical duration; slow past 1.3x; remaining shrinks with progress", () => {
  assert.deepEqual(etaState({ elapsedSec: 10, typicalSec: null, progress: 20 }), { kind: "none" });
  assert.deepEqual(etaState({ elapsedSec: 10, typicalSec: 0, progress: 20 }), { kind: "none" });
  assert.deepEqual(etaState({ elapsedSec: 200, typicalSec: 100, progress: 50 }), { kind: "slow" });
  const a = etaState({ elapsedSec: 20, typicalSec: 120, progress: 20 });
  const b = etaState({ elapsedSec: 80, typicalSec: 120, progress: 70 });
  assert.equal(a.kind, "left");
  assert.equal(b.kind, "left");
  if (a.kind === "left" && b.kind === "left") assert.ok(b.sec < a.sec, `${b.sec} < ${a.sec}`);
  // Far past the median is "slow" at ANY progress — never a stuck "a few seconds left" at 95 %.
  assert.equal(etaState({ elapsedSec: 150, typicalSec: 100, progress: 95 }).kind, "slow");
  assert.equal(etaState({ elapsedSec: 90, typicalSec: 100, progress: 95 }).kind, "left");
});

test("etaLabel is coarse Uzbek text", () => {
  assert.equal(etaLabel(3), "bir necha soniya");
  assert.equal(etaLabel(34), "30 soniya");
  assert.equal(etaLabel(70), "1 daqiqa");
  assert.equal(etaLabel(125), "2 daqiqa");
  assert.equal(etaLabel(125 * 60), "2 soat");
});
