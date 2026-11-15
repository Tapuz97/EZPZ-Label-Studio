import { describe, expect, it } from "vitest";
import { initialDocument } from "./model";
import { connectedSettings, densityRange, readyToPrint, validateDocumentForPrinter, type PrinterProfile } from "./printer-profile";

const d110: PrinterProfile = {
  protocol: "niimbot", supportedForPrinting: true,
  capabilities: { modelId: 2304, dpi: 203, maxWidthDots: 96, densityMin: 1, densityMax: 3, densityDefault: 2 },
};
const label = { widthMm: 30, heightMm: 12, dpi: 203 as const, density: 2 };

describe("connection-aware print preflight", () => {
  it("requires a supported connection rather than a writable endpoint or name", () => {
    for (const connection of [null, {}, { protocol: "niimbot" as const }, { protocol: "unsupported" as const, supportedForPrinting: true }])
      expect(readyToPrint(connection)).toBe(false);
    expect(readyToPrint(d110)).toBe(true);
  });
  it("accepts D110 labels in either design orientation", () => {
    expect(() => validateDocumentForPrinter(d110, label)).not.toThrow();
    expect(() => validateDocumentForPrinter(d110, { ...label, widthMm: 12, heightMm: 30 })).not.toThrow();
    expect(() => validateDocumentForPrinter(d110, { ...label, heightMm: 15 })).not.toThrow();
  });
  it("rejects incompatible stock, density and resolution without changing artwork", () => {
    for (const patch of [{ widthMm: 60, heightMm: 90 }, { heightMm: 16 }, { widthMm: 101 }, { dpi: 300 }, { density: 8 }] as const)
      expect(() => validateDocumentForPrinter(d110, { ...label, ...patch })).toThrow();
    expect(label).toEqual({ widthMm: 30, heightMm: 12, dpi: 203, density: 2 });
  });
  it("adapts resolution and density without saving NIIMBOT into portable designs", () => {
    const document = { ...initialDocument(), dpi: 300 as const };
    expect(connectedSettings(d110, document)).toEqual({ dpi: 203, density: 2 });
    expect(densityRange(d110)).toEqual({ min: 1, max: 3, default: 2 });
  });
  it("preserves legacy printer settings and validates reported widths on web too", () => {
    const zpl: PrinterProfile = { protocol: "zpl", supportedForPrinting: true };
    expect(connectedSettings(zpl, initialDocument())).toEqual({ protocol: "zpl" });
    expect(() => validateDocumentForPrinter(zpl, initialDocument())).not.toThrow();
    expect(() => validateDocumentForPrinter({ ...zpl, capabilities: { maxWidthDots: 96 } }, label)).toThrow();
    expect(() => validateDocumentForPrinter({ protocol: "unsupported" }, label)).toThrow();
  });
  it("applies a recognized roll only to an empty design", () => {
    const connection = { ...d110, capabilities: { ...d110.capabilities, stockCode: "02282280" } };
    expect(connectedSettings(connection, initialDocument())).not.toHaveProperty("widthMm");
    expect(connectedSettings(connection, { ...initialDocument(), elements: [] })).toMatchObject({ widthMm: 30, heightMm: 15 });
  });
});
