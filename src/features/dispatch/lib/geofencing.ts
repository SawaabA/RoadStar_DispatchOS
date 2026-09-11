import distance from "@turf/distance";
import { point } from "@turf/helpers";
import type {
  Coordinates,
  Facility,
  GeofenceVisit,
} from "../types";

const EXIT_BUFFER = 1.15;

export function updateGeofenceVisits(
  current: GeofenceVisit[],
  facilities: Facility[],
  truckId: string,
  location: Coordinates,
  now = Date.now(),
): GeofenceVisit[] {
  let visits = current;
  for (const facility of facilities) {
    const open = visits.find(
      (visit) =>
        visit.truckId === truckId &&
        visit.facilityId === facility.id &&
        !visit.departedAt,
    );
    const km = distance(
      point([location.lng, location.lat]),
      point([facility.point.lng, facility.point.lat]),
      { units: "kilometers" },
    );
    const inside = km <= facility.radiusKm * (open ? EXIT_BUFFER : 1);

    if (inside && !open) {
      visits = [
        ...visits,
        {
          id: `V-${now}-${facility.id}-${truckId}`,
          truckId,
          facilityId: facility.id,
          arrivedAt: new Date(now).toISOString(),
          dwellMinutes: 0,
        },
      ];
    } else if (!inside && open) {
      visits = visits.map((visit) =>
        visit.id === open.id
          ? { ...visit, departedAt: new Date(now).toISOString() }
          : visit,
      );
    }
  }
  return visits;
}
