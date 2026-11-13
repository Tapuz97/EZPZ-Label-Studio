import type { ResizeHandle } from "./resize";
import type { LabelElement } from "./model";
import { clamp } from "./model";
export type Alignment =
  "left" | "center" | "right" | "top" | "middle" | "bottom";
export function bounds(
  e: Pick<LabelElement, "x" | "y" | "width" | "height" | "rotation">,
) {
  const a = (e.rotation * Math.PI) / 180,
    w = Math.abs(Math.cos(a)) * e.width + Math.abs(Math.sin(a)) * e.height,
    h = Math.abs(Math.sin(a)) * e.width + Math.abs(Math.cos(a)) * e.height;
  return {
    x: e.x + (e.width - w) / 2,
    y: e.y + (e.height - h) / 2,
    width: w,
    height: h,
  };
}
export function alignElement(
  e: LabelElement,
  target: { x: number; y: number; width: number; height: number },
  mode: Alignment,
) {
  const b = bounds(e);
  let x = e.x,
    y = e.y;
  if (mode === "left") x += target.x - b.x;
  if (mode === "center") x += target.x + target.width / 2 - b.x - b.width / 2;
  if (mode === "right") x += target.x + target.width - b.x - b.width;
  if (mode === "top") y += target.y - b.y;
  if (mode === "middle") y += target.y + target.height / 2 - b.y - b.height / 2;
  if (mode === "bottom") y += target.y + target.height - b.y - b.height;
  return { x, y };
}
export function angleFromPointer(
  cx: number,
  cy: number,
  x: number,
  y: number,
  snap = false,
) {
  const a = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90 + 360) % 360;
  return (snap ? Math.round(a / 15) * 15 : Math.round(a)) % 360;
}
export function snapPlacement(
  e: LabelElement,
  x: number,
  y: number,
  others: LabelElement[],
  width: number,
  height: number,
  tolerance: number,
) {
  const moving = bounds({ ...e, x, y });
  const refs = [
    { x: 0, y: 0, width, height },
    ...others.filter((o) => o.id !== e.id).map(bounds),
  ];
  const guides: { axis: "x" | "y"; position: number }[] = [];
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const anchors = [
      moving[axis],
      moving[axis] + moving[size] / 2,
      moving[axis] + moving[size],
    ];
    let best = tolerance,
      delta: number | undefined,
      guide = 0;
    for (const ref of refs)
      for (const target of [
        ref[axis],
        ref[axis] + ref[size] / 2,
        ref[axis] + ref[size],
      ])
        for (const anchor of anchors) {
          const d = target - anchor;
          if (Math.abs(d) <= best) {
            best = Math.abs(d);
            delta = d;
            guide = target;
          }
        }
    if (axis === "x") x = delta === undefined ? Math.round(x) : x + delta;
    else y = delta === undefined ? Math.round(y) : y + delta;
    if (delta !== undefined) guides.push({ axis, position: guide });
  }
  const box = bounds({ ...e, x, y });
  x += clamp(box.x, 0, Math.max(0, width - box.width)) - box.x;
  y += clamp(box.y, 0, Math.max(0, height - box.height)) - box.y;
  return { x, y, guides };
}

// Quantize the changing dimension in local element coordinates. Proportional
// elements keep their aspect ratio while the dominant dimension lands on 1 mm.
export function snapResizeDelta(
  e: LabelElement,
  corner: ResizeHandle,
  dx: number,
  dy: number,
  unlockAspect = false,
) {
  const angle = (e.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const sx = corner.includes("r") ? 1 : corner.includes("l") ? -1 : 0,
    sy = corner.includes("b") ? 1 : corner.includes("t") ? -1 : 0;
  const localX = c * dx + s * dy,
    localY = -s * dx + c * dy;
  let width = Math.max(1, e.width + sx * localX),
    height = Math.max(1, e.height + sy * localY);
  if (corner.length === 2 && !unlockAspect) {
    const useWidth =
      Math.abs(width / e.width - 1) >= Math.abs(height / e.height - 1);
    const scale = useWidth
      ? Math.max(1, Math.round(width)) / e.width
      : Math.max(1, Math.round(height)) / e.height;
    width = e.width * scale;
    height = e.height * scale;
  } else {
    width = sx ? Math.round(width) : e.width;
    height = sy ? Math.round(height) : e.height;
  }
  const lx = (width - e.width) * sx,
    ly = (height - e.height) * sy;
  return { dx: c * lx - s * ly, dy: s * lx + c * ly };
}
export const rotationSnapping = (
  enabled: boolean,
  shift: boolean,
  alt: boolean,
) => !alt && (enabled || shift);
