import DOMPurify from "dompurify";
import { fitArtwork } from "./workflow";
import type { LabelDocument } from "./model";

export type PrintableGraphic = {
  data: string;
  width: number;
  height: number;
  name: string;
  widthMm?: number;
  heightMm?: number;
};
const svgNamespace = "http://www.w3.org/2000/svg";
const linkedContentError = "Choose a self-contained SVG without linked images, fonts or stylesheets.";
export const isSvgFile = (file: Pick<File, "name" | "type">) =>
  file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

function localReference(value: string) {
  return /^#[\w:.-]+$/.test(value.trim()) ||
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value.trim());
}
function checkCss(value: string) {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "");
  // CSS escapes and at-rules can hide a remote import or an external font.
  if (/[\\@]/.test(css) || /(?:expression|image-set|image)\s*\(/i.test(css))
    throw Error(linkedContentError);
  const rest = css.replace(/url\s*\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote, url: string) => {
    if (!localReference(url)) throw Error(linkedContentError);
    return "";
  });
  if (/url\s*\(/i.test(rest)) throw Error(linkedContentError);
}

/** Accept static SVG drawing content, then freeze it as a portable PNG. */
export function cleanSvg(source: string): SVGSVGElement {
  if (source.length > 5_000_000) throw Error("Choose an SVG smaller than 5 MB.");
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw Error(linkedContentError);
  const parser = new DOMParser();
  let parsed = parser.parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg" ||
    (parsed.documentElement.namespaceURI && parsed.documentElement.namespaceURI !== svgNamespace))
    throw Error("This file is not a valid SVG image.");
  // Many downloaded icons omit xmlns. Normalize it before sanitizing XML nodes.
  parsed.documentElement.setAttribute("xmlns", svgNamespace);
  parsed = parser.parseFromString(new XMLSerializer().serializeToString(parsed.documentElement), "image/svg+xml");
  const root = parsed.documentElement;
  if (root.querySelectorAll("*").length > 10_000 || root.querySelectorAll("use").length > 200)
    throw Error("This SVG is too complex. Export a PNG version and import that instead.");
  const checkReferences = () => {
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (element.localName === "style") checkCss(element.textContent ?? "");
      for (const attr of [...element.attributes]) {
        if (attr.localName === "href" && (!localReference(attr.value) || (element.localName === "use" && !attr.value.trim().startsWith("#"))))
          throw Error(linkedContentError);
        if (attr.localName === "style" || /url\s*\(|\\/.test(attr.value)) checkCss(attr.value);
      }
    }
  };
  // Detect missing linked artwork rather than silently importing a partial icon.
  checkReferences();
  DOMPurify.sanitize(root, {
    IN_PLACE: true,
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"], // Only local fragments are permitted above and below.
    FORBID_TAGS: ["script", "foreignObject", "a", "animate", "animateMotion", "animateTransform", "set"],
    FORBID_ATTR: ["xml:base"],
  });
  checkReferences();
  if (!root.querySelector("path,rect,circle,ellipse,line,polyline,polygon,text,use,image"))
    throw Error("This SVG does not contain any printable artwork.");
  return root as unknown as SVGSVGElement;
}

function svgLength(value: string | null): number | undefined {
  if (!value) return;
  const match = /^\s*(\d*\.?\d+(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value);
  if (!match) return;
  const units: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  const n = Number(match[1]) * units[(match[2] ?? "px").toLowerCase()];
  if (!Number.isFinite(n) || n <= 0) throw Error("SVG dimensions must be positive numbers.");
  return n;
}
export function svgDimensions(width: string | null, height: string | null, viewBox: string | null) {
  const values = viewBox?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && (!values || values.length !== 4 || values.some(n => !Number.isFinite(n)) || values[2] <= 0 || values[3] <= 0))
    throw Error("This SVG has an invalid viewBox.");
  const w = svgLength(width), h = svgLength(height);
  return {
    width: w ?? (h && values ? h * values[2] / values[3] : values?.[2] ?? 300),
    height: h ?? (w && values ? w * values[3] / values[2] : values?.[3] ?? 150),
  };
}

async function decode(blob: Blob, draw: (image: HTMLImageElement) => PrintableGraphic, name: string) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    image.src = url;
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Image preparation timed out. Choose a simpler SVG or a PNG version.")), 10000); }),
    ]);
    return draw(image);
  } catch (error) {
    if (error instanceof Error && !(error instanceof DOMException)) throw error;
    throw Error(`Could not read ${name}. Choose a valid image file.`);
  } finally {
    clearTimeout(timer);
    image.src = "";
    URL.revokeObjectURL(url);
  }
}
function raster(image: HTMLImageElement, maxSide: number, requireVisible = false) {
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (requireVisible) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = false;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
    if (!visible) throw Error("This SVG does not contain any visible artwork. Export a PNG version and try again.");
  }
  let data = canvas.toDataURL("image/png");
  // Stay within the existing portable-template image budget even for photos.
  while (data.length > 7_900_000 && Math.max(canvas.width, canvas.height) > 256) {
    const copy = document.createElement("canvas");
    copy.width = Math.max(1, Math.round(canvas.width * 0.75));
    copy.height = Math.max(1, Math.round(canvas.height * 0.75));
    copy.getContext("2d")!.drawImage(canvas, 0, 0, copy.width, copy.height);
    canvas.width = copy.width;
    canvas.height = copy.height;
    canvas.getContext("2d")!.drawImage(copy, 0, 0);
    data = canvas.toDataURL("image/png");
  }
  return data;
}
export async function graphicFromSvg(source: string, name: string, maxSide = 2048): Promise<PrintableGraphic> {
  const root = cleanSvg(source);
  const size = svgDimensions(root.getAttribute("width"), root.getAttribute("height"), root.getAttribute("viewBox"));
  if (!root.hasAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
  const ratio = maxSide / Math.max(size.width, size.height);
  const width = Math.max(1, Math.round(size.width * ratio)), height = Math.max(1, Math.round(size.height * ratio));
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.style.setProperty("width", `${width}px`, "important");
  root.style.setProperty("height", `${height}px`, "important");
  const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
  return decode(blob, image => ({ data: raster(image, maxSide, true), ...size, name, widthMm: size.width * 25.4 / 96, heightMm: size.height * 25.4 / 96 }), name);
}
export async function graphicFromFile(file: File, options: { maxSide?: number; maxBytes?: number; maxPixels?: number } = {}): Promise<PrintableGraphic> {
  if (!file.size || file.size > (options.maxBytes ?? 5_000_000))
    throw Error(`Choose an image smaller than ${(options.maxBytes ?? 5_000_000) / 1_000_000} MB.`);
  if (isSvgFile(file)) return graphicFromSvg(await file.text(), file.name, options.maxSide);
  const maxPixels = options.maxPixels ?? 32_000_000;
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !/^image\/(png|jpeg|webp)$/.test(file.type))
    throw Error("Choose an SVG, PNG, JPEG or WebP image.");
  if (/\.png$/i.test(file.name) || file.type === "image/png") {
    const bytes = await file.slice(0, 24).arrayBuffer();
    const view = new DataView(bytes);
    if (bytes.byteLength < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a)
      throw Error("This file is not a valid PNG image.");
    if (!view.getUint32(16) || !view.getUint32(20) || view.getUint32(16) * view.getUint32(20) > maxPixels)
      throw Error(`Image exceeds ${maxPixels / 1_000_000} million pixels. Resize it before importing.`);
  }
  return decode(file, image => {
    if (image.naturalWidth * image.naturalHeight > maxPixels)
      throw Error(`Image exceeds ${maxPixels / 1_000_000} million pixels. Resize it before importing.`);
    return { data: raster(image, options.maxSide ?? 2048), width: image.naturalWidth, height: image.naturalHeight, name: file.name };
  }, file.name);
}

export function graphicPlacement(graphic: Pick<PrintableGraphic, "width" | "height">, label: Pick<LabelDocument, "widthMm" | "heightMm">, maximum = 40) {
  if (![graphic.width, graphic.height].every(n => Number.isFinite(n) && n > 0))
    throw Error("Artwork dimensions must be positive numbers.");
  const box = { widthMm: Math.min(label.widthMm, maximum + 6), heightMm: Math.min(label.heightMm, maximum + 6) };
  const fit = fitArtwork(graphic.width, graphic.height, box, 3);
  if (fit.width < 0.1 || fit.height < 0.1)
    throw Error("This artwork is too narrow for the label. Crop it or choose a larger label size.");
  return { ...fit, x: (label.widthMm - fit.width) / 2, y: (label.heightMm - fit.height) / 2 };
}
