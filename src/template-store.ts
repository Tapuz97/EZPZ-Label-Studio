import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseDocument, type LabelDocument } from "./model";
export type SavedTemplate = { id: string; document: LabelDocument };
export type TemplateLibrary = { templates: SavedTemplate[]; location: string; fallback: boolean };
const libraryKey = "label-studio.library.v1";
function validateLibrary(value: unknown): SavedTemplate[] {
  if (!Array.isArray(value) || value.length > 30) throw Error("Your existing template library could not be read. Nothing was changed.");
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw Error("Invalid template library ID.");
    ids.add(item.id);
    return { id: item.id, document: parseDocument(item.document) };
  });
}
export async function loadTemplateLibrary(legacy: SavedTemplate[]): Promise<TemplateLibrary> {
  if (isTauri()) {
    const result = await invoke<TemplateLibrary>("load_template_library", { legacy });
    return { ...result, templates: validateLibrary(result.templates) };
  }
  const value = localStorage.getItem(libraryKey);
  return { templates: validateLibrary(value ? JSON.parse(value) : legacy), location: "This browser’s storage (on this device)", fallback: false };
}
export async function saveTemplateLibrary(templates: SavedTemplate[]): Promise<TemplateLibrary> {
  const validated = validateLibrary(templates);
  if (isTauri()) {
    const result = await invoke<TemplateLibrary>("save_template_library", { templates: validated });
    return { ...result, templates: validateLibrary(result.templates) };
  }
  localStorage.setItem(libraryKey, JSON.stringify(validated));
  return { templates: validated, location: "This browser’s storage (on this device)", fallback: false };
}
