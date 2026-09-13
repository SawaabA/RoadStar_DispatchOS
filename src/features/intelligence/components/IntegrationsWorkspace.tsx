import { useEffect, useState } from "react";
import { CheckCircle2, Database, PlugZap } from "lucide-react";
import { providerStatuses } from "../lib/intelligence";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";

export function IntegrationsWorkspace({ ops, trafficLive }: { ops: ReturnTypeOfDispatchOperations; trafficLive: boolean }) {
  const [health, setHealth] = useState<{ solver: string; simulator: boolean; external: Record<string, { provider: string; status: string }> }>({ solver: "browser-fallback", simulator: false, external: {} });
  const [sampleLoads, setSampleLoads] = useState<Array<{ externalId: string; customer: string; origin: string; destination: string; equipment: string; weightLbs: number; status: string }>>([]);
  useEffect(() => {
    const check = async () => {
      const [solver, simulator, integrations, tmsLoads] = await Promise.allSettled([
        fetch("/api/health", { signal: AbortSignal.timeout(4_000) }).then((response) => response.ok ? response.json() as Promise<{engine?: string}> : Promise.reject()),
        fetch("/api/telemetry/health", { signal: AbortSignal.timeout(4_000) }).then((response) => response.ok),
        fetch("/api/integrations/health", { signal: AbortSignal.timeout(7_000) }).then((response) => response.ok ? response.json() as Promise<{providers?: Array<{id: string; provider: string; status: string}>}> : Promise.reject()),
        fetch("/api/tms/loads", { signal: AbortSignal.timeout(4_000) }).then((response) => response.ok ? response.json() as Promise<{loads?: typeof sampleLoads}> : Promise.reject()),
      ]);
      const external = integrations.status === "fulfilled"
        ? Object.fromEntries((integrations.value.providers ?? []).map((provider) => [provider.id, provider]))
        : {};
      setHealth({ solver: solver.status === "fulfilled" ? solver.value.engine ?? "xflp" : "browser-fallback", simulator: simulator.status === "fulfilled" && simulator.value, external });
      if (tmsLoads.status === "fulfilled") setSampleLoads(tmsLoads.value.loads ?? []);
    };
    void check();
  }, []);
  const providers = providerStatuses({ cloud: Boolean(ops.userEmail), trafficLive, simulatorLive: health.simulator, solver: health.solver, external: health.external });
  return <div className="page fade-in"><div className="page-heading"><div><p className="kicker">PORTABLE PROVIDER LAYER</p><h1>Integration adapters</h1><p>Each vendor sits behind a RoadStar contract so production providers can be swapped without rewriting operator screens.</p></div></div><div className="provider-grid">{providers.map((provider) => <article className="surface provider-card" key={provider.id}><div><span className="metric-icon teal">{provider.id === "database" ? <Database /> : <PlugZap />}</span><span className={`badge ${provider.status === "connected" ? "green" : provider.status === "degraded" ? "amber" : "blue"}`}>{provider.status}</span></div><small>{provider.category}</small><h2>{provider.provider}</h2><p>Mode: <b>{provider.mode}</b></p><ul>{provider.capabilities.map((item) => <li key={item}><CheckCircle2 />{item}</li>)}</ul><footer>Production swap target: {provider.swapTarget}</footer></article>)}</div>{sampleLoads.length > 0 && <section className="surface adapter-note demo-tms"><p className="kicker">SYNTHETIC DATA · READ ONLY</p><h2>Vendor-neutral TMS contract preview</h2><p>These records prove the normalized load shape without impersonating a real carrier system. They are never written to Supabase or mixed into the live dispatch board.</p><div>{sampleLoads.map((load) => <article key={load.externalId}><span><b>{load.externalId}</b><small>{load.customer}</small></span><span>{load.origin} → {load.destination}</span><span>{load.equipment}<small>{load.weightLbs.toLocaleString()} lb · {load.status}</small></span></article>)}</div></section>}<section className="surface adapter-note"><h2>Deployment contract</h2><p>The web app calls same-origin <code>/api</code> routes. In development Vite proxies those routes; in production the RoadStar web gateway forwards them to the solver, telematics, Ontario 511, routing, and vendor-neutral TMS adapter. Supabase stays browser-direct through its publishable key and tenant-scoped RLS.</p></section></div>;
}
