import { useEffect, useState } from "react";
import { supabase } from "../../../shared/lib/supabase";
import type { LoadDocument } from "../types";

// Documents for the signed-in organization, refreshed over Realtime so a
// dispatcher sees a proof of delivery arrive while the driver is still on site.
// Row-level security decides which rows each role receives.
export function useLoadDocuments(organizationId: number | null) {
  const [documents, setDocuments] = useState<LoadDocument[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || organizationId === null) {
      setDocuments([]);
      setError(null);
      return;
    }
    const client = supabase;
    let active = true;
    const refresh = async () => {
      const { data, error: queryError } = await client
        .from("load_documents")
        .select("*")
        .eq("organization_id", organizationId)
        .order("uploaded_at", { ascending: false })
        .limit(200);
      if (!active) return;
      if (queryError) {
        setError(queryError.message);
        return;
      }
      setError(null);
      setDocuments((data ?? []) as LoadDocument[]);
    };
    void refresh();
    const channel = client
      .channel(`roadstar-load-documents-${organizationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "load_documents", filter: `organization_id=eq.${organizationId}` }, () => void refresh())
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [organizationId]);

  return { documents, error };
}
