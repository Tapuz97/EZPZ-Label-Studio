import { useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "@/icons";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  resetKey?: string;
  className?: string;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  toolbar?: ReactNode;
  creatorBar?: ReactNode;
  caption?: ReactNode;
  grid?: boolean;
};

/** View transforms only: children retain their physical document dimensions. */
export function ArtworkViewport({
  children,
  resetKey,
  className,
  zoom: controlledZoom,
  onZoomChange,
  toolbar,
  creatorBar,
  caption,
  grid = false,
}: Props) {
  const [localZoom, setLocalZoom] = useState(100);
  const zoom = controlledZoom ?? localZoom;
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  function setZoom(value: number) {
    const next = Math.max(50, Math.min(200, value));
    setLocalZoom(next);
    onZoomChange?.(next);
  }
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    gesture.current = null;
    setPanning(false);
  }, [resetKey]);
  useEffect(() => {
    const updateFit = () => {
      if (!surface.current || !content.current) return;
      const width = content.current.offsetWidth,
        height = content.current.offsetHeight;
      if (width && height)
        setFitScale(
          Math.max(
            0.05,
            Math.min(
              1,
              (surface.current.clientWidth - 56) / width,
              (surface.current.clientHeight - 56) / height,
            ),
          ),
        );
    };
    const observer = new ResizeObserver(updateFit);
    if (surface.current) observer.observe(surface.current);
    if (content.current) observer.observe(content.current);
    updateFit();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const next = Math.max(
        50,
        Math.min(200, zoom + (event.deltaY < 0 ? 25 : -25)),
      );
      if (next === zoom) return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      const ratio = next / zoom;
      setPan((previous) => ({
        x: x - (x - previous.x) * ratio,
        y: y - (y - previous.y) * ratio,
      }));
      setZoom(next);
    };
    // A non-passive listener prevents the page/WebView itself from scrolling.
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom, onZoomChange]);
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      data-artwork-viewport
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {toolbar ?? (
            <span className="text-xs text-muted-foreground">Preview</span>
          )}
        </div>
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Preview zoom"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom <= 50}
            onClick={() => setZoom(zoom - 25)}
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-16 tabular-nums"
            aria-label="Reset preview view"
            title="Reset zoom and position"
            onClick={() => {
              setZoom(100);
              setPan({ x: 0, y: 0 });
            }}
          >
            {zoom}%
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom >= 200}
            onClick={() => setZoom(zoom + 25)}
          >
            <Plus />
          </Button>
        </div>
      </div>
      {creatorBar && (
        <div className="shrink-0 border-b bg-card px-3 py-2">{creatorBar}</div>
      )}
      <div
        className="relative grid min-h-36 min-w-0 flex-1 place-items-center overflow-hidden"
        data-artwork-pan-surface
        ref={surface}
        style={{
          cursor: panning ? "grabbing" : undefined,
          backgroundImage: grid
            ? "radial-gradient(var(--border) 0.7px, transparent 0.7px)"
            : undefined,
          backgroundSize: grid ? "13px 13px" : undefined,
        }}
        onPointerDownCapture={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            ...pan,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (!active || active.pointerId !== event.pointerId) return;
          event.preventDefault();
          setPan({
            x: active.x + event.clientX - active.startX,
            y: active.y + event.clientY - active.startY,
          });
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => {
          gesture.current = null;
          setPanning(false);
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
      >
        <div
          ref={content}
          className="relative h-fit w-fit origin-center"
          data-artwork-transform
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${(fitScale * zoom) / 100})`,
          }}
        >
          {children}
        </div>
      </div>
      {caption && (
        <div className="shrink-0 bg-card px-3 py-2 text-center text-xs text-muted-foreground">
          {caption}
        </div>
      )}
      <p className="m-0 shrink-0 border-t bg-card px-3 py-2 text-center text-xs text-muted-foreground">
        Scroll to zoom · Middle-button drag to pan · Zoom changes only the
        preview
      </p>
    </div>
  );
}
