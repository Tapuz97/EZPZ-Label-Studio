// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanSvg } from "./graphics";

const svg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${content}</svg>`;
describe("SVG artwork preparation", () => {
  it("removes executable content while preserving static artwork", () => {
    const root = cleanSvg('<svg viewBox="0 0 24 24" onload="window.bad=1"><script>window.bad=1</script><foreignObject><p>bad</p></foreignObject><circle cx="12" cy="12" r="9" onclick="window.bad=1"/></svg>');
    expect(root.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(root.querySelector("script, foreignObject")).toBeNull();
    expect(root.hasAttribute("onload")).toBe(false);
    expect(root.querySelector("circle")?.hasAttribute("onclick")).toBe(false);
  });
  it("preserves internal symbols, gradients, styles and clipping", () => {
    const root = cleanSvg(svg('<style>.outline{fill:none;stroke:black}</style><defs><circle id="dot" r="3"/><clipPath id="clip"><rect width="20" height="20"/></clipPath><linearGradient id="ink"><stop stop-color="black"/></linearGradient></defs><use href="#dot"/><path class="outline" clip-path="url(#clip)" fill="url(#ink)" d="M0 0h20"/>'));
    expect(root.querySelector("use")?.getAttribute("href")).toBe("#dot");
    expect(root.querySelector("linearGradient")).not.toBeNull();
    expect(root.querySelector("style")?.textContent).toContain("stroke:black");
    expect(root.querySelector("path")?.getAttribute("clip-path")).toBe("url(#clip)");
  });
  it.each([
    '<image href="https://example.com/a.png"/>',
    '<use href="https://example.com/a.svg#dot"/>',
    '<image href="file:///C:/private.png"/>',
    '<style>@import "https://example.com/style.css";</style>',
    '<path fill="url(https://example.com/a.svg#dot)" d="M0 0h2"/>',
    '<path style="fill:u\\72l(https://example.com/a.svg#dot)" d="M0 0h2"/>',
    '<style>.x{fill:url(/*comment*/https://example.com/a.svg#dot)}</style>',
    '<style>@font-face{font-family:x;src:url(https://example.com/a.woff)}</style>',
    '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
  ])("rejects external or nested active content: %s", content => {
    expect(() => cleanSvg(svg(content))).toThrow("self-contained SVG");
  });
  it("allows embedded raster images, without allowing nested SVG images", () => {
    const root = cleanSvg(svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="24" height="24"/>'));
    expect(root.querySelector("image")?.getAttribute("href")).toContain("data:image/png;");
  });
  it("rejects malformed XML, entity declarations and empty artwork", () => {
    expect(() => cleanSvg("<svg><path>")).toThrow("valid SVG");
    expect(() => cleanSvg("<!DOCTYPE svg><svg/>")).toThrow("self-contained SVG");
    expect(() => cleanSvg(svg("<title>Empty</title>"))).toThrow("printable artwork");
    expect(() => cleanSvg("<html xmlns=\"http://www.w3.org/1999/xhtml\"><body/></html>")).toThrow("valid SVG");
  });
});
