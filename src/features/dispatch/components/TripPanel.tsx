import { AlertTriangle, ArrowRight, Boxes, Clock3, Plus, X } from "lucide-react";
import type { Assignment } from "../types";
import { tripLoadIds } from "../lib/tripPlanning";
import { fmtKm, fmtMoney, fmtTime, statusLabel } from "../lib/format";
import type { DispatchOperations } from "../viewTypes";
import { CoLoadRow, StopSequence, TripCapacitySummary } from "./AssignmentPlanner";

const CONSOLIDATABLE: Array<Assignment["status"]> = ["proposed", "dispatched", "accepted"];

/**
 * One truck's whole trip: the freight on board, how full the trailer is, how
 * far and how long the run is, and the stop order the loads will be served in.
 */
export function TripCard({
  assignment,
  ops,
  onAddLoad,
}: {
  assignment: Assignment;
  ops: DispatchOperations;
  onAddLoad: (assignment: Assignment) => void;
}) {
  const { state } = ops;
  const driver = state.drivers.find((item) => item.id === assignment.driverId);
  const truck = state.trucks.find((item) => item.id === assignment.truckId);
  const trailer = state.trailers.find((item) => item.id === assignment.trailerId);
  const loads = tripLoadIds(assignment).flatMap((id) =>
    state.loads.filter((load) => load.id === id),
  );
  const plan = ops.tripPlanFor(assignment.id);
  if (!driver || !truck || !trailer || !loads.length) return null;
  const canConsolidate = CONSOLIDATABLE.includes(assignment.status);
  const rolling = assignment.status === "in_transit";

  return (
    <article className="trip-card">
      <div className="assignment-top">
        <span className="avatar">{driver.initials}</span>
        <div>
          <b>{driver.name}</b>
          <p>
            Truck {truck.number} · {trailer.number} {trailer.type} · {trailer.capacityLbs.toLocaleString()} lb
          </p>
        </div>
        <span className={`badge ${assignment.status === "in_transit" ? "green" : "blue"}`}>
          {statusLabel(assignment.status)}
        </span>
      </div>

      <div className="trip-loads">
        {loads.map((load, index) => (
          <div className="trip-load" key={load.id}>
            <span className="trip-load-index">{index + 1}</span>
            <div>
              <b>
                {load.billNumber}
                {index > 0 && <i className="consolidated">consolidated</i>}
              </b>
              <small>
                {load.origin}
                <ArrowRight />
                {load.destination} · {load.weightLbs.toLocaleString()} lb · {load.pallets} pallets
              </small>
            </div>
            <span className="trip-load-rate">{fmtMoney(load.rate, load.currency)}</span>
            <button
              disabled={rolling || !ops.canManageDispatch}
              title={
                rolling
                  ? "An in-transit trip cannot be changed"
                  : loads.length > 1
                    ? "Take this load off the trip; the rest keeps running"
                    : "Release this load and free the unit"
              }
              onClick={() => ops.unassign(load.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {plan && <TripCapacitySummary plan={plan} />}

      <div className="trip-foot">
        <span>
          <Clock3 /> Finishes {fmtTime(plan?.finishAt ?? assignment.eta)}
        </span>
        <span>
          {loads.length} load{loads.length === 1 ? "" : "s"} ·{" "}
          {fmtMoney(loads.reduce((sum, load) => sum + load.rate, 0))}
          {plan && plan.totalKm > 0 ? ` · ${fmtMoney(plan.revenuePerKm)}/km` : ""}
        </span>
        <button
          className="trip-add"
          disabled={!canConsolidate || !ops.canManageDispatch}
          title={
            canConsolidate
              ? "Consolidate another open load onto this truck"
              : "Freight can only be consolidated before the driver starts the route"
          }
          onClick={() => onAddLoad(assignment)}
        >
          <Plus />
          Add load
        </button>
      </div>

      {plan && plan.stops.length > 2 && (
        <details className="trip-sequence">
          <summary>
            Stop plan · {plan.stops.length} stops · {fmtKm(plan.totalKm)}
          </summary>
          <StopSequence plan={plan} />
        </details>
      )}
      {plan?.blockers.map((blocker) => (
        <p className="trip-alert" key={blocker.code + blocker.label}>
          <AlertTriangle />
          {blocker.label}
        </p>
      ))}
      {plan?.warnings.map((warning) => (
        <p className="trip-note" key={warning}>
          {warning}
        </p>
      ))}
    </article>
  );
}

export function AddLoadToTripModal({
  assignment,
  ops,
  onClose,
}: {
  assignment: Assignment;
  ops: DispatchOperations;
  onClose: () => void;
}) {
  const { state } = ops;
  const driver = state.drivers.find((item) => item.id === assignment.driverId);
  const truck = state.trucks.find((item) => item.id === assignment.truckId);
  const options = ops.coLoadCandidatesFor(assignment.id);
  const onTrip = tripLoadIds(assignment)
    .map((id) => state.loads.find((item) => item.id === id)?.billNumber ?? id)
    .join(" + ");

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
        aria-labelledby="coload-title"
      >
        <button className="close" aria-label="Close consolidation dialog" autoFocus onClick={onClose}>
          <X />
        </button>
        <p className="kicker">CONSOLIDATE FREIGHT</p>
        <h2 id="coload-title">
          <Boxes /> Add a load to Truck {truck?.number ?? assignment.truckId}
        </h2>
        <p className="modal-sub">
          {driver?.name ?? assignment.driverId} is carrying {onTrip}. Each open load below is
          re-sequenced against that trip, so the extra distance, the extra on-duty time and the
          resulting trailer fill are the real numbers, not an estimate.
        </p>
        <div className="coload-list">
          {options.map((option) => {
            const load = state.loads.find((item) => item.id === option.loadId);
            if (!load) return null;
            return (
              <CoLoadRow
                key={option.loadId}
                option={option}
                heading={`${load.billNumber} · ${load.origin} → ${load.destination}`}
                subheading={`${load.customer} · ${load.weightLbs.toLocaleString()} lb · ${load.pallets} pallets · ${load.equipment}${load.temperatureControlled ? " · temp controlled" : ""}`}
                disabled={!ops.canManageDispatch}
                onAdd={() => {
                  if (ops.addToTrip(assignment.id, load.id)) onClose();
                }}
              />
            );
          })}
          {!options.length && <p className="empty-state">There are no open loads to consolidate.</p>}
        </div>
      </section>
    </div>
  );
}
