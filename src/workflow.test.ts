import { describe, it, expect } from "vitest";
import {
  fitArtwork,
  printerProtocol,
  parsePages,
  picturePresets,
  validateSize,
} from "./workflow";
describe("artwork preparation", () => {
  it("keeps exact exact inch dimensions", () => {
    expect(picturePresets.map((p) => [p.widthMm, p.heightMm])).toEqual([
      [101.6, 101.6],
      [101.6, 152.4],
      [101.6, 203.2],
    ]);
  });
  it("fits and centers artwork without distortion", () => {
    expect(fitArtwork(1200, 600, { widthMm: 60, heightMm: 90 }, 3)).toEqual({
      x: 3,
      y: 31.5,
      width: 54,
      height: 27,
    });
  });
  it("preserves requested page order and removes duplicates", () => {
    expect(parsePages("3, 1-2, 3", 5)).toEqual([3, 1, 2]);
  });
  it("rejects malformed, out-of-range and excessive page selections", () => {
    for (const selection of ["", "0", "4-2", "1-51", "1,6", "one", "1-2-3"])
      expect(() => parsePages(selection, 5)).toThrow();
  });
  it("rejects unsupported physical and raster sizes", () => {
    expect(() => validateSize(60, 90, 203)).not.toThrow();
    for (const size of [
      [0, 90],
      [217, 90],
      [60, 501],
      [NaN, 90],
      [216, 500],
    ])
      expect(() => validateSize(size[0], size[1], 300)).toThrow();
  });
});

describe("automatic printer format", () => {
  it("uses the supported profile for the connected model", () => {
    expect(printerProtocol("DB403")).toBe("zpl");
    for (const model of ["DB402", "XP-428A", "4B-2084A", "db402 test"])
      expect(printerProtocol(model)).toBe("tspl");
    expect(printerProtocol("DB403 test")).toBe("zpl");
  });
});
