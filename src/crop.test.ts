import { describe, it, expect } from "vitest";
import { dragCrop, fullCrop, type CropHandle } from "./crop";
describe("visual image crop", () => {
  it("keeps the current corner aspect ratio and anchors the opposite corner", () => {
    const start = { x: 0.1, y: 0.2, width: 0.6, height: 0.3 };
    for (const handle of ["nw", "ne", "sw", "se"] as CropHandle[]) {
      const next = dragCrop(start, handle, handle.includes("w") ? 0.12 : -0.12, handle.includes("n") ? 0.02 : -0.02);
      expect(next.width / next.height).toBeCloseTo(2);
      expect(next.width).toBeCloseTo(0.48);
      expect(handle.includes("w") ? next.x + next.width : next.x).toBeCloseTo(handle.includes("w") ? 0.7 : 0.1);
      expect(handle.includes("n") ? next.y + next.height : next.y).toBeCloseTo(handle.includes("n") ? 0.5 : 0.2);
    }
  });
  it("unlocks corner axes explicitly", () => {
    expect(dragCrop(fullCrop, "nw", 0.2, 0.3, false)).toEqual({ x: 0.2, y: 0.3, width: 0.8, height: 0.7 });
    expect(dragCrop(fullCrop, "se", -0.2, -0.3, false)).toEqual({ x: 0, y: 0, width: 0.8, height: 0.7 });
  });
  it("clamps corner scaling uniformly at source boundaries", () => {
    const next = dragCrop({ x: 0.1, y: 0.1, width: 0.4, height: 0.2 }, "se", 5, 5);
    expect(next.width).toBeCloseTo(0.9);
    expect(next.height).toBeCloseTo(0.45);
    expect(next.width / next.height).toBeCloseTo(2);
  });
  it("side handles adjust only their axis regardless of lock", () => {
    for (const handle of ["n", "e", "s", "w"] as CropHandle[]) {
      const next = dragCrop(fullCrop, handle, handle === "w" ? 0.2 : -0.2, handle === "n" ? 0.3 : -0.3);
      if (handle === "w" || handle === "e") { expect(next.height).toBe(1); expect(next.width).toBeCloseTo(0.8); }
      else { expect(next.width).toBe(1); expect(next.height).toBeCloseTo(0.7); }
    }
  });
  it("moves within bounds without resizing", () => {
    expect(dragCrop({ x: 0.1, y: 0.2, width: 0.4, height: 0.3 }, "move", 2, -2)).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.3 });
  });
  it("prevents empty or flipped crops", () => {
    const result = dragCrop(fullCrop, "nw", 2, 2);
    expect(result.width).toBeCloseTo(0.01); expect(result.height).toBeCloseTo(0.01);
    expect(dragCrop(fullCrop, "se", 2, 2)).toEqual(fullCrop);
  });
  it("ignores invalid pointer deltas", () => {
    expect(dragCrop(fullCrop, "move", NaN, 0)).toEqual(fullCrop);
  });
});
