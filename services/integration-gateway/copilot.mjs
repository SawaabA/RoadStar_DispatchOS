import { createHash } from "node:crypto";
import { AiError, MODELS, spurChat } from "./ai.mjs";

// The copilot phrases facts RoadStar has already computed. It never derives
// hours, distances, times or charges: the browser sends the deterministic
// results for one fixed question, and every answer is checked against them
// before it is shown to a dispatcher.

export const COPILOT_QUESTIONS = Object.freeze({
  at_risk: "What loads are at risk right now?",
  unassigned: "Why are loads still unassigned?",
  hos: "Which drivers are closest to their hours-of-service limits?",
  detention: "What is our detention exposure right now?",
  plan: "Summarize the recommended morning plan.",
});

const SYSTEM_PROMPT = [
  "You are the RoadStar DispatchOS copilot. You explain dispatch facts to a dispatcher in plain language.",
  "Answer only from the JSON in the user message. RoadStar's deterministic systems computed it, and it is the only source of truth.",
  "Never estimate, calculate, convert or round hours of service, distances, times, ETAs, detention minutes or charges. Quote every number exactly as it appears in the data. If a number is not in the data, say it is not available.",
  "Refer to loads by bill number, drivers by name and trucks by number, and cite the id of every load, driver and truck you mention.",
  "If the question assumes something the data contradicts, say so plainly before answering.",
  "If the answer is not in the data, say you do not have that information.",
  "Keep the answer under 120 words, in short sentences, without markdown.",
  'Return only JSON: {"answer": string, "citations": [{"type": "load" | "driver" | "truck", "id": string}]}',
].join("\n");

const cache = new Map();
const cacheMs = 5 * 60_000;
const maxAnswerLength = 1_500;

function directoryList(items, aliasKey) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.id === "string" && item.id.length <= 64)
    .slice(0, 500)
    .map((item) => ({ id: item.id, alias: typeof item[aliasKey] === "string" ? item[aliasKey].slice(0, 120) : undefined }));
}

export function parseCopilotRequest(body) {
  const { questionId } = body;
  if (typeof questionId !== "string" || !Object.hasOwn(COPILOT_QUESTIONS, questionId)) {
    throw new AiError(400, "invalid_question", "Unknown copilot question.");
  }
  if (!body.facts || typeof body.facts !== "object" || Array.isArray(body.facts)) {
    throw new AiError(400, "invalid_context", "Copilot facts are missing.");
  }
  const directory = body.directory && typeof body.directory === "object" ? body.directory : {};
  return {
    questionId,
    facts: body.facts,
    directory: {
      load: directoryList(directory.loads, "billNumber"),
      driver: directoryList(directory.drivers, "name"),
      truck: directoryList(directory.trucks, "number"),
    },
  };
}

// Numbers are compared without thousands separators so "$1,250" in the answer
// matches "1250" or "$1,250" in the facts.
const numbersIn = (text) => new Set((String(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => value.replace(/,/g, "")));

// Small whole numbers are allowed without a source: they are counts ("two
// loads") and ordinals, not the measured quantities the model must never
// invent.
const isMeasuredQuantity = (value) => value.includes(".") || Number(value) > 10;

export function validateCopilotAnswer(parsed, request, modelUsed) {
  const answer = typeof parsed?.answer === "string" ? parsed.answer.trim().slice(0, maxAnswerLength) : "";
  if (!answer) throw new AiError(502, "invalid_output", "The copilot returned no answer.");

  const lookup = {};
  const known = new Set();
  for (const [type, entries] of Object.entries(request.directory)) {
    lookup[type] = new Map();
    for (const entry of entries) {
      for (const key of [entry.id, entry.alias].filter(Boolean)) {
        lookup[type].set(key.toLowerCase(), entry.id);
        known.add(key.toLowerCase());
      }
    }
  }

  const citations = [];
  const invalidCitations = [];
  for (const citation of Array.isArray(parsed.citations) ? parsed.citations : []) {
    const type = citation?.type;
    const id = typeof citation?.id === "string" ? citation.id : "";
    const resolved = lookup[type]?.get(id.toLowerCase());
    if (resolved) {
      if (!citations.some((item) => item.type === type && item.id === resolved)) citations.push({ type, id: resolved });
    } else {
      invalidCitations.push(`${type}:${id}`);
    }
  }

  // Identifier-shaped tokens in the prose (RS-4521, D-113, T-084) must belong to
  // the directory, whether or not the model cited them.
  const references = [...new Set(answer.match(/\b[A-Z]{1,4}-\d{2,}\b/g) ?? [])]
    .filter((token) => !known.has(token.toLowerCase()));

  const factNumbers = numbersIn(JSON.stringify(request.facts));
  // Truck numbers and similar directory aliases are identifiers, not measured
  // quantities. The facts often spell a truck as T-067 while a good answer says
  // "Truck 67", which must not be flagged as an invented figure.
  const directoryNumbers = numbersIn(JSON.stringify(request.directory));
  const answerWithoutIds = answer.replace(/\b[A-Z]{1,4}-\d{2,}\b/g, " ");
  const numbers = [...numbersIn(answerWithoutIds)]
    .filter((value) => isMeasuredQuantity(value) && !factNumbers.has(value) && !directoryNumbers.has(value));

  return {
    answer,
    citations,
    modelUsed,
    grounded: invalidCitations.length === 0 && references.length === 0 && numbers.length === 0,
    fallback: false,
    unverified: { citations: invalidCitations, references, numbers },
  };
}

function parseModelJson(content) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new AiError(502, "invalid_output", "The copilot returned malformed output.");
  }
}

export async function handleCopilot({ identity, body, requestId }) {
  const request = parseCopilotRequest(body);
  const cacheKey = createHash("sha256")
    .update(JSON.stringify([identity.organizationId, request.questionId, request.facts, request.directory]))
    .digest("hex");
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return { ...hit.value, cached: true };

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        question: COPILOT_QUESTIONS[request.questionId],
        data: request.facts,
        directory: request.directory,
      }),
    },
  ];

  let reason = "provider_error";
  for (const model of [...new Set([MODELS.copilot, MODELS.copilotFallback])]) {
    try {
      const result = await spurChat({ model, messages, json: true, maxTokens: 600, requestId });
      const value = validateCopilotAnswer(parseModelJson(result.content), request, result.model);
      if (cache.size > 200) cache.clear();
      cache.set(cacheKey, { value, expiresAt: Date.now() + cacheMs });
      return { ...value, cached: false };
    } catch (error) {
      reason = error instanceof AiError ? error.code : "provider_error";
      // A missing key cannot be fixed by trying another model.
      if (reason === "not_configured") break;
    }
  }

  // Degrading is not an error: the browser renders the same deterministic
  // facts without narration, so no information is lost.
  return { answer: null, citations: [], modelUsed: null, grounded: false, fallback: true, reason, unverified: { citations: [], references: [], numbers: [] }, cached: false };
}
