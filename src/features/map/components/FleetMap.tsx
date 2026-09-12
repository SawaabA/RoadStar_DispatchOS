import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapInstance } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  Assignment,
  DispatchLoad,
  Facility,
  TruckAsset,
} from "../../dispatch/types";

type Props = {
  trucks: TruckAsset[];
  assignments: Assignment[];
  loads: DispatchLoad[];
  facilities: Facility[];
  satellite: boolean;
  selectedTruckId?: string;
  onSelectTruck?: (id: string) => void;
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
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<MapInstance | null>(null),
    markers = useRef<maplibregl.Marker[]>([]);
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
    const features = assignments.flatMap((a) => {
      const load = loads.find((l) => l.id === a.loadId);
      if (!load) return [];
      return [{
        type: "Feature" as const,
        properties: { id: a.id },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            ...(a.breadcrumbs || [load.originPoint]).map((position) => [
              position.lng,
              position.lat,
            ]),
            [a.currentPoint.lng, a.currentPoint.lat],
            [load.destinationPoint.lng, load.destinationPoint.lat],
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
  ]);
  return <div className="fleet-map" ref={container} />;
}
