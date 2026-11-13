import { describe, expect, it } from "vitest";
import { shouldConfirmDiscard } from "./unsaved-work";

describe("unsaved-work close decisions", () => {
  it("does not warn on empty Home or after explicit save", () => {
    expect(shouldConfirmDiscard(new Map(), false)).toBe(false);
    expect(shouldConfirmDiscard(new Map([["editor", false]]), false)).toBe(false);
  });
  it("protects every dirty source on app close but scopes import close", () => {
    const dirty = new Map([["editor", true], ["import", false]]);
    expect(shouldConfirmDiscard(dirty, false)).toBe(true);
    expect(shouldConfirmDiscard(dirty, false, "import")).toBe(false);
    dirty.set("import", true);
    expect(shouldConfirmDiscard(dirty, false, "import")).toBe(true);
    dirty.delete("import");
    expect(shouldConfirmDiscard(dirty, false)).toBe(true);
  });
  it("honors the explicit persisted opt-out for both scopes", () => {
    const dirty = new Map([["editor", true], ["import", true]]);
    expect(shouldConfirmDiscard(dirty, true)).toBe(false);
    expect(shouldConfirmDiscard(dirty, true, "import")).toBe(false);
  });
});
