import { describe, expect, it } from "vitest";
import { createDemoState } from "../../dispatch/data/demoData";
import type { LoadDocument } from "../types";
import { documentExceptions } from "./documentExceptions";

const document = (overrides: Partial<LoadDocument>): LoadDocument => ({
  id: "doc-1",
  organization_id: 1,
  load_external_id: "L-4521",
  storage_path: "1/L-4521/a.jpg",
  purpose: "pod",
  document_type: "pod",
  content_type: "image/jpeg",
  byte_size: 2048,
  uploaded_by: "user-1",
  uploaded_at: "2026-09-13T14:05:00Z",
  extraction_status: "complete",
  extraction: null,
  signature_missing: true,
  extracted_at: "2026-09-13T14:06:00Z",
  ...overrides,
});

describe("document exceptions", () => {
  const { loads } = createDemoState();

  it("raises a critical exception for an unsigned proof of delivery", () => {
    const [exception] = documentExceptions([document({})], loads);
    expect(exception).toMatchObject({ severity: "critical", type: "data", entityId: "L-4521", actionView: "loads" });
    expect(exception?.title).toBe("RS-4521 proof of delivery has no signature");
  });

  it("ignores signed, unread and non-POD documents", () => {
    expect(documentExceptions([
      document({ id: "signed", signature_missing: false }),
      document({ id: "unread", signature_missing: null, extraction_status: "pending" }),
      document({ id: "rate", purpose: "intake", document_type: "rate_confirmation" }),
    ], loads)).toEqual([]);
  });

  it("keeps a stable id so acknowledgement survives a refresh", () => {
    const first = documentExceptions([document({})], loads)[0]?.id;
    expect(documentExceptions([document({})], loads)[0]?.id).toBe(first);
  });

  it("falls back to the load id when the load is not in the workspace", () => {
    expect(documentExceptions([document({ load_external_id: "L-0001" })], loads)[0]?.title).toBe("L-0001 proof of delivery has no signature");
  });
});
