import { readFileSync } from "node:fs";

/**
 * Dockerfile reading helpers for the image tests.
 *
 * Since the ops sprint (docs/ops/O1-deploy-pipeline.md §3.1) the final stages
 * `runner` and `worker` start `FROM os-base`, so what a final image contains
 * is its own stage PLUS every stage it is built on. Tests that ask "does the
 * worker image have font X" must read that whole chain, not only the text
 * after `AS worker` (which would miss the shared base) and not the whole file
 * (which would also count packages of unrelated stages).
 */

export type Stage = { name: string; from: string; text: string };

export function readDockerfile(): string {
  return readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
}

/** Every `FROM <base> AS <name>` stage with its body (up to the next FROM). */
export function stages(df: string): Stage[] {
  const re = /^FROM\s+(?:--\S+\s+)*(\S+)\s+AS\s+(\S+)\s*$/gim;
  const heads = [...df.matchAll(re)];
  return heads.map((m, i) => ({
    from: m[1],
    name: m[2],
    text: df.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : df.length),
  }));
}

/**
 * The stage and its ancestors, nearest first (`worker`, `os-base`). Stops at
 * an external image (`${NODE_IMAGE}`). Throws on an unknown stage name.
 */
export function stageChain(df: string, name: string): Stage[] {
  const all = new Map(stages(df).map((s) => [s.name, s]));
  const out: Stage[] = [];
  let cur = all.get(name);
  if (!cur) throw new Error(`Dockerfile: no stage named ${name}`);
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = all.get(cur.from);
  }
  return out;
}

/** The text an image built with `--target <name>` is made of (own stage + bases). */
export function imageText(df: string, name: string): string {
  return stageChain(df, name)
    .map((s) => s.text)
    .reverse()
    .join("\n");
}

/** `RUN apk add …` lines of the given text (packages must stay on the RUN line). */
export function apkLines(text: string): string {
  return text
    .split("\n")
    .filter((l) => /^RUN apk add/.test(l))
    .join("\n");
}

export function hasPackage(apk: string, pkg: string): boolean {
  return new RegExp(`(^|\\s)${pkg.replace(/[-.]/g, "\\$&")}(\\s|$)`).test(apk);
}
