import { spawn } from "node:child_process";
import { build } from "./build.mjs";
import { findJdk, jdkMissingMessage } from "./jdk.mjs";

// A missing JDK is not a build failure: the web app falls back to the browser
// load planner, so dev:full should keep the other services running.
if (!findJdk()) {
  console.warn(`[SOLVER] ${jdkMissingMessage()}`);
  console.warn("[SOLVER] Skipping. 3D loading will use the browser fallback planner.");
  process.exit(0);
}

const { jdk, classpath } = await build();

const child = spawn(jdk.java, ["-cp", classpath, "com.roadstar.loader.LoaderServer"], {
  stdio: "inherit",
});

const forward = (signal) => () => child.kill(signal);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));

child.on("error", (error) => {
  console.error(`[SOLVER] ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(signal ? 0 : (code ?? 0));
});
