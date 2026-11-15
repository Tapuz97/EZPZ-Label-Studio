import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FramePreview, framePlacement } from "./FramePicker";
import { framePresets } from "./frames";

describe("frame insertion placement", () => {
  it("leaves1mm around general labels without a connected printer", () => {
    expect(framePlacement({ widthMm: 60, heightMm: 90, dpi: 203 })).toEqual({
      x: 1,
      y: 1,
      width: 58,
      height: 88,
    });
    expect(
      framePlacement({ widthMm: 101.6, heightMm: 152.4, dpi: 203 }),
    ).toEqual({ x: 1, y: 1, width: 99.6, height: 150.4 });
  });
  it("respects connected head limits on standard transports without rotating", () => {
    const result = framePlacement(
      { widthMm: 60, heightMm: 30, dpi: 203 },
      { protocol: "tspl", capabilities: { maxWidthMm: 50 } },
    );
    expect(result).toEqual({ x: 6, y: 1, width: 48, height: 28 });
  });
  it.each([
    { widthMm: 15, heightMm: 30 },
    { widthMm: 30, heightMm: 15 },
  ])("uses ordinary paper margins without the D110 model recommendation: %o", (size) => {
    const result = framePlacement(
      { ...size, dpi: 203 },
      { protocol: "niimbot", capabilities: { maxWidthDots: 96, dpi: 203 } },
    );
    expect(result).toEqual({ x: 1, y: 1, width: size.widthMm - 2, height: size.heightMm - 2 });
  });
  it("uses physical printerDPI when document resolution differs", () => {
    const result = framePlacement(
      { widthMm: 15, heightMm: 30, dpi: 300 },
      { protocol: "tspl", capabilities: { maxWidthDots: 96, dpi: 203 } },
    );
    expect(result.width).toBeCloseTo((96 * 25.4) / 203 - 2);
  });
  it.each([
    { widthMm: 1, heightMm: 1 },
    { widthMm: 0.1, heightMm: 0.2 },
    { widthMm: 2, heightMm: 10 },
  ])("keeps tiny imported geometry finite and inside label: %o", (size) => {
    const result = framePlacement({ ...size, dpi: 203 });
    expect(Object.values(result).every(Number.isFinite)).toBe(true);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.x + result.width).toBeLessThanOrEqual(size.widthMm);
    expect(result.y + result.height).toBeLessThanOrEqual(size.heightMm);
  });
  it("ignores invalid capability hints and rejects invalid label geometry", () => {
    expect(
      framePlacement(
        { widthMm: 60, heightMm: 90, dpi: 203 },
        { capabilities: { dpi: NaN, maxWidthDots: Infinity, maxWidthMm: -2 } },
      ),
    ).toEqual({ x: 1, y: 1, width: 58, height: 88 });
    for (const patch of [
      { widthMm: NaN },
      { heightMm: Infinity },
      { widthMm: 0 },
      { dpi: 0 },
      { heightMm: -1 },
    ])
      expect(() =>
        framePlacement({ widthMm: 60, heightMm: 90, dpi: 203, ...patch }),
      ).toThrow("positive label dimensions");
  });
});
describe("shared frame preview", () => {
  it("renders all twelve distinct presets as decorativeSVG in the accessible choice button", () => {
    const previews = framePresets.map((frame) =>
      renderToStaticMarkup(<FramePreview style={frame.id} />),
    );
    expect(previews).toHaveLength(12);
    expect(new Set(previews).size).toBe(12);
    for (const preview of previews) {
      expect(preview).toContain('aria-hidden="true"');
      expect(preview).toContain("<path");
      expect(preview).not.toMatch(/NaN|Infinity|<image|https?:/);
    }
  });
});
