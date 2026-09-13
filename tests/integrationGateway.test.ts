import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";

const children: ChildProcess[] = [];
const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return address.port;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  servers.splice(servers.indexOf(server), 1);
  return port;
}

function startGateway(port: number, routingBaseUrl: string) {
  const child = spawn(process.execPath, ["services/integration-gateway/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      INTEGRATION_HOST: "127.0.0.1",
      INTEGRATION_PORT: String(port),
      ROUTING_BASE_URL: routingBaseUrl,
      ROUTING_PROVIDER: "Test OSRM",
      REQUIRE_ROUTING: "true",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

async function readyResponse(port: number) {
  const deadline = Date.now() + 7_000;
  let response;
  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/readyz`);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Integration gateway did not start");
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("integration gateway routing readiness", () => {
  test("reports ready only after OSRM answers a nearest probe", async () => {
    const osrm = createServer((request, response) => {
      if (request.url?.startsWith("/nearest/v1/driving/")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "Ok", waypoints: [{ name: "Queen Street" }] }));
        return;
      }
      response.writeHead(404).end();
    });
    const osrmPort = await listen(osrm);
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${osrmPort}`);

    const response = await readyResponse(gatewayPort);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready", routing: { status: "connected" } });
  });

  test("reports not ready when required OSRM is unreachable", async () => {
    const unavailablePort = await unusedPort();
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${unavailablePort}`);

    const response = await readyResponse(gatewayPort);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready", routing: { status: "degraded" } });
  });
});
