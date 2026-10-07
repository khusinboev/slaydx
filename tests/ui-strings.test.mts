import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/*
 * UX-10: interfeys to'liq o'zbekcha. Ekran o'quvchi tugmalarning
 * `aria-label`/`title`/`placeholder` ini o'qiydi — ikki sarlavha tugmasi
 * («Toggle Sidebar», «Notifications alt+T») inglizcha e'lon qilinardi.
 * Bu test `components/**` va `app/uz/**` dagi LITERAL atribut matnlarida
 * tipik inglizcha UI so'zlarini qidiradi.
 */
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const ENGLISH = /\b(Toggle|Notifications?|Close|Open|Search|Menu|Loading|Delete|Remove|Upload|Download|Settings|Previous|Next|Back|Select|Choose|Edit|Save|Cancel|Share|Copy|Zoom|Play|Pause|Fullscreen|Sidebar|Dismiss|Expand|Collapse|Undo|Redo|Reset|Submit|Clear|Profile|Logout|Login|Sign in|Language|Theme)\b/;
const ATTR = /\b(aria-label|title|placeholder|alt)=(?:"([^"]*)"|\{"([^"]*)"\}|\{`([^`]*)`\})/g;

test("UX-10: komponentlardagi aria-label/title/placeholder/alt matnlari inglizcha emas", () => {
  const hits: string[] = [];
  for (const f of [...files(path.join(ROOT, "components")), ...files(path.join(ROOT, "app/uz"))]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(ATTR)) {
      const text = m[2] ?? m[3] ?? m[4] ?? "";
      if (ENGLISH.test(text)) hits.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});

/*
 * The TopBar (menu toggle + bell) is gone (redesign F0). Its successors: the
 * bottom bar, the «+» sheet and the Bosh header. Their names come through
 * props (`label=…`, `aria-label={cond ? … : …}`), which the literal scan above
 * cannot see, so they are pinned here.
 */
test("UX-10: tab bar, «+» sheet and Bosh header controls are named in Uzbek; the bell keeps its `title` shortcut", () => {
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
  const tabbar = read("components/shell/TabBar.tsx");
  assert.match(tabbar, /aria-label="Asosiy bo‘limlar"/);
  assert.match(tabbar, /aria-label=\{createOpen \? "Yopish" : "Yaratish"\}/);
  const sheet = read("components/shell/CreateSheet.tsx");
  assert.match(sheet, /aria-label="Yopish"/);
  assert.match(sheet, /Nima yaratamiz\?/);
  const hub = read("components/home/HomeHub.tsx");
  assert.match(hub, /label="Bildirishnomalar"/);
  assert.match(hub, /title="Bildirishnomalar \(Alt\+T\)"/);
  assert.match(hub, /label="Qidirish"/);
  // `label=` props of the shell's icon buttons must not be English either.
  const hits: string[] = [];
  for (const f of [...files(path.join(ROOT, "components")), ...files(path.join(ROOT, "app/uz"))]) {
    for (const m of readFileSync(f, "utf8").matchAll(/\blabel="([^"]*)"/g)) {
      if (ENGLISH.test(m[1]!)) hits.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
});
