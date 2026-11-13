import { describe, it, expect } from "vitest";
import {
  initialDocument,
  mmToPx,
  monochrome,
  parseCsv,
  parseDocument,
  substitute,
  makeElement, componentContent, requiredCsvColumns, validateCsvColumns, sampleCsv,
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

describe("component settings and CSV bindings",()=>{
  it("maps distinct component IDs and shared IDs without changing stable editor IDs",()=>{
    const name={...makeElement("text"),dataId:"name",content:"Fallback"};
    const item={...makeElement("qr"),dataId:"item"};
    expect(componentContent(name,{name:"שלום",item:"42"})).toBe("שלום");
    expect(componentContent(item,{name:"שלום",item:"42"})).toBe("42");
    expect(componentContent(name,{name:""})).toBe("");
    expect(componentContent(name,{})).toBe("Fallback");
    expect(name.id).not.toBe(name.dataId);
  });
  it("exports quoted required columns and validates all CSV rows",()=>{
    const doc={...initialDocument(),elements:[{...makeElement("text"),dataId:'name,part',content:'A "part"'},{...makeElement("qr"),dataId:"item",content:"https://example.com"},{...makeElement("barcode"),dataId:"item"},{...makeElement("text"),content:"{{note}}"}]};
    expect(requiredCsvColumns(doc)).toEqual(['name,part','item','note']);
    const rows=parseCsv(sampleCsv(doc));
    expect(rows[0]['name,part']).toBe('A "part"');
    expect(()=>validateCsvColumns(doc,rows)).not.toThrow();
    expect(()=>validateCsvColumns(doc,[rows[0],{item:"x"}])).toThrow("row 2");
  });
  it("round trips modern settings and rejects malformed imported settings",()=>{
    const e={...makeElement("qr"),rotation:37.5,dataId:"item",qrBackground:false,qrShowLogo:true,qrLogo:"data:image/png;base64,YQ==",barcodeShowText:false,strokeWidth:1.5,crop:{x:0.1,y:0.2,width:0.8,height:0.7}};
    const doc={...initialDocument(),elements:[e]};
    expect(parseDocument(doc).elements[0]).toEqual(e);
    for(const patch of [{qrLogo:"https://example.com/logo.png"},{qrBackground:"no"},{strokeWidth:0},{crop:{x:0.5,y:0,width:0.8,height:1}},{rotation:-1},{dataId:"bad\ncolumn"}])expect(()=>parseDocument({...doc,elements:[{...e,...patch}]})).toThrow();
  });
});
