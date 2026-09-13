import { Canvas } from "@react-three/fiber";
import { ContactShadows, Edges, Html, OrbitControls } from "@react-three/drei";
import { useMemo, useState } from "react";
import type { PackedItem, Trailer } from "../types";

const SCALE = 0.02;
const stopColours = ["#4ee6a8", "#58a6ff", "#f8c35c", "#e77cff", "#ff735c", "#72d5e8"];

export type CameraView = "perspective" | "driver" | "top" | "side" | "rear";
export type ColorMode = "load" | "stop" | "weight" | "constraint";

function colourFor(item: PackedItem, mode: ColorMode, maximumWeight: number) {
  if (mode === "load") return item.color;
  if (mode === "stop") return stopColours[(Math.max(1, item.stop) - 1) % stopColours.length];
  if (mode === "constraint") return item.invalid ? "#ff4d4d" : item.estimated ? "#f8c35c" : "#4ee6a8";
  const ratio = Math.min(1, item.weightLbs / Math.max(1, maximumWeight));
  return `rgb(${Math.round(70 + ratio * 185)}, ${Math.round(210 - ratio * 125)}, 86)`;
}

function CargoPiece({ item, faded, colour, explodedOffset, showLabel, onSelect }: {
  item: PackedItem;
  faded: boolean;
  colour: string;
  explodedOffset: number;
  showLabel: boolean;
  onSelect: (item: PackedItem) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const length = item.length * SCALE;
  const height = item.height * SCALE;
  const width = item.width * SCALE;
  return <group position={[
    (item.x + item.length / 2) * SCALE,
    (item.z + item.height / 2) * SCALE + explodedOffset,
    (item.y + item.width / 2) * SCALE,
  ]}>
    <mesh castShadow onClick={(event) => { event.stopPropagation(); onSelect(item); }} onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}>
      <boxGeometry args={[length * 0.97, height * 0.97, width * 0.97]} />
      <meshStandardMaterial color={colour} transparent opacity={faded ? 0.08 : hovered ? 1 : 0.82} roughness={0.55} />
    </mesh>
    {!faded && <Edges color="#06110e" threshold={15} />}
    {(hovered || (showLabel && !faded)) && <Html center distanceFactor={12} position={[0, height / 2 + 0.1, 0]}>
      <div className={`float-label ${hovered ? "expanded" : "compact"}`}>{item.id}{hovered && <small>{item.weightLbs.toLocaleString()} lb · Stop {item.stop}</small>}</div>
    </Html>}
  </group>;
}

const cameraPositions: Record<CameraView, [number, number, number]> = {
  perspective: [8, 7, 10],
  driver: [-9, 3, 0],
  top: [0, 15, 0.01],
  side: [0, 4, 13],
  rear: [13, 4, 0],
};

export function TrailerScene({ trailer, items, activeStop, activeLayer, view, colorMode, exploded, showLabels, showAxleHeat, focusItem, onSelect }: {
  trailer: Trailer;
  items: PackedItem[];
  activeStop: number;
  activeLayer: number | "all";
  view: CameraView;
  colorMode: ColorMode;
  exploded: boolean;
  showLabels: boolean;
  showAxleHeat: boolean;
  focusItem?: PackedItem | null;
  onSelect: (item: PackedItem) => void;
}) {
  const length = trailer.lengthIn * SCALE;
  const width = trailer.widthIn * SCALE;
  const height = trailer.heightIn * SCALE;
  const layers = useMemo(() => [...new Set(items.map((item) => item.z))].sort((a, b) => a - b), [items]);
  const maximumWeight = Math.max(1, ...items.map((item) => item.weightLbs));
  const centreX = items.length ? items.reduce((sum, item) => sum + (item.x + item.length / 2) * item.weightLbs, 0) / Math.max(1, items.reduce((sum, item) => sum + item.weightLbs, 0)) : trailer.lengthIn / 2;
  const target: [number, number, number] = focusItem
    ? [(focusItem.x + focusItem.length / 2) * SCALE - length / 2, (focusItem.z + focusItem.height / 2) * SCALE, (focusItem.y + focusItem.width / 2) * SCALE - width / 2]
    : [0, 1, 0];
  return <Canvas camera={{ position: cameraPositions[view], fov: view === "perspective" ? 42 : 48 }} shadows>
    <color attach="background" args={["#07110f"]} />
    <ambientLight intensity={1.5} /><directionalLight position={[4, 10, 5]} intensity={2} castShadow />
    <group position={[-length / 2, 0, -width / 2]}>
      <mesh position={[length / 2, -0.035, width / 2]} receiveShadow><boxGeometry args={[length, 0.07, width]} /><meshStandardMaterial color="#24332f" /></mesh>
      {showAxleHeat && <><mesh position={[length * 0.25, -0.015, width / 2]}><boxGeometry args={[length / 2, 0.025, width]} /><meshBasicMaterial color="#3c86e8" transparent opacity={0.2} /></mesh><mesh position={[length * 0.75, -0.014, width / 2]}><boxGeometry args={[length / 2, 0.025, width]} /><meshBasicMaterial color="#e19b31" transparent opacity={0.2} /></mesh><mesh position={[centreX * SCALE, 0.12, width / 2]}><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color="#ffffff" emissive="#4ee6a8" emissiveIntensity={1.4} /></mesh></>}
      <mesh position={[length / 2, height / 2, width / 2]}><boxGeometry args={[length, height, width]} /><meshBasicMaterial transparent opacity={0} /><Edges color="#78948b" /></mesh>
      {items.map((item) => {
        const layerIndex = layers.indexOf(item.z);
        const faded = (activeStop > 0 && item.stop !== activeStop) || (activeLayer !== "all" && item.z !== activeLayer);
        return <CargoPiece key={item.id} item={item} faded={faded} colour={colourFor(item, colorMode, maximumWeight)} explodedOffset={exploded ? layerIndex * 0.35 : 0} showLabel={showLabels} onSelect={onSelect} />;
      })}
    </group>
    <gridHelper args={[18, 36, "#21443a", "#10241f"]} position={[0, -0.08, 0]} />
    <ContactShadows position={[0, -0.06, 0]} opacity={0.35} scale={18} blur={2} />
    <OrbitControls makeDefault target={target} minDistance={3} maxDistance={24} enableRotate={view === "perspective" || view === "driver"} />
  </Canvas>;
}
