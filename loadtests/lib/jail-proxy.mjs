// Provider jail: an HTTP(S) proxy that NEVER forwards anything.
//
// The stack runs with NODE_USE_ENV_PROXY=1 + HTTPS_PROXY/HTTP_PROXY pointing here
// (NO_PROXY=127.0.0.1,localhost). Node's global fetch then sends every outbound
// request (Gemini, Telegram, Pexels, OpenAlex, ...) to this process instead of the
// internet. No app code is changed.
//
// Mode is re-read from $JAIL_MODE_FILE on every connection, so it can be flipped
// at runtime (`stack.sh provider-mode ...`):
//   reject  — answer 502 at once (provider down, fails fast)
//   tarpit  — hold the connection TARPIT_SEC seconds, then 502 (provider hangs)
//
// Every attempt is appended to $JAIL_LOG (ts, mode, target) as proof that nothing
// left the laptop. With blank provider keys the app normally makes no attempt at all.
import { appendFileSync, readFileSync } from "node:fs";
import net from "node:net";

const port = Number(process.env.JAIL_PORT || 3399);
const modeFile = process.env.JAIL_MODE_FILE || "";
const logFile = process.env.JAIL_LOG || "";
const tarpitSec = Number(process.env.TARPIT_SEC || 20);

function mode() {
  try {
    return readFileSync(modeFile, "utf8").trim() || "reject";
  } catch {
    return "reject";
  }
}

function record(m, target) {
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${new Date().toISOString()},${m},${target}\n`);
  } catch (e) {
    console.error("[jail] log write failed:", e.message);
  }
}

const server = net.createServer((sock) => {
  sock.on("error", () => {});
  sock.once("data", (buf) => {
    const first = buf.toString("latin1").split("\r\n")[0] || "";
    const target = first.split(" ")[1] || "?";
    const m = mode();
    record(m, target);
    const answer = () => {
      if (sock.destroyed) return;
      sock.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    };
    if (m === "tarpit") {
      const t = setTimeout(answer, tarpitSec * 1000);
      sock.on("close", () => clearTimeout(t));
    } else {
      answer();
    }
  });
});

server.listen(port, "127.0.0.1", () => console.log(`[jail] listening on 127.0.0.1:${port}, mode file ${modeFile}`));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => process.exit(0));
