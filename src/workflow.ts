import type { LabelDocument } from "./model";
export const commonPresets = [
  [20, 10],
  [25, 15],
  [30, 20],
  [30, 30],
  [40, 20],
  [40, 30],
  [40, 40],
  [50, 25],
  [50, 30],
  [50, 50],
  [60, 40],
  [60, 90],
  [70, 50],
  [70, 100],
  [80, 50],
  [80, 100],
  [100, 50],
  [100, 100],
  [100, 150],
].map(([widthMm, heightMm]) => ({
  label: widthMm + " × " + heightMm + " mm",
  widthMm,
  heightMm,
}));
export function printerProtocol(name: string): "zpl" | "tspl" {
  return /^(XP-428A|4B-2084A|DB402)(?:$|[ -])/i.test(name.trim())
    ? "tspl"
    : "zpl";
}
export const picturePresets = [
  { label: "4 × 4 in", widthMm: 101.6, heightMm: 101.6 },
  { label: "4 × 6 in", widthMm: 101.6, heightMm: 152.4 },
  { label: "4 × 8 in", widthMm: 101.6, heightMm: 203.2 },
] as const;
export function parsePages(text: string, count: number) {
  const pages = new Set<number>();
  for (const part of text.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw Error("Use page numbers such as 1–3 (with a hyphen), 5.");
    const a = Number(match[1]),
      b = Number(match[2] ?? a);
    if (a < 1 || b < a || b > count || b - a >= 50)
      throw Error("Choose valid pages, up to 50 per import.");
    for (let p = a; p <= b; p++) pages.add(p);
  }
  if (!pages.size || pages.size > 50) throw Error("Choose 1–50 pages.");
  return [...pages];
}
export function validateSize(widthMm: number, heightMm: number, dpi: number) {
  if (
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm < 10 ||
    widthMm > 216 ||
    heightMm < 10 ||
    heightMm > 500
  )
    throw Error("Label size must be 10–216 mm wide and 10–500 mm high.");
  if (
    Math.round((widthMm * dpi) / 25.4) * Math.round((heightMm * dpi) / 25.4) >
    8_000_000
  )
    throw Error(
      "This size exceeds 8 million pixels. Reduce the size or resolution.",
    );
}
export function fitArtwork(
  width: number,
  height: number,
  label: Pick<LabelDocument, "widthMm" | "heightMm">,
  margin: number,
) {
  const scale = Math.min(
    (label.widthMm - margin * 2) / width,
    (label.heightMm - margin * 2) / height,
  );
  const w = width * scale,
    h = height * scale;
  return {
    x: (label.widthMm - w) / 2,
    y: (label.heightMm - h) / 2,
    width: w,
    height: h,
  };
}
export const pdfOptions = {
  cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
  useSystemFonts: false,
  iccUrl: `${import.meta.env.BASE_URL}pdfjs/iccs/`,
};
