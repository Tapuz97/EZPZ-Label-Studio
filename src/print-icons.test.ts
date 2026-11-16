import { describe, expect, it } from "vitest";
import data from "./print-icons.json";
import { findIcons, iconName, iconSvg } from "./print-icons";
import type { IconCatalog } from "./print-icons";
const catalog = data as IconCatalog;
describe("offline printable icon pack", () => {
  it("contains unique icons from the pinned Lucide pack", () => {
    expect(catalog.provider).toBe("Lucide");
    expect(catalog.version).toBe("1.72.0");
    expect(catalog.icons).toHaveLength(2052);
    expect(new Set(catalog.icons.map(i => i.id)).size).toBe(catalog.icons.length);
  });
  it("searches names, multiword queries and common synonyms", () => {
    expect(findIcons(catalog.icons, "heart").some(i => i.id === "heart")).toBe(true);
    expect(findIcons(catalog.icons, "arrow left").every(i => i.id.includes("arrow") && i.id.includes("left"))).toBe(true);
    expect(findIcons(catalog.icons, "shipping").some(i => i.id === "truck")).toBe(true);
    expect(findIcons(catalog.icons, "smile").some(i => i.id === "face-slightly-smiling")).toBe(true);
    expect(findIcons(catalog.icons, "happy").some(i => i.id === "face-grinning")).toBe(true);
    expect(findIcons(catalog.icons, "xyznotanicon")).toEqual([]);
    expect(iconName("package-check")).toBe("Package Check");
  });
  it("serializes every icon as self-contained black vector artwork", () => {
    for (const icon of catalog.icons) {
      const svg = iconSvg(icon);
      expect(svg).toContain('stroke="black"');
      expect(svg).not.toMatch(/<script|<foreignObject|(?:href|style|onload)=|url\(/i);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(icon.node.length).toBeGreaterThan(0);
    }
  });
});
