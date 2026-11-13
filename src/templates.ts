import { parseDocument } from "./model";
import type { LabelDocument } from "./model";

export const templateBundleFormat = "ezpz-label-studio.templates";

function parseTemplateList(value: unknown): LabelDocument[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    throw Error("Choose a template bundle containing 1–30 templates.");
  }
  // Validate the complete bundle before returning anything to the library.
  return value.map((document, index) => {
    try {
      return parseDocument(document);
    } catch (cause) {
      throw Error(
        `Template ${index + 1}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  });
}

export function parseTemplateFile(value: unknown): LabelDocument[] {
  if (typeof value === "object" && value !== null && "format" in value) {
    if (value.format !== templateBundleFormat)
      throw Error("This is not a supported template bundle.");
    const bundle = value as { version?: unknown; templates?: unknown };
    if (bundle.version !== 1)
      throw Error("Unsupported template bundle version.");
    return parseTemplateList(bundle.templates);
  }
  return [parseDocument(value)];
}

export function templateBundle(templates: LabelDocument[]) {
  return {
    format: templateBundleFormat,
    version: 1 as const,
    templates: parseTemplateList(templates),
  };
}
