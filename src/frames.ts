/** Original, offline vector frames. Geometry is shared by SVG and print Canvas. */
export const framePresets = [
  { id: "plain", name: "Plain" },
  { id: "rounded", name: "Rounded" },
  { id: "double", name: "Double" },
  { id: "dashed", name: "Dashed" },
  { id: "dotted", name: "Dotted" },
  { id: "corners", name: "Corners" },
  { id: "ticket", name: "Ticket" },
  { id: "scalloped", name: "Scalloped" },
  { id: "bracket", name: "Brackets" },
  { id: "artdeco", name: "Art deco" },
  { id: "leaf", name: "Leaves" },
  { id: "stitched", name: "Stitched" },
] as const;
export type FrameStyle = (typeof framePresets)[number]["id"];
export type FramePath = {
  d: string;
  dash?: number[];
  lineCap?: "butt" | "round";
  lineJoin?: "miter" | "round" | "bevel";
};
export type FrameGeometry = {
  width: number;
  height: number;
  strokeWidth: number;
  paths: FramePath[];
};
export function isFrameStyle(value: unknown): value is FrameStyle {
  return typeof value === "string" && framePresets.some((preset) => preset.id === value);
}

/** Units are caller-defined (pixels for printing, SVG viewBox units for previews).
 * All line centers and Bezier controls remain inside a half-stroke inset.
 * Small elements keep a usable border by limiting thickness to half their short
 * side; multi-line ornament falls back to a simple outline when it cannot fit.
 */
export function frameGeometry(
  style: FrameStyle | undefined,
  width: number,
  height: number,
  stroke: number,
): FrameGeometry {
  if (![width, height, stroke].every(Number.isFinite) || width < 0 || height < 0 || stroke <= 0)
    throw Error("Frame dimensions must be finite and nonnegative; thickness must be positive.");
  if (style !== undefined && !isFrameStyle(style)) throw Error("Unknown frame style.");
  if (!width || !height) return { width, height, strokeWidth: 0, paths: [] };
  const s = Math.min(stroke, Math.min(width, height) / 2);
  const x = s / 2, y = s / 2, right = width - x, bottom = height - y;
  const w = right - x, h = bottom - y;
  const paths: FramePath[] = [];
  const point = (a: number, b: number) => `${a} ${b}`;
  const add = (d: string, extra: Omit<FramePath, "d"> = {}) => paths.push({ d, lineJoin: "round", ...extra });
  const rect = (inset = 0) => `M ${point(x + inset, y + inset)} H ${right - inset} V ${bottom - inset} H ${x + inset} Z`;
  const rounded = (radius: number) => `M ${point(x + radius, y)} H ${right - radius} Q ${point(right, y)} ${point(right, y + radius)} V ${bottom - radius} Q ${point(right, bottom)} ${point(right - radius, bottom)} H ${x + radius} Q ${point(x, bottom)} ${point(x, bottom - radius)} V ${y + radius} Q ${point(x, y)} ${point(x + radius, y)} Z`;
  const radius = Math.min(w, h) * 0.18;
  switch (style ?? "plain") {
    case "plain": add(rect(), { lineJoin: "miter" }); break;
    case "rounded": add(rounded(radius)); break;
    case "dashed": add(rect(), { dash: [s * 4, s * 3] }); break;
    case "dotted": add(rounded(radius), { dash: [s * 0.01, s * 2.5], lineCap: "round" }); break;
    case "double":
    case "stitched": {
      add(rect(), { lineJoin: "miter" });
      const inset = s * 2.5;
      if (w > inset * 2 + s && h > inset * 2 + s)
        add(rect(inset), style === "stitched" ? { dash: [s * 2, s * 2], lineCap: "round" } : { lineJoin: "miter" });
      break;
    }
    case "corners": {
      const a = w * 0.25, b = h * 0.3;
      add(`M ${point(x + a, y)} H ${x} V ${y + b} M ${point(right - a, y)} H ${right} V ${y + b} M ${point(right, bottom - b)} V ${bottom} H ${right - a} M ${point(x + a, bottom)} H ${x} V ${bottom - b}`);
      break;
    }
    case "bracket": {
      const a = Math.min(w * 0.2, h * 0.25);
      add(`M ${point(x + a, y)} H ${x} V ${bottom} H ${x + a} M ${point(right - a, y)} H ${right} V ${bottom} H ${right - a}`);
      break;
    }
    case "ticket": {
      const r = Math.min(w, h) * 0.16;
      add(`M ${point(x + r, y)} H ${right - r} Q ${point(right - r, y + r)} ${point(right, y + r)} V ${bottom - r} Q ${point(right - r, bottom - r)} ${point(right - r, bottom)} H ${x + r} Q ${point(x + r, bottom - r)} ${point(x, bottom - r)} V ${y + r} Q ${point(x + r, y + r)} ${point(x + r, y)} Z`);
      break;
    }
    case "scalloped": {
      const depth = Math.min(w, h) * 0.08;
      const nx = Math.max(2, Math.min(32, Math.round(w / Math.max(depth * 2, s * 3))));
      const ny = Math.max(2, Math.min(32, Math.round(h / Math.max(depth * 2, s * 3))));
      let d = `M ${point(x, y)}`;
      for (let i = 0; i < nx; i++) d += ` Q ${point(x + w * (i + 0.5) / nx, y + depth)} ${point(x + w * (i + 1) / nx, y)}`;
      for (let i = 0; i < ny; i++) d += ` Q ${point(right - depth, y + h * (i + 0.5) / ny)} ${point(right, y + h * (i + 1) / ny)}`;
      for (let i = 0; i < nx; i++) d += ` Q ${point(right - w * (i + 0.5) / nx, bottom - depth)} ${point(right - w * (i + 1) / nx, bottom)}`;
      for (let i = 0; i < ny; i++) d += ` Q ${point(x + depth, bottom - h * (i + 0.5) / ny)} ${point(x, bottom - h * (i + 1) / ny)}`;
      add(d + " Z");
      break;
    }
    case "artdeco": {
      const a = Math.min(w, h) * 0.2;
      add(`M ${point(x + a, y)} H ${right - a} L ${point(right, y + a)} V ${bottom - a} L ${point(right - a, bottom)} H ${x + a} L ${point(x, bottom - a)} V ${y + a} Z`, { lineJoin: "bevel" });
      const inset = s * 2.5;
      if (Math.min(w, h) > inset * 4)
        add(`M ${point(x + a, y + inset)} H ${right - a} M ${point(right - inset, y + a)} V ${bottom - a} M ${point(right - a, bottom - inset)} H ${x + a} M ${point(x + inset, bottom - a)} V ${y + a}`);
      break;
    }
    case "leaf": {
      add(rounded(radius));
      const a = Math.min(w, h) * 0.23;
      if (a > s * 3) {
        // Paired leaves fit inside opposite rounded corners without hiding text.
        add(`M ${point(x + a * 0.4, y + a * 0.4)} Q ${point(x + a * 1.5, y + a * 0.2)} ${point(x + a * 1.4, y + a * 1.4)} Q ${point(x + a * 0.2, y + a * 1.5)} ${point(x + a * 0.4, y + a * 0.4)} Z`);
        add(`M ${point(right - a * 0.4, bottom - a * 0.4)} Q ${point(right - a * 1.5, bottom - a * 0.2)} ${point(right - a * 1.4, bottom - a * 1.4)} Q ${point(right - a * 0.2, bottom - a * 1.5)} ${point(right - a * 0.4, bottom - a * 0.4)} Z`);
      }
      break;
    }
  }
  return { width, height, strokeWidth: s, paths };
}
