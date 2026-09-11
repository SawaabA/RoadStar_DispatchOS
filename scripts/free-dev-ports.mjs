import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORTS = [5173, 7070, 7071];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

// Number("") is 0, so an empty line from a tool's trailing newline would
// otherwise look like a valid PID.
const isRealPid = (value) => Number.isInteger(value) && value > 0;

const listenersOn = (port) => {
  if (process.platform === "win32") {
    const output = run("netstat", ["-ano", "-p", "TCP"]);
    if (output === null) return null;
    return output
      .split(/\r?\n/)
      .filter((line) => /LISTENING/i.test(line) && new RegExp(`[:.]${port}\\s`).test(line))
      .map((line) => Number(line.trim().split(/\s+/).pop()))
      .filter(isRealPid);
  }

  const viaLsof = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (viaLsof !== null)
    return viaLsof.split(/\s+/).filter(Boolean).map(Number).filter(isRealPid);

  const viaSs = run("ss", ["-ltnpH", `sport = :${port}`]);
  if (viaSs !== null)
    return [...viaSs.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])).filter(isRealPid);

  return null; // No supported tool available.
};

const commandLineOf = (pid) => {
  if (process.platform === "linux") {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
    } catch {
      return "";
    }
  }
  if (process.platform === "win32") {
    return (
      run("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
      ]) ?? ""
    ).trim();
  }
  return (run("ps", ["-o", "command=", "-p", String(pid)]) ?? "").trim();
};

// Only ever stop processes that belong to this checkout. Anything else holding
// a RoadStar port is someone else's application and must not be killed.
const isRoadStarProcess = (commandLine) =>
  commandLine.includes(repoRoot) ||
  /services[\\/]telematics-simulator/.test(commandLine) ||
  /LoaderServer/.test(commandLine);

let undetectable = false;

for (const port of PORTS) {
  const pids = listenersOn(port);
  if (pids === null) {
    undetectable = true;
    continue;
  }

  for (const pid of [...new Set(pids)]) {
    if (pid === process.pid) continue;
    const commandLine = commandLineOf(pid);

    if (!isRoadStarProcess(commandLine)) {
      console.error(
        `Port ${port} is used by another application (PID ${pid}). Close it before launching RoadStar.`,
      );
      if (commandLine) console.error(`  ${commandLine}`);
      process.exit(1);
    }

    console.log(`Stopping stale RoadStar process on port ${port} (PID ${pid})...`);
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH")
        console.warn(`  Could not stop PID ${pid}: ${error.message}`);
    }
  }
}

if (undetectable)
  console.warn(
    "Could not inspect listening ports on this system; continuing without freeing them.",
  );
