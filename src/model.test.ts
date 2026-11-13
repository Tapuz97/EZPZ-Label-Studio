import { describe, it, expect } from "vitest";
import {
  initialDocument,
  mmToPx,
  monochrome,
  parseCsv,
  parseDocument,
  substitute,
} from "./model";
describe("label documents", () => {
  it("round-trips a validated label", () => {
    const d = initialDocument();
    expect(parseDocument(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it("rejects invalid dimensions and duplicate element IDs", () => {
    const d = initialDocument();
    expect(() => parseDocument({ ...d, widthMm: 10000 })).toThrow();
    expect(() =>
      parseDocument({ ...d, elements: [d.elements[0], d.elements[0]] }),
    ).toThrow();
  });
  it("rejects remote and script-bearing images", () => {
    const d = initialDocument();
    for (const content of [
      "https://example.com/a.png",
      "data:image/svg+xml,<svg/>",
    ])
      expect(() =>
        parseDocument({
          ...d,
          elements: [{ ...d.elements[0], kind: "image", content }],
        }),
      ).toThrow();
  });
  it("maps mm to actual print pixels", () => {
    expect(mmToPx(25.4, 203)).toBe(203);
    expect(mmToPx(60, 203)).toBe(480);
  });
  it("imports older label files with safe printer, font and barcode defaults", () => {
    const d = initialDocument();
    const old = JSON.parse(JSON.stringify(d));
    delete old.protocol;
    for (const e of old.elements) {
      delete e.fontFamily;
      delete e.barcodeFormat;
    }
    const imported = parseDocument(old);
    expect(imported.protocol).toBe("zpl");
    expect(
      imported.elements.every(
        (e) => e.fontFamily === "Arial" && e.barcodeFormat === "CODE128",
      ),
    ).toBe(true);
  });
  it("accepts supported font and barcode choices and rejects unknown imported choices", () => {
    const d = initialDocument();
    for (const barcodeFormat of ["CODE128", "CODE39", "EAN13", "UPC", "ITF14"])
      expect(
        parseDocument({
          ...d,
          elements: [
            { ...d.elements[0], fontFamily: "Consolas", barcodeFormat },
          ],
        }).elements[0].barcodeFormat,
      ).toBe(barcodeFormat);
    for (const patch of [
      { fontFamily: "url(https://example.com/font)" },
      { barcodeFormat: "OTHER" },
    ])
      expect(() =>
        parseDocument({ ...d, elements: [{ ...d.elements[0], ...patch }] }),
      ).toThrow();
    expect(() => parseDocument({ ...d, protocol: "escpos" })).toThrow();
  });
});
describe("CSV data", () => {
  it("handles quoted commas, escaped quotes and embedded newlines", () =>
    expect(
      parseCsv('name,note\r\n"Bolt, M3","A ""good"" part\nReady"'),
    ).toEqual([{ name: "Bolt, M3", note: 'A "good" part\nReady' }]));
  it("rejects malformed and ambiguous data", () => {
    expect(() => parseCsv("name,name\na,b")).toThrow();
    expect(() => parseCsv("name,note\na")).toThrow();
    expect(() => parseCsv('name\n"a')).toThrow();
  });
  it("substitutes only matching columns without evaluating code", () =>
    expect(substitute("{{name}} · {{unknown}}", { name: "שלום" })).toBe(
      "שלום · {{unknown}}",
    ));
});
describe("monochrome raster", () => {
  it("composites transparency on white and applies luminance threshold", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0, 0, 0, 0, 255, 200, 200, 200, 255, 100, 100, 100, 255,
    ]);
    monochrome(pixels, 160);
    expect(Array.from(pixels)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });
});
