import { describe, expect, it, vi, afterEach } from "vitest";
import { fontBytes, parseFonts, type CustomFont } from "./font-types";
import { canvasFont, ensureCustomFont, hasEmoji, withDocumentFonts } from "./fonts";
import { initialDocument, parseDocument } from "./model";

const bytes = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const data = `data:font/ttf;base64,${btoa(String.fromCharCode(...bytes))}`;
const font: CustomFont = { family: `EZPZFont_${"a".repeat(64)}`, name: "My font", data };
afterEach(() => vi.unstubAllGlobals());
describe("portable custom fonts", () => {
  it("round trips embedded fonts through the same template parser as imports", () => {
    const d = initialDocument();
    d.elements[0].fontFamily = font.family;
    const portable = withDocumentFonts(d, [font]);
    expect(parseDocument(JSON.parse(JSON.stringify(portable))).fonts).toEqual([font]);
    expect(portable.elements[0].fontFamily).toBe(font.family);
    expect(withDocumentFonts({ ...portable, elements: [] }, []).fonts).toEqual([]);
  });
  it("requires the font file and rejects external URLs, duplicates and malformed data", () => {
    const d = initialDocument();
    d.elements[0].fontFamily = font.family;
    expect(() => parseDocument(d)).toThrow("Unsupported font");
    expect(() => withDocumentFonts(d, [])).toThrow("not available");
    expect(() => parseFonts([font, font])).toThrow("Invalid embedded font");
    expect(() => parseFonts([{ ...font, data: "https://example.com/font.ttf" }])).toThrow();
    expect(() => parseFonts([{ ...font, data: "data:font/ttf;base64,YmFk" }])).toThrow();
    expect(() => parseFonts([{ ...font, family: 'Arial", url(evil)' }])).toThrow();
  });
  it("rejects oversized files before decoding them", () => {
    expect(() => fontBytes(`data:font/ttf;base64,${"A".repeat(2_666_672)}`)).toThrow("2 MB");
    expect(() => parseFonts(Array.from({ length: 21 }, () => font))).toThrow("up to 20");
  });
  it.each([["ttf", "\x00\x01\x00\x00"], ["otf", "OTTO"], ["woff", "wOFF"], ["woff2", "wOF2"]])(
    "checks the binary signature of %s fonts",
    (format, signature) => {
      const body = btoa(signature + "\0".repeat(8));
      expect(fontBytes(`data:font/${format};base64,${body}`)).toHaveLength(12);
      expect(() => fontBytes(`data:font/${format};base64,${btoa("nope" + "\0".repeat(8))}`)).toThrow();
    },
  );
  it("checks the content hash before trusting a font family from an imported template", async () => {
    await expect(ensureCustomFont(font)).rejects.toThrow("damaged");
  });
  it("waits for font loading and only registers a successfully decoded font", async () => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
    const asset = { ...font, family: `EZPZFont_${hash}` };
    let finish!: () => void;
    const add = vi.fn();
    const load = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.stubGlobal("FontFace", class { load = load; });
    vi.stubGlobal("document", { fonts: { add } });
    const ready = ensureCustomFont(asset);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(add).not.toHaveBeenCalled();
    finish();
    await ready;
    expect(add).toHaveBeenCalledOnce();
  });
});
describe("emoji font selection", () => {
  it("detects joined emoji, flags and keycaps without altering plain ASCII", () => {
    for (const text of ["😀", "👨‍👩‍👧‍👦", "👍🏽", "🇮🇱", "1️⃣", "❤️"]) expect(hasEmoji(text)).toBe(true);
    expect(hasEmoji("ASCII :-) 123")).toBe(false);
    expect(canvasFont("Consolas", 18, true)).toBe('700 18px "Consolas", "EZPZ Emoji", "Segoe UI Symbol", sans-serif');
  });
});
