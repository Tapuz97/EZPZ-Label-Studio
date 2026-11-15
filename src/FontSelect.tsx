import { useRef } from "react";
import { FormSelect } from "./components/form-select";
import { Button } from "./components/ui/button";
import { Spinner } from "./components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { Upload } from "./icons";
import { systemFonts, type CustomFont } from "./font-types";

export function FontSelect({ value, fonts, onChange, onAdd, busy, id, label = "Text font" }: {
  value: string;
  fonts: CustomFont[];
  onChange: (family: string) => void;
  onAdd: (files: File[]) => Promise<void>;
  busy: boolean;
  id?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const options = [...new Map(fonts.map(f => [f.family, f])).values()];
  return <div className="flex min-w-0 items-center gap-1">
    <div className="min-w-0 flex-1">
      <FormSelect id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        <optgroup label="Standard fonts">
          {systemFonts.map(font => <option key={font} value={font}>{font}</option>)}
        </optgroup>
        {!!options.length && <optgroup label="Your fonts">
          {options.map(font => <option key={font.family} value={font.family}>{font.name}</option>)}
        </optgroup>}
      </FormSelect>
    </div>
    <TooltipProvider><Tooltip><TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label="Add fonts" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <Upload />}
      </Button>
    </TooltipTrigger><TooltipContent>Add fonts · TTF, OTF, WOFF, WOFF2 · up to 2 MB each</TooltipContent></Tooltip></TooltipProvider>
    <input ref={input} type="file" accept=".ttf,.otf,.woff,.woff2" multiple className="hidden" aria-label="Upload font files" onChange={event => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length) void onAdd(files);
    }} />
  </div>;
}
