import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { AiRequestError, postAi } from "../../../shared/lib/aiClient";
import { mapRateConfirmation, type IntakeMapping } from "../../dispatch/lib/intakeMapping";
import { DocumentReadError, readDocumentForExtraction } from "../lib/documentReader";

type ExtractResponse = {
  fields: Record<string, unknown>;
  sourceSpans: Record<string, string | null>;
  confidence: Record<string, number | null>;
  warnings: string[];
  manualReview: boolean;
  fallback: boolean;
  extractionPath: "text_layer" | "vision";
};

export type ImportedDocument = IntakeMapping & {
  file: File;
  warnings: string[];
  extractionPath: ExtractResponse["extractionPath"] | null;
};

type Status = { kind: "idle" } | { kind: "reading"; step: string } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function IntakeImporter({ signedIn, onImported }: { signedIn: boolean; onImported: (result: ImportedDocument) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const read = async (file: File | undefined) => {
    if (!file) return;
    try {
      setStatus({ kind: "reading", step: "Opening the document…" });
      const document = await readDocumentForExtraction(file);
      setStatus({ kind: "reading", step: document.mode === "text" ? "Reading the text…" : "Reading the scanned page…" });
      const response = await postAi<ExtractResponse>(
        "/api/ai/extract",
        document.mode === "text" ? { schema: "rate_confirmation", text: document.text } : { schema: "rate_confirmation", images: document.images },
        45_000,
      );
      const mapping = mapRateConfirmation({ fields: response.fields, sourceSpans: response.sourceSpans, confidence: response.confidence });
      onImported({ ...mapping, file, warnings: response.warnings ?? [], extractionPath: response.fallback ? null : response.extractionPath });
      const filled = Object.keys(mapping.draft).length;
      setStatus({
        kind: "done",
        message: response.fallback || !filled
          ? "The document could not be read. Fill in the form from the document."
          : `Filled ${filled} fields from the document. Check each one before creating the load.`,
      });
    } catch (error) {
      const message = error instanceof DocumentReadError
        ? error.message
        : error instanceof AiRequestError && error.code === "unauthenticated"
          ? "Sign in to read documents automatically."
          : error instanceof AiRequestError
            ? `The document could not be read: ${error.message}`
            : "The document could not be read. Fill in the form from the document.";
      setStatus({ kind: "error", message });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return <div className="intake-importer">
    <div>
      <b>Import a rate confirmation</b>
      <small>PDF or photo. RoadStar reads it and fills in the form; nothing is created until you choose Create load.</small>
    </div>
    {signedIn
      ? <>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={(event) => void read(event.target.files?.[0])} />
        <button type="button" className="btn compact secondary" disabled={status.kind === "reading"} onClick={() => input.current?.click()}>
          <FileUp />{status.kind === "reading" ? status.step : "Choose document"}
        </button>
      </>
      : <small>Sign in to read documents automatically.</small>}
    {status.kind === "done" && <p className="intake-status" role="status">{status.message}</p>}
    {status.kind === "error" && <p className="intake-status intake-error" role="alert">{status.message}</p>}
  </div>;
}
