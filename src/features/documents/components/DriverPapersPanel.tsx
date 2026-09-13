import { FileText, IdCard, ShieldCheck, Truck } from "lucide-react";
import type { DispatchLoad, Driver } from "../../dispatch/types";

/**
 * The paperwork a driver is asked for at a scale, a dock or a roadside
 * inspection. These are demo records: the production version reads the
 * carrier's compliance files and the load's own documents.
 */

type PaperStatus = "valid" | "expiring" | "pending";

type Paper = {
  id: string;
  title: string;
  reference: string;
  detail: string;
  status: PaperStatus;
};

const inDays = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" }).format(
    new Date(Date.now() + days * 86_400_000),
  );

const statusLabel: Record<PaperStatus, string> = {
  valid: "Valid",
  expiring: "Renew soon",
  pending: "Pending",
};

const statusTone: Record<PaperStatus, string> = {
  valid: "green",
  expiring: "amber",
  pending: "blue",
};

function PaperGroup({
  title,
  icon,
  papers,
}: {
  title: string;
  icon: React.ReactNode;
  papers: Paper[];
}) {
  return (
    <section className="paper-group">
      <h2>
        {icon}
        {title}
      </h2>
      {papers.map((paper) => (
        <details className="paper-card" key={paper.id}>
          <summary>
            <span>
              <b>{paper.title}</b>
              <small>{paper.reference}</small>
            </span>
            <i className={`badge ${statusTone[paper.status]}`}>{statusLabel[paper.status]}</i>
          </summary>
          <p>{paper.detail}</p>
          <div className="paper-preview" aria-hidden="true">
            <FileText />
            <span>Sample document image</span>
          </div>
        </details>
      ))}
    </section>
  );
}

export function DriverPapersPanel({ driver, load }: { driver: Driver; load: DispatchLoad }) {
  const credentials: Paper[] = [
    {
      id: "licence",
      title: "Ontario Class AZ licence",
      reference: `•••• ${driver.id.replace(/\D/g, "").padStart(4, "0")} · expires ${inDays(214)}`,
      detail: `${driver.name} · air brake (Z) endorsement · no restrictions recorded.`,
      status: "valid",
    },
    {
      id: "abstract",
      title: "Driver abstract & CVOR record",
      reference: `Pulled ${inDays(-46)}`,
      detail: "Clean abstract on file. RoadStar re-pulls abstracts every six months.",
      status: "valid",
    },
    {
      id: "medical",
      title: "Commercial medical certificate",
      reference: `Expires ${inDays(41)}`,
      detail: "Valid for commercial operation. Book the renewal before the expiry date.",
      status: "expiring",
    },
  ];

  const carrier: Paper[] = [
    {
      id: "cvor",
      title: "CVOR certificate",
      reference: "CVOR 084-621-119 · RoadStar Logistics Inc.",
      detail: "Satisfactory safety rating. Keep a copy in the cab at all times.",
      status: "valid",
    },
    {
      id: "insurance",
      title: "Insurance & cargo liability",
      reference: `Policy RS-CL-44102 · valid to ${inDays(163)}`,
      detail: "$2M liability and $250,000 cargo coverage. Shippers may ask for this certificate.",
      status: "valid",
    },
    {
      id: "inspection",
      title: "Annual inspection & trailer decal",
      reference: `Truck ${driver.truckId.replace("T-", "")} · trailer ${driver.trailerId}`,
      detail: "Annual inspection sticker current. Daily pre-trip inspection still required.",
      status: "valid",
    },
    {
      id: "ifta",
      title: "IFTA licence & NSC number",
      reference: "IFTA ON-118204 · NSC 6620117",
      detail: "Fuel-tax credentials for interprovincial running.",
      status: "valid",
    },
  ];

  const shipment: Paper[] = [
    {
      id: "bol",
      title: "Bill of lading",
      reference: `${load.billNumber} · ${load.customer}`,
      detail: `${load.origin} → ${load.destination} · ${load.weightLbs.toLocaleString()} lb · ${load.pallets} pallets · ${load.description}. Get a signature at delivery.`,
      status: "valid",
    },
    {
      id: "rate",
      title: "Rate confirmation",
      reference: `${load.billNumber}-RC`,
      detail: "Agreed rate, accessorials and the two free hours of dock time before detention starts.",
      status: "valid",
    },
    {
      id: "scale",
      title: "Weigh scale ticket",
      reference: "Captured at origin",
      detail: "Gross, axle and net weights recorded at the shipper's scale.",
      status: "valid",
    },
    {
      id: "pod",
      title: "Proof of delivery",
      reference: "Uploaded from the Today tab",
      detail: "Photograph the signed paperwork at the receiver. Dispatch sees it immediately.",
      status: "pending",
    },
  ];

  return (
    <div className="driver-papers">
      <p className="paper-note">
        Sample paperwork for the demo. In production these come from the carrier&apos;s compliance
        file and the load&apos;s own documents.
      </p>
      <PaperGroup title="My credentials" icon={<IdCard />} papers={credentials} />
      <PaperGroup title="Carrier papers" icon={<ShieldCheck />} papers={carrier} />
      <PaperGroup title={`Load papers · ${load.billNumber}`} icon={<Truck />} papers={shipment} />
    </div>
  );
}
