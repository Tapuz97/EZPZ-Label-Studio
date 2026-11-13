import type { LabelElement } from "./model";
import { clamp } from "./model";

type ResizeCorner = "tl" | "tr" | "bl" | "br";
export type ResizeHandle = ResizeCorner | "t" | "b" | "l" | "r";
export function resizeElement(
  element: LabelElement,
  corner: ResizeHandle,
  dxMm: number,
  dyMm: number,
  labelWidth: number,
  labelHeight: number,
  unlockAspect = false,
) {
  const sx = corner.includes("r") ? 1 : corner.includes("l") ? -1 : 0;
  const sy = corner.includes("b") ? 1 : corner.includes("t") ? -1 : 0;
  const proportional = corner.length === 2 && !unlockAspect;
  const minimum = element.kind === "line" ? 0.1 : 0.5;
  const angle = (element.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const localX = c * dxMm + s * dyMm,
    localY = -s * dxMm + c * dyMm;
  let width = clamp(element.width + sx * localX, minimum, labelWidth);
  let height = clamp(element.height + sy * localY, minimum, labelHeight);
  if (proportional) {
    const scaleX = width / element.width,
      scaleY = height / element.height;
    const requestedScale =
      Math.abs(scaleX - 1) > Math.abs(scaleY - 1) ? scaleX : scaleY;
    const scale = clamp(
      requestedScale,
      Math.max(minimum / element.width, minimum / element.height),
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
    ...(element.kind === "text" && corner.length === 2
      ? {
          fontSize: clamp(
            element.fontSize *
              (proportional ? width / element.width : height / element.height),
            2,
            144,
          ),
        }
      : {}),
    width,
    height,
    x: clamp(centerX - width / 2, 0, labelWidth - width),
    y: clamp(centerY - height / 2, 0, labelHeight - height),
  };
}
