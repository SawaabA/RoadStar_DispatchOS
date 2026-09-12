import { useEffect, useState } from "react";
import { CheckCircle2, Database, PlugZap } from "lucide-react";
import { providerStatuses } from "../lib/intelligence";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";

export function IntegrationsWorkspace({ ops, trafficLive }: { ops: ReturnTypeOfDispatchOperations; trafficLive: boolean }) {
  const [health, setHealth] = useState<{ solver: string; simulator: boolean; external: Record<string, { provider: string; status: string }> }>({ solver: "browser-fallback", simulator: false, external: {} });
  useEffect(() => {
    const check = async () => {
      const [solver, simulator, integrations] = await Promise.allSettled([
        fetch("/api/health", { signal: AbortSignal.timeout(4_000) }).then((response) => response.ok ? response.json() as Promise<{engine?: string}> : Promise.reject()),
        fetch("/api/telemetry/health", { signal: AbortSignal.timeout(4_000) }).then((response) => response.ok),
        fetch("/api/integrations/health", { signal: AbortSignal.timeout(7_000) }).then((response) => response.ok ? response.json() as Promise<{providers?: Array<{id: string; provider: string; status: string}>}> : Promise.reject()),
      ]);
      const external = integrations.status === "fulfilled"
        ? Object.fromEntries((integrations.value.providers ?? []).map((provider) => [provider.id, provider]))
        : {};
      setHealth({ solver: solver.status === "fulfilled" ? solver.value.engine ?? "xflp" : "browser-fallback", simulator: simulator.status === "fulfilled" && simulator.value, external });
    };
    void check();
  }, []);
  const providers = providerStatuses({ cloud: Boolean(ops.userEmail), trafficLive, simulatorLive: health.simulator, solver: health.solver, external: health.external });
  return <div className="page fade-in"><div className="page-heading"><div><p className="kicker">PORTABLE PROVIDER LAYER</p><h1>Integration adapters</h1><p>Each vendor sits behind a RoadStar contract so production providers can be swapped without rewriting operator screens.</p></div></div><div className="provider-grid">{providers.map((provider) => <article className="surface provider-card" key={provider.id}><div><span className="metric-icon teal">{provider.id === "database" ? <Database /> : <PlugZap />}</span><span className={`badge ${provider.status === "connected" ? "green" : provider.status === "degraded" ? "amber" : "blue"}`}>{provider.status}</span></div><small>{provider.category}</small><h2>{provider.provider}</h2><p>Mode: <b>{provider.mode}</b></p><ul>{provider.capabilities.map((item) => <li key={item}><CheckCircle2 />{item}</li>)}</ul><footer>Production swap target: {provider.swapTarget}</footer></article>)}</div><section className="surface adapter-note"><h2>Deployment contract</h2><p>The web app calls same-origin <code>/api</code> routes. In development Vite proxies those routes; in production the RoadStar web gateway forwards them to the solver, telematics, and Ontario 511 services. Supabase stays browser-direct through its publishable key and tenant-scoped RLS.</p></section></div>;
}
