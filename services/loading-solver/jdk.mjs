import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The solver targets Java 17 to match the documented requirement in README.md.
export const MIN_RELEASE = 17;

const EXE = process.platform === "win32" ? ".exe" : "";

const majorOf = (output) => {
  // "javac 25.0.4" and the legacy "javac 1.8.0_392" both appear in the wild.
  const match = /(\d+)(?:\.(\d+))?/.exec(output);
  if (!match) return NaN;
  const first = Number(match[1]);
  return first === 1 ? Number(match[2]) : first;
};

const probe = (home) => {
  const javac = join(home, "bin", `javac${EXE}`);
  const java = join(home, "bin", `java${EXE}`);
  // A JRE-only directory has java but no javac; Fedora ships several.
  if (!existsSync(javac) || !existsSync(java)) return null;
  try {
    const output = execFileSync(javac, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const major = majorOf(output);
    return Number.isFinite(major) && major >= MIN_RELEASE
      ? { home, javac, java, major }
      : null;
  } catch {
    return null;
  }
};

const childrenOf = (parent) => {
  try {
    return readdirSync(parent).map((entry) => join(parent, entry));
  } catch {
    return [];
  }
};

const searchRoots = () => {
  if (process.platform === "darwin")
    return childrenOf("/Library/Java/JavaVirtualMachines").map((home) =>
      join(home, "Contents", "Home"),
    );
  if (process.platform === "win32")
    return [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramW6432,
    ]
      .filter(Boolean)
      .flatMap((base) =>
        ["Java", "Eclipse Adoptium", "Microsoft", "Amazon Corretto"].flatMap(
          (vendor) => childrenOf(join(base, vendor)),
        ),
      );
  return childrenOf("/usr/lib/jvm");
};

// Resolution order: JAVA_HOME, then PATH, then the platform's usual install
// roots. The last step is what lets this work on a machine where a JDK is
// installed but never added to PATH.
export function findJdk() {
  if (process.env.JAVA_HOME) {
    const found = probe(process.env.JAVA_HOME);
    if (found) return found;
  }

  try {
    const output = execFileSync(`javac${EXE}`, ["-version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const major = majorOf(output);
    if (Number.isFinite(major) && major >= MIN_RELEASE)
      return { home: null, javac: `javac${EXE}`, java: `java${EXE}`, major };
  } catch {
    // Not on PATH; fall through to the platform scan.
  }

  const candidates = searchRoots()
    .map(probe)
    .filter(Boolean)
    .sort((a, b) => b.major - a.major);
  return candidates[0] ?? null;
}

export const jdkMissingMessage = () =>
  [
    `No JDK ${MIN_RELEASE}+ was found.`,
    "Searched JAVA_HOME, PATH, and the standard install locations.",
    "Install a JDK (Temurin, Corretto, or your distribution's openjdk)",
    "or set JAVA_HOME to an existing one.",
  ].join(" ");
