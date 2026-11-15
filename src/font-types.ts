export const systemFonts = ["Arial", "Segoe UI", "Consolas", "Courier New", "Times New Roman"] as const;
export const maxFontBytes = 2_000_000;
export const maxDocumentFontBytes = 4_000_000;
export type CustomFont = { family: string; name: string; data: string };
/** Length of a validated base64 font, without allocating another byte buffer. */
export const fontByteLength = (data: string) =>
  (data.length - data.indexOf(",") - 1) * 3 / 4 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
export const isCustomFontFamily = (family: unknown): family is string =>
  typeof family === "string" && /^EZPZFont_[a-f0-9]{64}$/.test(family);

export function fontBytes(data: string): Uint8Array<ArrayBuffer> {
  const match = /^data:font\/(ttf|otf|woff|woff2);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2].length > Math.ceil(maxFontBytes / 3) * 4 || match[2].length % 4)
    throw Error("Choose a TTF, OTF, WOFF or WOFF2 font up to 2 MB.");
  const decoded = atob(match[2]);
  const signature = decoded.slice(0, 4);
  const valid: Record<string, string> = { ttf: "\x00\x01\x00\x00", otf: "OTTO", woff: "wOFF", woff2: "wOF2" };
  if (decoded.length < 12 || decoded.length > maxFontBytes || signature !== valid[match[1]])
    throw Error("This file is not a supported font.");
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export function parseFonts(value: unknown): CustomFont[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw Error("A label can include up to 20 fonts.");
  const seen = new Set<string>();
  let total = 0;
  return value.map((item) => {
    if (!item || !isCustomFontFamily(item.family) || seen.has(item.family) ||
      typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 ||
      /[\u0000-\u001f]/.test(item.name) || typeof item.data !== "string")
      throw Error("Invalid embedded font.");
    total += fontBytes(item.data).length;
    if (total > maxDocumentFontBytes) throw Error("Fonts in one label must total 4 MB or less.");
    seen.add(item.family);
    return { family: item.family, name: item.name.trim(), data: item.data };
  });
}
