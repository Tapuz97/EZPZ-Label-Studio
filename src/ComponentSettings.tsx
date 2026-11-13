import { useId, useRef, useState } from "react";
import { CropEditor } from "./CropEditor";
import type { LabelElement } from "./model";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";
import { Button } from "./components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./components/ui/field";

export function ComponentSettings({element: e,onChange,onError}: {
  element: LabelElement;
  onChange: (patch: Partial<LabelElement>)=>void;
  onError: (error: unknown)=>void;
}) {
  const id=useId(), file=useRef<HTMLInputElement>(null), selected=useRef(e.id);
  selected.current=e.id;
  const [loading,setLoading]=useState(false);
  const [cropping,setCropping]=useState(false);
  const flag=(label:string,checked:boolean,patch:(value:boolean)=>Partial<LabelElement>,key:string)=>(
    <Field orientation="horizontal" key={key}>
      <Checkbox id={`${id}-${key}`} checked={checked} onCheckedChange={value=>onChange(patch(value===true))}/>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
    </Field>
  );
  async function uploadLogo(source?:File) {
    if(!source)return;
    const owner=e.id;
    setLoading(true);
    try{
      if(!/^image\/(png|jpeg|webp)$/.test(source.type))throw Error("Choose a PNG, JPEG or WebP logo.");
      if(source.size>8_000_000)throw Error("Choose a logo smaller than 8 MB.");
      const bitmap=await createImageBitmap(source);
      try{
        if(bitmap.width*bitmap.height>40_000_000)throw Error("Logo exceeds 40 million pixels.");
        const ratio=Math.min(1,256/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
        canvas.getContext("2d")!.drawImage(bitmap,0,0,canvas.width,canvas.height);
        if(selected.current===owner)onChange({qrLogo:canvas.toDataURL("image/png"),qrShowLogo:true});
      }finally{bitmap.close();}
    }catch(error){onError(error);}finally{setLoading(false);if(file.current)file.current.value="";}
  }
  return <FieldGroup>
    {["text","qr","barcode"].includes(e.kind)&&<Field>
      <FieldLabel htmlFor={`${id}-data`}>Component ID</FieldLabel>
      <Input id={`${id}-data`} value={e.dataId??""} maxLength={120} placeholder="e.g. name" onChange={event=>onChange({dataId:event.target.value.replace(/[\r\n]/g,"")})}/>
      <FieldDescription>Use the matching CSV column. Leave empty for fixed content.</FieldDescription>
    </Field>}
    {e.kind==="qr"&&<>
      {flag("Show QR background",e.qrBackground!==false,qrBackground=>({qrBackground}),"background")}
      {flag("Show center logo",!!e.qrShowLogo,qrShowLogo=>({qrShowLogo}),"logo")}
      <Field>
        <FieldLabel htmlFor={`${id}-logo-file`}>Center logo</FieldLabel>
        <Input ref={file} id={`${id}-logo-file`} type="file" accept="image/png,image/jpeg,image/webp" disabled={loading} onChange={event=>void uploadLogo(event.target.files?.[0])}/>
        {e.qrLogo&&<><img src={e.qrLogo} alt="Uploaded QR center logo" className="size-12 object-contain"/><Button type="button" variant="ghost" size="sm" onClick={()=>onChange({qrLogo:"",qrShowLogo:false})}>Remove logo</Button></>}
        <FieldDescription>{loading?"Preparing logo…":"Logo prints in monochrome. Check that your finished QR code scans."}</FieldDescription>
      </Field>
    </>}
    {e.kind==="barcode"&&flag("Show barcode numbers",e.barcodeShowText!==false,barcodeShowText=>({barcodeShowText}),"numbers")}
    {(e.kind==="line"||e.kind==="rect")&&<Field>
      <FieldLabel htmlFor={`${id}-stroke`}>Thickness (mm)</FieldLabel>
      <Input id={`${id}-stroke`} type="number" min={0.05} max={10} step={0.05} value={e.strokeWidth??0.2} onChange={event=>{const n=event.target.valueAsNumber;if(Number.isFinite(n))onChange({strokeWidth:Math.max(0.05,Math.min(10,n))});}}/>
    </Field>}
    {e.kind==="image"&&<>
      <Button type="button" variant="outline" onClick={()=>setCropping(true)}>Crop image</Button>
      {cropping&&<CropEditor key={e.id} element={e} onClose={()=>setCropping(false)} onApply={crop=>{onChange({crop});setCropping(false);}}/>}
    </>}
  </FieldGroup>;
}
