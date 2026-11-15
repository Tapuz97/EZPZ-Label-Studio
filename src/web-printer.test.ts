import { afterEach, describe, expect, it, vi } from "vitest";
import { WebPrinter } from "./web-printer";
import {
  NIIMBOT_SERVICE,
  NIIMBOT_CHARACTERISTIC,
  NiimbotFrameDecoder,
  niimbotFrame,
} from "./niimbot-protocol";
const service = "000018f0-0000-1000-8000-00805f9b34fb",
  write = "00002af1-0000-1000-8000-00805f9b34fb";
function fixture(
  ambiguous = false,
  options: {
    reportedSize?: number;
    name?: string;
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
    name: options.name ?? "DB403",
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
  protocol: "zpl",
});
function niimbotFixture(model = [9, 0], silentModel = false) {
  const printer = new WebPrinter(),
    decoder = new NiimbotFrameDecoder(),
    commands: number[] = [];
  const printableService = {
    uuid: NIIMBOT_SERVICE,
    getCharacteristic: async () => characteristic,
  };
  const characteristic = Object.assign(new EventTarget(), {
    uuid: NIIMBOT_CHARACTERISTIC,
    service: printableService,
    properties: { write: true, notify: true },
    value: new DataView(new ArrayBuffer(0)),
    startNotifications: vi.fn(async () => {}),
    stopNotifications: vi.fn(async () => {}),
    writeValueWithResponse: vi.fn(async (bytes: Uint8Array) => {
      for (const frame of decoder.push(bytes)) {
        commands.push(frame.command);
        let response: number | undefined,
          data = [1];
        if (frame.command === 0xc1) {
          response = 0xc2;
          data = [2];
        } else if (frame.command === 0xa5) {
          response = 0xb5;
          data = [0x30, 0x30];
        } else if (frame.command === 0x40) {
          if (frame.data[0] === 8 && silentModel) continue;
          response = 0x40 + frame.data[0];
          data = frame.data[0] === 8 ? model : [1];
        } else if (frame.command === 0xdc) response = 0;
        else if (frame.command === 0x1a) {
          response = 0x1b;
          data = [
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
          ];
        } else if (frame.command === 0xa3) {
          response = 0xb3;
          data = [0, 1, 100, 100];
        } else if (![0x84, 0x85].includes(frame.command))
          response = (
            {
              0x21: 0x31,
              0x23: 0x33,
              0x20: 0x30,
              0x15: 0x16,
              1: 2,
              3: 4,
              0x13: 0x14,
              0xe3: 0xe4,
              0xf3: 0xf4,
            } as Record<number, number>
          )[frame.command];
        if (response !== undefined) {
          const reply = niimbotFrame(response, data);
          characteristic.value = new DataView(reply.buffer);
          characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
        }
      }
    }),
  });
  const gatt = {
    connected: false,
    disconnect: vi.fn(() => {
      gatt.connected = false;
    }),
    connect: vi.fn(async () => {
      gatt.connected = true;
      return gatt;
    }),
    getPrimaryService: async (id: string) => {
      // Real D110 exposes this generic-looking endpoint as well as NIIMBOT.
      // An unknown advertised name must still select the binary family first.
      if (id === "49535343-fe7d-4ae5-8fa9-9fafd205e455")
        return {
          uuid: id,
          getCharacteristic: async () => ({
            uuid: "49535343-8841-43f4-a8d4-ecbe34729bb3",
            service: { uuid: id },
            properties: { write: true },
            writeValueWithResponse: async () => {
              commands.push(-1);
            },
          }),
        };
      if (id !== NIIMBOT_SERVICE) throw Error("not found");
      return printableService;
    },
  };
  const device = Object.assign(new EventTarget(), {
    id: "niimbot",
    name: "Unknown printer",
    gatt,
  });
  vi.stubGlobal("navigator", {
    bluetooth: { requestDevice: async () => device },
  });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("window", new EventTarget());
  return { printer, gatt, device, characteristic, commands };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("browser BLE lifecycle without hardware", () => {
  it("uses exact live D110 identity on NIIMBOT service even with unknown advertised name", async () => {
    const f = niimbotFixture();
    await f.printer.scan();
    const info = await f.printer.connect("niimbot");
    expect(info).toMatchObject({
      protocol: "niimbot",
      supportedForPrinting: true,
      maxChunk: 20,
      capabilities: {
        modelId: 2304,
        status: "model-specification",
        dpi: 203,
        maxWidthDots: 96,
        densityMin: 1,
        densityMax: 3,
        densityDefault: 2,
      },
    });
    expect(info.capabilities.fieldSources.dpi).toBe("model-specification");
    expect(info.capabilities.stockCode).toBe("02282280");
    expect(info.capabilities.fieldSources.stockCode).toBe(
      "live RFID roll identifier",
    );
    expect(info.capabilities).not.toHaveProperty("serial");
    expect(info.capabilities).not.toHaveProperty("uid");
    expect(
      f.commands.every((c) => [0xc1, 0xa5, 0x40, 0xdc, 0x1a].includes(c)),
    ).toBe(true);
    const result = await f.printer.print({
      ...label(),
      widthMm: 12,
      heightMm: 30,
      widthPx: 96,
      heightPx: 240,
      rgba: new Uint8Array(96 * 240 * 4).fill(255),
      density: 2,
      protocol: "niimbot",
    });
    expect(result.message).toContain("confirmed");
    expect(f.commands.slice(-12)).toEqual([
      0x21, 0x23, 1, 0x20, 3, 0x13, 0x15, 0x84, 0x84, 0xe3, 0xa3, 0xf3,
    ]);
    expect(f.printer.diagnostics().niimbotIdentity).toMatchObject({
      connectResult: 2,
      protocolVersion: 1,
      printTask: "legacy",
      heartbeatCommand: 0,
      heartbeat: [1],
      stockCode: "02282280",
    });
    f.printer.disconnect();
    expect(f.characteristic.stopNotifications).toHaveBeenCalledOnce();
  });
  it.each([{ model: [9, 1] }, { model: [9, 16] }])(
    "keeps an unverified NIIMBOT-service identity unsupported: %o",
    async ({ model }) => {
      const f = niimbotFixture(model);
      await f.printer.scan();
      const info = await f.printer.connect("niimbot");
      expect(info.protocol).toBe("unsupported");
      await expect(f.printer.print(label())).rejects.toThrow("not verified");
      expect(f.commands).not.toContain(0x21);
      f.printer.disconnect();
    },
  );
  it("cancels an inquiry during connect and releases notifications, waiters and connection", async () => {
    vi.useFakeTimers();
    const f = niimbotFixture([9, 0], true);
    await f.printer.scan();
    const rejected = expect(f.printer.connect("niimbot")).rejects.toThrow(
      /stopped|disconnected/,
    );
    await vi.advanceTimersByTimeAsync(1);
    f.printer.disconnect();
    await rejected;
    expect(f.printer.status().connected).toBe(false);
    expect(f.characteristic.stopNotifications).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
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
    const f = fixture(false, { reportedSize: 244, name: "DB402" });
    await f.printer.scan();
    await f.printer.connect("test-printer");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    f.writeValueWithResponse.mockImplementation(async () => {
      vi.advanceTimersByTime(100);
    });
    const result = await f.printer.print({ ...label(), protocol: "tspl" });
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
  it("rejects a mismatched ASCII protocol before any write", async () => {
    const f = fixture();
    await f.printer.scan();
    await f.printer.connect("test-printer");
    await expect(
      f.printer.print({ ...label(), protocol: "tspl" }),
    ).rejects.toThrow("does not match");
    expect(f.writeValueWithResponse).not.toHaveBeenCalled();
  });
  it("never falls back to ASCII for a NIIMBOT name on another BLE endpoint", async () => {
    const f = fixture(false, { name: "D110-FC06023035" });
    await f.printer.scan();
    const info = await f.printer.connect("test-printer");
    expect(info.protocol).toBe("unsupported");
    expect(info.supportedForPrinting).toBe(false);
    await expect(f.printer.print(label())).rejects.toThrow("not verified");
    expect(f.writeValueWithResponse).not.toHaveBeenCalled();
    f.printer.disconnect();
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
        protocol: "zpl",
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
