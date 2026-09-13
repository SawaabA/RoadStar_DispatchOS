import { createHash } from "node:crypto";

// Shared plumbing for every /api/ai route: the SPUR Compute client, caller
// verification, and the limits that stop a public deployment from turning the
// API key into an open relay.

const spurBaseUrl = (process.env.SPUR_BASE_URL || "https://ai.spuric.com/v1").replace(/\/$/, "");
const spurKey = process.env.SPUR_API_KEY || "";
const defaultTimeoutMs = Number(process.env.SPUR_TIMEOUT_MS) || 8_000;
const rateLimitPerMinute = Number(process.env.AI_RATE_LIMIT_PER_MINUTE) || 20;
// Both values are browser-safe. The gateway uses them only to ask Supabase who
// a caller is, presenting the caller's own token.
const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export const MODELS = Object.freeze({
  extract: process.env.SPUR_MODEL_EXTRACT || "spur-glm-5-2",
  vision: process.env.SPUR_MODEL_VISION || "spur-vision",
  copilot: process.env.SPUR_MODEL_COPILOT || "hari-verified",
  copilotFallback: process.env.SPUR_MODEL_COPILOT_FALLBACK || "spur-glm-5-2",
});

// Models SPUR serves from its own infrastructure. Several catalogue entries are
// resold through OpenRouter and would send dispatch data and driver documents
// out of the country, so any model not listed here is refused even when an
// environment variable names it.
export const SOVEREIGN_MODELS = new Set([
  "spur-glm-5-2",
  "spur-glm-air",
  "hari-verified",
  "spur-vision",
  "spur-chat-large",
  "spur-mistral-small",
  "spur-deepseek-v4-flash",
]);

const counters = { aiCalls: 0, aiFailures: 0 };
let lastCall = null;

export class AiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function log(level, event, context = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: "integration-gateway", event, ...context }));
}

export async function spurChat({ model, messages, json = false, maxTokens = 1_200, timeoutMs = defaultTimeoutMs, requestId }) {
  if (!spurKey) throw new AiError(503, "not_configured", "RoadStar AI is not configured.");
  if (!SOVEREIGN_MODELS.has(model)) throw new AiError(503, "model_not_allowed", `Model ${model} is not on the sovereign allowlist.`);

  const body = { model, messages, temperature: 0, max_tokens: maxTokens };
  if (json) body.response_format = { type: "json_object" };
  // GLM models reason before answering by default. That reasoning is discarded
  // here, costs roughly ten times the latency, and can exhaust max_tokens so
  // the visible answer comes back empty.
  if (model.startsWith("spur-glm")) body.chat_template_kwargs = { enable_thinking: false };

  counters.aiCalls += 1;
  const startedAt = Date.now();
  let outcome = "error";
  let usage = null;
  try {
    const response = await fetch(`${spurBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${spurKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    usage = payload?.usage ?? null;
    if (!response.ok) {
      outcome = `http_${response.status}`;
      throw new AiError(502, "provider_error", `SPUR returned ${response.status}.`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      outcome = "empty";
      throw new AiError(502, "provider_error", "SPUR returned no answer.");
    }
    outcome = "ok";
    return { content, model: payload.model || model, usage, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof AiError) throw error;
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    outcome = timedOut ? "timeout" : "network_error";
    throw new AiError(timedOut ? 504 : 502, timedOut ? "timeout" : "provider_error", timedOut ? "RoadStar AI timed out." : "RoadStar AI is unreachable.");
  } finally {
    const latencyMs = Date.now() - startedAt;
    if (outcome !== "ok") counters.aiFailures += 1;
    lastCall = { model, outcome, latencyMs, at: new Date().toISOString() };
    // Only what is needed to diagnose latency and failures: never prompts,
    // document contents, or the key.
    log(outcome === "ok" ? "info" : "warn", "ai_call", {
      requestId,
      model,
      outcome,
      latencyMs,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
    });
  }
}

const sessions = new Map();

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

export async function authenticate(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AiError(401, "unauthenticated", "Sign in to use RoadStar AI.");
  if (!supabaseUrl || !supabaseKey) throw new AiError(503, "auth_not_configured", "RoadStar AI authentication is not configured.");

  const cacheKey = createHash("sha256").update(token).digest("hex");
  const cached = sessions.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  const headers = { apikey: supabaseKey, Authorization: `Bearer ${token}` };
  let user;
  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(5_000) });
    // Supabase answers a malformed or expired token with 401 or 403.
    if (!userResponse.ok) throw new AiError(401, "unauthenticated", "Your session has expired. Sign in again.");
    user = await userResponse.json();
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(503, "auth_unavailable", "Could not verify your session. Try again.");
  }
  if (!user?.id) throw new AiError(401, "unauthenticated", "Your session has expired. Sign in again.");

  // Membership is read with the caller's own token so row-level security
  // decides what they can see, exactly as it does in the browser.
  const membershipUrl = new URL(`${supabaseUrl}/rest/v1/organization_members`);
  membershipUrl.searchParams.set("select", "organization_id,role");
  membershipUrl.searchParams.set("user_id", `eq.${user.id}`);
  membershipUrl.searchParams.set("limit", "1");
  let membership;
  try {
    const membershipResponse = await fetch(membershipUrl, { headers, signal: AbortSignal.timeout(5_000) });
    if (!membershipResponse.ok) throw new AiError(503, "auth_unavailable", "Could not verify your session. Try again.");
    const rows = await membershipResponse.json();
    membership = Array.isArray(rows) ? rows[0] : undefined;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(503, "auth_unavailable", "Could not verify your session. Try again.");
  }
  if (!membership) throw new AiError(403, "no_membership", "Your account is not a member of a RoadStar organization.");

  const identity = { userId: user.id, token, organizationId: Number(membership.organization_id), role: membership.role };
  const now = Date.now();
  const expiry = tokenExpiry(token);
  // Successful checks are reused briefly so every AI request does not cost two
  // Supabase round trips. Failures are never cached.
  if (!expiry || expiry > now) {
    if (sessions.size > 500) sessions.clear();
    sessions.set(cacheKey, { identity, expiresAt: Math.min(now + 60_000, expiry || now + 60_000) });
  }
  return identity;
}

export function requireRole(identity, roles) {
  if (!roles.includes(identity.role)) {
    throw new AiError(403, "forbidden", "Your role does not have access to this AI feature.");
  }
}

const windows = new Map();

export function checkRateLimit(userId, now = Date.now()) {
  const slot = windows.get(userId);
  if (!slot || now - slot.startedAt >= 60_000) {
    if (windows.size > 1_000) windows.clear();
    windows.set(userId, { startedAt: now, count: 1 });
    return;
  }
  slot.count += 1;
  if (slot.count > rateLimitPerMinute) {
    throw new AiError(429, "rate_limited", "Too many AI requests. Wait a moment and try again.", {
      retryAfterSeconds: Math.max(1, Math.ceil((slot.startedAt + 60_000 - now) / 1000)),
    });
  }
}

export async function readJson(request, limitBytes = 1_048_576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new AiError(413, "payload_too_large", "Request body is too large.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new AiError(400, "invalid_json", "Request body must be a JSON object.");
  }
}

// Reports configuration and the most recent call's outcome without making a
// live model call, so health probes stay free and fast.
export function aiReadiness() {
  const misconfigured = Object.entries(MODELS)
    .filter(([, model]) => !SOVEREIGN_MODELS.has(model))
    .map(([purpose, model]) => ({ purpose, model }));
  const authConfigured = Boolean(supabaseUrl && supabaseKey);
  let status;
  if (!spurKey) status = "not_configured";
  else if (!authConfigured || misconfigured.length) status = "degraded";
  else if (!lastCall) status = "configured";
  else status = lastCall.outcome === "ok" ? "connected" : "degraded";
  return { id: "ai", provider: "SPUR Compute", status, keyConfigured: Boolean(spurKey), authConfigured, models: MODELS, misconfigured, lastCall };
}

export const aiMetrics = () => ({ ...counters });
