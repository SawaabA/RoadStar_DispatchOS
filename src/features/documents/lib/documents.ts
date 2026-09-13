import { postAi } from "../../../shared/lib/aiClient";
import { supabase } from "../../../shared/lib/supabase";
import type { LoadDocument } from "../types";

export const DOCUMENT_BUCKET = "load-documents";
const MAX_EDGE_PX = 1600;

// Phone photos are routinely 3-8 MB. A 1600px JPEG keeps a document readable
// at a few hundred kilobytes, uploads quickly over a cellular connection, and
// stays well inside the vision model's input budget.
export async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("That photo could not be read."))), "image/jpeg", 0.82);
  });
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
  const image = await prepareImage(file);
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

export async function signedDocumentUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}
