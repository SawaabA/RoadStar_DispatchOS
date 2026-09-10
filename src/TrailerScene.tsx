import { Canvas } from '@react-three/fiber'
import { ContactShadows, Edges, Html, OrbitControls } from '@react-three/drei'
import { useState } from 'react'
import type { PackedItem, Trailer } from './types'

const SCALE = 0.02
function Pallet({ item, faded, onSelect }: { item: PackedItem; faded: boolean; onSelect: (i: PackedItem) => void }) {
  const [hovered, setHovered] = useState(false)
  const sx=item.length*SCALE, sy=item.height*SCALE, sz=item.width*SCALE
  return <group position={[(item.x+item.length/2)*SCALE, (item.z+item.height/2)*SCALE, (item.y+item.width/2)*SCALE]}>
    <mesh onClick={(e)=>{e.stopPropagation();onSelect(item)}} onPointerOver={(e)=>{e.stopPropagation();setHovered(true)}} onPointerOut={()=>setHovered(false)}>
      <boxGeometry args={[sx*.97, sy*.97, sz*.97]} />
      <meshStandardMaterial color={item.color} transparent opacity={faded ? .08 : hovered ? 1 : .82} roughness={.55} />
    </mesh>
    {!faded && <Edges color="#06110e" threshold={15}/>} 
    {hovered && !faded && <Html center distanceFactor={10}><div className="float-label">{item.id}<small>{item.weightLbs.toLocaleString()} lb · Stop {item.stop}</small></div></Html>}
  </group>
}

export function TrailerScene({ trailer, items, activeStop, onSelect }: { trailer: Trailer; items: PackedItem[]; activeStop: number; onSelect: (i: PackedItem) => void }) {
  const l=trailer.lengthIn*SCALE,w=trailer.widthIn*SCALE,h=trailer.heightIn*SCALE
  return <Canvas camera={{position:[8,7,10],fov:42}} shadows>
    <color attach="background" args={['#07110f']} />
    <ambientLight intensity={1.5}/><directionalLight position={[4,10,5]} intensity={2} castShadow/>
    <group position={[-l/2,0,-w/2]}>
      <mesh position={[l/2,-.035,w/2]} receiveShadow><boxGeometry args={[l,.07,w]}/><meshStandardMaterial color="#24332f"/></mesh>
      <mesh position={[l/2,h/2,w/2]}><boxGeometry args={[l,h,w]}/><meshBasicMaterial transparent opacity={0}/><Edges color="#78948b"/></mesh>
      {items.map(i=><Pallet key={i.id} item={i} faded={activeStop>0 && i.stop!==activeStop} onSelect={onSelect}/>) }
    </group>
    <gridHelper args={[18,36,'#21443a','#10241f']} position={[0,-.08,0]}/>
    <ContactShadows position={[0,-.06,0]} opacity={.35} scale={18} blur={2}/>
    <OrbitControls makeDefault target={[0,1,0]} minDistance={6} maxDistance={22}/>
  </Canvas>
}
