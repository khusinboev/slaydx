import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { imageText, readDockerfile, stageChain, stages } from "./helpers/dockerfile.mts";

/**
 * Image slimming (ops sprint P-IMG, docs/ops/O1-deploy-pipeline.md §3.1–3.2).
 *
 * Before: the worker ended with `chown -R worker:nodejs /app` (97 s on the
 * prod box, a second full copy of node_modules in the image), installed
 * Next's build compiler `@next/swc-*` (~140 MB) and shared no layer with the
 * web image; `.dockerignore` let tests/loadtests/.github into the context,
 * so a test-only commit re-ran the whole `next build`.
 */

const ROOT = new URL("../", import.meta.url);
const picomatch = (await import("next/dist/compiled/picomatch/index.js")).default as unknown as (
  glob: string | string[],
  opts?: { dot?: boolean; contains?: boolean },
) => (s: string) => boolean;

const df = readDockerfile();
const byName = new Map(stages(df).map((s) => [s.name, s]));
const instr = (text: string) => text.split("\n").filter((l) => /^[A-Z]+\s/.test(l));

test("Dockerfile: compose targets exist; `runner` and `worker` share the `os-base` stage", () => {
  const compose = readFileSync(new URL("docker-compose.yml", ROOT), "utf8");
  const targets = [...compose.matchAll(/^\s+target:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(targets.sort(), ["runner", "worker"], "docker-compose.yml build targets changed");
  for (const t of targets) assert.ok(byName.has(t), `compose target ${t} is not a Dockerfile stage`);
  for (const t of ["runner", "worker"]) {
    assert.ok(
      stageChain(df, t).some((s) => s.name === "os-base"),
      `${t} must be built FROM os-base (shared font layers, pulled once)`,
    );
  }
  // The last stage is what a target-less `docker build .` produces: keep it the
  // worker (compose comment on `web.build.target`), never the web server.
  assert.equal(stages(df).at(-1)!.name, "worker");
});

test("Dockerfile: no recursive chown anywhere (files are copied with --chown)", () => {
  // Instructions only (with their `\` continuation lines), not comments.
  const code = df
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert.ok(!/chown\s+(-\w*R|--recursive)/.test(code), "`chown -R` duplicates every file into a new layer");
});

test("Dockerfile: worker gets production node_modules without Next's SWC compiler", () => {
  const worker = byName.get("worker")!.text;
  const nm = instr(worker).filter((l) => /^COPY\b/.test(l) && /node_modules/.test(l));
  assert.equal(nm.length, 1, "worker must copy node_modules exactly once");
  assert.match(nm[0], /--from=prod-deps\s/, "worker node_modules must come from the prod-deps stage");
  assert.ok(
    !instr(worker).some((l) => /--from=(deps|builder)\b/.test(l)),
    "worker must not copy from deps/builder (dev dependencies)",
  );
  assert.ok(!/^RUN\s.*npm (ci|install)/m.test(worker), "worker must not install packages itself");
  const prod = imageText(df, "prod-deps");
  assert.match(prod, /npm (prune|ci) --omit=dev/, "prod-deps must drop devDependencies");
  assert.match(prod, /rm -rf node_modules\/@next\/swc-\*/, "prod-deps must drop @next/swc-* (build-time compiler)");
});

test("Dockerfile: worker files are owned by worker:nodejs via COPY --chown, user created first", () => {
  const lines = instr(byName.get("worker")!.text);
  const user = lines.findIndex((l) => /adduser\s.*\bworker\b/.test(l));
  const copies = lines.map((l, i) => [l, i] as const).filter(([l]) => /^COPY\b/.test(l));
  assert.ok(user >= 0, "worker user is not created");
  assert.ok(copies.length >= 5, "worker COPY lines missing");
  for (const [l, i] of copies) {
    assert.ok(i > user, `COPY before the user exists: ${l}`);
    assert.match(l, /--chown=worker:nodejs\s/, `worker COPY without --chown: ${l}`);
  }
  for (const what of ["lib ./lib", "scripts ./scripts", "data ./data", "tsconfig.json", "package.json"]) {
    assert.ok(copies.some(([l]) => l.includes(what)), `worker no longer copies ${what}`);
  }
  // Most volatile last: a code commit only changes the `lib` layer, not node_modules.
  const at = (re: RegExp) => copies.findIndex(([l]) => re.test(l));
  assert.ok(at(/node_modules/) < at(/ lib \.\/lib/), "node_modules must be copied before lib");
});

test("Dockerfile: web image copies migrations and orders layers stable → volatile", () => {
  const lines = instr(byName.get("runner")!.text);
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  assert.ok(at(/\/app\/lib\/server\/migrations \.\/lib\/server\/migrations/) >= 0, "runner must copy the migrations");
  assert.ok(at(/^RUN apk add .*libreoffice/) < at(/\.next\/standalone/), "LibreOffice layer must precede app layers");
  assert.ok(at(/\/app\/public/) < at(/\.next\/standalone/), "public must precede standalone");
  assert.ok(at(/lib\/server\/migrations/) < at(/\.next\/standalone/), "migrations must precede standalone");
  for (const l of lines.filter((x) => /^COPY\b/.test(x))) {
    assert.match(l, /--chown=nextjs:nodejs\s/, `runner COPY without --chown: ${l}`);
  }
});

test("Dockerfile: the only build arg is the base image pin; no build secrets, no BuildKit-only syntax", () => {
  // Images are pushed to a registry: every ARG value is readable there. OCI
  // source/revision labels come from the CI Bake file, not from build args.
  const args = [...df.matchAll(/^ARG\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(args)], ["NODE_IMAGE"], `unexpected build args: ${args}`);
  // No `RUN --mount` (secret or cache): no secret is needed to build, and the
  // legacy builder (fallback on-server build, hosts without buildx) rejects it.
  assert.ok(!/^RUN\s+--mount/m.test(df), "RUN --mount is BuildKit-only / a build secret");
});

/* ───────────────────────── .dockerignore ───────────────────────── */

/**
 * Docker semantics (moby/patternmatcher): a path is excluded when a pattern
 * matches it OR one of its parent directories; later rules win; `!` re-includes.
 */
const rules = readFileSync(new URL(".dockerignore", ROOT), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const neg = l.startsWith("!");
    const pat = (neg ? l.slice(1) : l).replace(/^\/+|\/+$/g, "");
    return { neg, match: picomatch(pat, { dot: true }) };
  });

function ignored(path: string): boolean {
  const parts = path.split("/");
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  let out = false;
  for (const r of rules) if (prefixes.some((p) => r.match(p))) out = !r.neg;
  return out;
}

function walk(dir: string): string[] {
  const abs = new URL(dir + "/", ROOT);
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((f) => statSync(new URL(f, abs)).isFile())
    .map((f) => join(dir, f));
}

test(".dockerignore: tests, load tests, CI, docs and deploy files stay out of the build context", () => {
  for (const p of [
    "tests/docker-image-slim.test.mts",
    "tests/helpers/dockerfile.mts",
    "loadtests/README.txt",
    ".github/workflows/ci.yml",
    "docs/ops/PLAN.md",
    "deploy/deploy-pull.sh",
    "CLAUDE.md",
    "README.md",
    "docker-compose.yml",
    "Dockerfile",
    ".env",
    ".env.local",
    ".claude/deploy.md",
    "audit/AUDITOR-BRIEF.md",
    ".backup.env",
    ".eslintcache",
    "node_modules/next/package.json",
    ".next/BUILD_ID",
  ]) {
    assert.ok(ignored(p), `${p} must not be in the docker build context`);
  }
});

test(".dockerignore: everything the build and the runtime stages read stays in the context", () => {
  const needed = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    "eslint.config.mjs",
    "instrumentation.ts",
    "next-env.d.ts",
    ...["app", "components", "lib", "public", "data", "scripts", "brand"].flatMap(walk),
  ];
  for (const must of [
    "scripts/guard-build.mjs",
    "scripts/worker.ts",
    "scripts/migrate.ts",
    "lib/server/parse-worker.ts",
    "public/samples/CREDITS.md",
    "data/ICONS-LICENSE.md",
  ]) {
    assert.ok(needed.includes(must), `${must} vanished from the repo walk`);
  }
  assert.ok(needed.some((p) => /^lib\/server\/migrations\/\d{3}_.*\.sql$/.test(p)), "migrations not found");
  const lost = needed.filter(ignored);
  assert.deepEqual(lost, [], "files needed by the build/runtime are excluded from the context");
});
