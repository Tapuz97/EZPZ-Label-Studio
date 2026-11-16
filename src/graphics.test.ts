import { describe, expect, it } from "vitest";
import { graphicPlacement, isSvgFile, svgDimensions } from "./graphics";
import { initialDocument, makeElement, parseDocument } from "./model";

describe("printable artwork geometry", () => {
  it("fits tall and wide emoji without distorting them or exceeding small stock", () => {
    for (const [width, height] of [[10, 100], [100, 10], [30, 30]]) {
      const placement = graphicPlacement({ width, height }, { widthMm: 15, heightMm: 30 });
      expect(placement.width / placement.height).toBeCloseTo(width / height);
      expect(placement.x).toBeGreaterThanOrEqual(3);
      expect(placement.y).toBeGreaterThanOrEqual(3);
      expect(placement.x + placement.width).toBeLessThanOrEqual(12);
      expect(placement.y + placement.height).toBeLessThanOrEqual(27);
    }
  });
  it("keeps icon sizes manageable on shipping labels", () => {
    const placement = graphicPlacement({ width: 24, height: 24 }, { widthMm: 101.6, heightMm: 152.4 }, 20);
    expect(placement.width).toBe(20);
    expect(placement.height).toBe(20);
    expect(placement.x + placement.width / 2).toBeCloseTo(50.8);
  });
  it("reads viewBox-only SVGs and absolute SVG dimensions", () => {
    expect(svgDimensions(null, null, "-5, -5, 30, 20")).toEqual({ width: 30, height: 20 });
    expect(svgDimensions("1in", "36pt", null)).toEqual({ width: 96, height: 48 });
    expect(svgDimensions("25.4mm", null, "0 0 100 50")).toEqual({ width: 96, height: 48 });
    expect(svgDimensions("100%", "100%", "0 0 20 10")).toEqual({ width: 20, height: 10 });
  });
  it("rejects broken viewBoxes and impossible SVG dimensions", () => {
    for (const value of ["0 0 -1 20", "0 0 20 0", "0 0 Infinity 1", "0 0 10"])
      expect(() => svgDimensions(null, null, value)).toThrow("viewBox");
    expect(() => svgDimensions("0", "10", null)).toThrow("positive");
  });
  it("recognizes SVG MIME types and files without a MIME type", () => {
    expect(isSvgFile({ type: "", name: "emoji.SVG" })).toBe(true);
    expect(isSvgFile({ type: "image/svg+xml", name: "emoji" })).toBe(true);
    expect(isSvgFile({ type: "image/png", name: "emoji.png" })).toBe(false);
  });
  it("round trips artwork names while keeping only raster content in templates", () => {
    const element = { ...makeElement("image"), imageName: "Heart icon", content: "data:image/png;base64,iVBORw0KGgo=" };
    const document = { ...initialDocument(), elements: [element] };
    expect(parseDocument(document).elements[0].imageName).toBe("Heart icon");
    expect(() => parseDocument({ ...document, elements: [{ ...element, imageName: "bad\nname" }] })).toThrow("artwork name");
    expect(() => parseDocument({ ...document, elements: [{ ...element, kind: "text" }] })).toThrow("artwork name");
    expect(() => parseDocument({ ...document, elements: [{ ...element, content: "data:image/svg+xml;base64,PHN2Zy8+" }] })).toThrow("embedded PNG");
  });
});
