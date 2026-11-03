/**
 * Studio «Montaj» — runs ffmpeg for one job (docs/studio/P8-SPEC.md «P8c» safety rules):
 *   - `spawn` with an argv array (no shell), stdin ignored, stdout ignored, stderr kept to its last 2 KB (logs only —
 *     never shown to the user);
 *   - a per-job temp dir (`mkdtemp` under the OS temp dir) holding the inputs under constant names; ffmpeg runs with
 *     that dir as `cwd`; the dir is removed afterwards whatever happened;
 *   - a hard timeout (≤ 120 s): SIGKILL, then the job fails;
 *   - a missing binary (ENOENT) is its own error, so the engine says «Montaj hozircha ishlamayapti» (refund).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Hard cap on one ffmpeg run (P8-SPEC: ≤ 120 s). */
export const MIX_FFMPEG_TIMEOUT_MS = 120_000;

export class FfmpegMissingError extends Error {
  constructor() {
    super("ffmpeg not installed");
    this.name = "FfmpegMissingError";
  }
}

export class FfmpegFailedError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "FfmpegFailedError";
  }
}

export type FfmpegRun = {
  /** Input files written into the temp dir first (constant names from `mix-args.ts`). */
  inputs: Readonly<Record<string, Uint8Array>>;
  args: readonly string[];
  /** The output file name inside the temp dir. */
  output: string;
  timeoutMs?: number;
  /** The binary (tests); default `ffmpeg` from PATH. */
  bin?: string;
};

const NAME_RE = /^[a-z0-9-]+\.(mp4|mp3)$/;

/** Runs ffmpeg in a fresh temp dir and returns the output bytes. Throws `FfmpegMissingError` / `FfmpegFailedError`. */
export async function runFfmpeg(run: FfmpegRun): Promise<Uint8Array> {
  for (const name of [...Object.keys(run.inputs), run.output]) if (!NAME_RE.test(name)) throw new Error(`mix: bad file name ${name}`);
  const dir = await mkdtemp(path.join(tmpdir(), "slaydx-mix-"));
  try {
    for (const [name, bytes] of Object.entries(run.inputs)) await writeFile(path.join(dir, name), bytes);
    await exec(run.bin ?? "ffmpeg", run.args, dir, Math.min(run.timeoutMs ?? MIX_FFMPEG_TIMEOUT_MS, MIX_FFMPEG_TIMEOUT_MS));
    return new Uint8Array(await readFile(path.join(dir, run.output)));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function exec(bin: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const done = (e?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e) reject(e);
      else resolve();
    };
    const child = spawn(bin, [...args], { cwd, stdio: ["ignore", "ignore", "pipe"], shell: false, windowsHide: true });
    // On timeout the promise settles from `close` (after the kill), so the caller removes the temp dir only once
    // ffmpeg is gone.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (s: string) => {
      stderr = (stderr + s).slice(-2048);
    });
    child.on("error", (e: NodeJS.ErrnoException) => done(e.code === "ENOENT" ? new FfmpegMissingError() : new FfmpegFailedError(e.message, stderr)));
    child.on("close", (code, signal) => {
      if (timedOut) done(new FfmpegFailedError(`ffmpeg timed out after ${timeoutMs} ms`, stderr));
      else if (code === 0) done();
      else done(new FfmpegFailedError(`ffmpeg exited ${code ?? signal}`, stderr));
    });
  });
}
