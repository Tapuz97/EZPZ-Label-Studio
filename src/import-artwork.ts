import { fitArtwork } from "./workflow";
export type ArtworkOrientation = "vertical" | "horizontal";
export function artworkOrientation(
  width: number,
  height: number,
): ArtworkOrientation {
  return width > height ? "horizontal" : "vertical";
}
export function orientLabel(
  widthMm: number,
  heightMm: number,
  orientation: ArtworkOrientation,
) {
  return orientation === "horizontal"
    ? {
        widthMm: Math.max(widthMm, heightMm),
        heightMm: Math.min(widthMm, heightMm),
      }
    : {
        widthMm: Math.min(widthMm, heightMm),
        heightMm: Math.max(widthMm, heightMm),
      };
}
export function artworkPlacement(
  sourceWidth: number,
  sourceHeight: number,
  size: { widthMm: number; heightMm: number },
  margin: number,
  scalePercent: number,
) {
  if (
    !Number.isFinite(margin) ||
    margin < 0 ||
    margin * 2 >= Math.min(size.widthMm, size.heightMm)
  )
    throw Error("Margins must leave space for the artwork.");
  if (!Number.isFinite(scalePercent) || scalePercent < 1 || scalePercent > 100)
    throw Error("Print scale must be between 1% and 100%.");
  const fitted = fitArtwork(sourceWidth, sourceHeight, size, margin);
  const width = (fitted.width * scalePercent) / 100,
    height = (fitted.height * scalePercent) / 100;
  return {
    x: (size.widthMm - width) / 2,
    y: (size.heightMm - height) / 2,
    width,
    height,
  };
}
