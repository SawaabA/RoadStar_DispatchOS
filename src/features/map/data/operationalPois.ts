import type { Coordinates } from "../../dispatch/types";

export type OperationalPoi = {
  id: string;
  kind: "truck-stop" | "fuel-station";
  name: string;
  city: string;
  point: Coordinates;
  services: string[];
};

// Curated presentation locations. Replace this collection with a provider adapter
// when a production POI source is selected.
export const operationalPois: OperationalPoi[] = [
  { id: "TS-MIL", kind: "truck-stop", name: "Milton 401 Truck Stop", city: "Milton", point: { lat: 43.524, lng: -79.904 }, services: ["Truck parking", "Food", "Restrooms"] },
  { id: "TS-WOO", kind: "truck-stop", name: "Woodstock Highway Stop", city: "Woodstock", point: { lat: 43.126, lng: -80.746 }, services: ["Truck parking", "Showers", "Food"] },
  { id: "TS-KIN", kind: "truck-stop", name: "King City Service Centre", city: "King City", point: { lat: 43.929, lng: -79.526 }, services: ["Truck parking", "Food", "Restrooms"] },
  { id: "FS-LON", kind: "fuel-station", name: "London Fleet Fuel", city: "London", point: { lat: 42.966, lng: -81.188 }, services: ["Diesel", "DEF", "24 hours"] },
  { id: "FS-MIS", kind: "fuel-station", name: "Mississauga Fleet Fuel", city: "Mississauga", point: { lat: 43.633, lng: -79.659 }, services: ["Diesel", "DEF", "Cardlock"] },
  { id: "FS-PIC", kind: "fuel-station", name: "Pickering Fleet Fuel", city: "Pickering", point: { lat: 43.838, lng: -79.072 }, services: ["Diesel", "24 hours", "Convenience"] },
];
