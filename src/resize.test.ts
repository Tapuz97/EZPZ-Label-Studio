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
      height: 90,
    });
  });
});
