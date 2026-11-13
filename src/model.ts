export type ElementKind = "text" | "barcode" | "qr" | "image" | "line" | "rect";
export type LabelElement = {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize: number;
  fontFamily:
    "Arial" | "Segoe UI" | "Consolas" | "Courier New" | "Times New Roman";
  barcodeFormat: "CODE128" | "CODE39" | "EAN13" | "UPC" | "ITF14";
  bold: boolean;
  align: "left" | "center" | "right";
  direction: "auto" | "ltr" | "rtl";
  rotation: number;
};
export type LabelDocument = {
  version: 1;
  name: string;
  widthMm: number;
  heightMm: number;
  dpi: 203 | 300;
  gapMm: number;
  density: number;
  threshold: number;
  protocol: "zpl" | "tspl";
  elements: LabelElement[];
};
export const uid = () => crypto.randomUUID();
export const mmToPx = (mm: number, dpi: number) =>
  Math.round((mm * dpi) / 25.4);
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function makeElement(kind: ElementKind): LabelElement {
  return {
    id: uid(),
    kind,
    x: 3,
    y: 3,
    width: kind === "qr" ? 18 : 36,
    height:
      kind === "line" ? 0.3 : kind === "text" ? 7 : kind === "qr" ? 18 : 12,
    content:
      kind === "text"
        ? "Your text"
        : kind === "barcode"
          ? "1234567890"
          : kind === "qr"
            ? "https://example.com"
            : "",
    fontSize: 12,
    fontFamily: "Arial",
    barcodeFormat: "CODE128",
    bold: false,
    align: "left",
    direction: "auto",
    rotation: 0,
  };
}
export function initialDocument(): LabelDocument {
  return {
    version: 1,
    name: "Workshop label",
    widthMm: 60,
    heightMm: 90,
    dpi: 203,
    gapMm: 2,
    density: 8,
    threshold: 160,
    protocol: "zpl",
    elements: [
      {
        ...makeElement("text"),
        x: 6,
        y: 5,
        width: 48,
        height: 7,
        content: "WORKSHOP / 001",
        fontSize: 12,
        bold: true,
      },
      { ...makeElement("line"), x: 6, y: 15, width: 48, height: 0.3 },
      {
        ...makeElement("text"),
        x: 6,
        y: 20,
        width: 48,
        height: 8,
        content: "Electronic parts",
        fontSize: 15,
        bold: true,
      },
      {
        ...makeElement("text"),
        x: 6,
        y: 30,
        width: 48,
        height: 6,
        content: "Ready for the next repair.",
        fontSize: 9,
      },
      {
        ...makeElement("qr"),
        x: 16,
        y: 39,
        width: 28,
        height: 28,
        content: "WORKSHOP-001",
      },
      {
        ...makeElement("barcode"),
        x: 6,
        y: 73,
        width: 48,
        height: 11,
        content: "1234567890",
      },
    ],
  };
}
function numberIn(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
export function parseDocument(input: unknown): LabelDocument {
  if (!input || typeof input !== "object")
    throw Error("This is not a label file.");
  const d = input as Record<string, unknown>;
  if (
    d.version !== 1 ||
    typeof d.name !== "string" ||
    d.name.length > 120 ||
    !numberIn(d.widthMm, 10, 216) ||
    !numberIn(d.heightMm, 10, 500) ||
    ![203, 300].includes(d.dpi as number) ||
    !numberIn(d.gapMm, 0, 10) ||
    !numberIn(d.density, 0, 15) ||
    !numberIn(d.threshold, 0, 255) ||
    !Array.isArray(d.elements) ||
    d.elements.length > 100
  )
    throw Error(
      "Invalid label settings. Use a Label Studio JSON file (10–216 mm wide, 10–500 mm tall).",
    );
  const ids = new Set<string>();
  const elements = d.elements.map((item: unknown) => {
    if (!item || typeof item !== "object") throw Error("Invalid element.");
    const e = item as Record<string, unknown>;
    if (
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      !["text", "barcode", "qr", "image", "line", "rect"].includes(
        e.kind as string,
      ) ||
      typeof e.content !== "string" ||
      e.content.length > 8_000_000 ||
      !numberIn(e.x, 0, 216) ||
      !numberIn(e.y, 0, 500) ||
      !numberIn(e.width, 0.1, 216) ||
      !numberIn(e.height, 0.1, 500) ||
      !numberIn(e.fontSize, 2, 144) ||
      !numberIn(e.rotation, 0, 270) ||
      ![0, 90, 180, 270].includes(e.rotation as number) ||
      typeof e.bold !== "boolean" ||
      !["left", "center", "right"].includes(e.align as string) ||
      !["auto", "ltr", "rtl"].includes(e.direction as string)
    )
      throw Error("Invalid label element.");
    if (
      e.kind === "image" &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(e.content)
    )
      throw Error("Images must be embedded PNG, JPEG or WebP files.");
    if (e.kind !== "image" && e.content.length > 4000)
      throw Error("Text and codes are limited to 4,000 characters.");
    if (
      e.fontFamily !== undefined &&
      ![
        "Arial",
        "Segoe UI",
        "Consolas",
        "Courier New",
        "Times New Roman",
      ].includes(e.fontFamily as string)
    )
      throw Error("Unsupported font family.");
    if (
      e.barcodeFormat !== undefined &&
      !["CODE128", "CODE39", "EAN13", "UPC", "ITF14"].includes(
        e.barcodeFormat as string,
      )
    )
      throw Error("Unsupported barcode format.");
    ids.add(e.id);
    return {
      id: e.id,
      kind: e.kind,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      content: e.content,
      fontSize: e.fontSize,
      fontFamily: e.fontFamily ?? "Arial",
      barcodeFormat: e.barcodeFormat ?? "CODE128",
      bold: e.bold,
      align: e.align,
      direction: e.direction,
      rotation: e.rotation,
    } as LabelElement;
  });
  if (d.protocol !== undefined && d.protocol !== "zpl" && d.protocol !== "tspl")
    throw Error("Unsupported printer language. Choose ZPL or TSPL.");
  return {
    version: 1,
    name: d.name,
    widthMm: d.widthMm,
    heightMm: d.heightMm,
    dpi: d.dpi as 203 | 300,
    gapMm: d.gapMm,
    density: d.density,
    threshold: d.threshold,
    protocol: d.protocol ?? "zpl",
    elements,
  };
}
export function substitute(
  content: string,
  row: Record<string, string>,
): string {
  return content.replace(
    /\{\{([^{}]+)\}\}/g,
    (_, key: string) => row[key.trim()] ?? `{{${key}}}`,
  );
}
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw Error("Unexpected quote in CSV.");
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) records.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV contains an unclosed quote.");
  row.push(cell);
  if (row.some(Boolean)) records.push(row);
  if (records.length < 2)
    throw Error("CSV needs a header and at least one data row.");
  const headers = records.shift()!.map((s) => s.trim());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw Error("CSV headers must be unique and nonempty.");
  if (records.length > 100) throw Error("Use up to 100 CSV rows per batch.");
  return records.map((r) => {
    if (r.length !== headers.length)
      throw Error("Every CSV row must have the same number of columns.");
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}
export function monochrome(data: Uint8ClampedArray, threshold: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const value =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha +
      255 * (1 - alpha);
    const v = value < threshold ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
}
