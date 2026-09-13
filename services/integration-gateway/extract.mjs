import { createHash } from "node:crypto";
import { AiError, MODELS, parseModelJson, spurChat, supabaseFetch } from "./ai.mjs";

// Reads a rate confirmation, bill of lading or proof of delivery into
// structured fields. The model extracts; it never decides. Every value on the
// text path must be backed by text that actually appears in the document, and
// nothing here creates or changes a load: the browser opens a review form.

const extractTimeoutMs = Number(process.env.SPUR_EXTRACT_TIMEOUT_MS) || 25_000;
const maxTextLength = 120_000;
const maxImages = 3;
const maxDownloadBytes = 8 * 1024 * 1024;
// SPUR's vision tier estimates input tokens from the base64 text and refuses
// anything over its 32,768-token window, so images must stay under this many
// characters in total. The browser encodes to a smaller budget
// (VISION_PAYLOAD_CHARS in src/features/documents/lib/documents.ts).
const maxVisionPayloadChars = 110_000;
const cache = new Map();
const cacheMs = 30 * 60_000;

const SCHEMAS = {
  rate_confirmation: {
    roles: ["admin", "dispatcher"],
    description: "A carrier rate confirmation or load tender.",
    fields: {
      customer: "string",
      reference_number: "string",
      origin: "string",
      destination: "string",
      pickup_date: "string",
      pickup_window: "string",
      delivery_date: "string",
      delivery_window: "string",
      equipment: "string",
      weight_lbs: "number",
      pallets: "number",
      rate_amount: "number",
      currency: "string",
      temperature_controlled: "boolean",
      commodity: "string",
    },
    guidance: "customer is the company tendering the load, often labelled Broker, Customer, Bill To or Shipper. reference_number is the load, confirmation, order or PO number, often labelled Load #, Conf # or Order #. temperature_controlled is true only when a temperature or reefer setting is stated, otherwise null. origin and destination are the city and province or state as written. equipment is Dry Van, Reefer or Flatbed when stated. rate_amount is the total rate as a plain number. Dates and times are copied exactly as written, never converted.",
  },
  bol: {
    roles: ["admin", "dispatcher"],
    description: "A bill of lading.",
    fields: {
      shipper: "string",
      consignee: "string",
      bol_number: "string",
      pro_number: "string",
      pickup_date: "string",
      pallets: "number",
      weight_lbs: "number",
      commodity: "string",
    },
    guidance: "Dates are copied exactly as written, never converted.",
  },
  pod: {
    roles: ["admin", "dispatcher", "driver"],
    description: "A proof of delivery, receipt or delivery photo returned by a driver.",
    fields: {
      document_type: ["pod", "bol", "lumper_receipt", "damage_photo", "other"],
      consignee: "string",
      reference_numbers: "string[]",
      signature_evidence: ["handwritten_mark", "typed_or_printed_name_only", "blank_line", "no_signature_area"],
      signature_name: "string",
      delivered_at: "string",
      pallets_received: "number",
      condition_notes: "string",
    },
    guidance: "A document titled proof of delivery is pod even when it also lists a BOL number. signature_evidence describes only what is visible in the signature area: handwritten_mark when there are pen strokes or a scribble on or beside the signature line, typed_or_printed_name_only when there is printed text but no handwriting, blank_line when the line is empty apart from its label, and no_signature_area when the document has no place to sign. Describe what you see; do not judge whether the delivery was accepted. delivered_at is the delivery date and time as written; do not treat it as a signature time.",
  },
};

const scalarTypes = new Set(["string", "number", "boolean"]);

function systemPrompt(name) {
  const schema = SCHEMAS[name];
  const shape = Object.entries(schema.fields)
    .map(([field, type]) => `  "${field}": ${Array.isArray(type) ? type.map((value) => `"${value}"`).join(" | ") : type} | null`)
    .join(",\n");
  return [
    `You extract fields from ${schema.description}`,
    "Use null for any field that is not present. Never infer, estimate, calculate or invent a value.",
    "For every field you populate, copy the exact text you took it from into source_text, keyed by the same field name used in fields (not by the document's label).",
    "Give each populated field a confidence between 0 and 1.",
    schema.guidance,
    `Return only JSON: {"fields": {\n${shape}\n}, "source_text": {"<field>": string | null}, "confidence": {"<field>": number}}`,
  ].join("\n");
}

const collapse = (text) => String(text).replace(/\s+/g, " ").trim().toLowerCase();

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[,$\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numberAppears(value, text) {
  const digits = String(text).replace(/[,\s]/g, "");
  return digits.includes(String(value)) || (!Number.isInteger(value) && digits.includes(value.toFixed(2)));
}

function coerce(type, value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(type)) return type.includes(value) ? value : null;
  if (type === "string") return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
  if (type === "number") return toNumber(value);
  if (type === "boolean") return typeof value === "boolean" ? value : null;
  if (type === "string[]") {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 80)).slice(0, 20) : [];
  }
  return null;
}

export function normalizeExtraction(name, parsed, documentText, extractionPath) {
  const schema = SCHEMAS[name];
  const fields = {};
  const confidence = {};
  const sourceSpans = {};
  const warnings = [];
  const document = documentText === null ? null : collapse(documentText);

  for (const [field, type] of Object.entries(schema.fields)) {
    let value = coerce(type, parsed?.fields?.[field]);
    const span = typeof parsed?.source_text?.[field] === "string" ? parsed.source_text[field].trim().slice(0, 300) : null;
    const score = Number(parsed?.confidence?.[field]);

    if (document !== null && value !== null && !(Array.isArray(value) && !value.length)) {
      // On the text path the document is available, so every populated value
      // must be traceable to text that is really in it.
      if (type === "string[]") {
        const kept = value.filter((item) => document.includes(collapse(item)));
        if (kept.length < value.length) warnings.push(`${field}: dropped values not found in the document`);
        value = kept;
      } else if (!span || !document.includes(collapse(span))) {
        warnings.push(`${field}: no matching text in the document, left blank`);
        value = null;
      } else if (type === "number" && !numberAppears(value, span)) {
        warnings.push(`${field}: value does not appear in its source text, left blank`);
        value = null;
      }
    }

    fields[field] = value;
    sourceSpans[field] = value === null || (Array.isArray(value) && !value.length) ? null : span;
    confidence[field] = fields[field] === null || !Number.isFinite(score) ? null : Math.min(1, Math.max(0, score));
  }

  if (name === "pod") {
    // The model reports what the signature area shows; whether that counts as
    // signed is decided here. Asked directly for a boolean, the vision model
    // called a blank signature line signed.
    const evidence = fields.signature_evidence;
    fields.signature_present = evidence === "handwritten_mark" ? true
      : evidence === "blank_line" || evidence === "typed_or_printed_name_only" ? false
        : null;
  }

  const populated = Object.entries(fields).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length));
  const scores = populated.map(([field]) => confidence[field]).filter((value) => value !== null);
  const meanConfidence = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const manualReview = !populated.length || (extractionPath === "vision" && meanConfidence < 0.5);
  if (manualReview) {
    warnings.unshift(extractionPath === "vision" ? "Scanned document — manual review required" : "Nothing could be read from this document — manual review required");
  }
  return { fields, confidence, sourceSpans, warnings, manualReview };
}

function parseRequest(body, identity) {
  const { schema } = body;
  if (typeof schema !== "string" || !Object.hasOwn(SCHEMAS, schema)) throw new AiError(400, "invalid_schema", "Unknown document schema.");
  if (!SCHEMAS[schema].roles.includes(identity.role)) throw new AiError(403, "forbidden", "Your role cannot extract this kind of document.");

  const inputs = ["text", "images", "storagePath"].filter((key) => body[key] !== undefined && body[key] !== null);
  if (inputs.length !== 1) throw new AiError(400, "invalid_input", "Provide exactly one of text, images or storagePath.");

  const documentId = body.documentId;
  if (documentId !== undefined && (typeof documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(documentId))) {
    throw new AiError(400, "invalid_document", "documentId must be a document UUID.");
  }

  if (inputs[0] === "text") {
    if (typeof body.text !== "string" || !body.text.trim()) throw new AiError(400, "invalid_input", "Document text is empty.");
    if (body.text.length > maxTextLength) throw new AiError(413, "payload_too_large", "Document text is too long.");
    return { schema, mode: "text", text: body.text, documentId };
  }
  if (inputs[0] === "images") {
    const images = body.images;
    if (!Array.isArray(images) || !images.length || images.length > maxImages
      || !images.every((image) => typeof image === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))) {
      throw new AiError(400, "invalid_input", `Provide 1 to ${maxImages} JPEG, PNG or WebP images as data URLs.`);
    }
    // Refused here rather than spending a model call that is certain to fail.
    if (images.join("").length > maxVisionPayloadChars) {
      throw new AiError(413, "input_too_large", "The images are too large for the model to read. Re-encode them smaller.");
    }
    return { schema, mode: "images", images, documentId };
  }
  const path = body.storagePath;
  // The organization prefix is checked here; storage policies still decide
  // whether this caller may read the file.
  if (typeof path !== "string" || !path.startsWith(`${identity.organizationId}/`) || !/^[0-9]{1,18}\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}\/[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp|pdf)$/.test(path)) {
    throw new AiError(403, "forbidden", "That document is not in your organization.");
  }
  return { schema, mode: "storage", storagePath: path, documentId };
}

async function downloadImage(identity, storagePath) {
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  let response;
  try {
    response = await supabaseFetch(`/storage/v1/object/authenticated/load-documents/${encoded}`, identity, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(503, "storage_unavailable", "The document could not be downloaded.");
  }
  if (response.status === 400 || response.status === 403 || response.status === 404) {
    throw new AiError(404, "document_not_found", "The document does not exist or you cannot read it.");
  }
  if (!response.ok) throw new AiError(503, "storage_unavailable", "The document could not be downloaded.");
  const type = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (type === "application/pdf") {
    throw new AiError(415, "render_pdf_in_browser", "Render PDF pages to images or extract their text in the browser before extraction.");
  }
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new AiError(415, "unsupported_type", "Only JPEG, PNG and WebP images can be read.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxDownloadBytes) throw new AiError(413, "payload_too_large", "The document is too large to read.");
  return `data:${type};base64,${bytes.toString("base64")}`;
}

async function storeExtraction(identity, documentId, schema, result) {
  const status = result.fallback ? "failed" : "complete";
  try {
    const response = await supabaseFetch("/rest/v1/rpc/record_load_document_extraction", identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_document_id: documentId,
        p_status: status,
        p_document_type: schema === "pod" ? result.fields.document_type ?? null : schema,
        p_extraction: {
          schema,
          fields: result.fields,
          confidence: result.confidence,
          sourceSpans: result.sourceSpans,
          warnings: result.warnings,
          modelUsed: result.modelUsed,
          extractionPath: result.extractionPath,
        },
        // Only a document read as a proof of delivery can be missing a signature.
        p_signature_missing: schema === "pod" && result.fields.document_type === "pod" && result.fields.signature_present === false,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function handleExtract({ identity, body, requestId }) {
  const request = parseRequest(body, identity);
  const schema = SCHEMAS[request.schema];
  const blankFields = Object.fromEntries(Object.entries(schema.fields).map(([field, type]) => [field, type === "string[]" ? [] : null]));

  let images = request.images ?? null;
  if (request.mode === "storage") images = [await downloadImage(identity, request.storagePath)];

  const extractionPath = request.mode === "text" ? "text_layer" : "vision";
  const model = request.mode === "text" ? MODELS.extract : MODELS.vision;
  const inputHash = createHash("sha256").update(request.mode === "text" ? request.text : images.join("|")).digest("hex");
  const cacheKey = `${identity.organizationId}:${request.schema}:${inputHash}`;

  // The review form opens blank with a notice; extraction failing never blocks
  // the dispatcher or loses the uploaded document.
  const fallbackResult = (reason) => ({
    schema: request.schema,
    modelUsed: null,
    extractionPath,
    fields: blankFields,
    confidence: {},
    sourceSpans: {},
    warnings: [
      reason === "timeout" ? "Reading the document timed out — fill in the form manually"
        : reason === "input_too_large" ? "The image is too large for the model to read — fill in the form manually"
          : "The document could not be read — fill in the form manually",
    ],
    manualReview: true,
    fallback: true,
    reason,
    cached: false,
  });

  let result;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    result = { ...hit.value, cached: true };
  } else if (request.mode === "storage" && images.join("").length > maxVisionPayloadChars) {
    // A stored photo can be larger than the model accepts. It is recorded as a
    // failed read so the document never sits waiting for an extraction.
    result = fallbackResult("input_too_large");
  } else {
    const content = request.mode === "text"
      ? `Document text:\n${request.text}`
      : [{ type: "text", text: "Extract the fields from this document." }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))];
    try {
      const response = await spurChat({
        model,
        json: true,
        maxTokens: 900,
        timeoutMs: extractTimeoutMs,
        requestId,
        messages: [{ role: "system", content: systemPrompt(request.schema) }, { role: "user", content }],
      });
      const normalized = normalizeExtraction(request.schema, parseModelJson(response.content), request.mode === "text" ? request.text : null, extractionPath);
      result = { schema: request.schema, modelUsed: response.model, extractionPath, ...normalized, fallback: false, cached: false };
      if (cache.size > 200) cache.clear();
      cache.set(cacheKey, { value: result, expiresAt: Date.now() + cacheMs });
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      if (error.code === "model_not_allowed" || error.code === "auth_not_configured") throw error;
      result = fallbackResult(error.code);
    }
  }

  const stored = request.documentId ? await storeExtraction(identity, request.documentId, request.schema, result) : null;
  return { ...result, stored };
}
