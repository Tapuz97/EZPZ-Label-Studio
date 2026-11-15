import { describe, expect, it } from "vitest";
import {
  NiimbotFrameDecoder,
  d110RowFrames,
  niimbotFrame,
  niimbotProtocolVersion,
  niimbotStockCode,
  prepareD110Raster,
} from "./niimbot-protocol";
import { encodeWebPrint, type WebPrintJob } from "./web-protocol";

export function d110Job(overrides: Partial<WebPrintJob> = {}): WebPrintJob {
  return {
    widthMm: 12,
    heightMm: 30,
    dpi: 203,
    widthPx: 96,
    heightPx: 240,
    copies: 1,
    density: 2,
    gapMm: 2,
    threshold: 128,
    protocol: "niimbot",
    rgba: new Uint8Array(96 * 240 * 4).fill(255),
    ...overrides,
  };
}
describe("NIIMBOT protocol without hardware", () => {
  it("encodes legacy 85 split counts for the three32-dot head regions", () => {
    const data = new Uint8Array(12);
    data.set([0x80, 0, 0, 1, 0xff, 0, 0, 0, 0x81, 0, 0, 1]);
    const frame = d110RowFrames(
      { width: 96, height: 1, rotated: false, data },
      "legacy",
    )[0];
    expect(new NiimbotFrameDecoder().push(frame)[0]).toEqual({
      command: 0x85,
      data: new Uint8Array([0, 0, 2, 8, 3, 1, ...data]),
    });
    const b1 = d110RowFrames(
      { width: 96, height: 1, rotated: false, data },
      "b1",
    )[0];
    expect(new NiimbotFrameDecoder().push(b1)[0].data.slice(0, 6)).toEqual(
      new Uint8Array([0, 0, 0, 13, 0, 1]),
    );
  });
  it("extracts only the SKU from a complete length-prefixed RFID layout", () => {
    const payload = new Uint8Array([
      ...new Uint8Array(8),
      8,
      ...new TextEncoder().encode("02282280"),
      16,
      ...new TextEncoder().encode("TEST000000000000"),
      0,
      252,
      0,
      119,
      1,
    ]);
    expect(payload.length).toBe(39);
    expect(niimbotStockCode(payload)).toBe("02282280");
    expect(niimbotStockCode(new Uint8Array([...payload, 0, 210]))).toBe(
      "02282280",
    );
    expect(niimbotStockCode(payload.slice(0, -1))).toBeUndefined();
    expect(niimbotStockCode(new Uint8Array([...payload, 0]))).toBeUndefined();
    const badCode = payload.slice();
    badCode[9] = 0xff;
    expect(niimbotStockCode(badCode)).toBeUndefined();
    const badSerial = payload.slice();
    badSerial[17] = 64;
    expect(niimbotStockCode(badSerial)).toBeUndefined();
    const tooLong = payload.slice();
    tooLong[8] = 65;
    expect(niimbotStockCode(tooLong)).toBeUndefined();
    expect(niimbotStockCode(new Uint8Array([0]))).toBeUndefined();
    expect(niimbotStockCode(new Uint8Array([1]))).toBeUndefined();
  });
  it("matches golden model and status inquiries including XOR", () => {
    expect([...niimbotFrame(0x40, [8])]).toEqual([
      0x55, 0x55, 0x40, 1, 8, 0x49, 0xaa, 0xaa,
    ]);
    expect([...niimbotFrame(0xa5, [1])]).toEqual([
      0x55, 0x55, 0xa5, 1, 1, 0xa5, 0xaa, 0xaa,
    ]);
    expect([...niimbotFrame(0xdc, [4])]).toEqual([
      0x55, 0x55, 0xdc, 1, 4, 0xd9, 0xaa, 0xaa,
    ]);
  });
  it("assembles fragmented and coalesced replies with leading noise", () => {
    const frame = niimbotFrame(0x48, [9, 0]),
      decoder = new NiimbotFrameDecoder();
    expect(decoder.push([0x03, 0, ...frame.slice(0, 3)])).toEqual([]);
    expect(
      decoder.push([...frame.slice(3), ...niimbotFrame(0xd9, [1])]),
    ).toEqual([
      { command: 0x48, data: new Uint8Array([9, 0]) },
      { command: 0xd9, data: new Uint8Array([1]) },
    ]);
  });
  it("discards invalid checksum and tail, resynchronizes, and bounds garbage", () => {
    const decoder = new NiimbotFrameDecoder(),
      bad = niimbotFrame(0x48, [9, 0]);
    bad[6] ^= 1;
    const tail = niimbotFrame(0xc2, [1]);
    tail[7] = 0;
    const replies = decoder.push([
      ...new Uint8Array(5000),
      ...bad,
      ...tail,
      ...niimbotFrame(0x48, [9, 0]),
    ]);
    expect(replies).toEqual([{ command: 0x48, data: new Uint8Array([9, 0]) }]);
  });
  it("keeps short status protocol unknown and decodes only positive versions", () => {
    expect(niimbotProtocolVersion(new Uint8Array([1]))).toBeNull();
    const status = new Uint8Array(13);
    status.set([2, 4], 11);
    expect(niimbotProtocolVersion(status)).toBe(3);
    status.set([3, 1], 11);
    expect(niimbotProtocolVersion(status)).toBe(4);
  });
  it("encodes blank runs at 200 rows and bitmap MSB-first black=1", () => {
    const raster = prepareD110Raster(d110Job());
    const frames = d110RowFrames(raster),
      decode = new NiimbotFrameDecoder();
    expect(
      frames.flatMap((f) => decode.push(f)).map((f) => [f.command, ...f.data]),
    ).toEqual([
      [0x84, 0, 0, 200],
      [0x84, 0, 200, 40],
    ]);
    const rgba = new Uint8Array(d110Job().rgba);
    rgba.set([0, 0, 0, 255], 0);
    const pixel = prepareD110Raster(d110Job({ rgba }));
    expect(pixel.data[0]).toBe(128);
    expect(decode.push(d110RowFrames(pixel)[0])[0].data).toEqual(
      new Uint8Array([0, 0, 0, 1, 0, 1, 128, ...new Uint8Array(11)]),
    );
  });
  it("rotates landscape clockwise once and centers narrow rasters on the head", () => {
    const rgba = new Uint8Array(240 * 80 * 4).fill(255);
    rgba.set([0, 0, 0, 255], 0);
    const raster = prepareD110Raster(
      d110Job({ widthMm: 30, heightMm: 10, widthPx: 240, heightPx: 80, rgba }),
    );
    expect(raster.rotated).toBe(true);
    expect(raster.height).toBe(240);
    // Original top-left moves to right edge of the centered 80-dot band.
    expect(raster.data[10]).toBe(1);
    expect(raster.data.reduce((a, b) => a + b, 0)).toBe(1);
  });
  it.each([
    { widthMm: 15, heightMm: 30, widthPx: 120, heightPx: 240 },
    { widthMm: 30, heightMm: 15, widthPx: 240, heightPx: 120 },
  ])(
    "handles 15 mm paper in either orientation without dropping black content: %o",
    (size) => {
      const rgba = new Uint8Array(size.widthPx * size.heightPx * 4).fill(255);
      rgba.set([0, 0, 0, 255], 0);
      const second = size.widthPx === 120 ? 119 : 119 * size.widthPx;
      rgba.set([0, 0, 0, 255], second * 4);
      const result = prepareD110Raster(d110Job({ ...size, rgba }));
      expect(result.width).toBe(120);
      expect(result.height).toBe(240);
      expect(result.data[0]).toBe(128);
      expect(result.data[14]).toBe(1);
      expect(result.data.filter((byte) => byte !== 0).length).toBe(2);
      const decoded = new NiimbotFrameDecoder().push(d110RowFrames(result, "legacy")[0])[0];
      expect([...decoded.data.slice(0, 6)]).toEqual([0, 0, 1, 0, 1, 1]);
      expect(decoded.data.length).toBe(21);
    },
  );
  it.each([
    {
      dpi: 300,
      widthPx: 142,
      heightPx: 354,
      rgba: new Uint8Array(142 * 354 * 4),
    },
    { density: 4 },
    { widthMm: 30, widthPx: 240, rgba: new Uint8Array(240 * 240 * 4) },
    { heightMm: 101, heightPx: 807, rgba: new Uint8Array(96 * 807 * 4) },
  ])("rejects invalid complete jobs before encoding: %o", (patch) => {
    expect(() => prepareD110Raster(d110Job(patch))).toThrow();
  });
  it("never routes binary jobs through the generic ASCII encoder", async () => {
    await expect(encodeWebPrint(d110Job())).rejects.toThrow("acknowledged");
  });
});
