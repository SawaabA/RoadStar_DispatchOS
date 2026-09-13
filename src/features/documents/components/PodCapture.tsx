import { useRef, useState } from "react";
import { AlertTriangle, Camera, Check } from "lucide-react";
import { uploadProofOfDelivery, type PodUploadStage } from "../lib/documents";
import type { LoadDocument } from "../types";

type Status =
  | { kind: "idle" }
  | { kind: "working"; stage: PodUploadStage }
  | { kind: "saved"; message: string; signatureMissing: boolean }
  | { kind: "error"; message: string };

const STAGE_LABELS: Record<PodUploadStage, string> = {
  preparing: "Preparing photo…",
  uploading: "Uploading…",
  reading: "Reading the document…",
};

export function PodCapture({ loadId, organizationId, signedIn, documents }: {
  loadId: string;
  organizationId: number | null;
  signedIn: boolean;
  documents: LoadDocument[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const onFile = documents.filter((item) => item.purpose === "pod" && item.load_external_id === loadId);
  const canUpload = signedIn && organizationId !== null;

  const upload = async (file: File | undefined) => {
    if (!file || organizationId === null) return;
    try {
      const result = await uploadProofOfDelivery(organizationId, loadId, file, (stage) => setStatus({ kind: "working", stage }));
      setStatus({
        kind: "saved",
        signatureMissing: result.signatureMissing === true,
        message: result.extraction === "complete"
          ? "Proof of delivery saved and read."
          : "Proof of delivery saved. It could not be read automatically, so dispatch will review it.",
      });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "The proof of delivery could not be saved." });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  return <section className="mobile-pod" aria-labelledby={`pod-${loadId}`}>
    <div>
      <p className="kicker" id={`pod-${loadId}`}>PROOF OF DELIVERY</p>
      {onFile.length > 0 && <span className="badge green">{onFile.length} on file</span>}
    </div>
    {!canUpload
      ? <p>Sign in to attach a proof of delivery.</p>
      : <>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => void upload(event.target.files?.[0])} />
        <button type="button" className="btn full secondary" disabled={status.kind === "working"} onClick={() => input.current?.click()}>
          <Camera />{status.kind === "working" ? STAGE_LABELS[status.stage] : "Photograph signed POD"}
        </button>
      </>}
    {status.kind === "saved" && <p role="status"><Check /> {status.message}</p>}
    {status.kind === "saved" && status.signatureMissing && <p className="pod-alert" role="alert"><AlertTriangle /> No signature detected. Ask the receiver to sign before you leave.</p>}
    {status.kind === "error" && <p className="pod-alert" role="alert"><AlertTriangle /> {status.message}</p>}
  </section>;
}
