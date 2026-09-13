import distance from "@turf/distance";
import { point } from "@turf/helpers";
import type { Coordinates } from "../types";

// Great-circle distance understates road distance, so every measured leg
// carries the same circuity correction. Applying it to a loaded trip but not
// to the deadhead understated deadhead, which is the heaviest weighted score
// component.
export const ROAD_CIRCUITY = 1.18;
// Practical Southern Ontario 400-series average including ramps and city legs.
export const AVERAGE_SPEED_KPH = 82;
// Loading or unloading one stop. Two stops therefore cost the 1.5 h of on-duty
// time the single-load optimizer has always assumed.
export const STOP_SERVICE_HOURS = 0.75;

export const kmBetween = (a: Coordinates, b: Coordinates) =>
  distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: "kilometers" }) * ROAD_CIRCUITY;

export const driveHours = (km: number) => km / AVERAGE_SPEED_KPH;
