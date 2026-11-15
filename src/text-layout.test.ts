import { describe, expect, it } from "vitest";
import { wrapText } from "./text-layout";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const measure = (text: string) => [...graphemes.segment(text)].length;
describe("Unicode text layout", () => {
  it("preserves joined emoji, skin tones, flags and keycaps when wrapping", () => {
    const text = "👨‍👩‍👧‍👦👍🏽🇮🇱1️⃣😀";
    expect(wrapText(text, 2, measure)).toEqual(["👨‍👩‍👧‍👦👍🏽", "🇮🇱1️⃣", "😀"]);
  });
  it("keeps word wrapping, explicit empty lines and ASCII emoticons", () => {
    expect(wrapText("Hello :-) world\n\n:D", 10, measure)).toEqual(["Hello :-)", "world", "", ":D"]);
  });
  it("keeps RTL combining marks attached to their letter", () => {
    expect(wrapText("שָׁלוֹם", 2, measure)).toEqual(["שָׁל", "וֹם"]);
  });
});
