import type { Coordinates } from "../types";

// City-centre coordinates for the Southern Ontario service area. They are
// precise enough for deadhead and ETA estimates, not for dock-level routing.
// A document's origin or destination is matched against this list by exact
// name only; anything unmatched must be chosen by the dispatcher, so a load
// never receives coordinates a model guessed.
export const ONTARIO_CITIES: ReadonlyArray<{ name: string; point: Coordinates }> = [
  { name: "Ajax", point: { lat: 43.8509, lng: -79.0204 } },
  { name: "Aurora", point: { lat: 44.0065, lng: -79.4504 } },
  { name: "Barrie", point: { lat: 44.3894, lng: -79.6903 } },
  { name: "Belleville", point: { lat: 44.1628, lng: -77.3832 } },
  { name: "Bolton", point: { lat: 43.8758, lng: -79.7373 } },
  { name: "Brampton", point: { lat: 43.7315, lng: -79.7624 } },
  { name: "Brantford", point: { lat: 43.1394, lng: -80.2644 } },
  { name: "Burlington", point: { lat: 43.3255, lng: -79.799 } },
  { name: "Cambridge", point: { lat: 43.3616, lng: -80.3144 } },
  { name: "Chatham", point: { lat: 42.4048, lng: -82.191 } },
  { name: "Cobourg", point: { lat: 43.9593, lng: -78.1677 } },
  { name: "Collingwood", point: { lat: 44.5008, lng: -80.2169 } },
  { name: "Concord", point: { lat: 43.8, lng: -79.4833 } },
  { name: "Etobicoke", point: { lat: 43.6205, lng: -79.5132 } },
  { name: "Guelph", point: { lat: 43.5448, lng: -80.2482 } },
  { name: "Hamilton", point: { lat: 43.2557, lng: -79.8711 } },
  { name: "Kingston", point: { lat: 44.2312, lng: -76.486 } },
  { name: "Kitchener", point: { lat: 43.4516, lng: -80.4925 } },
  { name: "London", point: { lat: 42.9849, lng: -81.2453 } },
  { name: "Markham", point: { lat: 43.8561, lng: -79.337 } },
  { name: "Milton", point: { lat: 43.5183, lng: -79.8774 } },
  { name: "Mississauga", point: { lat: 43.589, lng: -79.6441 } },
  { name: "Newmarket", point: { lat: 44.0592, lng: -79.4613 } },
  { name: "Niagara Falls", point: { lat: 43.0896, lng: -79.0849 } },
  { name: "Oakville", point: { lat: 43.4675, lng: -79.6877 } },
  { name: "Orangeville", point: { lat: 43.9194, lng: -80.0943 } },
  { name: "Orillia", point: { lat: 44.6082, lng: -79.4197 } },
  { name: "Oshawa", point: { lat: 43.8971, lng: -78.8658 } },
  { name: "Peterborough", point: { lat: 44.3091, lng: -78.3197 } },
  { name: "Pickering", point: { lat: 43.8384, lng: -79.0868 } },
  { name: "Richmond Hill", point: { lat: 43.8828, lng: -79.4403 } },
  { name: "Sarnia", point: { lat: 42.9745, lng: -82.4066 } },
  { name: "Scarborough", point: { lat: 43.7731, lng: -79.2578 } },
  { name: "St. Catharines", point: { lat: 43.1594, lng: -79.2469 } },
  { name: "St. Thomas", point: { lat: 42.7792, lng: -81.1927 } },
  { name: "Stoney Creek", point: { lat: 43.2172, lng: -79.765 } },
  { name: "Stratford", point: { lat: 43.37, lng: -80.9822 } },
  { name: "Toronto", point: { lat: 43.6532, lng: -79.3832 } },
  { name: "Vaughan", point: { lat: 43.8563, lng: -79.5085 } },
  { name: "Waterloo", point: { lat: 43.4643, lng: -80.5204 } },
  { name: "Welland", point: { lat: 42.9922, lng: -79.2483 } },
  { name: "Whitby", point: { lat: 43.8975, lng: -78.9429 } },
  { name: "Windsor", point: { lat: 42.3149, lng: -83.0364 } },
  { name: "Woodstock", point: { lat: 43.1315, lng: -80.7467 } },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/,\s*(on|ont|ontario)\b.*$/, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

export function findOntarioCity(label: string | null | undefined) {
  if (!label) return null;
  const key = normalize(label);
  return ONTARIO_CITIES.find((city) => normalize(city.name) === key) ?? null;
}
