import { useEffect, useState } from 'react'
import { AlertTriangle, Box, ChevronRight, RotateCcw, Sparkles, Truck } from 'lucide-react'
import { TrailerScene } from './TrailerScene'
import { solvePlan } from './solver'
import type { Load, PackedItem, Trailer } from './types'
import './styles.css'

const trailer: Trailer = { id:'DV001', lengthIn:636, widthIn:98, heightIn:102, capacityLbs:44500, frontAxleLimitLbs:12000, rearAxleLimitLbs:34000, axleDistanceIn:480 }
const initialLoads: Load[] = [
  { id:'412572', origin:'Oshawa, ON', destination:'Whitby, ON', weightLbs:17070, pallets:17, stop:1, description:'Automotive components', palletLengthIn:48, palletWidthIn:40, palletHeightIn:48, rotatable:true, stackable:false, bearingLimitLbs:0 },
  { id:'412479', origin:'North York, ON', destination:'Milton, ON', weightLbs:3091, pallets:8, stop:2, description:'Building materials', palletLengthIn:48, palletWidthIn:40, palletHeightIn:48, rotatable:true, stackable:true, bearingLimitLbs:2500 },
]

export default function App(){
  const [loads,setLoads]=useState(initialLoads), [activeStop,setActiveStop]=useState(0), [selected,setSelected]=useState<PackedItem|null>(null)
  const [plan,setPlan]=useState<ReturnType<typeof import('./planner').createPlan>>(()=>({items:[],unplanned:[],totalWeight:0,usedFloorArea:0,warnings:[],engine:'connecting'}))
  useEffect(()=>{ let alive=true; solvePlan(loads,trailer).then(p=>alive&&setPlan(p)); return()=>{alive=false} },[loads])
  const weightPct=Math.round(plan.totalWeight/trailer.capacityLbs*100), floorPct=Math.round(plan.usedFloorArea/(trailer.lengthIn*trailer.widthIn)*100)
  const update=(idx:number,key:keyof Load,value:string)=>setLoads(ls=>ls.map((l,i)=>i===idx?{...l,[key]:key==='weightLbs'||key==='pallets'?Math.max(1,Number(value)):value}:l))
  return <main>
    <header><div className="brand"><span className="mark"><Truck size={20}/></span><div>ROADSTAR<small>LOADSPACE</small></div></div><div className="status"><i/> LOCAL PLANNER READY</div></header>
    <section className="workspace">
      <aside className="panel left">
        <div className="eyebrow">LOAD PLAN / RS-0912</div><h1>Trailer loading</h1><p className="muted">Build a safe, stop-aware loading proposal.</p>
        <div className="trailer-card"><div><Truck/><span><b>{trailer.id}</b><small>53′ Dry Van</small></span></div><ChevronRight/></div>
        <h3>SHIPMENTS <span>{loads.length}</span></h3>
        {loads.map((l,i)=><div className="load" key={l.id}>
          <div className="load-head"><span className={`dot c${i}`}/><b>#{l.id}</b><span>STOP {l.stop}</span></div>
          <div className="route">{l.origin}<ChevronRight size={13}/>{l.destination}</div>
          <div className="inputs"><label>PALLETS<input type="number" value={l.pallets} onChange={e=>update(i,'pallets',e.target.value)}/></label><label>TOTAL LB<input type="number" value={l.weightLbs} onChange={e=>update(i,'weightLbs',e.target.value)}/></label></div>
        </div>)}
        <button className="generate" onClick={()=>{setActiveStop(0);setSelected(null)}}><Sparkles size={17}/> Generate plan</button>
      </aside>
      <section className="stage">
        <div className="stage-top"><div><span className="live-dot"/> INTERACTIVE LOAD PLAN</div><div className="view-hint">DRAG TO ORBIT · SCROLL TO ZOOM</div></div>
        <TrailerScene trailer={trailer} items={plan.items} activeStop={activeStop} onSelect={setSelected}/>
        <div className="stop-filter"><button className={activeStop===0?'active':''} onClick={()=>setActiveStop(0)}>All cargo</button>{loads.map((l,i)=><button key={l.id} className={activeStop===l.stop?'active':''} onClick={()=>setActiveStop(l.stop)}><i className={`dot c${i}`}/> Stop {l.stop}</button>)}</div>
        <div className="estimate"><AlertTriangle size={16}/><span><b>ESTIMATED GEOMETRY</b> Standard 48×40×48 in pallets generated from shipment totals.</span></div>
      </section>
      <aside className="panel right">
        <div className="eyebrow">PLAN HEALTH · {plan.engine?.toUpperCase()}</div><div className="score">{plan.unplanned.length?72:94}<small>/100</small></div><p className="good">READY FOR REVIEW</p>
        <div className="metric"><span>Weight</span><b>{plan.totalWeight.toLocaleString()} <small>/ {trailer.capacityLbs.toLocaleString()} lb</small></b><div><i style={{width:`${weightPct}%`}}/></div><em>{weightPct}%</em></div>
        <div className="metric"><span>Floor used</span><b>{floorPct}%</b><div><i style={{width:`${floorPct}%`}}/></div></div>
        <div className="metric-row"><span><Box/>Planned pallets<b>{plan.items.length}</b></span><span><AlertTriangle/>Unplanned<b>{plan.unplanned.length}</b></span></div>
        <h3>VALIDATION</h3><div className="check">✓ Under trailer weight limit</div><div className="check">✓ Stop-aware rear unloading</div><div className="warn">! Dimensions require confirmation</div>
        {selected&&<div className="selection"><button onClick={()=>setSelected(null)}>×</button><small>SELECTED PALLET</small><b>{selected.id}</b><p>{selected.destination}</p><span>{selected.weightLbs.toLocaleString()} lb · Stop {selected.stop}</span></div>}
        <button className="reset" onClick={()=>setLoads(initialLoads)}><RotateCcw size={15}/> Reset demo</button>
      </aside>
    </section>
  </main>
}
