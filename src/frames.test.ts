import { describe, expect, it } from "vitest";
import { frameGeometry, framePresets, isFrameStyle } from "./frames";

/** Independent SVG path sampler checks the actual exported geometry. */
function samplePath(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const points: [number, number][] = [];
  let i = 0, x = 0, y = 0, startX = 0, startY = 0;
  const n = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "M" || command === "L") { x = n(); y = n(); if (command === "M") { startX = x; startY = y; } }
    else if (command === "H") x = n();
    else if (command === "V") y = n();
    else if (command === "Z") { x = startX; y = startY; }
    else if (command === "Q") {
      const cx = n(), cy = n(), endX = n(), endY = n();
      for (let step = 1; step <= 16; step++) {
        const t = step / 16, inv = 1 - t;
        points.push([inv * inv * x + 2 * inv * t * cx + t * t * endX, inv * inv * y + 2 * inv * t * cy + t * t * endY]);
      }
      x = endX; y = endY;
    } else throw Error(`Unexpected SVG command ${command}`);
    points.push([x, y]);
  }
  return points;
}

describe("portable vector frame library", () => {
  it("keeps the legacy plain border inset and provides distinct original presets", () => {
    expect(frameGeometry(undefined, 100, 60, 2)).toEqual(frameGeometry("plain", 100, 60, 2));
    expect(frameGeometry("plain", 100, 60, 2).paths[0].d).toBe("M 1 1 H 99 V 59 H 1 Z");
    expect(new Set(framePresets.map((preset) => preset.id)).size).toBe(12);
    const designs = framePresets.map(({ id }) => JSON.stringify(frameGeometry(id, 100, 60, 2).paths));
    expect(new Set(designs).size).toBe(12);
    for (const preset of framePresets) { expect(isFrameStyle(preset.id)).toBe(true); expect(preset.name.length).toBeGreaterThan(2); }
    expect(isFrameStyle("<script>" )).toBe(false);
  });

  it("keeps the complete stroke inside every shape, including tiny and thick elements", () => {
    for (const { id } of framePresets) for (const [width, height, stroke] of [[100, 60, 2], [0.1, 0.2, 10], [10, 200, 0.05], [100, 0.1, 8], [16, 16, 8]]) {
      const shape = frameGeometry(id, width, height, stroke);
      expect(shape.paths.length).toBeGreaterThan(0);
      expect(shape.strokeWidth).toBeGreaterThan(0);
      expect(shape.strokeWidth).toBeLessThanOrEqual(stroke);
      for (const path of shape.paths) {
        for (const [x, y] of samplePath(path.d)) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x - shape.strokeWidth / 2).toBeGreaterThanOrEqual(-1e-9);
          expect(y - shape.strokeWidth / 2).toBeGreaterThanOrEqual(-1e-9);
          expect(x + shape.strokeWidth / 2).toBeLessThanOrEqual(width + 1e-9);
          expect(y + shape.strokeWidth / 2).toBeLessThanOrEqual(height + 1e-9);
        }
        if (path.dash) expect(path.dash.every((length) => Number.isFinite(length) && length > 0)).toBe(true);
      }
    }
  });

  it("scales geometry proportionally for matching SVG previews and print pixels", () => {
    for (const { id } of framePresets) {
      const a = frameGeometry(id, 120, 80, 2), b = frameGeometry(id, 240, 160, 4);
      expect(b.strokeWidth).toBe(a.strokeWidth * 2);
      expect(b.paths.length).toBe(a.paths.length);
      a.paths.forEach((path, index) => {
        const first = samplePath(path.d), second = samplePath(b.paths[index].d);
        expect(second.length).toBe(first.length);
        first.forEach(([x, y], point) => { expect(second[point][0]).toBeCloseTo(x * 2, 8); expect(second[point][1]).toBeCloseTo(y * 2, 8); });
      });
    }
  });

  it("handles zero-size elements and rejects invalid geometry without SVG injection", () => {
    expect(frameGeometry("plain", 0, 20, 2).paths).toEqual([]);
    expect(frameGeometry("rounded", 20, 0, 2).paths).toEqual([]);
    for (const [w, h, stroke] of [[NaN, 20, 2], [20, Infinity, 2], [-1, 10, 2], [20, 10, 0], [20, 10, -1]])
      expect(() => frameGeometry("plain", w, h, stroke)).toThrow();
    expect(() => frameGeometry("url(https://example.com)" as "plain", 100, 60, 2)).toThrow();
  });
});
