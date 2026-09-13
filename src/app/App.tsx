import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Database,
  Gauge,
  Layers3,
  LayoutDashboard,
  ListFilter,
  Map,
  MapPin,
  Menu,
  Navigation,
  PackageCheck,
  Play,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  Tractor,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { useDispatchOperations } from "../features/dispatch/hooks/useDispatchOperations";
import { useRoadIntelligence } from "../features/intelligence/hooks/useRoadIntelligence";
import { IntelligenceWorkspace } from "../features/intelligence/components/IntelligenceWorkspace";
import { LoadDocumentsPanel } from "../features/documents/components/LoadDocumentsPanel";
import { PodCapture } from "../features/documents/components/PodCapture";
import { useLoadDocuments } from "../features/documents/hooks/useLoadDocuments";
import { NewLoadForm } from "../features/dispatch/components/NewLoadForm";
import { documentExceptions } from "../features/documents/lib/documentExceptions";
import { AnalyticsWorkspace } from "../features/intelligence/components/AnalyticsWorkspace";
import { IntegrationsWorkspace } from "../features/intelligence/components/IntegrationsWorkspace";
import type {
  DispatchCandidate,
  DispatchLoad,
  Driver,
} from "../features/dispatch/types";
import { isSupabaseConfigured } from "../shared/lib/supabase";
import { isAuthCallbackHash } from "../shared/lib/authCallback";
import "./styles.css";

type View =
  | "overview"
  | "dispatch"
  | "loads"
  | "fleet"
  | "map"
  | "detention"
  | "driver"
  | "loader"
  | "intelligence"
  | "analytics"
  | "integrations";
const fmtTime = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const fmtMoney = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
const statusLabel = (value: string) => value.replaceAll("_", " ");
const NAV: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Command center", icon: LayoutDashboard },
  { id: "dispatch", label: "Dispatch board", icon: Route },
  { id: "loads", label: "Load board", icon: PackageCheck },
  { id: "fleet", label: "Drivers & fleet", icon: Tractor },
  { id: "map", label: "Live map", icon: Map },
  { id: "detention", label: "Detention", icon: Timer },
  { id: "driver", label: "Driver view", icon: Navigation },
  { id: "loader", label: "3D load planner", icon: Layers3 },
  { id: "intelligence", label: "Intelligence", icon: AlertTriangle },
  { id: "analytics", label: "KPI & replay", icon: Gauge },
  { id: "integrations", label: "Integrations", icon: Settings2 },
];

const LoaderWorkspace = lazy(() =>
  import("../features/loading/components/LoaderWorkspace").then((module) => ({
    default: module.LoaderWorkspace,
  })),
);
const FleetMap = lazy(() =>
  import("../features/map/components/FleetMap").then((module) => ({
    default: module.FleetMap,
  })),
);

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "green" | "amber" | "red" | "blue" | "neutral";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Overview({
  ops,
  intelligence,
  onNavigate,
}: {
  ops: ReturnType<typeof useDispatchOperations>;
  intelligence: ReturnType<typeof useRoadIntelligence>;
  onNavigate: (v: View) => void;
}) {
  const { state, metrics, simulationRunning, setSimulationRunning } = ops,
    active = state.assignments.filter((a) => a.status !== "completed"),
    urgent = state.loads.filter(
      (l) => l.status === "unassigned" && l.priority !== "standard",
    ),
    acknowledged = new Set(state.acknowledgedExceptionIds ?? []),
    openExceptions = intelligence.exceptions.filter((item) => !acknowledged.has(item.id));
  return (
    <div className="page fade-in">
      <div className="page-heading">
        <div>
          <p className="kicker">TODAY'S OPERATIONS · SOUTHERN ONTARIO</p>
          <h1>Good morning, Dispatch</h1>
          <p>Here’s what needs attention across the network.</p>
        </div>
        <div className="heading-actions">
          <button
            className="btn secondary"
            onClick={() => setSimulationRunning(!simulationRunning)}
          >
            {simulationRunning ? (
              <>
                <Radio className="pulse" /> Live simulation
              </>
            ) : (
              <>
                <Play /> Start live demo
              </>
            )}
          </button>
          <button
            className="btn primary"
            onClick={() => onNavigate("dispatch")}
          >
            <Sparkles />
            Plan my morning
          </button>
        </div>
      </div>
      <div className="metric-grid">
        <article className="metric-card">
          <span className="metric-icon teal">
            <PackageCheck />
          </span>
          <div>
            <small>OPEN LOADS</small>
            <strong>{metrics.open}</strong>
            <em>{urgent.length} high priority</em>
          </div>
        </article>
        <article className="metric-card">
          <span className="metric-icon blue">
            <Truck />
          </span>
          <div>
            <small>ACTIVE TRIPS</small>
            <strong>{metrics.active}</strong>
            <em>
              {
                state.assignments.filter((a) => a.status === "in_transit")
                  .length
              }{" "}
              moving now
            </em>
          </div>
        </article>
        <article className="metric-card">
          <span className="metric-icon violet">
            <Users />
          </span>
          <div>
            <small>AVAILABLE DRIVERS</small>
            <strong>
              {metrics.available}
              <i> / {state.drivers.length}</i>
            </strong>
            <em>HOS verified</em>
          </div>
        </article>
        <article className="metric-card">
          <span className="metric-icon amber">
            <CircleDollarSign />
          </span>
          <div>
            <small>DETENTION CAPTURED</small>
            <strong>{fmtMoney(metrics.detention)}</strong>
            <em>Today’s evidence</em>
          </div>
        </article>
      </div>
      <div className="overview-grid">
        <section className="surface map-card">
          <div className="section-head">
            <div>
              <p className="kicker">LIVE OPERATIONS</p>
              <h2>Fleet pulse</h2>
            </div>
            <button className="text-btn" onClick={() => onNavigate("map")}>
              Open map <ArrowRight />
            </button>
          </div>
          <div className="mini-map">
            <Suspense fallback={<div className="module-loading"><Map /><b>Loading fleet map…</b></div>}>
              <FleetMap
                trucks={state.trucks}
                assignments={state.assignments}
                loads={state.loads}
                facilities={state.facilities}
                satellite={false}
                incidents={intelligence.traffic.incidents}
              />
            </Suspense>
          </div>
        </section>
        <section className="surface attention">
          <div className="section-head">
            <div>
              <p className="kicker">ACTION REQUIRED</p>
              <h2>Exceptions</h2>
            </div>
            <Badge tone="amber">{openExceptions.length} open</Badge>
          </div>
          {!openExceptions.length && <div className="empty-state">No open operational exceptions.</div>}
          {openExceptions.slice(0, 3).map((item) => <button className="exception" key={item.id} onClick={() => onNavigate("intelligence")}>
            <span className={item.severity === "critical" ? "danger-icon" : "amber-icon"}><AlertTriangle /></span>
            <div><b>{item.title}</b><p>{item.detail}</p></div><ArrowRight />
          </button>)}
          {openExceptions.length > 3 && <button className="text-btn" onClick={() => onNavigate("intelligence")}>View all {openExceptions.length} exceptions <ArrowRight /></button>}
        </section>
      </div>
      <section className="surface">
        <div className="section-head">
          <div>
            <p className="kicker">CURRENT EXECUTION</p>
            <h2>Active movements</h2>
          </div>
          <span className="live-label">
            <i /> Updates every second
          </span>
        </div>
        <div className="movement-list">
          {active.map((a) => {
            const load = state.loads.find((l) => l.id === a.loadId)!,
              driver = state.drivers.find((d) => d.id === a.driverId)!,
              truck = state.trucks.find((t) => t.id === a.truckId)!;
            return (
              <article className="movement" key={a.id}>
                <span className="avatar">{driver.initials}</span>
                <div className="movement-main">
                  <div>
                    <b>{load.origin}</b>
                    <ArrowRight />
                    <b>{load.destination}</b>
                  </div>
                  <p>
                    {load.billNumber} · {driver.name} · Truck {truck.number}
                  </p>
                  <div className="progress">
                    <i style={{ width: `${Math.max(4, a.progress * 100)}%` }} />
                  </div>
                </div>
                <div className="movement-stat">
                  <small>SPEED</small>
                  <b>{a.speedKph} km/h</b>
                </div>
                <div className="movement-stat">
                  <small>ETA</small>
                  <b>{fmtTime(a.eta)}</b>
                </div>
                <Badge tone={a.status === "in_transit" ? "green" : "blue"}>
                  {statusLabel(a.status)}
                </Badge>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function AssignmentModal({
  load,
  drivers,
  onClose,
  onAssign,
  candidateFor,
}: {
  load: DispatchLoad;
  drivers: Driver[];
  onClose: () => void;
  onAssign: (c: DispatchCandidate) => void;
  candidateFor: (l: string, d: string) => DispatchCandidate | null;
}) {
  const candidates = drivers
    .map((d) => candidateFor(load.id, d.id))
    .filter(Boolean) as DispatchCandidate[];
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <section className="modal assignment-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-title">
        <button className="close" aria-label="Close assignment dialog" autoFocus onClick={onClose}>
          <X />
        </button>
        <p className="kicker">MANUAL DISPATCH</p>
        <h2 id="assignment-title">
          {load.billNumber} · {load.origin} → {load.destination}
        </h2>
        <p className="modal-sub">
          Choose a unit. DispatchOS checks equipment, capacity, pickup
          feasibility, and HOS before assignment.
        </p>
        <div className="candidate-list">
          {candidates
            .sort(
              (a, b) =>
                Number(b.feasible) - Number(a.feasible) || b.score - a.score,
            )
            .map((c) => {
              const d = drivers.find((x) => x.id === c.driverId)!;
              return (
                <article
                  className={`candidate ${c.feasible ? "" : "blocked"}`}
                  key={d.id}
                >
                  <span className="avatar">{d.initials}</span>
                  <div className="candidate-copy">
                    <div>
                      <b>{d.name}</b>
                      <Badge tone={c.feasible ? "green" : "red"}>
                        {c.feasible ? "Feasible" : "Blocked"}
                      </Badge>
                    </div>
                    <p>
                      Truck {c.truckId.replace("T-", "")} · Trailer{" "}
                      {c.trailerId} · {Math.round(c.deadheadKm)} km deadhead
                    </p>
                    <small>{c.explanation}</small>
                    <details className="score-details">
                      <summary>Why this score?</summary>
                      <div><span>Deadhead <b>{Math.round(c.scoreBreakdown.deadhead)}</b></span><span>On-time <b>{Math.round(c.scoreBreakdown.onTime)}</b></span><span>HOS buffer <b>{Math.round(c.scoreBreakdown.hosBuffer)}</b></span><span>Future position <b>{Math.round(c.scoreBreakdown.futurePosition)}</b></span></div>
                    </details>
                  </div>
                  <div className="candidate-score">
                    <strong>{c.score}</strong>
                    <small>MATCH</small>
                  </div>
                  <button
                    disabled={!c.feasible}
                    className="btn compact primary"
                    onClick={() => onAssign(c)}
                  >
                    Assign
                  </button>
                </article>
              );
            })}
        </div>
      </section>
    </div>
  );
}

function PlanModal({ ops }: { ops: ReturnType<typeof useDispatchOperations> }) {
  const { proposal, state, setProposal, applyPlan } = ops;
  if (!proposal) return null;
  return (
    <div className="modal-backdrop" onKeyDown={(event) => event.key === "Escape" && setProposal(null)}>
      <section className="modal plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <button className="close" aria-label="Close morning plan" autoFocus onClick={() => setProposal(null)}>
          <X />
        </button>
        <div className="plan-title">
          <span className="spark">
            <Sparkles />
          </span>
          <div>
            <p className="kicker">FLEET-WIDE PROPOSAL</p>
            <h2 id="plan-title">Morning plan ready</h2>
            <p>
              {proposal.candidates.length} assignments ·{" "}
              {Math.round(proposal.projectedDeadheadKm)} km projected deadhead ·
              nothing changes until you approve.
            </p>
          </div>
        </div>
        <div className="proposal-summary">
          <span>
            <Check /> {proposal.candidates.length} feasible
          </span>
          <span className={proposal.rejectedLoads.length ? "warn-text" : ""}>
            <AlertTriangle /> {proposal.rejectedLoads.length} needs review
          </span>
          <span>
            <Clock3 /> Generated {fmtTime(proposal.generatedAt)}
          </span>
        </div>
        <div className="proposal-list">
          {proposal.candidates.map((c) => {
            const load = state.loads.find((l) => l.id === c.loadId)!,
              driver = state.drivers.find((d) => d.id === c.driverId)!;
            return (
              <article key={c.loadId}>
                <div className="proposal-route">
                  <b>{load.billNumber}</b>
                  <span>
                    {load.origin}
                    <ArrowRight />
                    {load.destination}
                  </span>
                </div>
                <div>
                  <small>RECOMMENDED UNIT</small>
                  <b>
                    {driver.name} · Truck {c.truckId.replace("T-", "")}
                  </b>
                </div>
                <div>
                  <small>DEADHEAD</small>
                  <b>{Math.round(c.deadheadKm)} km</b>
                </div>
                <div>
                  <small>HOS AFTER</small>
                  <b>{c.hosRemainingAfter.toFixed(1)} h</b>
                </div>
                <p>
                  <Sparkles />
                  {c.explanation}
                </p>
              </article>
            );
          })}
          {proposal.rejectedLoads.map((item) => {
            const load = state.loads.find((l) => l.id === item.loadId)!;
            return (
              <article className="rejected" key={item.loadId}>
                <div className="proposal-route">
                  <b>{load.billNumber}</b>
                  <span>
                    {load.origin}
                    <ArrowRight />
                    {load.destination}
                  </span>
                </div>
                <div className="reject-reason">
                  <AlertTriangle />
                  <span>
                    <b>Manual review required</b>
                    <small>
                      {item.reasons[0] || "No available feasible unit"}
                    </small>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="modal-footer">
          <button className="btn secondary" onClick={() => setProposal(null)}>
            Reject plan
          </button>
          <button className="btn primary" onClick={applyPlan}>
            <Check />
            Apply {proposal.candidates.length} assignments
          </button>
        </footer>
      </section>
    </div>
  );
}

function DispatchBoard({
  ops,
}: {
  ops: ReturnType<typeof useDispatchOperations>;
}) {
  const { state, generatePlan, unassign } = ops,
    [selected, setSelected] = useState<DispatchLoad | null>(null),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const open = state.loads.filter(
      (l) =>
        l.status === "unassigned" &&
        (filter === "all" || l.priority === filter) &&
        `${l.billNumber}${l.customer}${l.origin}${l.destination}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    assigned = state.assignments.filter((a) => a.status !== "completed");
  return (
    <div className="page fade-in">
      <div className="page-heading">
        <div>
          <p className="kicker">DISPATCH WORKSPACE</p>
          <h1>Build today’s plan</h1>
          <p>
            Assign manually or generate a fleet-wide proposal. Every pairing is
            checked before dispatch.
          </p>
        </div>
        <button className="btn primary xl" onClick={generatePlan}>
          <Sparkles />
          Plan my morning <span>{open.length} loads</span>
        </button>
      </div>
      <div className="dispatch-toolbar">
        <div className="search">
          <Search />
          <input
            aria-label="Search open loads"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search loads, cities, customers…"
          />
        </div>
        <button
          className={`chip ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All open{" "}
          <b>{state.loads.filter((l) => l.status === "unassigned").length}</b>
        </button>
        <button
          className={`chip ${filter === "critical" ? "active" : ""}`}
          onClick={() => setFilter("critical")}
        >
          Critical
        </button>
        <button
          className={`chip ${filter === "high" ? "active" : ""}`}
          onClick={() => setFilter("high")}
        >
          High priority
        </button>
        <button className="icon-btn" aria-label="Additional dispatch filters" disabled title="More filters are planned">
          <Settings2 />
        </button>
      </div>
      <div className="dispatch-grid">
        <section className="board-column">
          <div className="column-head">
            <span>UNASSIGNED LOADS</span>
            <Badge>{open.length}</Badge>
          </div>
          {open.map((load) => (
            <article
              className={`load-card priority-${load.priority}`}
              key={load.id}
            >
              <div className="load-title">
                <div>
                  <b>{load.billNumber}</b>
                  <Badge
                    tone={
                      load.priority === "critical"
                        ? "red"
                        : load.priority === "high"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {load.priority}
                  </Badge>
                </div>
                <strong>{fmtMoney(load.rate)}</strong>
              </div>
              <div className="route-line">
                <span>
                  <i />
                  {load.origin}
                  <small>
                    {fmtTime(load.pickupStart)}–{fmtTime(load.pickupEnd)}
                  </small>
                </span>
                <ArrowRight />
                <span>
                  <i />
                  {load.destination}
                  <small>Due {fmtTime(load.deliveryEnd)}</small>
                </span>
              </div>
              <div className="load-meta">
                <span>
                  <Box />
                  {load.pallets} pallets
                </span>
                <span>
                  <Gauge />
                  {load.weightLbs.toLocaleString()} lb
                </span>
                <span>
                  <Truck />
                  {load.equipment}
                </span>
              </div>
              <button
                className="assign-action"
                onClick={() => setSelected(load)}
              >
                Find eligible unit <ArrowRight />
              </button>
            </article>
          ))}
          {!open.length && <p className="empty-state">No open loads match these filters.</p>}
        </section>
        <section className="board-column planned">
          <div className="column-head">
            <span>ACTIVE PLAN</span>
            <Badge tone="green">{assigned.length}</Badge>
          </div>
          {assigned.map((a) => {
            const load = state.loads.find((l) => l.id === a.loadId)!,
              driver = state.drivers.find((d) => d.id === a.driverId)!;
            return (
              <article className="assignment-card" key={a.id}>
                <div className="assignment-top">
                  <span className="avatar">{driver.initials}</span>
                  <div>
                    <b>{driver.name}</b>
                    <p>
                      Truck {a.truckId.replace("T-", "")} · {a.trailerId}
                    </p>
                  </div>
                  <Badge tone={a.status === "in_transit" ? "green" : "blue"}>
                    {statusLabel(a.status)}
                  </Badge>
                </div>
                <div className="assignment-load">
                  <b>{load.billNumber}</b>
                  <span>
                    {load.origin}
                    <ArrowRight />
                    {load.destination}
                  </span>
                </div>
                <div className="assignment-foot">
                  <span>
                    <Clock3 /> ETA {fmtTime(a.eta)}
                  </span>
                  <button disabled={a.status === "in_transit"} title={a.status === "in_transit" ? "An in-transit load cannot be unassigned" : undefined} onClick={() => unassign(load.id)}>Unassign</button>
                </div>
              </article>
            );
          })}
        </section>
        <section className="board-column resources">
          <div className="column-head">
            <span>AVAILABLE UNITS</span>
            <Badge>
              {state.drivers.filter((d) => d.status === "available").length}
            </Badge>
          </div>
          {state.drivers.map((d) => {
            const trailer = state.trailers.find((t) => t.id === d.trailerId)!;
            return (
              <article className={`resource-card ${d.status}`} key={d.id}>
                <div>
                  <span className="avatar">{d.initials}</span>
                  <div>
                    <b>{d.name}</b>
                    <p>
                      {d.id} · Truck {d.truckId.replace("T-", "")}
                    </p>
                  </div>
                  <i className="availability" />
                </div>
                <div className="resource-stats">
                  <span>
                    <small>LOCATION</small>
                    {d.location}
                  </span>
                  <span>
                    <small>DRIVING</small>
                    <b className={d.drivingHoursRemaining < 4 ? "risk" : ""}>
                      {d.drivingHoursRemaining.toFixed(1)} h
                    </b>
                  </span>
                  <span>
                    <small>EQUIPMENT</small>
                    {trailer.type}
                  </span>
                </div>
              </article>
            );
          })}
        </section>
      </div>
      {selected && (
        <AssignmentModal
          load={selected}
          drivers={state.drivers}
          candidateFor={ops.candidateFor}
          onClose={() => setSelected(null)}
          onAssign={(c) => {
            ops.assign(c);
            setSelected(null);
          }}
        />
      )}
      <PlanModal ops={ops} />
    </div>
  );
}

function LoadsPage({ ops, documents }: { ops: ReturnType<typeof useDispatchOperations>; documents: ReturnType<typeof useLoadDocuments> }) {
  const [creatingLoad, setCreatingLoad] = useState(false);
  const [query, setQuery] = useState(""),
    rows = ops.state.loads.filter((l) =>
      `${l.billNumber}${l.customer}${l.origin}${l.destination}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return (
    <div className="page fade-in">
      <div className="page-heading">
        <div>
          <p className="kicker">SYSTEM OF RECORD</p>
          <h1>Load board</h1>
          <p>
            Every order, appointment, assignment, and execution state in one
            view.
          </p>
        </div>
        <button className="btn primary" disabled={!ops.canManageDispatch} title={ops.canManageDispatch ? undefined : "Only dispatchers and admins can create loads"} onClick={() => setCreatingLoad(true)}>+ New load</button>
      </div>
      {creatingLoad && <NewLoadForm onCreate={ops.createLoad} onClose={() => setCreatingLoad(false)} />}
      <LoadDocumentsPanel documents={documents.documents} loads={ops.state.loads} signedIn={Boolean(ops.userEmail)} error={documents.error} />
      <section className="surface table-surface">
        <div className="table-toolbar">
          <div className="search">
            <Search />
            <input
              aria-label="Search all loads"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bill, customer, or city"
            />
          </div>
          <button className="btn secondary" disabled title="Advanced filters are planned for the next phase">
            <ListFilter />
            Filters
          </button>
        </div>
        <div className="data-table">
          <div className="table-row table-head">
            <span>LOAD</span>
            <span>ROUTE</span>
            <span>APPOINTMENT</span>
            <span>FREIGHT</span>
            <span>VALUE</span>
            <span>STATUS</span>
          </div>
          {rows.map((l) => (
            <div className="table-row" key={l.id}>
              <span>
                <b>{l.billNumber}</b>
                <small>{l.customer}</small>
              </span>
              <span>
                <b>{l.origin}</b>
                <small>→ {l.destination}</small>
              </span>
              <span>
                <b>
                  {fmtTime(l.pickupStart)}–{fmtTime(l.pickupEnd)}
                </b>
                <small>Delivery {fmtTime(l.deliveryEnd)}</small>
              </span>
              <span>
                <b>{l.weightLbs.toLocaleString()} lb</b>
                <small>
                  {l.pallets} pallets · {l.equipment}
                </small>
              </span>
              <span>
                <b>{fmtMoney(l.rate)}</b>
                <small>CAD</small>
              </span>
              <span>
                <Badge
                  tone={
                    l.status === "completed"
                      ? "green"
                      : l.status === "in_transit"
                        ? "blue"
                        : l.status === "unassigned"
                          ? "amber"
                          : "neutral"
                  }
                >
                  {statusLabel(l.status)}
                </Badge>
              </span>
            </div>
          ))}
          {!rows.length && <p className="empty-state">No loads match your search.</p>}
        </div>
      </section>
    </div>
  );
}

function FleetPage({ ops }: { ops: ReturnType<typeof useDispatchOperations> }) {
  const { state } = ops;
  return (
    <div className="page fade-in">
      <div className="page-heading">
        <div>
          <p className="kicker">CAPACITY & COMPLIANCE</p>
          <h1>Drivers and fleet</h1>
          <p>
            See location, equipment pairing, duty clock, and availability
            without changing systems.
          </p>
        </div>
      </div>
      <div className="fleet-cards">
        {state.drivers.map((d) => {
          const t = state.trailers.find((x) => x.id === d.trailerId)!;
          return (
            <article className="surface driver-card" key={d.id}>
              <div className="driver-head">
                <span className="avatar large">{d.initials}</span>
                <div>
                  <h3>{d.name}</h3>
                  <p>
                    {d.id} · Truck {d.truckId.replace("T-", "")} · {t.number}
                  </p>
                </div>
                <Badge tone={d.status === "available" ? "green" : "blue"}>
                  {d.status}
                </Badge>
              </div>
              <div className="location-line">
                <MapPin />
                {d.location}
                <small>
                  {d.nextAvailable === "Now"
                    ? "Available now"
                    : `Available ${d.nextAvailable}`}
                </small>
              </div>
              <div className="hos-grid">
                <div>
                  <small>DRIVING LEFT</small>
                  <strong>{d.drivingHoursRemaining.toFixed(1)}h</strong>
                  <i>
                    <b
                      style={{
                        width: `${(d.drivingHoursRemaining / 13) * 100}%`,
                      }}
                    />
                  </i>
                </div>
                <div>
                  <small>ON-DUTY LEFT</small>
                  <strong>{d.onDutyHoursRemaining.toFixed(1)}h</strong>
                  <i>
                    <b
                      style={{
                        width: `${(d.onDutyHoursRemaining / 14) * 100}%`,
                      }}
                    />
                  </i>
                </div>
                <div>
                  <small>CYCLE LEFT</small>
                  <strong>{d.cycleHoursRemaining.toFixed(1)}h</strong>
                  <i>
                    <b
                      style={{
                        width: `${(d.cycleHoursRemaining / 70) * 100}%`,
                      }}
                    />
                  </i>
                </div>
              </div>
              <div className="equipment-row">
                <span>
                  <Truck /> Truck {d.truckId.replace("T-", "")}
                </span>
                <span>
                  <Warehouse /> {t.type}
                </span>
                <span>
                  <ShieldCheck /> Pre-trip clear
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MapPage({ ops, intelligence }: { ops: ReturnType<typeof useDispatchOperations>; intelligence: ReturnType<typeof useRoadIntelligence> }) {
  const [sat, setSat] = useState(false),
    [truck, setTruck] = useState<string>(),
    [incidentId, setIncidentId] = useState<string>();
  const selected = ops.state.trucks.find((t) => t.id === truck),
    active = ops.state.assignments.find((a) => a.truckId === truck),
    incident = intelligence.traffic.incidents.find((item) => item.id === incidentId);
  return (
    <div className="map-page fade-in">
      <div className="map-toolbar">
        <div>
          <p className="kicker">TRACK & TRACE</p>
          <h1>Live fleet map</h1>
        </div>
        <div className="segmented">
          <button
            className={!sat ? "active" : ""}
            aria-pressed={!sat}
            onClick={() => setSat(false)}
          >
            Road
          </button>
          <button className={sat ? "active" : ""} aria-pressed={sat} onClick={() => setSat(true)}>
            Satellite
          </button>
        </div>
        <button
          className={`btn ${ops.simulationRunning ? "live-btn" : "secondary"}`}
          onClick={() => ops.setSimulationRunning(!ops.simulationRunning)}
        >
          {ops.simulationRunning ? (
            <>
              <Radio /> Live
            </>
          ) : (
            <>
              <Play /> Start simulator
            </>
          )}
        </button>
      </div>
      <div className="full-map">
        <Suspense fallback={<div className="module-loading"><Map /><b>Loading fleet map…</b></div>}>
          <FleetMap
            trucks={ops.state.trucks}
            assignments={ops.state.assignments}
            loads={ops.state.loads}
            facilities={ops.state.facilities}
            satellite={sat}
            selectedTruckId={truck}
            onSelectTruck={setTruck}
            incidents={intelligence.traffic.incidents}
            onSelectIncident={(id) => { setTruck(undefined); setIncidentId(id); }}
          />
        </Suspense>
        {incident && <aside className="map-detail incident-detail"><button className="close" aria-label="Close incident details" onClick={() => setIncidentId(undefined)}><X /></button><p className="kicker">{incident.source === "ontario-511" ? "ONTARIO 511" : "DEMO INCIDENT"}</p><h2>{incident.roadway}</h2><Badge tone={incident.severity === "critical" || incident.severity === "high" ? "red" : "amber"}>{incident.severity}</Badge><p>{incident.description}</p><div className="map-detail-grid"><span><small>DIRECTION</small><b>{incident.direction || "Not reported"}</b></span><span><small>TYPE</small><b>{incident.eventType}</b></span></div><button className="btn primary full" onClick={() => setIncidentId(undefined)}>Return to fleet map</button></aside>}
        {selected && (
          <aside className="map-detail">
            <button className="close" aria-label="Close truck details" onClick={() => setTruck(undefined)}>
              <X />
            </button>
            <p className="kicker">SELECTED ASSET</p>
            <h2>Truck {selected.number}</h2>
            <Badge tone={selected.status === "available" ? "green" : "blue"}>
              {selected.status}
            </Badge>
            <div className="map-detail-grid">
              <span>
                <small>SPEED</small>
                <b>{active?.speedKph || 0} km/h</b>
              </span>
              <span>
                <small>ODOMETER</small>
                <b>{Math.round(selected.odometerKm).toLocaleString()} km</b>
              </span>
              <span>
                <small>DISTANCE</small>
                <b>{Math.round(active?.distanceKm || 0)} km</b>
              </span>
              <span>
                <small>ETA</small>
                <b>{active ? fmtTime(active.eta) : "—"}</b>
              </span>
            </div>
            {active && (
              <>
                <h3>ROUTE PROGRESS</h3>
                <div className="progress big">
                  <i style={{ width: `${active.progress * 100}%` }} />
                </div>
                <p>{Math.round(active.progress * 100)}% complete</p>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function DetentionPage({
  ops,
}: {
  ops: ReturnType<typeof useDispatchOperations>;
}) {
  return (
    <div className="page fade-in">
      <div className="page-heading">
        <div>
          <p className="kicker">AUTOMATED REVENUE CAPTURE</p>
          <h1>Detention desk</h1>
          <p>
            Geofence timestamps become auditable dwell records and billable
            charges automatically.
          </p>
        </div>
        <div className="detention-total">
          <small>CAPTURED TODAY</small>
          <b>{fmtMoney(ops.metrics.detention)}</b>
        </div>
      </div>
      <div className="detention-grid">
        {ops.state.visits.map((v) => {
          const facility = ops.state.facilities.find(
              (f) => f.id === v.facilityId,
            )!,
            truck = ops.state.trucks.find((t) => t.id === v.truckId)!,
            billable = Math.max(0, v.dwellMinutes - facility.freeMinutes),
            charge = (billable * facility.detentionRate) / 60;
          return (
            <article className="surface visit-card" key={v.id}>
              <div className="visit-top">
                <span className={`clock-ring ${billable ? "billing" : ""}`}>
                  <Timer />
                </span>
                <div>
                  <Badge tone={billable ? "amber" : "green"}>
                    {v.departedAt
                      ? "Departed"
                      : billable
                        ? "Billing now"
                        : "Inside geofence"}
                  </Badge>
                  <h2>Truck {truck.number}</h2>
                  <p>{facility.name}</p>
                </div>
                <strong>{fmtMoney(charge)}</strong>
              </div>
              <div className="dwell-track">
                <i
                  style={{
                    width: `${Math.min(100, (v.dwellMinutes / 180) * 100)}%`,
                  }}
                />
                <b style={{ left: `${(facility.freeMinutes / 180) * 100}%` }} />
              </div>
              <div className="visit-stats">
                <span>
                  <small>ARRIVED</small>
                  {fmtTime(v.arrivedAt)}
                </span>
                <span>
                  <small>DWELL</small>
                  {Math.floor(v.dwellMinutes / 60)}h {v.dwellMinutes % 60}m
                </span>
                <span>
                  <small>FREE TIME</small>
                  {facility.freeMinutes} min
                </span>
                <span>
                  <small>BILLABLE</small>
                  {billable} min
                </span>
                <span>
                  <small>RATE</small>
                  {fmtMoney(facility.detentionRate)}/h
                </span>
              </div>
              {billable > 0 && (
                <div className="evidence">
                  <ShieldCheck />
                  <span>
                    <b>Evidence package ready</b>
                    <small>
                      Arrival time, departure status, facility, and rate
                      captured.
                    </small>
                  </span>
                  <details>
                    <summary>View record</summary>
                    <span>Arrived {fmtTime(v.arrivedAt)}{v.departedAt ? ` · Departed ${fmtTime(v.departedAt)}` : " · Still on site"} · {billable} billable minutes at {fmtMoney(facility.detentionRate)}/h.</span>
                  </details>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function DriverPage({
  ops,
  onNavigate,
  documents,
}: {
  ops: ReturnType<typeof useDispatchOperations>;
  onNavigate: (v: View) => void;
  documents: ReturnType<typeof useLoadDocuments>["documents"];
}) {
  const [showStopDetails, setShowStopDetails] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const assignment =
      (ops.driverId
        ? ops.state.assignments.find((a) => a.driverId === ops.driverId && a.status !== "completed")
        : ops.state.assignments.find((a) => a.driverId === "D-131")) ||
      (ops.memberRole === "driver" ? undefined : ops.state.assignments[0]),
    load = ops.state.loads.find((l) => l.id === assignment?.loadId),
    driver = ops.state.drivers.find((d) => d.id === assignment?.driverId);
  if (!assignment || !load || !driver) return <div className="page"><h1>Driver view</h1><p className="empty-state">{ops.actionError || "There is no active driver assignment."}</p></div>;
  const legalToDrive = driver.drivingHoursRemaining > 0 && driver.onDutyHoursRemaining > 0 && driver.cycleHoursRemaining > 0;
  return (
    <div className="driver-demo fade-in">
      <div className="phone">
        <header>
          <div className="driver-brand">
            <span className="brand-mark">
              <Truck />
            </span>
            <b>
              ROADSTAR<small>DRIVER</small>
            </b>
          </div>
          <span className="online">
            <i /> Online
          </span>
        </header>
        <div className="phone-main">
          <p className="kicker">TODAY’S ASSIGNMENT</p>
          <div className="driver-greeting">
            <h1>Hi, {driver.name.split(" ")[0]}</h1>
            <p>Drive safe. Your next stop is ready.</p>
          </div>
          <article className="mobile-load">
            <div>
              <Badge tone="green">{statusLabel(assignment.status)}</Badge>
              <b>{load.billNumber}</b>
            </div>
            <div className="mobile-route">
              <span>
                <i />
                <small>PICKUP · {fmtTime(load.pickupStart)}</small>
                <b>{load.origin}</b>
              </span>
              <em />
              <span>
                <i />
                <small>DELIVER BY · {fmtTime(load.deliveryEnd)}</small>
                <b>{load.destination}</b>
              </span>
            </div>
            <div className="mobile-meta">
              <span>
                <Box />
                <b>{load.pallets}</b>
                <small>Pallets</small>
              </span>
              <span>
                <Gauge />
                <b>{(load.weightLbs / 1000).toFixed(1)}k</b>
                <small>Pounds</small>
              </span>
              <span>
                <Truck />
                <b>{load.equipment}</b>
                <small>Equipment</small>
              </span>
            </div>
          </article>
          <div className="driver-actions">
            {assignment.status === "proposed" ||
            assignment.status === "dispatched" ? (
              <button
                className="accept"
                disabled={actionPending}
                onClick={async () => {
                  setActionPending(true);
                  await ops.updateAssignmentStatus(assignment.id, "accepted");
                  setActionPending(false);
                }}
              >
                <Check />
                {actionPending ? "Saving…" : "Accept load"}
              </button>
            ) : assignment.status === "accepted" ? (
              <button
                className="accept"
                disabled={actionPending}
                onClick={async () => {
                  setActionPending(true);
                  const started = await ops.updateAssignmentStatus(assignment.id, "in_transit");
                  if (started && !ops.userEmail) ops.setSimulationRunning(true);
                  setActionPending(false);
                }}
              >
                <Navigation />
                {actionPending ? "Starting…" : "Start route"}
              </button>
            ) : (
              <button className="accept" onClick={() => onNavigate("map")}>
                <Navigation />
                Open route
              </button>
            )}
            <button
              disabled={actionPending}
              onClick={async () => {
                if (assignment.status === "proposed" || assignment.status === "dispatched") {
                  setActionPending(true);
                  await ops.updateAssignmentStatus(assignment.id, "declined");
                  setActionPending(false);
                } else setShowStopDetails((visible) => !visible);
              }}
              aria-expanded={assignment.status === "proposed" || assignment.status === "dispatched" ? undefined : showStopDetails}
            >
              <MapPin />
              {assignment.status === "proposed" || assignment.status === "dispatched" ? "Decline load" : "Stop details"}
            </button>
          </div>
          {ops.actionError && <p className="driver-action-error" role="alert">{ops.actionError}</p>}
          {showStopDetails && <div className="driver-stop-details" role="status"><b>Next stop: {load.destination}</b><span>Deliver by {fmtTime(load.deliveryEnd)} · {load.description}</span></div>}
          {(assignment.status === "accepted" || assignment.status === "in_transit") && <PodCapture loadId={load.id} organizationId={ops.organizationId} signedIn={Boolean(ops.userEmail)} documents={documents} />}
          <section className="mobile-hos">
            <div>
              <p className="kicker">HOURS OF SERVICE</p>
              <Badge tone={legalToDrive ? "green" : "red"}>{legalToDrive ? "Legal to drive" : "HOS limit reached"}</Badge>
            </div>
            <div>
              <span>
                <small>DRIVING</small>
                <b>{driver.drivingHoursRemaining.toFixed(1)}h</b>
                <i>
                  <em
                    style={{
                      width: `${(driver.drivingHoursRemaining / 13) * 100}%`,
                    }}
                  />
                </i>
              </span>
              <span>
                <small>ON DUTY</small>
                <b>{driver.onDutyHoursRemaining.toFixed(1)}h</b>
                <i>
                  <em
                    style={{
                      width: `${(driver.onDutyHoursRemaining / 14) * 100}%`,
                    }}
                  />
                </i>
              </span>
            </div>
          </section>
        </div>
      </div>
      <aside className="driver-notes">
        <p className="kicker">RESPONSIVE DRIVER WORKFLOW</p>
        <h1>Dispatch reaches the cab instantly.</h1>
        <p>
          This focused interface lets a driver acknowledge the load, see
          appointment and freight details, open the route, and monitor practical
          HOS—without exposing the dispatcher’s full workspace.
        </p>
        <ul>
          <li>
            <Check />
            Assignment acceptance synchronized
          </li>
          <li>
            <Check />
            Duty and route state visible
          </li>
          <li>
            <Check />
            Designed as an installable PWA path
          </li>
        </ul>
      </aside>
    </div>
  );
}

function AuthModal({
  ops,
  onClose,
}: {
  ops: ReturnType<typeof useDispatchOperations>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("Sending secure link…");
    try {
      const error = await ops.sendMagicLink(email);
      setMessage(error || "Check your inbox for the RoadStar sign-in link.");
    } catch {
      setMessage("We could not send the link. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <form className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onSubmit={submit}>
        <button type="button" className="close" aria-label="Close account dialog" autoFocus onClick={onClose}>
          <X />
        </button>
        <span className="spark">
          <Database />
        </span>
        <p className="kicker">SECURE CLOUD SYNC</p>
        <h2 id="auth-title">
          {ops.userEmail ? "Dispatcher account" : "Connect your workspace"}
        </h2>
        {ops.userEmail ? (
          <>
            <p className="modal-sub">
              Signed in as {ops.userEmail}. Operational changes synchronize
              through Supabase Realtime.
            </p>
            <div className="sync-state">
              <i className={ops.syncStatus} />
              <span>
                <b>
                  {ops.syncStatus === "synced"
                    ? "All changes saved"
                    : `Sync status: ${ops.syncStatus}`}
                </b>
                <small>RoadStar organization workspace</small>
              </span>
            </div>
            <button
              type="button"
              className="btn secondary full"
              onClick={() => {
                void ops.signOut();
                onClose();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <p className="modal-sub">
              Enter your work email. Supabase will send a password-free sign-in
              link; local demo mode remains available.
            </p>
            <label className="auth-field">
              WORK EMAIL
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="dispatcher@roadstar.ca"
              />
            </label>
            <button className="btn primary full" type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Email me a secure link"}
            </button>
            {message && <p className="auth-message" role="status">{message}</p>}
          </>
        )}
      </form>
    </div>
  );
}

export default function App() {
  const ops = useDispatchOperations(),
    loadDocuments = useLoadDocuments(ops.organizationId),
    documentAlerts = useMemo(() => documentExceptions(loadDocuments.documents, ops.state.loads), [loadDocuments.documents, ops.state.loads]),
    intelligence = useRoadIntelligence(ops.state, documentAlerts),
    [view, setView] = useState<View>(() => {
      const requested = window.location.hash.slice(1) as View;
      return NAV.some((item) => item.id === requested) ? requested : "overview";
    }),
    [navOpen, setNavOpen] = useState(true),
    [authOpen, setAuthOpen] = useState(false),
    availableNav = useMemo(
      () => ops.memberRole === "driver"
        ? NAV.filter((item) => item.id === "driver" || item.id === "map")
        : NAV,
      [ops.memberRole],
    ),
    title = useMemo(
      () => availableNav.find((n) => n.id === view)?.label || "DispatchOS",
      [view, availableNav],
    );
  useEffect(() => {
    if (ops.memberRole === "driver" && view !== "driver" && view !== "map") setView("driver");
  }, [ops.memberRole, view]);
  useEffect(() => {
    document.title = `${title} · RoadStar DispatchOS`;
    // Never clobber a magic-link callback hash: auth-js reads it asynchronously
    // and would otherwise find the session already gone. userEmail is a
    // dependency so the route hash is restored once auth has settled.
    if (isAuthCallbackHash(window.location.hash)) return;
    window.history.replaceState(null, "", `#${view}`);
  }, [view, title, ops.userEmail]);
  useEffect(() => {
    const openLoadSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setView("loads");
      window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Search all loads"]')?.focus(), 0);
    };
    window.addEventListener("keydown", openLoadSearch);
    return () => window.removeEventListener("keydown", openLoadSearch);
  }, []);
  return (
    <div className={`app-shell ${navOpen ? "" : "nav-collapsed"}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Truck />
          </span>
          <b>
            ROADSTAR<small>DISPATCHOS</small>
          </b>
        </div>
        <nav>
          {availableNav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
              title={item.label}
              aria-current={view === item.id ? "page" : undefined}
            >
              <item.icon />
              <span>{item.label}</span>
              {item.id === "dispatch" && <i>{ops.metrics.open}</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="connection">
            <Database />
            <span>
              <b>
                {ops.userEmail
                  ? "Cloud workspace"
                  : isSupabaseConfigured
                    ? "Supabase ready"
                    : "Demo data mode"}
              </b>
              <small>
                {ops.userEmail
                  ? ops.syncStatus
                  : isSupabaseConfigured
                    ? "Sign in to sync"
                    : "Configure .env to connect"}
              </small>
            </span>
            <i />
          </div>
          <button onClick={() => window.confirm("Reset all local demo changes?") && ops.reset()}>
            <RefreshCw />
            <span>Reset demo</span>
          </button>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <button className="menu-btn" aria-label={navOpen ? "Collapse navigation" : "Expand navigation"} aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
            <Menu />
          </button>
          <div className="crumb">
            Operations <span>/</span> <b>{title}</b>
          </div>
          <div className="topbar-right">
            {ops.memberRole !== "driver" && <button className="global-search" aria-label="Search loads" onClick={() => {
              setView("loads");
              window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Search all loads"]')?.focus(), 0);
            }}>
              <Search />
              <span>Search anything</span>
              <kbd>Ctrl K</kbd>
            </button>}
            {ops.memberRole !== "driver" && <button className="alert-button" aria-label={`View ${intelligence.exceptions.filter((item) => !(ops.state.acknowledgedExceptionIds ?? []).includes(item.id)).length} active exceptions`} onClick={() => setView("intelligence")}>
              <AlertTriangle />
              <i>{intelligence.exceptions.filter((item) => !(ops.state.acknowledgedExceptionIds ?? []).includes(item.id)).length}</i>
            </button>}
            <button className="profile" onClick={() => setAuthOpen(true)}>
              <span>
                {ops.userEmail ? ops.userEmail.slice(0, 2).toUpperCase() : "SD"}
              </span>
              <div>
                <b>{ops.userEmail?.split("@")[0] || "Demo Dispatcher"}</b>
                <small>
                  {ops.userEmail
                    ? `${ops.memberRole ? statusLabel(ops.memberRole) : "Member"} · Cloud synchronized`
                    : "Local demo session"}
                </small>
              </div>
              <ChevronDown />
            </button>
          </div>
        </header>
        {ops.syncStatus === "conflict" && <div className="sync-conflict" role="alert"><AlertTriangle />Another dispatcher saved a newer workspace version. Your local edit was not overwritten.<button className="btn compact secondary" onClick={() => void ops.reloadCloud()}>Load latest cloud version</button></div>}
        {ops.userEmail && ops.memberRole === "viewer" && <div className="sync-conflict" role="status"><ShieldCheck />You are signed in with read-only access. Ask an administrator for dispatcher access to make changes.</div>}
        <div className="view-container">
          {view === "overview" && <Overview ops={ops} intelligence={intelligence} onNavigate={setView} />}{" "}
          {view === "dispatch" && <DispatchBoard ops={ops} />}{" "}
          {view === "loads" && <LoadsPage ops={ops} documents={loadDocuments} />}{" "}
          {view === "fleet" && <FleetPage ops={ops} />}{" "}
          {view === "map" && <MapPage ops={ops} intelligence={intelligence} />}{" "}
          {view === "detention" && <DetentionPage ops={ops} />}{" "}
          {view === "driver" && <DriverPage ops={ops} onNavigate={setView} documents={loadDocuments.documents} />}{" "}
          {view === "intelligence" && <IntelligenceWorkspace ops={ops} intelligence={intelligence} />}{" "}
          {view === "analytics" && <AnalyticsWorkspace ops={ops} />}{" "}
          {view === "integrations" && <IntegrationsWorkspace ops={ops} trafficLive={intelligence.traffic.source === "ontario-511"} />}{" "}
          {view === "loader" && (
            <Suspense
              fallback={
                <div className="module-loading">
                  <Layers3 />
                  <b>Loading 3D planner…</b>
                </div>
              }
            >
              <LoaderWorkspace onPersistCargo={(values) => ops.saveP1Record("cargo_items", values)} />
            </Suspense>
          )}
        </div>
      </main>
      {authOpen && <AuthModal ops={ops} onClose={() => setAuthOpen(false)} />}
    </div>
  );
}
