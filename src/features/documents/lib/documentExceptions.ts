import type { DispatchLoad } from "../../dispatch/types";
import type { OperationalException } from "../../intelligence/types";
import type { LoadDocument } from "../types";

// An unsigned proof of delivery weakens payment and detention claims, so it
// joins the same exceptions inbox as HOS, equipment and dwell risk.
export function documentExceptions(documents: LoadDocument[], loads: DispatchLoad[]): OperationalException[] {
  return documents
    .filter((document) => document.purpose === "pod" && document.signature_missing === true)
    .map((document) => {
      const load = loads.find((item) => item.id === document.load_external_id);
      return {
        id: `DOCUMENT-${document.id}-signature`,
        type: "data" as const,
        severity: "critical" as const,
        title: `${load?.billNumber ?? document.load_external_id} proof of delivery has no signature`,
        detail: "The uploaded proof of delivery shows no signature. Payment and detention claims need a signed receipt.",
        entityId: document.load_external_id,
        recommendedAction: "Request a signed proof of delivery",
        actionView: "loads" as const,
      };
    });
}
