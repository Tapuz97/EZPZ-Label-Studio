import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { mmToPx, monochrome, substitute } from "./model";
import type { LabelDocument } from "./model";
const imageCache = new Map<string, Promise<HTMLImageElement>>();
function imageFor(src: string) {
  let image = imageCache.get(src);
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error("Could not load embedded image."));
      i.src = src;
    });
    if (imageCache.size > 30) imageCache.clear();
    imageCache.set(src, image);
  }
  return image;
}
export async function renderLabel(
  doc: LabelDocument,
  row: Record<string, string> = {},
  thresholded = true,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = mmToPx(doc.widthMm, doc.dpi);
  canvas.height = mmToPx(doc.heightMm, doc.dpi);
  if (canvas.width * canvas.height > 8_000_000)
    throw Error(
      "Label exceeds 8 million pixels. Reduce dimensions or resolution.",
    );
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = "white";
  c.fillRect(0, 0, canvas.width, canvas.height);
  const scale = doc.dpi / 25.4;
  for (const e of doc.elements) {
    const content = substitute(e.content, row);
    const x = e.x * scale,
      y = e.y * scale,
      w = e.width * scale,
      h = e.height * scale;
    c.save();
    c.translate(x + w / 2, y + h / 2);
    c.rotate((e.rotation * Math.PI) / 180);
    c.translate(-w / 2, -h / 2);
    c.fillStyle = "black";
    c.strokeStyle = "black";
    c.lineWidth = Math.max(1, 0.2 * scale);
    if (e.kind === "text") {
      c.beginPath();
      c.rect(0, 0, w, h);
      c.clip();
      const size = (e.fontSize * doc.dpi) / 72;
      c.font = `${e.bold ? "700" : "400"} ${size}px "${e.fontFamily}", sans-serif`;
      c.textBaseline = "top";
      c.textAlign = e.align;
      const rtl =
        e.direction === "rtl" ||
        (e.direction === "auto" && /[\u0590-\u08FF]/.test(content));
      c.direction = rtl ? "rtl" : "ltr";
      const tx = e.align === "center" ? w / 2 : e.align === "right" ? w : 0;
      const lines: string[] = [];
      for (const paragraph of content.split("\n")) {
        let line = "";
        for (const word of paragraph.split(" ")) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && c.measureText(candidate).width > w) {
            lines.push(line);
            line = word;
          } else line = candidate;
        }
        lines.push(line);
      }
      lines.forEach((line, i) => c.fillText(line, tx, i * size * 1.18));
    } else if (e.kind === "rect")
      c.strokeRect(
        c.lineWidth / 2,
        c.lineWidth / 2,
        w - c.lineWidth,
        h - c.lineWidth,
      );
    else if (e.kind === "line") {
      c.beginPath();
      c.moveTo(0, h / 2);
      c.lineTo(w, h / 2);
      c.stroke();
    } else if (e.kind === "image") {
      const image = await imageFor(content);
      const ratio = Math.min(w / image.width, h / image.height);
      c.drawImage(
        image,
        (w - image.width * ratio) / 2,
        (h - image.height * ratio) / 2,
        image.width * ratio,
        image.height * ratio,
      );
    } else if (e.kind === "qr") {
      if (!content) throw Error("QR code content cannot be empty.");
      const code = QRCode.create(content, { errorCorrectionLevel: "M" });
      const module = Math.floor(Math.min(w, h) / (code.modules.size + 8));
      if (module < 1)
        throw Error("QR code is too small for its content. Increase its size.");
      const side = (code.modules.size + 8) * module;
      const ox = (w - side) / 2 + 4 * module,
        oy = (h - side) / 2 + 4 * module;
      c.fillStyle = "white";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "black";
      for (let yy = 0; yy < code.modules.size; yy++)
        for (let xx = 0; xx < code.modules.size; xx++)
          if (code.modules.get(yy, xx))
            c.fillRect(ox + xx * module, oy + yy * module, module, module);
    } else if (e.kind === "barcode") {
      if (!content) throw Error("Barcode content cannot be empty.");
      const code = document.createElement("canvas");
      const fontSize = Math.max(12, Math.round((doc.dpi / 72) * 7));
      try {
        JsBarcode(code, content, {
          format: e.barcodeFormat,
          width: 1,
          height: 1,
          margin: 10,
          displayValue: false,
        });
      } catch {
        throw Error(
          `${e.barcodeFormat}: invalid content or check digit. Use ASCII for Code 128, uppercase letters/numbers for Code 39, or valid digits for EAN/UPC/ITF. Use QR for Hebrew.`,
        );
      }
      const module = Math.floor(w / code.width);
      if (module < 1)
        throw Error(
          "Barcode is too small for its content. Increase its width or shorten the text.",
        );
      if (h < fontSize + 14)
        throw Error("Barcode is too short. Increase its height.");
      JsBarcode(code, content, {
        format: e.barcodeFormat,
        width: module,
        height: Math.floor(h) - fontSize - 4,
        fontSize,
        textMargin: 4,
        displayValue: true,
        margin: 0,
        marginLeft: 10 * module,
        marginRight: 10 * module,
      });
      c.imageSmoothingEnabled = false;
      c.drawImage(code, (w - code.width) / 2, (h - code.height) / 2);
    }
    c.restore();
  }
  if (thresholded) {
    const data = c.getImageData(0, 0, canvas.width, canvas.height);
    monochrome(data.data, doc.threshold);
    c.putImageData(data, 0, 0);
  }
  return canvas;
}
