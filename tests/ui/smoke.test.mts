import "./setup.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";

/** jsdom + Testing Library ishlayotganini qulflaydi — keyingi UI testlar shunga tayanadi. */
function Counter() {
  const [n, setN] = useState(0);
  return h("button", { onDoubleClick: () => setN(n + 1) }, `soni: ${n}`);
}

test("jsdom muhiti: dblclick React holatini o'zgartiradi", () => {
  render(h(Counter));
  const btn = screen.getByText("soni: 0");
  fireEvent.doubleClick(btn);
  assert.equal(btn.textContent, "soni: 1");
  cleanup();
});
