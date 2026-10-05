import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Ops sprint P-CI (docs/ops/PLAN.md, O2/O1 §3.5): contract of `.github/workflows/*`.
 * The workflows only run on GitHub, so their load-bearing details are locked here as text:
 * - `--test-shard` must precede the file glob (after it node silently runs every file — O2 gotcha 1),
 *   and the sharded commands must keep every flag of the package.json scripts they replace;
 * - `main` runs are never cancelled; only `images` / `promote` hold `packages: write`;
 * - promote needs `ci-ok` + `images`; the deploy command uses the `<SERVER_IP>` placeholder;
 * - every third-party action is pinned to a full commit SHA;
 * - the GHCR retention selection (jq) keeps `main`, the newest builds and recent promoted shas.
 */

const WF_DIR = ".github/workflows";
const ci = readFileSync(`${WF_DIR}/ci.yml`, "utf8");
const retention = readFileSync(`${WF_DIR}/ghcr-retention.yml`, "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

/** Top-level job blocks of a workflow: name -> text (2-space indented keys under `jobs:`). */
function jobs(yml: string): Map<string, string> {
  const body = yml.slice(yml.indexOf("\njobs:\n") + 7);
  const out = new Map<string, string>();
  const re = /^ {2}([A-Za-z0-9_-]+):\s*$/gm;
  const heads = [...body.matchAll(re)];
  heads.forEach((m, i) => {
    out.set(m[1], body.slice(m.index!, i + 1 < heads.length ? heads[i + 1].index : undefined));
  });
  return out;
}

/** Folded (`>-`) run command of the step whose name contains `stepName`, joined to one line. */
function foldedRun(job: string, stepName: string): string {
  const at = job.indexOf(stepName);
  assert.ok(at >= 0, `step ${stepName} not found`);
  const m = /run: >-\n((?: {10}.*\n?)+)/.exec(job.slice(at));
  assert.ok(m, `folded run for ${stepName} not found`);
  return m[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
}

/** The test command a package.json script runs, split into (flags, file glob). */
function scriptParts(name: string): { flags: string[]; glob: string } {
  const tokens = pkg.scripts[name].split(/\s+/);
  assert.equal(tokens[0], "tsx", `${name} is expected to start with tsx`);
  const glob = tokens[tokens.length - 1];
  assert.match(glob, /\*\.test\.mts$/);
  return { flags: tokens.slice(1, -1), glob };
}

function assertSharded(cmd: string, script: string) {
  const { flags, glob } = scriptParts(script);
  // `${{ matrix.shard }}` -> `${{matrix.shard}}` so expressions stay one token
  const tokens = cmd.replace(/\$\{\{\s*(.*?)\s*\}\}/g, "${{$1}}").split(/\s+/);
  const shard = tokens.findIndex((t) => t.startsWith("--test-shard="));
  const globAt = tokens.indexOf(glob);
  assert.ok(shard > 0, `${script}: --test-shard missing`);
  assert.ok(globAt > 0, `${script}: glob ${glob} missing`);
  assert.ok(shard < globAt, `${script}: --test-shard must come BEFORE ${glob} (after it, node ignores it)`);
  assert.equal(globAt, tokens.length - 1, `${script}: the glob must be the last argument`);
  for (const f of flags) assert.ok(tokens.includes(f), `${script}: CI command lost flag ${f}`);
  assert.equal(tokens[shard], "--test-shard=${{matrix.shard}}/${{strategy.job-total}}");
}

test("ci.yml: unit and ui shards put --test-shard before the glob and keep the package.json flags", () => {
  const j = jobs(ci);
  assertSharded(foldedRun(j.get("unit")!, "npm test (shard"), "test");
  assertSharded(foldedRun(j.get("ui")!, "test:ui (shard"), "test:ui");
  assert.match(j.get("ui")!, /if: matrix\.shard == 1\n\s+run: npm run test:viewer/);
});

test("ci.yml: every unit shard has its own Postgres service; ui shards have none", () => {
  const j = jobs(ci);
  assert.match(j.get("unit")!, /services:\n\s+postgres:\n(?:\s+#.*\n)*\s+image: postgres:16\.15-alpine3\.24/);
  assert.match(j.get("unit")!, /shard: \[1, 2, 3, 4\]/);
  assert.match(j.get("ui")!, /shard: \[1, 2, 3\]/);
  assert.doesNotMatch(j.get("ui")!, /services:/);
});

test("ci.yml: triggers, and only pull_request runs cancel stale runs (main never)", () => {
  assert.match(ci, /\non:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {2}workflow_dispatch:/);
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  // push runs get a unique group: a queued main run is never replaced by a newer one
  assert.match(ci, /group: ci-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id \}\}/);
});

test("ci.yml: least privilege — contents: read by default, packages: write only on images and promote", () => {
  assert.match(ci, /\npermissions:\n {2}contents: read\n/);
  const j = jobs(ci);
  const writers = [...j].filter(([, body]) => /\n\s+permissions:\n(?:\s+[a-z-]+: [a-z]+\n)*?\s+packages: write\n/.test(body)).map(([name]) => name).sort();
  assert.deepEqual(writers, ["images", "promote"]);
  assert.match(j.get("images")!, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(j.get("promote")!, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(j.get("images-check")!, /push: false/);
  assert.doesNotMatch(j.get("images-check")!, /permissions:|docker login/);
  assert.match(j.get("ci-ok")!, /permissions: \{\}/);
});

test("ci.yml: ci-ok aggregates every job; promote waits for ci-ok + images and re-tags by digest", () => {
  const j = jobs(ci);
  const others = [...j.keys()].filter((k) => k !== "ci-ok" && k !== "promote").sort();
  const needs = /needs: \[([^\]]+)\]/.exec(j.get("ci-ok")!)![1].split(",").map((s) => s.trim()).sort();
  assert.deepEqual(needs, others);
  assert.match(j.get("ci-ok")!, /if: always\(\)/);
  assert.match(j.get("promote")!, /needs: \[ci-ok, images\]/);
  assert.match(j.get("promote")!, /imagetools create --prefer-index=false/);
  assert.match(j.get("promote")!, /slaydx-\$s@\$d/);
  assert.match(j.get("promote")!, /ssh root@<SERVER_IP> slaydx-deploy \$GITHUB_SHA/);
  assert.match(ci, /REGISTRY: ghcr\.io\/khusinboev\n/);
  assert.match(ci, /\$\{REGISTRY\}\/slaydx-web:build-\$\{GIT_SHA\}/);
  assert.match(ci, /\$\{REGISTRY\}\/slaydx-worker:build-\$\{GIT_SHA\}/);
});

test("workflows: every action is pinned to a full commit SHA with a version comment; no IPs", () => {
  for (const f of readdirSync(WF_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(`${WF_DIR}/${f}`, "utf8");
    for (const m of text.matchAll(/uses:\s*(\S+)(.*)$/gm)) {
      if (m[1].startsWith("./")) continue;
      assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${m[1]} is not pinned to a commit SHA`);
      assert.match(m[2], /# v\d+(\.\d+)*/, `${f}: ${m[1]} lacks a version comment`);
    }
    const ips = [...text.matchAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)].map((m) => m[0]);
    assert.deepEqual(ips.filter((ip) => !ip.startsWith("127.")), [], `${f}: contains a non-loopback IPv4 literal`);
  }
});

test("package.json: lint uses a content-hashed eslint cache (CI restores .eslintcache)", () => {
  assert.equal(pkg.scripts.lint, "eslint --cache --cache-strategy content");
  assert.match(ci, /path: \.eslintcache/);
  assert.match(readFileSync(".gitignore", "utf8"), /^\.eslintcache$/m);
});

// ---- GHCR retention selection ----

function hasJq(): boolean {
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** The jq program from the `RETENTION_JQ: |` block scalar (8-space indented lines). */
function retentionJq(): string {
  const m = /RETENTION_JQ: \|\n((?: {8}.*\n|\n)+)/.exec(retention);
  assert.ok(m, "RETENTION_JQ block not found");
  return m[1].split("\n").map((l) => l.slice(8)).join("\n");
}

const DAY = 86_400;
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0) / 1000;
const iso = (daysAgo: number) => new Date((NOW - daysAgo * DAY) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const sha = (n: number) => n.toString(16).padStart(40, "a");
const version = (id: number, daysAgo: number, tags: string[]) => ({
  id,
  name: `sha256:${id.toString(16).padStart(64, "0")}`,
  created_at: iso(daysAgo),
  metadata: { package_type: "container", container: { tags } },
});

test("ghcr-retention: keeps main, newest N builds, recent promoted shas; deletes the rest", { skip: hasJq() ? false : "jq not installed" }, () => {
  const versions = [
    version(1, 90, [`build-${sha(1)}`, sha(1)]), // old promoted, beyond N -> delete
    version(2, 60, [`build-${sha(2)}`, sha(2), "main"]), // main tag, however old -> keep
    version(3, 40, [`build-${sha(3)}`]), // old failed candidate -> delete
    version(4, 20, [`build-${sha(4)}`, sha(4)]), // promoted, 20 days, beyond N -> keep (age)
    version(5, 10, [`build-${sha(5)}`]), // failed candidate beyond N -> delete
    version(6, 3, [`build-${sha(6)}`]), // newest 2 builds -> keep
    version(7, 1, [`build-${sha(7)}`, sha(7)]), // newest 2 builds -> keep
    version(8, 2, []), // untagged, recent -> keep
    version(9, 45, []), // untagged, old -> delete
    version(10, 35, [sha(10)]), // promoted sha without build tag, 35 days -> delete
  ];
  const out = execFileSync(
    "jq",
    ["--argjson", "now", String(NOW), "--argjson", "keep", "2", "--argjson", "maxAge", "30", retentionJq()],
    { input: JSON.stringify(versions), encoding: "utf8" },
  );
  const plan = JSON.parse(out) as { id: number; keep: string | null }[];
  const keep = Object.fromEntries(plan.map((p) => [p.id, p.keep]));
  assert.deepEqual(
    plan.filter((p) => p.keep === null).map((p) => p.id).sort((a, b) => a - b),
    [1, 3, 5, 9, 10],
  );
  assert.equal(keep[2], "main tag");
  assert.equal(keep[6], "newest 2 build-*");
  assert.equal(keep[7], "newest 2 build-*");
  assert.equal(keep[4], "promoted sha, <= 30 days");
  assert.equal(keep[8], "untagged, <= 30 days");
});

test("ghcr-retention: dry run unless explicitly applied; only packages: write", () => {
  assert.match(
    retention,
    /APPLY: \$\{\{ \(github\.event_name == 'workflow_dispatch' && inputs\.apply\) \|\| \(github\.event_name == 'schedule' && vars\.GHCR_RETENTION_APPLY == 'true'\) \}\}/,
  );
  assert.match(retention, /apply:\n\s+description: [^\n]+\n\s+type: boolean\n\s+default: false/);
  assert.match(retention, /if \[ "\$APPLY" != "true" \]; then/);
  assert.match(retention, /\npermissions: \{\}\n/);
  assert.match(retention, /permissions:\n\s+packages: write\n/);
  assert.match(retention, /package: \[slaydx-web, slaydx-worker\]/);
});
