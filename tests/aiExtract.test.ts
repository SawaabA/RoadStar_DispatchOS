import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";

type Recorded = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };
const servers: Server[] = [];
const children: ChildProcess[] = [];
const PUBLISHABLE = "sb_publishable_test";
const DOC_ID = "6f1d2c1e-8f7a-4a52-9f65-0b8f3a2c9d41";

async function fakeServer(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) {
  const requests: Recorded[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    handler(request, response, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake server did not bind");
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

const reply = (response: ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
};

function token() {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ exp: Math.floor(Date.now() / 1000) + 3600, jti: randomUUID() })}.signature`;
}

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

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) if (!child.killed) child.kill("SIGTERM");
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
});

async function loadExtract() {
  vi.resetModules();
  return import("../services/integration-gateway/extract.mjs");
}

const RATE_CON = `RATE CONFIRMATION
Broker: Maple Freight Brokerage
Load #: MF-88213
Pick up: Milton, ON  09/14/2026  08:00-10:00
Deliver: London, ON  09/14/2026  by 15:00
Equipment: 53' Dry Van
Weight: 31,200 lbs   Pallets: 18
Total Rate: $1,850.00 CAD`;

describe("extraction normalization", () => {
  test("keeps values whose source text is in the document", async () => {
    const extract = await loadExtract();
    const result = extract.normalizeExtraction("rate_confirmation", {
      fields: { customer: "Maple Freight Brokerage", reference_number: "MF-88213", weight_lbs: "31,200", pallets: 18, rate_amount: 1850 },
      source_text: { customer: "Maple Freight Brokerage", reference_number: "Load #: MF-88213", weight_lbs: "Weight: 31,200 lbs", pallets: "Pallets: 18", rate_amount: "Total Rate: $1,850.00 CAD" },
      confidence: { customer: 0.95, reference_number: 0.9, weight_lbs: 0.9, pallets: 0.9, rate_amount: 2 },
    }, RATE_CON, "text_layer");

    expect(result.fields).toMatchObject({ customer: "Maple Freight Brokerage", reference_number: "MF-88213", weight_lbs: 31200, pallets: 18, rate_amount: 1850 });
    expect(result.confidence.rate_amount).toBe(1);
    expect(result.manualReview).toBe(false);
  });

  test("blanks a value whose quoted source is not in the document", async () => {
    const extract = await loadExtract();
    const result = extract.normalizeExtraction("rate_confirmation", {
      fields: { customer: "Acme Logistics" },
      source_text: { customer: "Broker: Acme Logistics" },
      confidence: { customer: 0.9 },
    }, RATE_CON, "text_layer");
    expect(result.fields.customer).toBeNull();
    expect(result.warnings.join(" ")).toContain("customer: no matching text");
  });

  test("blanks a number that does not appear in its own source text", async () => {
    const extract = await loadExtract();
    const result = extract.normalizeExtraction("rate_confirmation", {
      fields: { rate_amount: 2100 },
      source_text: { rate_amount: "Total Rate: $1,850.00 CAD" },
      confidence: { rate_amount: 0.8 },
    }, RATE_CON, "text_layer");
    expect(result.fields.rate_amount).toBeNull();
  });

  test("requires quoted source text on the text path", async () => {
    const extract = await loadExtract();
    const result = extract.normalizeExtraction("rate_confirmation", { fields: { origin: "Milton, ON" }, source_text: {}, confidence: {} }, RATE_CON, "text_layer");
    expect(result.fields.origin).toBeNull();
  });

  test("rejects values of the wrong type or outside an enumeration", async () => {
    const extract = await loadExtract();
    const result = extract.normalizeExtraction("pod", {
      fields: { document_type: "invoice", signature_evidence: "maybe", pallets_received: "eighteen", reference_numbers: ["RS-4521", 42] },
      source_text: {}, confidence: {},
    }, null, "vision");
    expect(result.fields).toMatchObject({ document_type: null, signature_present: null, pallets_received: null, reference_numbers: ["RS-4521"] });
  });

  test("decides whether a POD is signed from what the signature area shows", async () => {
    const extract = await loadExtract();
    const signed = (evidence: string) => extract.normalizeExtraction("pod", { fields: { document_type: "pod", signature_evidence: evidence }, source_text: {}, confidence: { document_type: 0.9, signature_evidence: 0.9 } }, null, "vision").fields.signature_present;
    expect(signed("handwritten_mark")).toBe(true);
    expect(signed("blank_line")).toBe(false);
    expect(signed("typed_or_printed_name_only")).toBe(false);
    expect(signed("no_signature_area")).toBeNull();
    expect(signed("probably")).toBeNull();
  });

  test("flags a low-confidence scan for manual review", async () => {
    const extract = await loadExtract();
    const result = extract.normalizeExtraction("pod", { fields: { consignee: "Northern Foods" }, source_text: { consignee: "Northern Foods" }, confidence: { consignee: 0.2 } }, null, "vision");
    expect(result.manualReview).toBe(true);
    expect(result.warnings[0]).toBe("Scanned document — manual review required");
  });
});

async function startStack(options: { role?: string; spur?: "ok" | "unsigned" | "damage" | "error"; storageType?: string } = {}) {
  const role = options.role ?? "driver";
  const supabase = await fakeServer((request, response) => {
    if (request.url === "/auth/v1/user") return reply(response, 200, { id: `user-${role}` });
    if (request.url?.startsWith("/rest/v1/organization_members")) return reply(response, 200, [{ organization_id: 1, role }]);
    if (request.url?.startsWith("/storage/v1/object/authenticated/load-documents/")) {
      response.writeHead(200, { "Content-Type": options.storageType ?? "image/jpeg" });
      return response.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    }
    if (request.url === "/rest/v1/rpc/record_load_document_extraction") return reply(response, 200, { id: DOC_ID });
    reply(response, 404, {});
  });
  const spur = await fakeServer((_, response, body) => {
    const { model } = JSON.parse(body);
    if (options.spur === "error") return reply(response, 503, { detail: "down" });
    const pod = {
      fields: { document_type: options.spur === "damage" ? "damage_photo" : "pod", consignee: "Northern Foods DC", reference_numbers: ["RS-4521"], signature_evidence: options.spur === "ok" ? "handwritten_mark" : "blank_line", signature_name: options.spur === "unsigned" ? null : "J. Patel", delivered_at: "2026-09-13 14:05", pallets_received: 18, condition_notes: null },
      source_text: { consignee: "Northern Foods DC", signature_name: "J. Patel" },
      confidence: { document_type: 0.9, consignee: 0.9, reference_numbers: 0.9, signature_present: 0.85, signature_name: 0.8, delivered_at: 0.9, pallets_received: 0.8 },
    };
    const rate = { fields: { customer: "Maple Freight Brokerage", weight_lbs: 31200 }, source_text: { customer: "Maple Freight Brokerage", weight_lbs: "Weight: 31,200 lbs" }, confidence: { customer: 0.9, weight_lbs: 0.9 } };
    reply(response, 200, { model, choices: [{ message: { content: "```json\n" + JSON.stringify(model === "spur-vision" ? pod : rate) + "\n```" } }] });
  });
  const port = await unusedPort();
  const child = spawn(process.execPath, ["services/integration-gateway/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: "test", INTEGRATION_HOST: "127.0.0.1", INTEGRATION_PORT: String(port),
      SPUR_API_KEY: "sk-spur-test", SPUR_BASE_URL: spur.url, SPUR_EXTRACT_TIMEOUT_MS: "3000",
      SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    },
    stdio: "ignore",
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/healthz`);
  const callerToken = token();
  const call = (body: unknown) => fetch(`${base}/api/ai/extract`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${callerToken}` }, body: JSON.stringify(body) });
  return { call, supabase, spur, callerToken };
}

describe("extraction route", () => {
  test("a driver reads a POD from storage with their own session and records the result", async () => {
    const { call, supabase, spur, callerToken } = await startStack({ spur: "unsigned" });
    const response = await call({ schema: "pod", storagePath: "1/L-4521/pod-a.jpg", documentId: DOC_ID });
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ extractionPath: "vision", modelUsed: "spur-vision", fallback: false, stored: true });
    expect(result.fields).toMatchObject({ document_type: "pod", signature_present: false, consignee: "Northern Foods DC" });

    const download = supabase.requests.find((item) => item.url?.startsWith("/storage/v1/object/authenticated/"))!;
    expect(download.headers.authorization).toBe(`Bearer ${callerToken}`);
    const sent = JSON.parse(spur.requests[0]!.body);
    expect(sent.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);

    const stored = JSON.parse(supabase.requests.find((item) => item.url === "/rest/v1/rpc/record_load_document_extraction")!.body);
    expect(stored).toMatchObject({ p_document_id: DOC_ID, p_status: "complete", p_document_type: "pod", p_signature_missing: true });
  }, 15_000);

  test("a signed POD is not flagged as missing a signature", async () => {
    const { call, supabase } = await startStack({ spur: "ok" });
    await call({ schema: "pod", storagePath: "1/L-4521/pod-a.jpg", documentId: DOC_ID });
    const stored = JSON.parse(supabase.requests.find((item) => item.url === "/rest/v1/rpc/record_load_document_extraction")!.body);
    expect(stored.p_signature_missing).toBe(false);
  }, 15_000);

  test("a photo that is not a proof of delivery is never flagged as missing a signature", async () => {
    const { call, supabase } = await startStack({ spur: "damage" });
    await call({ schema: "pod", storagePath: "1/L-4521/damage-1.jpg", documentId: DOC_ID });
    const stored = JSON.parse(supabase.requests.find((item) => item.url === "/rest/v1/rpc/record_load_document_extraction")!.body);
    expect(stored).toMatchObject({ p_document_type: "damage_photo", p_signature_missing: false });
  }, 15_000);

  test("drivers cannot extract rate confirmations, which carry pricing", async () => {
    const { call, spur } = await startStack({ role: "driver" });
    const response = await call({ schema: "rate_confirmation", text: RATE_CON });
    expect(response.status).toBe(403);
    expect(spur.requests).toHaveLength(0);
  }, 15_000);

  test("refuses a storage path in another organization without downloading it", async () => {
    const { call, supabase } = await startStack({ role: "dispatcher" });
    const response = await call({ schema: "pod", storagePath: "2/L-4521/pod-a.jpg" });
    expect(response.status).toBe(403);
    expect(supabase.requests.some((item) => item.url?.startsWith("/storage/"))).toBe(false);
  }, 15_000);

  test("asks the browser to render a stored PDF rather than sending it to the model", async () => {
    const { call, spur } = await startStack({ role: "dispatcher", storageType: "application/pdf" });
    const response = await call({ schema: "bol", storagePath: "1/intake/bol-1.pdf" });
    expect(response.status).toBe(415);
    expect((await response.json()).code).toBe("render_pdf_in_browser");
    expect(spur.requests).toHaveLength(0);
  }, 15_000);

  test("reads a text layer with the extraction model and strips a fenced reply", async () => {
    const { call, spur } = await startStack({ role: "dispatcher" });
    const result = await (await call({ schema: "rate_confirmation", text: RATE_CON })).json();
    expect(result).toMatchObject({ extractionPath: "text_layer", modelUsed: "spur-glm-5-2", fallback: false });
    expect(result.fields).toMatchObject({ customer: "Maple Freight Brokerage", weight_lbs: 31200 });
    expect(typeof JSON.parse(spur.requests[0]!.body).messages[1].content).toBe("string");
  }, 15_000);

  test("opens a blank form instead of failing when the model is unavailable", async () => {
    const { call, supabase } = await startStack({ spur: "error" });
    const response = await call({ schema: "pod", storagePath: "1/L-4521/pod-a.jpg", documentId: DOC_ID });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ fallback: true, manualReview: true, stored: true });
    expect(Object.values(result.fields).every((value) => value === null || (Array.isArray(value) && value.length === 0))).toBe(true);
    const stored = JSON.parse(supabase.requests.find((item) => item.url === "/rest/v1/rpc/record_load_document_extraction")!.body);
    expect(stored.p_status).toBe("failed");
  }, 15_000);

  test("serves a repeated document from cache", async () => {
    const { call, spur } = await startStack({ role: "dispatcher" });
    await call({ schema: "rate_confirmation", text: RATE_CON });
    const calls = spur.requests.length;
    const second = await (await call({ schema: "rate_confirmation", text: RATE_CON })).json();
    expect(second.cached).toBe(true);
    expect(spur.requests).toHaveLength(calls);
  }, 15_000);

  test("requires exactly one input", async () => {
    const { call } = await startStack({ role: "dispatcher" });
    expect((await call({ schema: "rate_confirmation", text: RATE_CON, storagePath: "1/intake/a.jpg" })).status).toBe(400);
    expect((await call({ schema: "rate_confirmation" })).status).toBe(400);
  }, 15_000);
});
