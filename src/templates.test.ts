import { describe, expect, it } from "vitest";
import { initialDocument } from "./model";
import {
  parseTemplateFile,
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
