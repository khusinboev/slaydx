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
  // promote must not rely on the implicit success(): images-check is skipped on push (first main run skipped promote).
  assert.match(j.get("promote")!, /!cancelled\(\) && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' &&/);
  assert.match(j.get("promote")!, /needs\.ci-ok\.result == 'success' && needs\.images\.result == 'success'/);
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

/** A numeric env value of the retention job (`NAME: "10"` or the `|| '20'` default of KEEP_BUILDS). */
function retentionEnv(name: string): number {
  const m = new RegExp(`\\n {6}${name}: [^\\n]*?"?'?(\\d+)'?"?(?: \\}\\})?\\n`).exec(retention);
  assert.ok(m, `${name} not found in ghcr-retention.yml`);
  return Number(m[1]);
}

type Params = { keepBuilds: number; keepPromoted: number; promotedMaxAge: number; untaggedMaxAge: number };
const workflowParams = (): Params => ({
  keepBuilds: retentionEnv("KEEP_BUILDS"),
  keepPromoted: retentionEnv("KEEP_PROMOTED"),
  promotedMaxAge: retentionEnv("PROMOTED_MAX_AGE_DAYS"),
  untaggedMaxAge: retentionEnv("UNTAGGED_MAX_AGE_DAYS"),
});

function plan(versions: ReturnType<typeof version>[], p: Params): Record<number, string | null> {
  const args = ["--argjson", "now", String(NOW)];
  for (const [k, v] of Object.entries(p)) args.push("--argjson", k, String(v));
  const out = execFileSync("jq", [...args, retentionJq()], { input: JSON.stringify(versions), encoding: "utf8" });
  return Object.fromEntries((JSON.parse(out) as { id: number; keep: string | null }[]).map((x) => [x.id, x.keep]));
}
const deleted = (pl: Record<number, string | null>) =>
  Object.entries(pl).filter(([, k]) => k === null).map(([id]) => Number(id)).sort((a, b) => a - b);

const jqSkip = { skip: hasJq() ? false : "jq not installed" };

test("ghcr-retention: workflow keeps >= 10 newest promoted versions and promoted shas for >= 90 days", () => {
  const p = workflowParams();
  assert.equal(p.keepBuilds, 20);
  assert.ok(p.keepPromoted >= 10, `KEEP_PROMOTED=${p.keepPromoted}`);
  assert.ok(p.promotedMaxAge >= 90, `PROMOTED_MAX_AGE_DAYS=${p.promotedMaxAge}`);
  assert.equal(p.untaggedMaxAge, 30);
});

test("ghcr-retention (review C1): the deployed sha survives 21 newer main pushes and 40 days", jqSkip, () => {
  // Reviewer scenario: the owner stays on a deploy promoted 40 days ago while CI promotes 21 newer main pushes.
  const versions = [version(1, 40, [`build-${sha(1)}`, sha(1)])];
  for (let i = 2; i <= 22; i++) {
    versions.push(version(i, 22 - i, [`build-${sha(i)}`, sha(i), ...(i === 22 ? ["main"] : [])]));
  }
  const pl = plan(versions, workflowParams());
  assert.notEqual(pl[1], null, "the deployed version would be deleted");
  assert.deepEqual(deleted(pl), []);
});

test("ghcr-retention: the newest promoted versions are kept regardless of age", jqSkip, () => {
  // 11 promoted versions, all ancient; builds/age rules disabled so only the promoted rule can keep them.
  const versions = Array.from({ length: 11 }, (_, k) => version(k + 1, 1000 - k, [sha(k + 1)]));
  versions.push(version(12, 0, [`build-${sha(12)}`, sha(12), "main"]));
  const pl = plan(versions, { keepBuilds: 1, keepPromoted: 10, promotedMaxAge: 90, untaggedMaxAge: 30 });
  // newest 10 promoted = 12 (main) + ids 11..3; id 2 and 1 are the 11th/12th -> deleted
  assert.deepEqual(deleted(pl), [1, 2]);
  assert.equal(pl[3], "newest 10 promoted");
  assert.equal(pl[12], "main tag");
});

test("ghcr-retention: rule by rule (main, keep-*, same digest, builds, age, untagged)", jqSkip, () => {
  const versions = [
    version(1, 90, [`build-${sha(1)}`, sha(1)]), // old promoted, beyond the newest 2 promoted -> delete
    version(2, 60, [`build-${sha(2)}`, sha(2), "main"]), // main tag, however old -> keep
    version(3, 40, [`build-${sha(3)}`]), // old failed candidate -> delete
    version(4, 20, [`build-${sha(4)}`, sha(4)]), // promoted, 20 days -> keep (age)
    version(5, 10, [`build-${sha(5)}`]), // failed candidate beyond the newest 2 builds -> delete
    version(6, 3, [`build-${sha(6)}`]), // newest 2 builds -> keep
    version(7, 1, [`build-${sha(7)}`, sha(7)]), // newest 2 promoted -> keep
    version(8, 2, []), // untagged, recent -> keep
    version(9, 45, []), // untagged, old -> delete
    version(10, 35, [sha(10)]), // promoted sha, 35 days, beyond the newest 2 promoted -> delete
    version(11, 0.5, [sha(11)]), // newest promoted -> keep
    version(12, 500, ["keep-prod", sha(12)]), // manual pin -> keep
    { ...version(13, 400, []), name: version(2, 0, []).name }, // same digest as the main version -> keep
  ];
  const pl = plan(versions, { keepBuilds: 2, keepPromoted: 2, promotedMaxAge: 30, untaggedMaxAge: 30 });
  assert.deepEqual(deleted(pl), [1, 3, 5, 9, 10]);
  assert.equal(pl[2], "main tag");
  assert.equal(pl[12], "keep-* tag");
  assert.equal(pl[13], "same digest as a protected version");
  assert.equal(pl[11], "newest 2 promoted");
  assert.equal(pl[7], "newest 2 promoted");
  assert.equal(pl[6], "newest 2 build-*");
  assert.equal(pl[4], "promoted sha, <= 30 days");
  assert.equal(pl[8], "untagged, <= 30 days");
});

test("ci.yml (review C2/C3/D3): provenance off, carbon-copy promote, private packages, revision label checked", () => {
  const j = jobs(ci);
  assert.match(j.get("images")!, /provenance: false/);
  assert.match(j.get("images-check")!, /provenance: false/);
  assert.equal((j.get("promote")!.match(/imagetools create --prefer-index=false/g) ?? []).length, 2);
  const promote = j.get("promote")!;
  const vis = promote.indexOf("-q .visibility");
  assert.ok(vis > 0 && vis < promote.indexOf("imagetools create"), "visibility check must run before any tag moves");
  assert.match(promote, /\[ "\$vis" = "private" \] \|\|/);
  assert.match(j.get("images")!, /\.config\.Labels\["org\.opencontainers\.image\.revision"\]/);
  assert.match(j.get("images")!, /\[ "\$rev" = "\$GITHUB_SHA" \] \|\|/);
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
