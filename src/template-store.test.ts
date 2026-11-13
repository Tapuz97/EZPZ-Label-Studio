import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ native: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => runtime.native, invoke: runtime.invoke }));
import { loadTemplateLibrary, saveTemplateLibrary } from "./template-store";
import { initialDocument } from "./model";
const key = "label-studio.library.v1";
let values: Map<string, string>;
beforeEach(() => {
  runtime.native = false; runtime.invoke.mockReset(); values = new Map();
  vi.stubGlobal("localStorage", { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => values.set(name, value) });
});
const sample = () => [{ id: "saved-1", document: initialDocument() }];
describe("persistent template bridge", () => {
  it("reloads the saved browser library instead of stale initial entries", async () => {
    const saved = sample(); await saveTemplateLibrary(saved);
    expect((await loadTemplateLibrary([])).templates).toEqual(saved);
  });
  it("keeps the previous browser library if validation or quota checks fail", async () => {
    const saved = sample(); await saveTemplateLibrary(saved); const before = values.get(key);
    await expect(saveTemplateLibrary([...saved, ...saved])).rejects.toThrow(/ID/);
    expect(values.get(key)).toBe(before);
    vi.stubGlobal("localStorage", { getItem: (name: string) => values.get(name) ?? null, setItem: () => { throw Error("Quota exceeded"); } });
    await expect(saveTemplateLibrary([])).rejects.toThrow(/Quota/);
    expect(values.get(key)).toBe(before);
  });
  it("does not reset a corrupt browser library", async () => {
    values.set(key, "broken"); await expect(loadTemplateLibrary([])).rejects.toThrow();
    expect(values.get(key)).toBe("broken");
  });
  it("passes legacy templates for native migration and accepts the established disk library", async () => {
    runtime.native = true; const disk = sample(); const legacy = [{ ...sample()[0], id: "legacy" }];
    runtime.invoke.mockResolvedValue({ templates: disk, location: "C:/Users/test/templates", fallback: true });
    const result = await loadTemplateLibrary(legacy);
    expect(runtime.invoke).toHaveBeenCalledWith("load_template_library", { legacy });
    expect(result.templates).toEqual(disk); expect(result.fallback).toBe(true);
    expect(values.size).toBe(0);
  });
  it("surfaces native failures without changing the source library or browser backup", async () => {
    runtime.native = true; const saved = sample(); const before = JSON.stringify(saved); values.set(key, before);
    runtime.invoke.mockRejectedValue(Error("Access denied"));
    await expect(saveTemplateLibrary(saved)).rejects.toThrow(/Access denied/);
    expect(JSON.stringify(saved)).toBe(before); expect(values.get(key)).toBe(before);
  });
});
