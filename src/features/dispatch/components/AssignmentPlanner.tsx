import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, Check, Clock3, Gauge, Route, Timer, Truck, X } from "lucide-react";
import type { DispatchCandidate, DispatchLoad } from "../types";
import type { CoLoadEvaluation, TripPlan } from "../lib/tripPlanning";
import { tripLoadIds } from "../lib/tripPlanning";
import { fmtDuration, fmtKm, fmtMoney, fmtTime, statusLabel } from "../lib/format";
import type { DispatchOperations } from "../viewTypes";

type UnitOption = {
  candidate: DispatchCandidate;
  plan: TripPlan;
  /** Both engines must agree: the scorer ranks, the trip plan re-checks reality. */
  eligible: boolean;
  blockers: string[];
  driverName: string;
  initials: string;
  driverId: string;
  truckNumber: string;
  trailerNumber: string;
  trailerType: string;
  location: string;
};

const pct = (value: number) => `${Math.round(value)}%`;
const fillTone = (value: number) => (value > 100 ? "over" : value > 85 ? "high" : "");

function Fill({ label, used, capacity, unit }: { label: string; used: number; capacity: number; unit: string }) {
  const value = capacity > 0 ? (used / capacity) * 100 : 0;
  return (
    <div className={`fill-meter ${fillTone(value)}`}>
      <span>
        {label}
        <b>{pct(value)}</b>
      </span>
      <i>
        <em style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </i>
      <small>
        {Math.round(used).toLocaleString()} / {Math.round(capacity).toLocaleString()} {unit}
      </small>
    </div>
  );
}

function StopSequence({ plan }: { plan: TripPlan }) {
  return (
    <ol className="stop-sequence">
      {plan.stops.map((stop, index) => (
        <li key={`${stop.loadId}-${stop.kind}-${index}`} className={stop.lateMinutes > 0 ? "late" : ""}>
          <span className={`stop-dot ${stop.kind}`}>{index + 1}</span>
          <div>
            <b>
              {stop.kind === "pickup" ? "Pick up" : "Deliver"} {stop.billNumber}
            </b>
            <small>
              {stop.location} · {fmtKm(stop.legKm)} leg · arrive {fmtTime(stop.arrivalAt)}
              {stop.kind === "pickup" && stop.windowStart
                ? ` (window ${fmtTime(stop.windowStart)}–${fmtTime(stop.windowEnd)})`
                : ` (due ${fmtTime(stop.windowEnd)})`}
            </small>
          </div>
          <span className="stop-state">
            {stop.lateMinutes > 0
              ? `${stop.lateMinutes} min late`
              : stop.waitMinutes > 0
                ? `${stop.waitMinutes} min wait`
                : `${stop.slackMinutes} min spare`}
            <small>
              {Math.round(stop.onBoardLbs).toLocaleString()} lb · {stop.onBoardPallets} pallets on board
            </small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AssignmentPlanner({
  load,
  ops,
  onClose,
}: {
  load: DispatchLoad;
  ops: DispatchOperations;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"new" | "consolidate">("new");
  const { state } = ops;

  const units = useMemo<UnitOption[]>(
    () =>
      state.drivers
        .flatMap((driver) => {
          const candidate = ops.candidateFor(load.id, driver.id);
          const plan = ops.soloTripPlanFor(load.id, driver.id);
          const truck = state.trucks.find((item) => item.id === driver.truckId);
          const trailer = state.trailers.find((item) => item.id === driver.trailerId);
          if (!candidate || !plan || !trailer) return [];
          // The stop plan sees costs the score does not, such as on-duty time
          // spent waiting for an appointment window to open.
          const blockers = [
            ...new Set([
              ...candidate.reasons.map((reason) => reason.label),
              ...plan.blockers.map((blocker) => blocker.label),
            ]),
          ];
          return [
            {
              candidate,
              plan,
              eligible: candidate.feasible && plan.feasible,
              blockers,
              driverId: driver.id,
              driverName: driver.name,
              initials: driver.initials,
              truckNumber: truck?.number ?? driver.truckId.replace("T-", ""),
              trailerNumber: trailer.number,
              trailerType: trailer.type,
              location: driver.location,
            },
          ];
        })
        .sort(
          (left, right) =>
            Number(right.eligible) - Number(left.eligible) ||
            right.candidate.score - left.candidate.score,
        ),
    [state, load.id, ops],
  );

  const coLoads = useMemo(() => ops.coLoadOptionsFor(load.id), [ops, load.id]);
  const feasibleUnits = units.filter((unit) => unit.eligible).length;
  const feasibleCoLoads = coLoads.filter((option) => option.feasible).length;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <section
        className="modal planner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-title"
      >
        <button className="close" aria-label="Close assignment dialog" autoFocus onClick={onClose}>
          <X />
        </button>
        <p className="kicker">MANUAL DISPATCH</p>
        <h2 id="assignment-title">
          {load.billNumber} · {load.origin} → {load.destination}
        </h2>
        <div className="planner-load-facts">
          <span>
            <small>APPOINTMENTS</small>
            <b>
              Pickup {fmtTime(load.pickupStart)}–{fmtTime(load.pickupEnd)} · deliver by{" "}
              {fmtTime(load.deliveryEnd)}
            </b>
          </span>
          <span>
            <small>FREIGHT</small>
            <b>
              {load.weightLbs.toLocaleString()} lb · {load.pallets} pallets · {load.equipment}
              {load.temperatureControlled ? " · temp controlled" : ""}
            </b>
          </span>
          <span>
            <small>REVENUE</small>
            <b>{fmtMoney(load.rate, load.currency)}</b>
          </span>
          <span>
            <small>PRIORITY</small>
            <b>{load.priority}</b>
          </span>
        </div>
        <div className="segmented planner-tabs" role="group" aria-label="Assignment approach">
          <button
            className={mode === "new" ? "active" : ""}
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            New trip <i>{feasibleUnits} eligible</i>
          </button>
          <button
            className={mode === "consolidate" ? "active" : ""}
            aria-pressed={mode === "consolidate"}
            onClick={() => setMode("consolidate")}
          >
            Add to a running trip <i>{feasibleCoLoads} fit</i>
          </button>
        </div>

        {mode === "new" ? (
          <>
            <p className="modal-sub">
              Every unit is checked for equipment, trailer capacity, pallet positions, appointment
              windows and Canadian HOS before it can be dispatched.
            </p>
            <div className="unit-list">
              {units.map((unit) => {
                const pickup = unit.plan.stops[0];
                const weightFill = (load.weightLbs / unit.plan.capacityLbs) * 100;
                return (
                  <article className={`unit-card ${unit.eligible ? "" : "blocked"}`} key={unit.driverId}>
                    <header>
                      <i className="avatar">{unit.initials}</i>
                      <div>
                        <b>{unit.driverName}</b>
                        <small>
                          Truck {unit.truckNumber} · {unit.trailerNumber} {unit.trailerType} ·{" "}
                          {unit.location}
                        </small>
                      </div>
                      <span className="unit-score">
                        <strong>{unit.eligible ? unit.candidate.score : "—"}</strong>
                        <small>{unit.eligible ? "MATCH" : "BLOCKED"}</small>
                      </span>
                      <button
                        disabled={!unit.eligible || !ops.canManageDispatch}
                        className="btn compact primary"
                        onClick={() => {
                          ops.assign(unit.candidate);
                          onClose();
                        }}
                      >
                        Assign
                      </button>
                    </header>
                    <div className="unit-stats">
                      <span>
                        <small>DEADHEAD</small>
                        <b>{fmtKm(unit.candidate.deadheadKm)}</b>
                        <em>{fmtDuration(unit.candidate.pickupEtaMinutes / 60)} out</em>
                      </span>
                      <span>
                        <small>AT PICKUP</small>
                        <b>{pickup ? fmtTime(pickup.arrivalAt) : "—"}</b>
                        <em>
                          {pickup
                            ? pickup.lateMinutes > 0
                              ? `${pickup.lateMinutes} min after close`
                              : `${pickup.slackMinutes} min before close`
                            : "no plan"}
                        </em>
                      </span>
                      <span>
                        <small>TRIP DISTANCE</small>
                        <b>{fmtKm(unit.plan.totalKm)}</b>
                        <em>{fmtKm(unit.plan.emptyKm)} empty</em>
                      </span>
                      <span>
                        <small>TRIP TIME</small>
                        <b>{fmtDuration(unit.plan.onDutyHours)}</b>
                        <em>{fmtDuration(unit.plan.drivingHours)} driving</em>
                      </span>
                      <span>
                        <small>TRAILER FILL</small>
                        <b>{pct(weightFill)} weight</b>
                        <em>
                          {load.pallets} / {unit.plan.palletPositions} positions
                        </em>
                      </span>
                      <span>
                        <small>HOS AFTER</small>
                        <b className={unit.plan.hosRemainingAfter < 1 ? "risk" : ""}>
                          {unit.plan.hosRemainingAfter.toFixed(1)} h
                        </b>
                        <em>{fmtMoney(unit.plan.revenuePerKm)}/km</em>
                      </span>
                    </div>
                    <details className="unit-detail">
                      <summary>
                        {unit.eligible
                          ? "Why this unit, stop by stop"
                          : `Blocked: ${unit.blockers.join(" · ")}`}
                      </summary>
                      <div className="score-breakdown">
                        <span>
                          Deadhead <b>{Math.round(unit.candidate.scoreBreakdown.deadhead)}</b>
                        </span>
                        <span>
                          On-time <b>{Math.round(unit.candidate.scoreBreakdown.onTime)}</b>
                        </span>
                        <span>
                          HOS buffer <b>{Math.round(unit.candidate.scoreBreakdown.hosBuffer)}</b>
                        </span>
                        <span>
                          Future position{" "}
                          <b>{Math.round(unit.candidate.scoreBreakdown.futurePosition)}</b>
                        </span>
                      </div>
                      <StopSequence plan={unit.plan} />
                      {unit.plan.warnings.map((warning) => (
                        <p className="planner-warning" key={warning}>
                          <AlertTriangle />
                          {warning}
                        </p>
                      ))}
                    </details>
                  </article>
                );
              })}
              {!units.length && <p className="empty-state">No driver, truck and trailer pairing exists yet.</p>}
            </div>
          </>
        ) : (
          <>
            <p className="modal-sub">
              Consolidation keeps one truck and one trailer. RoadStar re-sequences every stop, then
              shows the extra distance, the extra on-duty time, and how full the trailer ends up.
            </p>
            <div className="coload-list">
              {coLoads.map((option) => {
                const assignment = state.assignments.find(
                  (item) => item.id === option.assignmentId,
                );
                if (!assignment) return null;
                const driver = state.drivers.find((item) => item.id === assignment.driverId);
                const truck = state.trucks.find((item) => item.id === assignment.truckId);
                const onTrip = tripLoadIds(assignment)
                  .map(
                    (id) => state.loads.find((item) => item.id === id)?.billNumber ?? id,
                  )
                  .join(" + ");
                return (
                  <CoLoadRow
                    key={option.assignmentId}
                    option={option}
                    heading={`Truck ${truck?.number ?? assignment.truckId} · ${driver?.name ?? assignment.driverId}`}
                    subheading={`${statusLabel(assignment.status)} · carrying ${onTrip}`}
                    disabled={!ops.canManageDispatch}
                    onAdd={() => {
                      if (ops.addToTrip(option.assignmentId, load.id)) onClose();
                    }}
                  />
                );
              })}
              {!coLoads.length && (
                <p className="empty-state">
                  No trip is open for consolidation. Trips can take extra freight until the driver
                  starts the route.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function CoLoadRow({
  option,
  heading,
  subheading,
  disabled,
  onAdd,
}: {
  option: CoLoadEvaluation;
  heading: string;
  subheading: string;
  disabled?: boolean;
  onAdd: () => void;
}) {
  const corridorTone =
    option.corridor === "same" ? "green" : option.corridor === "adjacent" ? "amber" : "red";
  return (
    <article className={`coload-row ${option.feasible ? "" : "blocked"}`}>
      <header>
        <div>
          <b>{heading}</b>
          <small>{subheading}</small>
        </div>
        <span className={`badge ${corridorTone}`}>
          {option.corridor === "same"
            ? "same corridor"
            : option.corridor === "adjacent"
              ? "adjacent corridor"
              : "off corridor"}
        </span>
        <span className="coload-score">
          <strong>{option.feasible ? option.score : "—"}</strong>
          <small>{option.feasible ? "FIT" : "BLOCKED"}</small>
        </span>
      </header>
      <div className="coload-deltas">
        <span>
          <Route />
          <b>+{fmtKm(option.addedKm)}</b>
          <small>added distance · trip becomes {fmtKm(option.combined.totalKm)}</small>
        </span>
        <span>
          <Timer />
          <b>+{option.addedMinutes} min</b>
          <small>added on-duty time · finishes {fmtTime(option.combined.finishAt)}</small>
        </span>
        <span>
          <ArrowRight />
          <b>{Math.round(option.destinationSpreadKm)} km</b>
          <small>between the two delivery points</small>
        </span>
        <span>
          <Clock3 />
          <b>{option.hosAfterHours.toFixed(1)} h</b>
          <small>HOS left after the last stop</small>
        </span>
      </div>
      <div className="coload-fills">
        <Fill label="Weight" used={option.weightAfterLbs} capacity={option.combined.capacityLbs} unit="lb" />
        <Fill
          label="Pallet positions"
          used={option.palletsAfter}
          capacity={option.combined.palletPositions}
          unit="pallets"
        />
      </div>
      <p className={option.feasible ? "coload-why" : "coload-why blocked-why"}>
        {option.feasible ? <Check /> : <AlertTriangle />}
        {option.explanation}
      </p>
      {option.warnings.map((warning) => (
        <p className="planner-warning" key={warning}>
          <AlertTriangle />
          {warning}
        </p>
      ))}
      <details className="unit-detail">
        <summary>Re-sequenced stop plan</summary>
        <StopSequence plan={option.combined} />
      </details>
      <footer>
        <span className="coload-revenue">
          <Gauge />
          {fmtMoney(option.addedRevenue)} added revenue ·{" "}
          {option.addedKm > 0 ? `${fmtMoney(option.revenuePerAddedKm)}/added km` : "no added distance"}
        </span>
        <button className="btn compact primary" disabled={!option.feasible || disabled} onClick={onAdd}>
          <Boxes />
          Add to this trip
        </button>
      </footer>
    </article>
  );
}

export function TripCapacitySummary({ plan }: { plan: TripPlan }) {
  return (
    <div className="trip-capacity">
      <Fill label="Weight" used={plan.peakWeightLbs} capacity={plan.capacityLbs} unit="lb" />
      <Fill
        label="Pallet positions"
        used={plan.peakPallets}
        capacity={plan.palletPositions}
        unit="pallets"
      />
      <div className="trip-distance">
        <span>
          <Truck />
          <b>{fmtKm(plan.totalKm)}</b>
          <small>{fmtKm(plan.emptyKm)} empty</small>
        </span>
        <span>
          <Clock3 />
          <b>{fmtDuration(plan.onDutyHours)}</b>
          <small>on duty · {fmtDuration(plan.drivingHours)} driving</small>
        </span>
      </div>
    </div>
  );
}

export { StopSequence };
