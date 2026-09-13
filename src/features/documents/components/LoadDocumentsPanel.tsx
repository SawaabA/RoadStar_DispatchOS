import { useEffect, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import type { DispatchLoad } from "../../dispatch/types";
import { signedDocumentUrl } from "../lib/documents";
import type { LoadDocument } from "../types";

const TYPE_LABELS: Record<LoadDocument["document_type"], string> = {
  rate_confirmation: "Rate confirmation",
  bol: "Bill of lading",
  pod: "Proof of delivery",
  lumper_receipt: "Lumper receipt",
  damage_photo: "Damage photo",
  other: "Document",
  unknown: "Document",
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export function LoadDocumentsPanel({ documents, loads, signedIn, error }: {
  documents: LoadDocument[];
  loads: DispatchLoad[];
  signedIn: boolean;
  error: string | null;
}) {
  return <section className="surface documents-panel" aria-labelledby="documents-heading">
    <div className="section-head">
      <div><p className="kicker">DRIVER UPLOADS AND INTAKE</p><h2 id="documents-heading">Load documents</h2></div>
      {signedIn && !error && <small>Updates live as drivers upload</small>}
    </div>
    {!signedIn && <p className="empty-state">Sign in to see proof-of-delivery photos and rate confirmations.</p>}
    {signedIn && error && <p className="empty-state" role="status">Documents are unavailable: {error}</p>}
    {signedIn && !error && !documents.length && <p className="empty-state">No documents yet. A proof of delivery appears here as soon as a driver photographs it.</p>}
    {signedIn && !error && documents.length > 0 && <div className="documents-grid">
      {documents.slice(0, 12).map((document) => <DocumentCard key={document.id} document={document} load={loads.find((item) => item.id === document.load_external_id)} />)}
    </div>}
  </section>;
}

function DocumentCard({ document, load }: { document: LoadDocument; load?: DispatchLoad }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = document.content_type.startsWith("image/");
  useEffect(() => {
    if (!isImage) return;
    let active = true;
    void signedDocumentUrl(document.storage_path).then((signed) => { if (active) setUrl(signed); });
    return () => { active = false; };
  }, [document.storage_path, isImage]);

  const fields = document.extraction?.fields ?? {};
  const label = TYPE_LABELS[document.document_type];
  const bill = load?.billNumber ?? document.load_external_id;
  const receivedBy = text(fields.signature_name);
  const consignee = text(fields.consignee);
  const delivered = text(fields.delivered_at);

  return <article className="document-card">
    <div className="document-thumb">{url ? <img src={url} alt={`${label} for ${bill}`} /> : <FileText aria-hidden="true" />}</div>
    <div>
      <b>{bill} · {label}</b>
      {consignee && <p>Consignee: {consignee}</p>}
      {receivedBy && <p>Received by: {receivedBy}</p>}
      {delivered && <p>Delivered: {delivered}</p>}
      <p>Uploaded {new Date(document.uploaded_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>
      <div className="badges">
        {document.extraction_status === "pending" && <span className="badge blue">Reading</span>}
        {document.extraction_status === "failed" && <span className="badge amber">Needs manual review</span>}
        {document.signature_missing === true && <span className="badge red"><AlertTriangle aria-hidden="true" /> No signature</span>}
        {document.signature_missing === false && <span className="badge green">Signed</span>}
      </div>
    </div>
  </article>;
}
