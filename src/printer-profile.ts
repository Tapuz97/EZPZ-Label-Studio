import type { LabelDocument } from "./model";
import { stockForPrinter } from "./printer-stock";

export type PrinterProtocol = "zpl" | "tspl" | "niimbot" | "unsupported";
export type PrinterProfile = {
  protocol?: PrinterProtocol;
  supportedForPrinting?: boolean;
  capabilities?: {
    stockCode?: string;
    modelId?: number;
    dpi?: number;
    maxWidthDots?: number;
    densityMin?: number;
    densityMax?: number;
    densityDefault?: number;
  };
};

// A writable Bluetooth endpoint alone does not identify a printer's commands.
export function readyToPrint(connection: PrinterProfile | null): boolean {
  return !!connection?.supportedForPrinting &&
    ["zpl", "tspl", "niimbot"].includes(connection.protocol ?? "");
}

export function densityRange(connection: PrinterProfile | null) {
  const niimbot = connection?.protocol === "niimbot";
  return {
    min: connection?.capabilities?.densityMin ?? (niimbot ? 1 : 0),
    max: connection?.capabilities?.densityMax ?? (niimbot ? 3 : 15),
    default: connection?.capabilities?.densityDefault ?? (niimbot ? 2 : 8),
  };
}

export function connectedSettings(
  connection: PrinterProfile,
  document: LabelDocument,
): Partial<LabelDocument> {
  const patch: Partial<LabelDocument> = {};
  // Templates remain portable. NIIMBOT selection belongs to the connection.
  if (connection.protocol === "zpl" || connection.protocol === "tspl")
    patch.protocol = connection.protocol;
  if (!readyToPrint(connection)) return patch;
  const dpi = connection.capabilities?.dpi;
  if (dpi === 203 || dpi === 300) patch.dpi = dpi;
  const range = densityRange(connection);
  if (document.density < range.min || document.density > range.max)
    patch.density = range.default;
  const stock = stockForPrinter(connection);
  if (stock && document.elements.length === 0) {
    patch.widthMm = stock.widthMm;
    patch.heightMm = stock.heightMm;
  }
  return patch;
}

export function validateDocumentForPrinter(
  connection: PrinterProfile,
  document: Pick<LabelDocument, "widthMm" | "heightMm" | "dpi" | "density">,
) {
  if (!readyToPrint(connection))
    throw Error("This printer has not been verified for printing. No print data was sent.");
  const { dpi, density, widthMm, heightMm } = document;
  const width = Math.round(widthMm * dpi / 25.4);
  const height = Math.round(heightMm * dpi / 25.4);
  const expectedDpi = connection.capabilities?.dpi;
  if (expectedDpi && dpi !== expectedDpi)
    throw Error(`Choose ${expectedDpi} dpi for this printer.`);
  const range = densityRange(connection);
  if (!Number.isInteger(density) || density < range.min || density > range.max)
    throw Error(`Choose a density from ${range.min} to ${range.max}.`);
  if (connection.protocol === "niimbot") {
    // D110 model 2304 only. Rotate landscape artwork to the physical head axis;
    // never stretch, shrink or crop a label to force it onto narrower stock.
    if (dpi !== 203 || Math.min(width, height) > 120 || Math.max(width, height) > 799)
      throw Error("The D110 needs 203 dpi labels with a paper width up to 15 mm and a length up to 100 mm. Its centered print area is 12 mm wide. Choose the size loaded in the printer.");
  } else if (connection.capabilities?.maxWidthDots && width > connection.capabilities.maxWidthDots) {
    throw Error(`This label is wider than the printer's ${connection.capabilities.maxWidthDots}-dot print area. Choose a smaller label width.`);
  }
}
