import { describe, expect, it } from "vitest";
import {
  encodeWebPrint,
  monochrome,
  validatePrintJob,
  type WebPrintJob,
} from "./web-protocol";
const job = (overrides: Partial<WebPrintJob> = {}): WebPrintJob => ({
  widthMm: 10,
  heightMm: 10,
  gapMm: 2,
  dpi: 203,
  copies: 1,
  density: 8,
  rgba: new Uint8Array(80 * 80 * 4).fill(255),
  widthPx: 80,
  heightPx: 80,
  threshold: 128,
  protocol: "zpl",
  ...overrides,
});
describe("browser raster compatibility", () => {
  it("packs MSB-first pixels, composites alpha and keeps edge padding white", () => {
    const rgba = new Uint8Array(9 * 4).fill(255);
    for (const index of [0, 7, 8]) rgba.fill(0, index * 4, index * 4 + 3);
    expect([...monochrome(job({ widthPx: 9, heightPx: 1, rgba }))]).toEqual([
      0x81, 0x80,
    ]);
    rgba[3] = 0;
    expect([...monochrome(job({ widthPx: 9, heightPx: 1, rgba }))]).toEqual([
      0x01, 0x80,
    ]);
  });
  it("matches TSPL polarity, dimensions and trailing copies without text-decoding raster bytes", async () => {
    const j = job({ protocol: "tspl", copies: 2 });
    (j.rgba as Uint8Array).fill(0, 0, 3);
    const bytes = await encodeWebPrint(j),
      header = new TextEncoder().encode("BITMAP 0,0,10,80,0,");
    const decoded = new TextDecoder().decode(bytes),
      start = decoded.indexOf("BITMAP");
    expect([
      ...bytes.slice(start + header.length, start + header.length + 2),
    ]).toEqual([0x7f, 0xff]);
    expect(decoded.endsWith("\nPRINT 1,2\n")).toBe(true);
  });
  it("round-trips each zlib/base64 band to the native encoder raster layout", async () => {
    const j = job({
      heightMm: 40,
      heightPx: 320,
      rgba: new Uint8Array(80 * 320 * 4).fill(255),
    });
    (j.rgba as Uint8Array).fill(0, 80 * 256 * 4, 80 * 256 * 4 + 3);
    const encoded = new TextDecoder().decode(await encodeWebPrint(j));
    const bands = [
      ...encoded.matchAll(
        /\^FO0,(\d+)\n\^GFA,(\d+),(\d+),(\d+),:Z64:([\s\S]*?)\^FS/g,
      ),
    ];
    expect(bands.map((b) => Number(b[1]))).toEqual([0, 256]);
    const raster = monochrome(j);
    for (const band of bands) {
      const compressed = Uint8Array.from(
        atob(band[5].replace(/\s/g, "")),
        (c) => c.charCodeAt(0),
      );
      const actual = new Uint8Array(
        await new Response(
          new Blob([compressed])
            .stream()
            .pipeThrough(new DecompressionStream("deflate")),
        ).arrayBuffer(),
      );
      expect(actual).toEqual(
        raster.slice(
          Number(band[1]) * 10,
          Number(band[1]) * 10 + Number(band[2]),
        ),
      );
    }
    expect(encoded.endsWith("^PQ1\n^XZ\n")).toBe(true);
  });
  it("rejects inconsistent sizes and oversized copies before print encoding", () => {
    expect(() => validatePrintJob(job({ widthPx: 79 }))).toThrow("dimensions");
    expect(() => validatePrintJob(job({ copies: 101 }))).toThrow("copies");
    expect(() => validatePrintJob(job({ rgba: new Uint8Array() }))).toThrow(
      "RGBA",
    );
  });
});
