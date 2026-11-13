import { describe, it, expect } from "vitest";
import { makeElement } from "./model";
import {
  alignElement,
  angleFromPointer,
  bounds,
  snapPlacement,
  snapResizeDelta,
  rotationSnapping,
} from "./editor-geometry";
import { resizeElement } from "./resize";
describe("editor geometry", () => {
  it("centers rotated bounds against label and another component", () => {
    const e = {
      ...makeElement("text"),
      x: 10,
      y: 10,
      width: 20,
      height: 10,
      rotation: 90,
    };
    const placed = {
      ...e,
      ...alignElement(e, { x: 0, y: 0, width: 60, height: 90 }, "left"),
    };
    expect(bounds(placed).x).toBeCloseTo(0);
    expect(
      alignElement(e, { x: 20, y: 30, width: 20, height: 10 }, "middle").y,
    ).toBeCloseTo(30);
  });
  it("snaps a moving edge to a peer and reports the guide", () => {
    const e = { ...makeElement("image"), x: 0, y: 0, width: 10, height: 10 };
    const peer = {
      ...makeElement("image"),
      x: 20,
      y: 25,
      width: 12,
      height: 12,
    };
    const out = snapPlacement(e, 9.8, 15, [peer], 60, 90, 0.5);
    expect(out.x).toBeCloseTo(10);
    expect(out.guides).toContainEqual({ axis: "x", position: 20 });
  });
  it("rotates from the top handle and optionally snaps to 15 degrees", () => {
    expect(angleFromPointer(0, 0, 1, 0)).toBe(90);
    expect(angleFromPointer(0, 0, 0, -1)).toBe(0);
    expect(angleFromPointer(0, 0, 1, -1, true)).toBe(45);
  });
  it("scales text font with proportional resizing", () => {
    const e = {
      ...makeElement("text"),
      width: 20,
      height: 10,
      fontSize: 12,
      x: 0,
      y: 0,
    };
    const r = resizeElement(e, "br", 20, 10, 100, 100);
    expect(r.width).toBe(40);
    expect(r.height).toBe(20);
    expect(r.fontSize).toBe(24);
  });
});

describe("snap policy", () => {
  it("rotation follows Snap, Shift override and Alt bypass", () => {
    expect(rotationSnapping(true, false, false)).toBe(true);
    expect(rotationSnapping(false, true, false)).toBe(true);
    expect(rotationSnapping(false, false, false)).toBe(false);
    expect(rotationSnapping(true, true, true)).toBe(false);
  });
  it("snaps resized width without distorting a rotated image", () => {
    const e = { ...makeElement("image"), width: 20, height: 10, rotation: 90 };
    const d = snapResizeDelta(e, "br", -1.13, 2.26);
    const result = resizeElement(e, "br", d.dx, d.dy, 100, 100);
    expect(result.width).toBe(22);
    expect(result.height).toBe(11);
  });
  it("snaps both free rectangle dimensions", () => {
    const e = { ...makeElement("rect"), width: 20, height: 10 };
    const d = snapResizeDelta(e, "br", 2.2, 3.3);
    const result = resizeElement(e, "br", d.dx, d.dy, 100, 100);
    expect(result.width).toBe(22);
    expect(result.height).toBe(13);
  });
});
