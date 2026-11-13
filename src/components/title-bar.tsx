import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopyDuotoneIcon as CopyIcon, MinusDuotoneIcon as MinusIcon, SquareDuotoneIcon as SquareIcon, XDuotoneIcon as XIcon } from "@thesvg/ui-react";
import { Button } from "@/components/ui/button";
import { useUnsavedWorkGuard } from "@/components/unsaved-work";
import { assetUrl } from "@/assets";

export function TitleBar() {
  const { requestAppClose } = useUnsavedWorkGuard();
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  const native = isTauri();
  useEffect(() => {
    if (!native) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = () => { void appWindow.isMaximized().then((value) => { if (!disposed) setMaximized(value); }).catch(() => {}); };
    update();
    void appWindow.onResized(update).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((reason) => {
      if (!disposed) setError(`Window status unavailable: ${String(reason)}`);
    });
    return () => { disposed = true; unlisten?.(); };
  }, [native]);
  const perform = (operation: Promise<void>) => { void operation.catch((reason) => setError(`Window control failed: ${String(reason)}`)); };
  const toggle = () => { if (native) perform(getCurrentWindow().toggleMaximize()); };
  if (!native) return null;
  return <header className="app-titlebar pointer-events-auto relative z-[60] flex h-10 shrink-0 select-none items-center border-b bg-background" aria-label="Application window"
    onPointerDown={(event) => event.stopPropagation()}>
    <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-4"
      onMouseDown={(event) => {
        if (!native || event.button !== 0) return;
        if (event.detail === 2) toggle();
        else perform(getCurrentWindow().startDragging());
      }}>
      <img src={assetUrl("app-icon.svg")} alt="" className="pointer-events-none size-5" />
      <span className="pointer-events-none truncate text-xs font-medium">EZPZ Label Studio</span>
    </div>
    {error && <span role="alert" className="max-w-72 truncate px-2 text-xs" title={error}>{error}</span>}
    <div className="flex h-full items-center" aria-label="Window controls">
      <Button variant="ghost" size="icon" className="h-full w-11 rounded-none" aria-label="Minimize window" title="Minimize" disabled={!native} onClick={() => { perform(getCurrentWindow().minimize()); }}><MinusIcon /></Button>
      <Button variant="ghost" size="icon" className="h-full w-11 rounded-none" aria-label={maximized ? "Restore window" : "Maximize window"} title={maximized ? "Restore" : "Maximize"} disabled={!native} onClick={toggle}>{maximized ? <CopyIcon /> : <SquareIcon />}</Button>
      <Button variant="ghost" size="icon" className="h-full w-11 rounded-none" aria-label="Close application" title="Close" onClick={requestAppClose}><XIcon /></Button>
    </div>
  </header>;
}
