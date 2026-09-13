import { postAi } from "../../../shared/lib/aiClient";
import { supabase } from "../../../shared/lib/supabase";
import type { LoadDocument } from "../types";

export const DOCUMENT_BUCKET = "load-documents";
const MAX_EDGE_PX = 1600;

// SPUR's vision tier refuses a request whose estimated input exceeds its
// 32,768-token context window, and it estimates from the base64 text rather
// than from the image, at roughly four characters a token. All images sent in
// one request share this many base64 characters, leaving room for the prompt.
// The gateway enforces a slightly larger limit (maxVisionPayloadChars in
// services/integration-gateway/extract.mjs), so a compliant client is never refused.
export const VISION_PAYLOAD_CHARS = 96_000;
// Documents stay legible for the model down to about 760px on the long edge.
const BUDGET_STEPS: Array<[edge: number, quality: number]> = [[1600, 0.8], [1400, 0.72], [1200, 0.68], [1000, 0.62], [900, 0.55], [760, 0.5]];

const dataUrlLength = (bytes: number) => Math.ceil(bytes / 3) * 4 + "data:image/jpeg;base64,".length;

function encode(source: ImageBitmap | HTMLCanvasElement, edge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("This browser cannot prepare images."));
  // JPEG has no transparency; without a white ground a transparent PNG turns black.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("That photo could not be read."))), "image/jpeg", quality);
  });
}

// Encodes an image as JPEG. Without a budget it keeps up to 1600px for the
// record; with one it steps down size and quality until the image fits.
export async function encodeImage(source: ImageBitmap | HTMLCanvasElement, budgetChars?: number): Promise<Blob> {
  if (!budgetChars) return encode(source, MAX_EDGE_PX, 0.82);
  for (const [edge, quality] of BUDGET_STEPS) {
    const blob = await encode(source, edge, quality);
    if (dataUrlLength(blob.size) <= budgetChars) return blob;
  }
  throw new Error("This image is too detailed to read automatically. Photograph just the document, closer up.");
}

// Phone photos are routinely 3-8 MB; re-encoding keeps uploads quick over a
// cellular connection.
export async function prepareImage(file: File, budgetChars?: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That photo could not be read.");
  }
  try {
    return await encodeImage(bitmap, budgetChars);
  } finally {
    bitmap.close();
  }
}

export type PodUploadStage = "preparing" | "uploading" | "reading";

export type PodUploadResult = {
  document: LoadDocument;
  extraction: "complete" | "unreadable" | "unavailable";
  signatureMissing: boolean | null;
};

type ExtractResponse = { fallback: boolean; fields: { document_type?: string | null; signature_present?: boolean | null } };

export async function uploadProofOfDelivery(
  organizationId: number,
  loadId: string,
  file: File,
  onStage: (stage: PodUploadStage) => void,
): Promise<PodUploadResult> {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  onStage("preparing");
  // The gateway sends the stored copy to the model, so it is sized to the
  // vision budget. A photo too detailed to fit is still stored at full size:
  // the driver's proof is kept, and only the automatic reading is skipped.
  const image = await prepareImage(file, VISION_PAYLOAD_CHARS).catch(() => prepareImage(file));
  const path = `${organizationId}/${loadId}/${crypto.randomUUID()}.jpg`;

  onStage("uploading");
  const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error: attachError } = await supabase.rpc("attach_load_document", {
    p_storage_path: path,
    p_load_external_id: loadId,
    p_purpose: "pod",
  });
  if (attachError || !data) throw new Error(attachError?.message ?? "The proof of delivery could not be attached to this load.");
  const document = data as LoadDocument;

  // The file is stored and attached before extraction starts, so a slow or
  // failed read never loses the driver's upload.
  onStage("reading");
  try {
    const result = await postAi<ExtractResponse>("/api/ai/extract", { schema: "pod", storagePath: path, documentId: document.id }, 45_000);
    if (result.fallback) return { document, extraction: "unreadable", signatureMissing: null };
    const signatureMissing = result.fields.document_type === "pod" && result.fields.signature_present === false;
    return { document, extraction: "complete", signatureMissing };
  } catch {
    return { document, extraction: "unavailable", signatureMissing: null };
  }
}

// Stores the original intake document once the load it describes exists. It is
// best effort: the load is already created, so a failed upload is reported
// without undoing it.
export async function attachIntakeDocument(organizationId: number, loadId: string, file: File): Promise<void> {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  const isPdf = file.type === "application/pdf";
  const body: Blob = isPdf ? file : await prepareImage(file);
  const path = `${organizationId}/intake/${crypto.randomUUID()}.${isPdf ? "pdf" : "jpg"}`;
  const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, body, { contentType: isPdf ? "application/pdf" : "image/jpeg", upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  const { error: attachError } = await supabase.rpc("attach_load_document", { p_storage_path: path, p_load_external_id: loadId, p_purpose: "intake" });
  if (attachError) throw new Error(attachError.message);
}

export async function signedDocumentUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}
