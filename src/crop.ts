export type Crop = { x: number; y: number; width: number; height: number };
export type CropHandle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w";
export const fullCrop: Crop = { x: 0, y: 0, width: 1, height: 1 };
const bound = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function dragCrop(start: Crop, handle: CropHandle, dx: number, dy: number, lockAspect = true): Crop {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return start;
  if (handle === "move") return {
    ...start,
    x: bound(start.x + dx, 0, 1 - start.width),
    y: bound(start.y + dy, 0, 1 - start.height),
  };
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (lockAspect && handle.length === 2) {
    const west = handle.includes("w"), north = handle.includes("n");
    const horizontal = (west ? -dx : dx) / start.width;
    const vertical = (north ? -dy : dy) / start.height;
    const change = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
    const maxWidth = west ? right : 1 - left;
    const maxHeight = north ? bottom : 1 - top;
    const factor = bound(1 + change,
      Math.max(0.01 / start.width, 0.01 / start.height),
      Math.min(maxWidth / start.width, maxHeight / start.height));
    const width = start.width * factor, height = start.height * factor;
    return { x: west ? right - width : left, y: north ? bottom - height : top, width, height };
  }
  // Side handles always adjust just their edge. Shift unlocks corner resizing.
  if (handle.includes("w")) left = bound(left + dx, 0, right - 0.01);
  if (handle.includes("e")) right = bound(right + dx, left + 0.01, 1);
  if (handle.includes("n")) top = bound(top + dy, 0, bottom - 0.01);
  if (handle.includes("s")) bottom = bound(bottom + dy, top + 0.01, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
