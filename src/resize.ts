import type { LabelElement } from "./model";
import { clamp } from "./model";

export type ResizeCorner = "tl" | "tr" | "bl" | "br";
export function resizeElement(
  element: LabelElement,
  corner: ResizeCorner,
  dxMm: number,
  dyMm: number,
  labelWidth: number,
  labelHeight: number,
) {
  const sx = corner.endsWith("r") ? 1 : -1;
  const sy = corner.startsWith("b") ? 1 : -1;
  const angle = (element.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const localX = c * dxMm + s * dyMm,
    localY = -s * dxMm + c * dyMm;
  let width = clamp(element.width + sx * localX, 0.5, labelWidth);
  let height = clamp(element.height + sy * localY, 0.5, labelHeight);
  if (
    element.kind === "image" ||
    element.kind === "text" ||
    element.kind === "qr"
  ) {
    const scaleX = width / element.width,
      scaleY = height / element.height;
    const requestedScale =
      Math.abs(scaleX - 1) > Math.abs(scaleY - 1) ? scaleX : scaleY;
    const scale = clamp(
      requestedScale,
      Math.max(0.5 / element.width, 0.5 / element.height),
      Math.min(labelWidth / element.width, labelHeight / element.height),
    );
    width = element.width * scale;
    height = element.height * scale;
  }
  // Keep the opposite corner fixed even when the artwork is rotated.
  const centerX =
    element.x +
    element.width / 2 +
    (sx * (width - element.width) * c - sy * (height - element.height) * s) / 2;
  const centerY =
    element.y +
    element.height / 2 +
    (sx * (width - element.width) * s + sy * (height - element.height) * c) / 2;
  return {
    ...(element.kind === "text"
      ? { fontSize: clamp((element.fontSize * width) / element.width, 2, 144) }
      : {}),
    width,
    height,
    x: clamp(centerX - width / 2, 0, labelWidth - width),
    y: clamp(centerY - height / 2, 0, labelHeight - height),
  };
}
