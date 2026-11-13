import { describe, expect, it } from "vitest";
import { makeElement } from "./model";
import { resizeElement } from "./resize";

describe("artwork corner resize", () => {
  it("keeps the opposite corner and image aspect ratio", () => {
    const image = {
      ...makeElement("image"),
      x: 10,
      y: 20,
      width: 40,
      height: 20,
    };
    expect(resizeElement(image, "br", 20, 0, 100, 100)).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 30,
    });
    expect(resizeElement(image, "tl", -20, -10, 100, 100)).toEqual({
      x: 0,
      y: 10,
      width: 60,
      height: 30,
    });
  });
  it("maps pointer movement into rotated artwork coordinates", () => {
    const element = {
      ...makeElement("rect"),
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      rotation: 90,
    };
    const resized = resizeElement(element, "br", -10, 10, 100, 100);
    expect(resized.width).toBeCloseTo(30);
    expect(resized.height).toBeCloseTo(30);
    expect(resized.x).toBeCloseTo(30);
    expect(resized.y).toBeCloseTo(40);
  });
  it("clamps size instead of inverting or leaving the stock", () => {
    const element = {
      ...makeElement("rect"),
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    };
    expect(resizeElement(element, "br", -100, -100, 60, 90)).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
    expect(resizeElement(element, "br", 500, 500, 60, 90)).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 60,
    });
  });
});

describe("eight resize handles", () => {
  it("side handles resize only their axis", () => {
    const e = { ...makeElement("image"), x: 20, y: 20, width: 40, height: 20 };
    expect(resizeElement(e, "r", 10, 99, 100, 100)).toEqual({
      x: 20,
      y: 20,
      width: 50,
      height: 20,
    });
    expect(resizeElement(e, "t", 99, -10, 100, 100)).toEqual({
      x: 20,
      y: 10,
      width: 40,
      height: 30,
    });
  });
  it("corners preserve every component ratio and Shift unlocks", () => {
    for (const kind of [
      "image",
      "text",
      "qr",
      "barcode",
      "line",
      "rect",
    ] as const) {
      const e = { ...makeElement(kind), x: 20, y: 20, width: 40, height: 20 };
      const locked = resizeElement(e, "br", 10, 0, 100, 100);
      expect(locked.width / locked.height).toBe(2);
      const unlocked = resizeElement(e, "br", 10, 0, 100, 100, true);
      expect(unlocked.width).toBe(50);
      expect(unlocked.height).toBe(20);
    }
  });
  it("rotated side resizing keeps the opposite edge fixed", () => {
    const e = {
      ...makeElement("image"),
      x: 20,
      y: 20,
      width: 40,
      height: 20,
      rotation: 90,
    };
    const r = resizeElement(e, "r", 0, 10, 100, 100);
    expect(r.width).toBe(50);
    expect(r.height).toBe(20);
    expect(r.x).toBeCloseTo(15);
    expect(r.y).toBeCloseTo(25);
  });
});
