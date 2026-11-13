import { useRef, useState } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import type { LabelElement } from "./model";
import { dragCrop, fullCrop, type Crop, type CropHandle } from "./crop";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./components/ui/dialog";

export function CropEditor({element,onApply,onClose}:{element:LabelElement;onApply:(crop:Crop)=>void;onClose:()=>void}) {
  const [crop,setCrop]=useState<Crop>(()=>({...element.crop??fullCrop}));
  const [ratio,setRatio]=useState(1),[loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false);
  const stage=useRef<HTMLDivElement>(null);
  const drag=useRef<{crop:Crop;handle:CropHandle;x:number;y:number;width:number;height:number}|null>(null);
  function start(event:PointerEvent,handle:CropHandle) {
    if(event.button!==0||!loaded)return;
    event.preventDefault();event.stopPropagation();
    const rect=stage.current!.getBoundingClientRect();
    drag.current={crop,handle,x:event.clientX,y:event.clientY,width:rect.width,height:rect.height};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent) {
    const d=drag.current;if(!d)return;
    setCrop(dragCrop(d.crop,d.handle,(event.clientX-d.x)/d.width,(event.clientY-d.y)/d.height,!event.shiftKey));
  }
  function keyboard(event:KeyboardEvent,handle:CropHandle) {
    const step=event.altKey?0.05:0.01;
    const direction=({ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]} as Record<string,number[]>)[event.key];
    if(!direction)return;event.preventDefault();event.stopPropagation();setCrop(dragCrop(crop,handle,direction[0],direction[1],!event.shiftKey));
  }
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Crop image</DialogTitle><DialogDescription>Corners keep proportions; hold Shift to crop freely. Side handles adjust one edge. Drag inside to move. Arrow keys adjust the focused handle; Alt takes larger steps.</DialogDescription></DialogHeader>
      <div className="flex justify-center rounded-md bg-muted p-4">
        <div ref={stage} data-testid="crop-stage" className="relative overflow-hidden select-none" style={{width:`min(100%, calc(50vh * ${ratio}))`,aspectRatio:ratio,touchAction:"none"}}>
          <img src={element.content} alt="Full source image for cropping" draggable={false} className="block size-full object-contain" onLoad={event=>{setRatio(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight);setLoaded(true);}} onError={()=>setFailed(true)}/>
          {loaded&&<div role="button" tabIndex={0} aria-label="Move crop selection" data-testid="crop-selection" className="absolute cursor-move border-2 border-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`,boxShadow:"0 0 0 9999px rgba(0,0,0,0.55)",touchAction:"none"}} onPointerDown={event=>start(event,"move")} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={event=>keyboard(event,"move")}>
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3" aria-hidden="true">{Array.from({length:9},(_,i)=><span key={i} className="border border-white/35"/>)}</div>
            {(["nw","n","ne","e","se","s","sw","w"] as const).map(handle=><button key={handle} type="button" aria-label={`Resize crop ${handle}`} className="absolute size-4 border-2 border-primary bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{
              ...(handle.includes("w")?{left:0}:handle.includes("e")?{right:0}:{left:"50%",transform:"translateX(-50%)"}),
              ...(handle.includes("n")?{top:0}:handle.includes("s")?{bottom:0}:{top:"50%",transform:"translateY(-50%)"}),
              cursor:handle==="n"||handle==="s"?"ns-resize":handle==="e"||handle==="w"?"ew-resize":handle==="nw"||handle==="se"?"nwse-resize":"nesw-resize",touchAction:"none"}} onPointerDown={event=>start(event,handle)} onPointerMove={move} onPointerUp={event=>{event.stopPropagation();drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={event=>keyboard(event,handle)}/>)}
          </div>}
        </div>
      </div>
      {failed&&<p role="alert">The source image could not be loaded.</p>}
      <p className="text-sm text-muted-foreground" aria-live="polite">Selected area: {Math.round(crop.width*100)}% × {Math.round(crop.height*100)}%</p>
      <DialogFooter><Button type="button" variant="ghost" onClick={()=>setCrop({...fullCrop})}>Reset crop</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!loaded||failed} onClick={()=>onApply(crop)}>Apply crop</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
