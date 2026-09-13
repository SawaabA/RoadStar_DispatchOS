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
  test("labels local ELD telemetry as demo rather than a live vendor", async () => {
    const unavailablePort = await unusedPort();
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${unavailablePort}`);
    await readyResponse(gatewayPort);

    const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/integrations/health`);
    const payload = await response.json();
    expect(payload.providers).toContainEqual(expect.objectContaining({ id: "eld", status: "demo", provider: "RoadStar telemetry simulator" }));
  });

  test("exposes clearly labelled read-only vendor-neutral TMS samples", async () => {
    const unavailablePort = await unusedPort();
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${unavailablePort}`);
    await readyResponse(gatewayPort);

    const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/tms/loads`);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ source: "roadstar-neutral-demo", mode: "demo" });
    expect(payload.loads).toHaveLength(3);
  });

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

  test("normalizes OSRM road geometry, distance, and duration", async () => {
    const osrm = createServer((request, response) => {
      if (request.url?.startsWith("/nearest/v1/driving/")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "Ok", waypoints: [{ name: "Road" }] }));
      } else if (request.url?.startsWith("/route/v1/driving/")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "Ok", routes: [{ distance: 71500, duration: 3900, geometry: { coordinates: [[-79.38, 43.65], [-79.55, 43.58], [-79.72, 43.43], [-79.87, 43.25]] } }] }));
      } else response.writeHead(404).end();
    });
    const osrmPort = await listen(osrm);
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${osrmPort}`);
    await readyResponse(gatewayPort);
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/routing/route?origin=-79.38,43.65&destination=-79.87,43.25`);
    expect(await response.json()).toMatchObject({ source: "Test OSRM", distanceKm: 71.5, durationMinutes: 65, coordinates: expect.any(Array) });
  });

  test("rejects malformed coordinate input before calling OSRM", async () => {
    const unavailablePort = await unusedPort();
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${unavailablePort}`);
    await readyResponse(gatewayPort);
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/routing/route?origin=nope&destination=-79.87,43.25`);
    expect(response.status).toBe(400);
  });

  test("falls back safely when a routing provider returns unusable metrics", async () => {
    const osrm = createServer((request, response) => {
      if (request.url?.startsWith("/nearest/v1/driving/")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "Ok", waypoints: [{ name: "Road" }] }));
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "Ok", routes: [{ distance: null, duration: -1, geometry: { coordinates: [[-79.38, 43.65]] } }] }));
      }
    });
    const osrmPort = await listen(osrm);
    const gatewayPort = await unusedPort();
    startGateway(gatewayPort, `http://127.0.0.1:${osrmPort}`);
    await readyResponse(gatewayPort);

    const response = await fetch(`http://127.0.0.1:${gatewayPort}/api/routing/route?origin=-79.38,43.65&destination=-79.87,43.25`);
    expect(await response.json()).toMatchObject({ source: "presentation-fallback", fallback: true });
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
