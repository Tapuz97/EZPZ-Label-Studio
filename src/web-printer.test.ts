import { afterEach, describe, expect, it, vi } from "vitest";
import { WebPrinter } from "./web-printer";
const service = "000018f0-0000-1000-8000-00805f9b34fb",
  write = "00002af1-0000-1000-8000-00805f9b34fb";
function fixture(
  ambiguous = false,
  options: {
    reportedSize?: number;
    probe?: "full" | "truncate" | "reject" | "silent" | "timeout";
  } = {},
) {
  const printer = new WebPrinter(),
    writeValueWithResponse = vi.fn(async (_bytes?: Uint8Array) => {});
  const notify = Object.assign(new EventTarget(), {
    value: new DataView(new ArrayBuffer(0)),
    properties: { notify: true },
    startNotifications: vi.fn(async () => {}),
    stopNotifications: vi.fn(async () => {}),
  });
  if (options.probe)
    writeValueWithResponse.mockImplementation(async (bytes) => {
      if (!bytes) return;
      if (bytes.length > 20 && options.probe === "reject")
        throw Error("Invalid attribute length");
      if (bytes.length > 20 && options.probe === "timeout")
        return new Promise<void>(() => {});
      const received =
        options.probe === "truncate" && bytes.length > 20
          ? bytes.slice(0, 20)
          : bytes;
      if (
        options.probe !== "silent" &&
        new TextDecoder().decode(received).endsWith("~!T\n")
      )
        queueMicrotask(() => {
          const reply = new TextEncoder().encode("DB403\r\n");
          notify.value = new DataView(reply.buffer);
          notify.dispatchEvent(new Event("characteristicvaluechanged"));
        });
    });
  const printableService: {
    uuid: string;
    getCharacteristic: (id: string) => Promise<unknown>;
  } = {
    uuid: service,
    getCharacteristic: async (id) => {
      if (id === "00002af0-0000-1000-8000-00805f9b34fb" && options.probe)
        return notify;
      if (id !== write) throw Error("not found");
      return {
        uuid: write,
        service: printableService,
        properties: { write: true },
        writeValueWithResponse,
      };
    },
  };
  const gatt = {
    connected: false,
    maxWriteWithoutResponseSize: options.reportedSize,
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
      return printableService;
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
  return { printer, gatt, writeValueWithResponse, requestDevice, notify };
}
const label = () => ({
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("browser BLE lifecycle without hardware", () => {
  it("uses a bounded browser-reported payload without sending inquiry probes", async () => {
    const f = fixture(false, { reportedSize: 514 });
    await f.printer.scan();
    const info = await f.printer.connect("test-printer");
    expect(info.maxChunk).toBe(244);
    expect(f.writeValueWithResponse).not.toHaveBeenCalled();
  });
  it("verifies the last bytes of a 244-byte DB403 model inquiry and releases notifications", async () => {
    vi.useFakeTimers();
    const f = fixture(false, { probe: "full" });
    await f.printer.scan();
    const pending = f.printer.connect("test-printer");
    await vi.advanceTimersByTimeAsync(500);
    const info = await pending;
    expect(info.maxChunk).toBe(244);
    expect(info.chunkSource).toBe("db403-padded-model-inquiry");
    expect(
      f.writeValueWithResponse.mock.calls.map((c) => c[0]?.length),
    ).toEqual([4, 244]);
    expect(f.notify.stopNotifications).toHaveBeenCalledOnce();
    const probe = f.writeValueWithResponse.mock.calls[1][0]!;
    expect([...probe.slice(0, 240)].every((b) => b === 10)).toBe(true);
    expect(new TextDecoder().decode(probe.slice(240))).toBe("~!T\n");
  });
  it.each(["truncate", "reject"] as const)(
    "keeps 20-byte print writes after a %s probe",
    async (probe) => {
      vi.useFakeTimers();
      const f = fixture(false, { probe });
      await f.printer.scan();
      const pending = f.printer.connect("test-printer");
      await vi.advanceTimersByTimeAsync(2500);
      expect((await pending).maxChunk).toBe(20);
      expect(f.notify.stopNotifications).toHaveBeenCalledOnce();
      expect(f.writeValueWithResponse.mock.calls.at(-1)?.[0]).toEqual(
        new Uint8Array([10]),
      );
    },
  );
  it("never tries larger probes when the baseline model inquiry is unanswered", async () => {
    vi.useFakeTimers();
    const f = fixture(false, { probe: "silent" });
    await f.printer.scan();
    const pending = f.printer.connect("test-printer");
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending).maxChunk).toBe(20);
    expect(
      f.writeValueWithResponse.mock.calls.map((c) => c[0]?.length),
    ).toEqual([4]);
  });
  it("disconnects instead of printing when a verification write is still uncertain", async () => {
    vi.useFakeTimers();
    const f = fixture(false, { probe: "timeout" });
    await f.printer.scan();
    const rejected = expect(f.printer.connect("test-printer")).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(11000);
    await rejected;
    expect(f.gatt.connected).toBe(false);
  });
  it("does not yield to timers after acknowledgements already satisfy the rate ceiling", async () => {
    const f = fixture();
    await f.printer.scan();
    await f.printer.connect("test-printer");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    f.writeValueWithResponse.mockImplementation(async () => {
      vi.advanceTimersByTime(15);
    });
    const result = await f.printer.print(label());
    expect(result.chunksSent).toBeGreaterThan(1);
    expect(result.elapsedMs).toBe(result.chunksSent * 15);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("sends proven 244-byte print chunks in order, without changing label bytes", async () => {
    const f = fixture(false, { reportedSize: 244 });
    await f.printer.scan();
    await f.printer.connect("test-printer");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    f.writeValueWithResponse.mockImplementation(async () => {
      vi.advanceTimersByTime(100);
    });
    const result = await f.printer.print(label());
    const sizes = f.writeValueWithResponse.mock.calls.map((c) => c[0]!.length);
    expect(sizes[0]).toBe(244);
    expect(result.chunksSent).toBe(Math.ceil(result.bytesSent / 244));
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(result.bytesSent);
  });
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
