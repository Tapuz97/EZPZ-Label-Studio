import { describe, expect, it } from "vitest";
import { initialDocument } from "./model";
import {
  parseTemplateFile,
  parseTemplateFiles,
  templateBundle,
  templateBundleFormat,
} from "./templates";

describe("portable template files", () => {
  it("imports a legacy single label and a selected-template bundle", () => {
    const first = initialDocument();
    const second = {
      ...initialDocument(),
      name: "Second template",
      widthMm: 40,
      heightMm: 30,
    };
    expect(parseTemplateFile(first)).toEqual([first]);
    const serialized = JSON.parse(
      JSON.stringify(templateBundle([second, first])),
    );
    expect(parseTemplateFile(serialized)).toEqual([second, first]);
  });
  it("rejects an entire bundle when a later template is malformed, without modifying its input", () => {
    const first = initialDocument();
    const malformed = { ...initialDocument(), widthMm: -1 };
    const bundle = {
      format: templateBundleFormat,
      version: 1,
      templates: [first, malformed],
    };
    const before = JSON.stringify(bundle);
    expect(() => parseTemplateFile(bundle)).toThrow(/Template 2:/);
    expect(JSON.stringify(bundle)).toBe(before);
  });
  it("rejects unsupported format/version and absent, empty or oversized template lists", () => {
    for (const value of [
      { format: "different", version: 1, templates: [initialDocument()] },
      {
        format: templateBundleFormat,
        version: 2,
        templates: [initialDocument()],
      },
      { format: templateBundleFormat, version: 1 },
      { format: templateBundleFormat, version: 1, templates: [] },
      {
        format: templateBundleFormat,
        version: 1,
        templates: Array.from({ length: 31 }, initialDocument),
      },
    ])
      expect(() => parseTemplateFile(value)).toThrow();
  });
  it("validates outgoing selections and creates detached documents", () => {
    expect(() => templateBundle([])).toThrow();
    const original = initialDocument();
    const bundle = templateBundle([original]);
    bundle.templates[0].elements[0].content = "Changed after export";
    expect(original.elements[0].content).not.toBe("Changed after export");
  });
});


describe("multiple template file imports", () => {
  const file = (name: string, value: unknown) => ({ name, size: 100, text: async () => JSON.stringify(value) }) as File;
  it("combines single files and bundles after complete validation", async () => {
    const a = initialDocument(), b = { ...initialDocument(), name: "B" };
    expect(await parseTemplateFiles([file("a.json", a), file("b.json", templateBundle([b]))])).toEqual([a, b]);
  });
  it("rejects the entire selection when a later file is invalid", async () => {
    await expect(parseTemplateFiles([file("good.json", initialDocument()), file("bad.json", { version: -1 })])).rejects.toThrow(/bad.json/);
  });
  it("enforces total template and byte budgets", async () => {
    const bundle = templateBundle(Array.from({ length: 30 }, initialDocument));
    await expect(parseTemplateFiles([file("bundle.json", bundle), file("extra.json", initialDocument())])).rejects.toThrow(/more than 30/);
    await expect(parseTemplateFiles([{ ...file("large.json", initialDocument()), size: 36_000_001 } as File])).rejects.toThrow(/36 MB/);
  });
});
