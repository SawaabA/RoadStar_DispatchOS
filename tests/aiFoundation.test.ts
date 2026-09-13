import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";

type Recorded = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };

const servers: Server[] = [];
const children: ChildProcess[] = [];
const ENV_KEYS = [
  "SPUR_API_KEY", "SPUR_BASE_URL", "SPUR_TIMEOUT_MS", "SPUR_MODEL_EXTRACT", "SPUR_MODEL_VISION",
  "SPUR_MODEL_COPILOT", "SPUR_MODEL_COPILOT_FALLBACK", "AI_RATE_LIMIT_PER_MINUTE",
  "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY",
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const KEY = "sk-spur-test-key-do-not-log";
const PUBLISHABLE = "sb_publishable_test";

async function fakeServer(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const requests: Recorded[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake server did not bind a port");
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, requests };
}

function reply(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

const completion = (content: string) => ({ model: "spur-glm-5-2", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } });

function token(expiresInSeconds = 3600) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })}.signature`;
}

function fakeSupabase(options: { authStatus?: number; members?: unknown[] } = {}) {
  return fakeServer((request, response) => {
    if (request.url === "/auth/v1/user") {
      if ((options.authStatus ?? 200) !== 200) return reply(response, options.authStatus!, { error_code: "bad_jwt" });
      return reply(response, 200, { id: "user-1", email: "dispatcher@roadstar.test" });
    }
    if (request.url?.startsWith("/rest/v1/organization_members")) return reply(response, 200, options.members ?? [{ organization_id: 7, role: "dispatcher" }]);
    reply(response, 404, {});
  });
}

async function loadAi(env: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  vi.resetModules();
  return import("../services/integration-gateway/ai.mjs");
}

const requestWith = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}

async function waitFor(url: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error(`${url} did not start`);
}

function startService(script: string, env: Record<string, string>) {
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", ...env }, stdio: "ignore" });
  children.push(child);
  return child;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const child of children.splice(0)) if (!child.killed) child.kill("SIGTERM");
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("SPUR client", () => {
  test("refuses to call without a key", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion("hi")));
    const ai = await loadAi({ SPUR_BASE_URL: spur.url });
    await expect(ai.spurChat({ model: "spur-glm-5-2", messages: [] })).rejects.toMatchObject({ code: "not_configured" });
    expect(spur.requests).toHaveLength(0);
  });

  test("refuses a model outside the sovereign allowlist without contacting SPUR", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion("hi")));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    await expect(ai.spurChat({ model: "spur-claude-opus-4-8", messages: [] })).rejects.toMatchObject({ code: "model_not_allowed" });
    expect(spur.requests).toHaveLength(0);
  });

  test("disables GLM reasoning, requests JSON, and authenticates with the key", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion('{"ok":true}')));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    const result = await ai.spurChat({ model: "spur-glm-5-2", json: true, messages: [{ role: "user", content: "hi" }] });

    const sent = JSON.parse(spur.requests[0]!.body);
    expect(spur.requests[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(sent).toMatchObject({ model: "spur-glm-5-2", temperature: 0, response_format: { type: "json_object" }, chat_template_kwargs: { enable_thinking: false } });
    expect(result).toMatchObject({ content: '{"ok":true}', usage: { prompt_tokens: 12 } });
  });

  test("sends GLM-only parameters only to GLM models", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion("ok")));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    await ai.spurChat({ model: "spur-vision", messages: [{ role: "user", content: "hi" }] });
    expect(JSON.parse(spur.requests[0]!.body).chat_template_kwargs).toBeUndefined();
  });

  test("treats an answer with no visible content as a provider failure", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, { choices: [{ message: { content: "", reasoning: "thinking..." } }] }));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    await expect(ai.spurChat({ model: "spur-glm-5-2", messages: [] })).rejects.toMatchObject({ code: "provider_error" });
  });

  test("maps an upstream error to a provider failure", async () => {
    const spur = await fakeServer((_, response) => reply(response, 503, { detail: "upstream down" }));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    await expect(ai.spurChat({ model: "spur-glm-5-2", messages: [] })).rejects.toMatchObject({ status: 502, code: "provider_error" });
  });

  test("times out instead of hanging on a stalled provider", async () => {
    const spur = await fakeServer(() => { /* never responds */ });
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    const startedAt = Date.now();
    await expect(ai.spurChat({ model: "spur-glm-5-2", messages: [], timeoutMs: 150 })).rejects.toMatchObject({ status: 504, code: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test("never writes the key or the prompt to the logs", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion("answer")));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url });
    const logged: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args) => { logged.push(args.join(" ")); });
    await ai.spurChat({ model: "spur-glm-5-2", messages: [{ role: "user", content: "SECRET LOAD RS-4521 DETAILS" }] });

    const output = logged.join("\n");
    expect(output).toContain('"event":"ai_call"');
    expect(output).not.toContain(KEY);
    expect(output).not.toContain("SECRET LOAD");
  });
});

describe("caller authentication", () => {
  test("rejects a request with no bearer token", async () => {
    const supabase = await fakeSupabase();
    const ai = await loadAi({ SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    await expect(ai.authenticate(requestWith({}))).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
  });

  test("rejects a token Supabase does not accept", async () => {
    const supabase = await fakeSupabase({ authStatus: 403 });
    const ai = await loadAi({ SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    await expect(ai.authenticate(requestWith({ authorization: `Bearer ${token()}` }))).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
  });

  test("resolves organization and role using the caller's own token", async () => {
    const supabase = await fakeSupabase();
    const ai = await loadAi({ SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    const callerToken = token();
    const identity = await ai.authenticate(requestWith({ authorization: `Bearer ${callerToken}` }));

    expect(identity).toMatchObject({ userId: "user-1", organizationId: 7, role: "dispatcher" });
    const membership = supabase.requests.find((item) => item.url?.startsWith("/rest/v1/organization_members"))!;
    expect(membership.headers.authorization).toBe(`Bearer ${callerToken}`);
    expect(membership.headers.apikey).toBe(PUBLISHABLE);
    expect(membership.url).toContain("user_id=eq.user-1");
  });

  test("refuses a signed-in user who belongs to no organization", async () => {
    const supabase = await fakeSupabase({ members: [] });
    const ai = await loadAi({ SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    await expect(ai.authenticate(requestWith({ authorization: `Bearer ${token()}` }))).rejects.toMatchObject({ status: 403, code: "no_membership" });
  });

  test("reuses a verified session rather than asking Supabase on every request", async () => {
    const supabase = await fakeSupabase();
    const ai = await loadAi({ SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    const request = requestWith({ authorization: `Bearer ${token()}` });
    await ai.authenticate(request);
    await ai.authenticate(request);
    expect(supabase.requests.filter((item) => item.url === "/auth/v1/user")).toHaveLength(1);
  });

  test("fails closed when authentication is not configured", async () => {
    const ai = await loadAi({});
    await expect(ai.authenticate(requestWith({ authorization: `Bearer ${token()}` }))).rejects.toMatchObject({ status: 503, code: "auth_not_configured" });
  });

  test("accepts the browser-safe Supabase variables used in local development", async () => {
    const supabase = await fakeSupabase();
    const ai = await loadAi({ VITE_SUPABASE_URL: supabase.url, VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    await expect(ai.authenticate(requestWith({ authorization: `Bearer ${token()}` }))).resolves.toMatchObject({ role: "dispatcher" });
  });
});

describe("request guards", () => {
  test("enforces feature roles", async () => {
    const ai = await loadAi({});
    expect(() => ai.requireRole({ role: "viewer" }, ["admin", "dispatcher"])).toThrow(expect.objectContaining({ status: 403, code: "forbidden" }));
    expect(() => ai.requireRole({ role: "dispatcher" }, ["admin", "dispatcher"])).not.toThrow();
  });

  test("rate-limits each caller and resets on the next window", async () => {
    const ai = await loadAi({ AI_RATE_LIMIT_PER_MINUTE: "3" });
    const now = 1_000_000;
    for (let index = 0; index < 3; index += 1) ai.checkRateLimit("user-1", now);
    let rejection: { status?: number; details?: { retryAfterSeconds?: number } } = {};
    try { ai.checkRateLimit("user-1", now + 1_000); } catch (error) { rejection = error as typeof rejection; }
    expect(rejection.status).toBe(429);
    expect(rejection.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(() => ai.checkRateLimit("user-2", now + 1_000)).not.toThrow();
    expect(() => ai.checkRateLimit("user-1", now + 60_000)).not.toThrow();
  });

  test("accepts only a JSON object body within the size limit", async () => {
    const ai = await loadAi({});
    const body = (text: string) => Readable.from([Buffer.from(text)]) as unknown as IncomingMessage;
    await expect(ai.readJson(body('{"question":"x"}'))).resolves.toEqual({ question: "x" });
    await expect(ai.readJson(body("not json"))).rejects.toMatchObject({ status: 400 });
    await expect(ai.readJson(body("[1,2]"))).rejects.toMatchObject({ status: 400 });
    await expect(ai.readJson(body('{"a":"0123456789"}'), 10)).rejects.toMatchObject({ status: 413 });
  });
});

describe("AI readiness", () => {
  test("reports not_configured without a key", async () => {
    const ai = await loadAi({});
    expect(ai.aiReadiness()).toMatchObject({ status: "not_configured", keyConfigured: false });
  });

  test("reports configured before any call, without calling SPUR", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion("x")));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url, SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    expect(ai.aiReadiness()).toMatchObject({ status: "configured", keyConfigured: true, authConfigured: true });
    expect(spur.requests).toHaveLength(0);
  });

  test("is degraded when a model variable names a non-sovereign model", async () => {
    const ai = await loadAi({ SPUR_API_KEY: KEY, SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SPUR_MODEL_COPILOT: "spur-gpt-5-5" });
    expect(ai.aiReadiness()).toMatchObject({ status: "degraded", misconfigured: [{ purpose: "copilot", model: "spur-gpt-5-5" }] });
  });

  test("is degraded when caller authentication is not configured", async () => {
    const ai = await loadAi({ SPUR_API_KEY: KEY });
    expect(ai.aiReadiness()).toMatchObject({ status: "degraded", authConfigured: false });
  });

  test("follows the outcome of the most recent call", async () => {
    let fail = false;
    const spur = await fakeServer((_, response) => fail ? reply(response, 500, {}) : reply(response, 200, completion("ok")));
    const ai = await loadAi({ SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url, SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await ai.spurChat({ model: "spur-glm-5-2", messages: [] });
    expect(ai.aiReadiness().status).toBe("connected");
    fail = true;
    await ai.spurChat({ model: "spur-glm-5-2", messages: [] }).catch(() => {});
    expect(ai.aiReadiness().status).toBe("degraded");
  });
});

describe("integration gateway AI surface", () => {
  test("serves readiness without a live model call and keeps other routes unchanged", async () => {
    const spur = await fakeServer((_, response) => reply(response, 200, completion("x")));
    const port = await unusedPort();
    startService("services/integration-gateway/server.mjs", {
      INTEGRATION_HOST: "127.0.0.1", INTEGRATION_PORT: String(port),
      SPUR_API_KEY: KEY, SPUR_BASE_URL: spur.url,
      SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    });
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/healthz`);

    const health = await fetch(`${base}/api/ai/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ id: "ai", status: "configured" });

    const integrations = await fetch(`${base}/api/integrations/health`);
    const text = await integrations.text();
    expect(JSON.parse(text).providers).toContainEqual({ id: "ai", provider: "SPUR Compute", status: "configured" });
    expect(text).not.toContain(KEY);

    expect((await fetch(`${base}/api/ai/does-not-exist`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/api/traffic/incidents`, { method: "PUT" })).status).toBe(405);
    const preflight = await fetch(`${base}/api/ai/does-not-exist`, { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(spur.requests).toHaveLength(0);
  }, 15_000);
});

describe("web gateway proxy", () => {
  test("forwards the caller's session to AI routes and to no other upstream", async () => {
    const echo = () => fakeServer((request, response) => reply(response, 200, { path: request.url, authorization: request.headers.authorization ?? null }));
    const integrations = await echo();
    const solver = await echo();
    const telemetry = await echo();
    const port = await unusedPort();
    startService("services/web-server/server.mjs", {
      HOST: "127.0.0.1", PORT: String(port),
      INTEGRATION_URL: integrations.url, SOLVER_URL: solver.url, SIMULATOR_URL: telemetry.url,
    });
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/healthz`);
    const auth = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };

    const ai = await (await fetch(`${base}/api/ai/copilot`, { method: "POST", headers: auth, body: "{}" })).json();
    expect(ai).toMatchObject({ path: "/api/ai/copilot" });
    expect(ai.authorization).toBe(auth.Authorization);

    await fetch(`${base}/api/plan`, { method: "POST", headers: auth, body: "{}" });
    await fetch(`${base}/api/traffic/incidents`, { headers: auth });
    expect(solver.requests.at(-1)?.headers.authorization).toBeUndefined();
    expect(integrations.requests.find((item) => item.url === "/api/traffic/incidents")?.headers.authorization).toBeUndefined();
  }, 15_000);
});
