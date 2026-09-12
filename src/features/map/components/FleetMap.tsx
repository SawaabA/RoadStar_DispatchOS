import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapInstance } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  Assignment,
  DispatchLoad,
  Facility,
  TruckAsset,
} from "../../dispatch/types";
import type { RoadIncident } from "../../intelligence/types";
import { fetchRoadRoute } from "../lib/routingProvider";

type Props = {
  trucks: TruckAsset[];
  assignments: Assignment[];
  loads: DispatchLoad[];
  facilities: Facility[];
  satellite: boolean;
  selectedTruckId?: string;
  onSelectTruck?: (id: string) => void;
  incidents?: RoadIncident[];
  onSelectIncident?: (id: string) => void;
};

const roadStyle = "https://tiles.openfreemap.org/styles/liberty";
const satelliteStyle = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri",
    },
  },
  layers: [{ id: "satellite", type: "raster" as const, source: "satellite" }],
};

export function FleetMap({
  trucks,
  assignments,
  loads,
  facilities,
  satellite,
  selectedTruckId,
  onSelectTruck,
  incidents = [],
  onSelectIncident,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<MapInstance | null>(null),
    markers = useRef<maplibregl.Marker[]>([]);
  const [roadRoutes, setRoadRoutes] = useState<Record<string, Array<[number, number]>>>({});
  const routeRequests = useMemo(() => assignments.flatMap((assignment) => {
    const load = loads.find((item) => item.id === assignment.loadId);
    return load ? [{ id: assignment.id, origin: load.originPoint, destination: load.destinationPoint }] : [];
  }), [assignments.map((item) => `${item.id}:${item.loadId}`).join("|"), loads.map((item) => `${item.id}:${item.originPoint.lng}:${item.originPoint.lat}:${item.destinationPoint.lng}:${item.destinationPoint.lat}`).join("|")]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(routeRequests.map(async (request) => ({
      id: request.id,
      route: await fetchRoadRoute(request.origin, request.destination, controller.signal),
    }))).then((results) => {
      if (controller.signal.aborted) return;
      setRoadRoutes(Object.fromEntries(results.filter((item) => item.route).map((item) => [item.id, item.route!.coordinates])));
    });
    return () => controller.abort();
  }, [routeRequests]);
  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: satellite ? satelliteStyle : roadStyle,
      center: [-79.75, 43.55],
      zoom: 7.2,
      maxBounds: [
        [-82.2, 42.2],
        [-77.8, 45.0],
      ],
    });
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.current = instance;
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (map.current)
      map.current.setStyle(satellite ? satelliteStyle : roadStyle);
  }, [satellite]);
  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    for (const truck of trucks) {
      const el = document.createElement("button");
      el.className = `truck-marker ${selectedTruckId === truck.id ? "selected" : ""}`;
      el.textContent = truck.number;
      el.title = `Truck ${truck.number}`;
      el.onclick = () => onSelectTruck?.(truck.id);
      markers.current.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([truck.point.lng, truck.point.lat])
          .addTo(map.current),
      );
    }
    for (const facility of facilities) {
      const el = document.createElement("div");
      el.className = "facility-marker";
      el.title = facility.name;
      markers.current.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([facility.point.lng, facility.point.lat])
          .addTo(map.current),
      );
    }
    for (const incident of incidents) {
      const el = document.createElement("button");
      el.className = `incident-marker ${incident.severity}`;
      el.setAttribute("aria-label", `${incident.roadway} ${incident.eventType}: ${incident.description}`);
      el.title = `${incident.roadway} · ${incident.description}`;
      el.textContent = "!";
      el.onclick = () => onSelectIncident?.(incident.id);
      markers.current.push(new maplibregl.Marker({ element: el })
        .setLngLat([incident.point.lng, incident.point.lat]).addTo(map.current));
    }
    const features = assignments.flatMap((a) => {
      const load = loads.find((l) => l.id === a.loadId);
      if (!load) return [];
      const roadRoute = roadRoutes[a.id];
      return [{
        type: "Feature" as const,
        properties: { id: a.id },
        geometry: {
          type: "LineString" as const,
          coordinates: roadRoute ?? [
            ...(a.breadcrumbs || [load.originPoint]).map((position) => [position.lng, position.lat] as [number, number]),
            [a.currentPoint.lng, a.currentPoint.lat] as [number, number],
            [load.destinationPoint.lng, load.destinationPoint.lat] as [number, number],
          ],
        },
      }];
    });
    const update = () => {
      const source = map.current?.getSource("routes") as
        | GeoJSONSource
        | undefined;
      if (source) source.setData({ type: "FeatureCollection", features });
      else if (map.current) {
        map.current.addSource("routes", {
          type: "geojson",
          data: { type: "FeatureCollection", features },
        });
        map.current.addLayer({
          id: "routes-line",
          type: "line",
          source: "routes",
          paint: {
            "line-color": "#2dd4bf",
            "line-width": 3,
            "line-opacity": 0.78,
            "line-dasharray": [2, 1],
          },
        });
      }
    };
    if (map.current.isStyleLoaded()) update();
    else map.current.once("style.load", update);
  }, [
    trucks,
    assignments,
    loads,
    facilities,
    selectedTruckId,
    onSelectTruck,
    satellite,
    incidents,
    onSelectIncident,
    roadRoutes,
  ]);
  const routedCount = Object.keys(roadRoutes).length;
  return <div className="fleet-map-shell" role="region" aria-label={`Fleet map with ${trucks.length} trucks, ${incidents.length} incidents, and ${routedCount} provider-routed movements. ${assignments.length - routedCount} movements use presentation geometry.`}>
    <div className="fleet-map" ref={container} />
    <span className={`route-mode ${routedCount ? "live" : "fallback"}`}>{routedCount ? "ROAD-ROUTED" : "PRESENTATION ROUTE"}</span>
  </div>;
}
