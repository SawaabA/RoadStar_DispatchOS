export type LoadDocumentType = "rate_confirmation" | "bol" | "pod" | "lumper_receipt" | "damage_photo" | "other" | "unknown";

export type DocumentExtraction = {
  schema?: string;
  fields?: Record<string, unknown>;
  warnings?: string[];
  modelUsed?: string | null;
  extractionPath?: string;
};

// Mirrors public.load_documents.
export type LoadDocument = {
  id: string;
  organization_id: number;
  load_external_id: string;
  storage_path: string;
  purpose: "intake" | "pod";
  document_type: LoadDocumentType;
  content_type: string;
  byte_size: number;
  uploaded_by: string | null;
  uploaded_at: string;
  extraction_status: "pending" | "complete" | "failed" | "skipped";
  extraction: DocumentExtraction | null;
  signature_missing: boolean | null;
  extracted_at: string | null;
};
