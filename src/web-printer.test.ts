import { afterEach, describe, expect, it, vi } from "vitest";
import { WebPrinter } from "./web-printer";
const service = "000018f0-0000-1000-8000-00805f9b34fb",
  write = "00002af1-0000-1000-8000-00805f9b34fb";
function fixture(ambiguous = false) {
  const printer = new WebPrinter(),
    writeValueWithResponse = vi.fn(async () => {});
  const gatt = {
    connected: false,
    connect: vi.fn(async () => {
      gatt.connected = true;
      return gatt;
    }),
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
    getPrimaryService: vi.fn(async (id: string) => {
      if (ambiguous) {
        if (!id.startsWith("0000fff0")) throw Error("not found");
        return {
          getCharacteristics: async () =>
            ["fff1", "fff2"].map((n) => ({
              uuid: `0000${n}-0000-1000-8000-00805f9b34fb`,
              properties: { write: true },
            })),
        };
      }
      if (id !== service) throw Error("not found");
      return {
        getCharacteristic: async () => ({
          uuid: write,
          service: { uuid: service },
          properties: { write: true },
          writeValueWithResponse,
        }),
      };
    }),
  };
  const device = Object.assign(new EventTarget(), {
    id: "test-printer",
    name: "DB403",
    gatt,
  });
  const requestDevice = vi.fn(async () => device);
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("window", new EventTarget());
  return { printer, gatt, writeValueWithResponse, requestDevice };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("browser BLE lifecycle without hardware", () => {
  it("asks the browser before connecting and never sends print bytes on connect", async () => {
    const f = fixture();
    const devices = await f.printer.scan();
    expect(f.requestDevice).toHaveBeenCalledOnce();
    expect(f.gatt.connect).not.toHaveBeenCalled();
    const info = await f.printer.connect(devices[0].id);
    expect(info.writeUuid).toBe(write);
    expect(info.maxChunk).toBe(20);
    expect(f.writeValueWithResponse).not.toHaveBeenCalled();
    f.printer.disconnect();
    expect(f.printer.status().connected).toBe(false);
  });
  it("refuses ambiguous fallback endpoints without sending data", async () => {
    const f = fixture(true);
    await f.printer.scan();
    await expect(f.printer.connect("test-printer")).rejects.toThrow(
      "verified compatibility",
    );
    expect(f.writeValueWithResponse).not.toHaveBeenCalled();
    expect(f.gatt.connected).toBe(false);
  });
  it("cancels after the first write, disconnects and never retries a partial job", async () => {
    const f = fixture();
    await f.printer.scan();
    await f.printer.connect("test-printer");
    f.writeValueWithResponse.mockImplementation(async () => {
      f.printer.cancel();
    });
    await expect(
      f.printer.print({
        widthMm: 10,
        heightMm: 10,
        gapMm: 2,
        dpi: 203,
        copies: 1,
        density: 8,
        rgba: new Uint8Array(80 * 80 * 4).fill(255),
        widthPx: 80,
        heightPx: 80,
        threshold: 128,
        protocol: "tspl",
      }),
    ).rejects.toThrow("Printing stopped");
    expect(f.writeValueWithResponse).toHaveBeenCalledTimes(1);
    expect(f.printer.status().connected).toBe(false);
  });
  it("releases a connection that completes after its timeout", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let complete!: (server: typeof f.gatt) => void;
    f.gatt.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await f.printer.scan();
    const result = expect(f.printer.connect("test-printer")).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(10001);
    await result;
    f.gatt.connected = true;
    complete(f.gatt);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.gatt.connected).toBe(false);
  });
});
