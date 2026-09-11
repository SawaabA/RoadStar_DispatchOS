import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findJdk, jdkMissingMessage, MIN_RELEASE } from "./jdk.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const deps = join(root, ".deps");
const out = join(root, "out");

const LIBRARIES = {
  "xflp-0.7.7-RELEASE.jar":
    "https://repo1.maven.org/maven2/com/github/hschneid/xflp/0.7.7-RELEASE/xflp-0.7.7-RELEASE.jar",
  "guava-33.7.1-jre.jar":
    "https://repo1.maven.org/maven2/com/google/guava/guava/33.7.1-jre/guava-33.7.1-jre.jar",
  "gson-2.13.2.jar":
    "https://repo1.maven.org/maven2/com/google/code/gson/gson/2.13.2/gson-2.13.2.jar",
};

const javaSources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return javaSources(full);
    return entry.name.endsWith(".java") ? [full] : [];
  });

async function fetchLibrary(name, url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok)
    throw new Error(`Download failed for ${name}: ${response.status} ${response.statusText}`);
  // Write to a partial file first so an interrupted download can never leave a
  // truncated jar that looks cached on the next run.
  const partial = `${destination}.part`;
  writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  renameSync(partial, destination);
}

export async function build() {
  const jdk = findJdk();
  if (!jdk) throw new Error(jdkMissingMessage());

  mkdirSync(deps, { recursive: true });
  mkdirSync(out, { recursive: true });

  for (const [name, url] of Object.entries(LIBRARIES)) {
    const destination = join(deps, name);
    if (existsSync(destination)) continue;
    console.log(`[SOLVER] downloading ${name}`);
    await fetchLibrary(name, url, destination);
  }

  const classpath = Object.keys(LIBRARIES)
    .map((name) => join(deps, name))
    .join(process.platform === "win32" ? ";" : ":");

  const sources = javaSources(join(root, "src"));
  const result = spawnSync(
    jdk.javac,
    ["--release", String(MIN_RELEASE), "-cp", classpath, "-d", out, ...sources],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`javac exited with code ${result.status}`);

  console.log(`[SOLVER] compiled with JDK ${jdk.major} targeting Java ${MIN_RELEASE}`);
  return { jdk, classpath: `${out}${process.platform === "win32" ? ";" : ":"}${classpath}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  build().catch((error) => {
    console.error(`[SOLVER] ${error.message}`);
    process.exit(1);
  });
}
