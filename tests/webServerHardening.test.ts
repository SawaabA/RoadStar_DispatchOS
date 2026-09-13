import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) if (!child.killed) child.kill("SIGTERM");
});

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}

async function startWebServer(env: Record<string, string> = {}) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ["services/web-server/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port), ...env },
    stdio: "ignore",
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("web server did not start");
}

describe("web gateway hardening", () => {
  test("sends Strict-Transport-Security on every response", async () => {
    const base = await startWebServer();
    const response = await fetch(`${base}/healthz`);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  }, 15_000);

  test("serves /metrics to the host but not to requests relayed by the public proxy", async () => {
    const base = await startWebServer();
    const direct = await fetch(`${base}/metrics`);
    expect(direct.status).toBe(200);
    expect(await direct.text()).toContain("roadstar_web_requests_total");

    const proxied = await fetch(`${base}/metrics`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
    expect(proxied.status).toBe(404);
    expect(await proxied.text()).not.toContain("roadstar_web");
  }, 15_000);

  test("lets an authorized scraper read /metrics through the proxy with METRICS_TOKEN", async () => {
    const base = await startWebServer({ METRICS_TOKEN: "scrape-secret-123" });
    const headers = { "X-Forwarded-For": "203.0.113.9" };
    expect((await fetch(`${base}/metrics`, { headers: { ...headers, Authorization: "Bearer scrape-secret-123" } })).status).toBe(200);
    expect((await fetch(`${base}/metrics`, { headers: { ...headers, Authorization: "Bearer wrong-secret-123" } })).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { headers: { ...headers, Authorization: "Bearer short" } })).status).toBe(404);
  }, 15_000);
});
