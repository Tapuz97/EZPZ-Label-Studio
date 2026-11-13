import { describe, it, expect } from "vitest";
import {
  artworkOrientation,
  orientLabel,
  artworkPlacement,
} from "./import-artwork";
describe("import artwork geometry", () => {
  it("chooses landscape only for wider sources and portrait for squares", () => {
    expect(artworkOrientation(300, 200)).toBe("horizontal");
    expect(artworkOrientation(200, 300)).toBe("vertical");
    expect(artworkOrientation(200, 200)).toBe("vertical");
  });
  it("swaps stock dimensions without changing the artwork dimensions", () => {
    expect(orientLabel(60, 90, "horizontal")).toEqual({
      widthMm: 90,
      heightMm: 60,
    });
    expect(orientLabel(90, 60, "vertical")).toEqual({
      widthMm: 60,
      heightMm: 90,
    });
  });
  it("centers a print-scale reduction inside margins while preserving source ratio", () => {
    const placement = artworkPlacement(
      1200,
      600,
      { widthMm: 60, heightMm: 90 },
      3,
      50,
    );
    expect(placement).toEqual({ x: 16.5, y: 38.25, width: 27, height: 13.5 });
    expect(placement.width / placement.height).toBe(2);
  });
  it("rejects invalid margins and print scales", () => {
    for (const [margin, scale] of [
      [30, 100],
      [0, 0],
      [0, 101],
      [NaN, 50],
    ])
      expect(() =>
        artworkPlacement(
          1200,
          600,
          { widthMm: 60, heightMm: 90 },
          margin,
          scale,
        ),
      ).toThrow();
  });
});
