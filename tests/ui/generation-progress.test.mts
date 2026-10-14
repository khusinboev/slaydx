import "./setup.ts";
import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { GenerationProgress, clockText } from "../../components/files/GenerationProgress.tsx";
import type * as api from "../../lib/api-client.ts";

/**
 * The running panel of every non-slide tool (percent, stage checklist, step text, elapsed, ETA).
 * Clock is mocked (`Date` + `setInterval`) so the creep and the clock are deterministic.
 *
 * MUTATIONS checked: render the raw server value only (no creep) -> "creeps" fails; drop the stage
 * ceiling in smoothProgress -> "stays inside the stage" fails; drop `queued` branch -> queued test fails.
 */

afterEach(() => {
  cleanup();
  mock.timers.reset();
});

function detail(patch: Record<string, unknown> = {}): api.GenerationDetail {
  return {
    id: "g1",
    type: "lesson-plan",
    topic: "Kasr sonlar",
    status: "IN_PROGRESS",
    createdAt: "2026-10-14T08:00:00.000Z",
    price: 3000,
    format: "docx",
    progress: 10,
    step: "Mazmun yozilmoqda",
    hasFile: false,
    ...patch,
  } as unknown as api.GenerationDetail;
}

const q = (sel: string) => document.querySelector(sel);
const percent = () => Number((q("[data-progress-percent]")?.textContent ?? "").replace("%", ""));
const states = () => [...document.querySelectorAll("[data-stage-state]")].map((el) => el.getAttribute("data-stage-state"));

test("first render shows the server value, the engine step text and the tool's stage list", () => {
  render(h(GenerationProgress, { gen: detail() }));
  assert.equal(percent(), 10);
  assert.equal(q("[role=progressbar]")?.getAttribute("aria-valuenow"), "10");
  assert.match(q("[data-progress-step]")?.textContent ?? "", /Mazmun yozilmoqda/);
  // lesson-plan = teacher kind: 5 stages, 2nd (index 1, from 8) is current.
  assert.deepEqual(states(), ["done", "current", "todo", "todo", "todo"]);
  assert.equal(q("[data-generation-progress]")?.getAttribute("data-kind"), "teacher");
  assert.ok(q("[data-art=teacher]"), "per-kind art");
});

test("kind follows the tool (audio / image / game) and stages differ per kind", () => {
  const labels = (type: string) => {
    cleanup();
    render(h(GenerationProgress, { gen: detail({ type }) }));
    return [...document.querySelectorAll("[data-stage-state]")].map((el) => el.textContent);
  };
  assert.ok(labels("podcast").includes("Ovozga o‘girilmoqda"));
  assert.ok(labels("image").includes("Rasm chizilmoqda"));
  assert.ok(labels("crossword").includes("Varaq tayyorlanmoqda"));
  assert.ok(!labels("podcast").includes("Mavzu tahlil qilinmoqda"), "no generic text on tool-specific lists");
});

test("creeps inside the current stage while the server value stands still, never past the next stage mark", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-14T08:01:00Z") });
  render(h(GenerationProgress, { gen: detail({ progress: 10, runningSec: 5, typicalSec: 120 }) }));
  assert.equal(percent(), 10);
  let last = 10;
  for (let i = 0; i < 40; i++) {
    act(() => mock.timers.tick(10_000));
    const p = percent();
    assert.ok(p >= last, `never backwards: ${last} -> ${p}`);
    assert.ok(p <= 59, `stays inside the stage (teacher "Mazmun" ends at 59): ${p}`);
    last = p;
  }
  assert.ok(last > 40, `creeps: ${last}`);
  assert.deepEqual(states(), ["done", "current", "todo", "todo", "todo"], "still in the same stage");
});

test("a new server value restarts from it and moves the checklist; shown value never drops", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-14T08:01:00Z") });
  const view = render(h(GenerationProgress, { gen: detail({ progress: 10 }) }));
  act(() => mock.timers.tick(60_000));
  const crept = percent();
  assert.ok(crept > 10);
  view.rerender(h(GenerationProgress, { gen: detail({ progress: 20 }) }));
  assert.ok(percent() >= crept, "does not drop below what was already shown");
  view.rerender(h(GenerationProgress, { gen: detail({ progress: 62, step: "Hujjat yig‘ilmoqda" }) }));
  assert.equal(percent(), 62);
  assert.deepEqual(states(), ["done", "done", "current", "todo", "todo"]);
  assert.equal(q("[role=progressbar]")?.getAttribute("aria-valuenow"), "62");
});

test("elapsed clock and ETA: left, then slow past 1.3x the median", () => {
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-14T08:01:00Z") });
  render(h(GenerationProgress, { gen: detail({ progress: 30, runningSec: 20, typicalSec: 120 }) }));
  assert.match(q("[data-progress-time]")?.textContent ?? "", /Ketdi: 0:20/);
  assert.ok(q("[data-eta=left]"), "estimate shown");
  assert.match(q("[data-eta=left]")?.textContent ?? "", /qoldi/);
  act(() => mock.timers.tick(150_000));
  assert.match(q("[data-progress-time]")?.textContent ?? "", /Ketdi: 2:50/);
  assert.ok(q("[data-eta=slow]"), "slow note instead of a stuck estimate");
  assert.ok(!q("[data-eta=left]"));
});

test("no typical duration or no runningSec (old server) -> no estimate, panel still works", () => {
  render(h(GenerationProgress, { gen: detail({ runningSec: 40 }) }));
  assert.ok(!q("[data-eta]"), "no median -> no ETA");
  assert.ok(q("[data-progress-time]"), "elapsed still shown");
  cleanup();
  render(h(GenerationProgress, { gen: detail() }));
  assert.ok(!q("[data-progress-time]"));
  assert.equal(percent(), 10);
});

test("QUEUED: queue position, no percent, no stage list, bar has no value", () => {
  render(h(GenerationProgress, { gen: detail({ status: "QUEUED", progress: 0, queuePosition: 3, etaSec: 150 }) }));
  assert.match(q("[data-queue-position]")?.textContent ?? "", /3/);
  assert.match(q("[data-queue-position]")?.textContent ?? "", /3 daqiqa/);
  assert.ok(!q("[data-progress-percent]"));
  assert.ok(!q("[data-stage-state]"));
  assert.equal(q("[role=progressbar]")?.getAttribute("aria-valuenow"), null);
});

test("clockText", () => {
  assert.equal(clockText(0), "0:00");
  assert.equal(clockText(65.9), "1:05");
  assert.equal(clockText(750), "12:30");
  assert.equal(clockText(-4), "0:00");
});
