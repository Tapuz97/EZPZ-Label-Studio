import { monochrome, validatePrintJob, type WebPrintJob } from "./web-protocol";

// Protocol facts independently implemented from iscarelli/niimbot-web-bluetooth
// (MIT), src/niimbot.js and registry.json; not proof of this unit's print output.
// Legacy negotiation/row fields: printers.niim.blue/interfacing/proto/ (facts only).
export const NIIMBOT_SERVICE = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
export const NIIMBOT_CHARACTERISTIC = "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f";
export const D110_MODEL_ID = 2304;
export type NiimbotFrame = { command: number; data: Uint8Array<ArrayBuffer> };

export function niimbotFrame(command: number, data: ArrayLike<number> = []) {
  if (
    !Number.isInteger(command) ||
    command < 0 ||
    command > 255 ||
    data.length > 255
  )
    throw Error("Invalid NIIMBOT frame.");
  const bytes = new Uint8Array(data.length + 7);
  bytes.set([0x55, 0x55, command, data.length]);
  let checksum = command ^ data.length;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isInteger(data[i]) || data[i] < 0 || data[i] > 255)
      throw Error("Invalid NIIMBOT data byte.");
    bytes[4 + i] = data[i];
    checksum ^= data[i];
  }
  bytes.set([checksum, 0xaa, 0xaa], 4 + data.length);
  return bytes;
}

/** Bounded stream decoder: notifications are neither frame nor ACK boundaries. */
export class NiimbotFrameDecoder {
  private buffer: number[] = [];
  reset() {
    this.buffer = [];
  }
  push(input: ArrayLike<number>): NiimbotFrame[] {
    const frames: NiimbotFrame[] = [];
    for (let i = 0; i < input.length; i++) {
      this.buffer.push(input[i]);
      while (
        this.buffer.length >= 2 &&
        (this.buffer[0] !== 0x55 || this.buffer[1] !== 0x55)
      )
        this.buffer.shift();
      while (this.buffer.length >= 4) {
        if (this.buffer[0] !== 0x55 || this.buffer[1] !== 0x55) {
          this.buffer.shift();
          continue;
        }
        const size = this.buffer[3] + 7;
        if (this.buffer.length < size) break;
        let checksum = 0;
        for (let j = 2; j < size - 3; j++) checksum ^= this.buffer[j];
        if (
          this.buffer[size - 2] === 0xaa &&
          this.buffer[size - 1] === 0xaa &&
          checksum === this.buffer[size - 3]
        ) {
          frames.push({
            command: this.buffer[2],
            data: new Uint8Array(this.buffer.slice(4, size - 3)),
          });
          this.buffer.splice(0, size);
        } else this.buffer.shift();
      }
      if (this.buffer.length > 262)
        this.buffer.splice(0, this.buffer.length - 262);
    }
    return frames;
  }
}

export function niimbotProtocolVersion(data: Uint8Array) {
  if (data.length < 13) return null;
  const version = data[11] * 100 + data[12];
  return version >= 302 ? 5 : version >= 300 ? 4 : version >= 204 ? 3 : null;
}

/** Decode only the roll SKU. UID, serial and counters never become UI fields. */
export function niimbotStockCode(data: Uint8Array): string | undefined {
  if (data.length < 8 + 1 + 1 + 5) return undefined;
  let offset = 8;
  const codeLength = data[offset++];
  if (!codeLength || codeLength > 64 || offset + codeLength >= data.length)
    return undefined;
  const code = data.slice(offset, offset + codeLength);
  if (!code.every((byte) => byte >= 0x21 && byte <= 0x7e)) return undefined;
  offset += codeLength;
  const serialLength = data[offset++];
  if (serialLength > 64 || offset + serialLength > data.length)
    return undefined;
  // Validate the length-prefixed serial, but do not retain or expose it.
  if (
    !data
      .slice(offset, offset + serialLength)
      .every((byte) => byte >= 0x20 && byte <= 0x7e)
  )
    return undefined;
  offset += serialLength;
  // Two i16 counters + type, and optionally the final i16 capacity. Unknown
  // extensions are rejected instead of guessing at a different payload layout.
  if (![5, 7].includes(data.length - offset)) return undefined;
  return String.fromCharCode(...code);
}

export type D110Raster = {
  width: 96;
  height: number;
  rotated: boolean;
  data: Uint8Array<ArrayBuffer>;
};
export function prepareD110Raster(job: WebPrintJob): D110Raster {
  validatePrintJob(job);
  if (
    job.protocol !== "niimbot" ||
    job.dpi !== 203 ||
    job.density < 1 ||
    job.density > 3
  )
    throw Error("D110 requires 203 dpi and density 1–3.");
  const rotated =
    job.widthPx > 96 && job.heightPx <= 120 && job.heightPx < job.widthPx;
  const width = rotated ? job.heightPx : job.widthPx;
  const height = rotated ? job.widthPx : job.heightPx;
  if (width > 120 || height > Math.round((100 * 203) / 25.4))
    throw Error(
      "D110 artwork must fit 15 mm stock across its 96-dot printhead and 100 mm feed length. Rotate a landscape label if needed.",
    );
  const source = monochrome(job),
    sourceStride = Math.ceil(job.widthPx / 8);
  const data = new Uint8Array(12 * height);
  const crop = Math.max(0, Math.floor((width - 96) / 2)),
    pad = Math.max(0, Math.floor((96 - width) / 2));
  for (let y = 0; y < job.heightPx; y++)
    for (let x = 0; x < job.widthPx; x++) {
      if (!(source[y * sourceStride + (x >> 3)] & (0x80 >> (x & 7)))) continue;
      const cross = rotated ? job.heightPx - 1 - y : x;
      const nx = cross - crop + pad;
      if (nx < 0 || nx >= 96)
        throw Error(
          "D110 has a 12 mm printable band on 15 mm stock. Keep about 1.5 mm blank on each side; this artwork has content outside the printable band.",
        );
      const ny = rotated ? x : y;
      data[ny * 12 + (nx >> 3)] |= 0x80 >> (nx & 7);
    }
  return { width: 96, height, rotated, data };
}

export type NiimbotPrintTask = "legacy" | "b1";
export function d110RowFrames(
  raster: D110Raster,
  task: NiimbotPrintTask = "b1",
) {
  const frames: Uint8Array<ArrayBuffer>[] = [];
  for (let row = 0; row < raster.height;) {
    const bytes = raster.data.slice(row * 12, row * 12 + 12);
    let repeat = 1;
    while (
      repeat < 200 &&
      row + repeat < raster.height &&
      bytes.every((b, i) => b === raster.data[(row + repeat) * 12 + i])
    )
      repeat++;
    const counts = [0, 0, 0];
    for (let i = 0; i < bytes.length; i++)
      for (let mask = 1; mask <= 128; mask <<= 1)
        if (bytes[i] & mask) counts[Math.floor(i / 4)]++;
    const count = counts[0] + counts[1] + counts[2];
    frames.push(
      count === 0
        ? niimbotFrame(0x84, [row >> 8, row & 255, repeat])
        : niimbotFrame(0x85, [
            row >> 8,
            row & 255,
            ...(task === "legacy" ? counts : [0, count & 255, count >> 8]),
            repeat,
            ...bytes,
          ]),
    );
    row += repeat;
  }
  return frames;
}
