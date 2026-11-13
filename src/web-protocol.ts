export type WebPrintJob = {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  dpi: number;
  copies: number;
  density: number;
  rgba: ArrayLike<number>;
  widthPx: number;
  heightPx: number;
  threshold: number;
  protocol: string;
};

function between(n: number, min: number, max: number) {
  return Number.isFinite(n) && n >= min && n <= max;
}
export function validatePrintJob(job: WebPrintJob) {
  if (
    !between(job.widthMm, 10, 216) ||
    !between(job.heightMm, 10, 500) ||
    !between(job.gapMm, 0, 10)
  )
    throw Error(
      "Use a width of 10–216 mm, height of 10–500 mm, and gap of 0–10 mm.",
    );
  if (
    ![203, 300].includes(job.dpi) ||
    !Number.isInteger(job.copies) ||
    !between(job.copies, 1, 100) ||
    !Number.isInteger(job.density) ||
    !between(job.density, 0, 15) ||
    !Number.isInteger(job.threshold) ||
    !between(job.threshold, 0, 255)
  )
    throw Error("Invalid resolution, copies, density or threshold.");
  if (
    job.widthPx !== Math.round((job.widthMm * job.dpi) / 25.4) ||
    job.heightPx !== Math.round((job.heightMm * job.dpi) / 25.4)
  )
    throw Error("Raster dimensions do not match the label size and DPI.");
  const pixels = job.widthPx * job.heightPx;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > 8_000_000 ||
    job.rgba.length !== pixels * 4
  )
    throw Error("Invalid RGBA buffer or raster exceeds 8 million pixels.");
  if (!["zpl", "tspl"].includes(job.protocol))
    throw Error("Unsupported printer format.");
}
export function monochrome(job: WebPrintJob) {
  const rowBytes = Math.ceil(job.widthPx / 8);
  const raster = new Uint8Array(rowBytes * job.heightPx);
  for (let index = 0; index < job.widthPx * job.heightPx; index++) {
    const p = index * 4,
      alpha = job.rgba[p + 3] / 255;
    const luminance =
      (0.299 * job.rgba[p] +
        0.587 * job.rgba[p + 1] +
        0.114 * job.rgba[p + 2]) *
        alpha +
      255 * (1 - alpha);
    if (luminance < job.threshold)
      raster[
        Math.floor(index / job.widthPx) * rowBytes +
          Math.floor((index % job.widthPx) / 8)
      ] |= 0x80 >> ((index % job.widthPx) % 8);
  }
  return raster;
}
export async function encodeWebPrint(job: WebPrintJob) {
  validatePrintJob(job);
  const raster = monochrome(job),
    rowBytes = Math.ceil(job.widthPx / 8),
    text = new TextEncoder();
  let output: Uint8Array;
  if (job.protocol === "tspl") {
    const header = text.encode(
      `SIZE ${job.widthMm.toFixed(3)} mm,${job.heightMm.toFixed(3)} mm\nGAP ${job.gapMm.toFixed(3)} mm,0 mm\nDENSITY ${job.density}\nDIRECTION 1\nREFERENCE 0,0\nCLS\nBITMAP 0,0,${rowBytes},${job.heightPx},0,`,
    );
    const trailer = text.encode(`\nPRINT 1,${job.copies}\n`);
    output = new Uint8Array(header.length + raster.length + trailer.length);
    output.set(header);
    output.set(
      raster.map((b) => b ^ 0xff),
      header.length,
    );
    output.set(trailer, header.length + raster.length);
  } else {
    let command = `\nSIZE ${job.widthMm.toFixed(3)} mm,${job.heightMm.toFixed(3)} mm\nGAP ${job.gapMm.toFixed(3)} mm,0 mm\n^XA\n~SD${job.density * 2}\n^PW${job.widthPx}\n^LL${job.heightPx}\n^LH0,0\n`;
    for (let start = 0; start < raster.length; start += rowBytes * 256) {
      const band = raster.slice(start, start + rowBytes * 256);
      const compressed = new Uint8Array(
        await new Response(
          new Blob([band])
            .stream()
            .pipeThrough(new CompressionStream("deflate")),
        ).arrayBuffer(),
      );
      const encoded = btoa(
        Array.from(compressed, (b) => String.fromCharCode(b)).join(""),
      );
      command += `^FO0,${start / rowBytes}\n^GFA,${band.length},${band.length},${rowBytes},:Z64:${encoded.match(/.{1,76}/g)!.join("\n")}\n\n^FS\n`;
    }
    output = text.encode(`${command}^PQ${job.copies}\n^XZ\n`);
  }
  if (output.length > 1_048_576)
    throw Error(
      "Encoded label exceeds 1 MB. Reduce label size, complexity or DPI.",
    );
  return output;
}
