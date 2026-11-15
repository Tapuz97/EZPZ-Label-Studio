import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NiimbotFrameDecoder,
  niimbotFrame,
  type NiimbotFrame,
} from "./niimbot-protocol";
import { NiimbotSession } from "./niimbot-session";
import type { WebPrintJob } from "./web-protocol";

function job(): WebPrintJob {
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
  };
}
function fixture(
  options: {
    model?: number[];
    protocol?: number;
    connectAck?: number;
    withoutResponse?: boolean;
    fragmented?: boolean;
    rfid?: number[] | null;
    heartbeat?: boolean;
  } = {},
) {
  const outgoing: NiimbotFrame[] = [],
    chunks: Uint8Array[] = [],
    decoder = new NiimbotFrameDecoder();
  let handler: ((frame: NiimbotFrame) => boolean) | undefined;
  const characteristic = Object.assign(new EventTarget(), {
    value: new DataView(new ArrayBuffer(0)),
    properties: {
      write: !options.withoutResponse,
      writeWithoutResponse: true,
      notify: true,
    },
    startNotifications: vi.fn(async () => characteristic),
    stopNotifications: vi.fn(async () => characteristic),
    writeValueWithResponse: vi.fn(async (bytes: Uint8Array) => accept(bytes)),
    writeValueWithoutResponse: vi.fn(async (bytes: Uint8Array) =>
      accept(bytes),
    ),
  });
  const notify = (command: number, data: number[]) => {
    const frame = niimbotFrame(command, data);
    const parts = options.fragmented
      ? [frame.slice(0, 2), frame.slice(2, 5), frame.slice(5)]
      : [frame];
    for (const part of parts) {
      characteristic.value = new DataView(part.buffer);
      characteristic.dispatchEvent(new Event("characteristicvaluechanged"));
    }
  };
  function accept(bytes: Uint8Array) {
    chunks.push(bytes.slice());
    for (const frame of decoder.push(bytes)) {
      outgoing.push(frame);
      if (handler?.(frame)) continue;
      if (frame.command === 0xc1) notify(0xc2, [options.connectAck ?? 2]);
      else if (frame.command === 0xa5) {
        const data =
          options.protocol === undefined
            ? [0x30, 0x30]
            : [...new Uint8Array(11), options.protocol, 4];
        notify(0xb5, data);
      } else if (frame.command === 0x40)
        notify(
          0x40 + frame.data[0],
          frame.data[0] === 8 ? (options.model ?? [9, 0]) : [1],
        );
      else if (frame.command === 0xdc) {
        if (options.heartbeat !== false) notify(0, [1]);
      } else if (frame.command === 0x1a) {
        if (options.rfid !== null) notify(0x1b, options.rfid ?? [0]);
      } else if (frame.command === 0xa3) notify(0xb3, [0, 1, 100, 100]);
      else if (![0x84, 0x85].includes(frame.command))
        notify(
          (
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
          )[frame.command],
          [1],
        );
    }
  }
  const session = new NiimbotSession(
    characteristic as unknown as BluetoothRemoteGATTCharacteristic,
  );
  return {
    session,
    characteristic,
    outgoing,
    chunks,
    notify,
    setHandler: (next: typeof handler) => {
      handler = next;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("acknowledged D110 browser session, fake GATT only", () => {
  it("runs actual-unit legacy protocol1 sequence as a complete job per copy", async () => {
    const f = fixture();
    expect(await f.session.initialize()).toMatchObject({
      connectResult: 2,
      protocolVersion: 1,
      printTask: "legacy",
      compatible: true,
    });
    f.outgoing.length = 0;
    await f.session.print({ ...job(), copies: 2 });
    const sequence = [
      0x21, 0x23, 1, 0x20, 3, 0x13, 0x15, 0x84, 0x84, 0xe3, 0xa3, 0xf3,
    ];
    expect(f.outgoing.map((frame) => frame.command)).toEqual([
      ...sequence,
      ...sequence,
    ]);
    expect([...f.outgoing.find((frame) => frame.command === 1)!.data]).toEqual([
      1,
    ]);
    expect([
      ...f.outgoing.find((frame) => frame.command === 0x13)!.data,
    ]).toEqual([0, 240, 0, 96]);
    expect([
      ...f.outgoing.find((frame) => frame.command === 0x15)!.data,
    ]).toEqual([0, 1]);
    f.session.close();
  });
  it.each([
    { connectAck: 1 },
    { connectAck: 3 },
    { connectAck: 2, protocol: 3 },
    { connectAck: 3, protocol: 3 },
  ])("leaves unverified negotiation read-only: %o", async (options) => {
    const f = fixture(options);
    expect((await f.session.initialize()).compatible).toBe(false);
    await expect(f.session.print(job())).rejects.toThrow("not verified");
    expect(f.outgoing.some((frame) => frame.command === 0x21)).toBe(false);
    f.session.close();
  });
  it.each([0, 0x5a, 4])(
    "rejects failed/unknown ConnectResult %s",
    async (connectAck) => {
      const f = fixture({ connectAck });
      await expect(f.session.initialize()).rejects.toThrow("handshake");
    },
  );
  it("keeps a missing optional heartbeat nonfatal and retains its absence", async () => {
    vi.useFakeTimers();
    const f = fixture({ heartbeat: false });
    const pending = f.session.initialize();
    await vi.advanceTimersByTimeAsync(601);
    expect(await pending).toMatchObject({
      compatible: true,
      heartbeat: [],
      heartbeatCommand: null,
    });
    expect(vi.getTimerCount()).toBe(0);
    f.session.close();
  });
  it("keeps missing optional RFID nonfatal and releases its timeout", async () => {
    vi.useFakeTimers();
    const f = fixture({ rfid: null });
    const connection = f.session.initialize();
    await vi.advanceTimersByTimeAsync(601);
    expect(await connection).toMatchObject({
      compatible: true,
      rfid: null,
      stockCode: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
    f.session.close();
  });
  it("subscribes first, sends only handshake/inquiries, preserves identity sources", async () => {
    const f = fixture({ fragmented: true });
    const info = await f.session.initialize();
    expect(f.characteristic.startNotifications).toHaveBeenCalledOnce();
    expect([...f.chunks[0]]).toEqual([
      3, 0x55, 0x55, 0xc1, 1, 1, 0xc1, 0xaa, 0xaa,
    ]);
    expect(f.outgoing.map((f) => f.command)).toEqual([
      0xc1,
      0xa5,
      ...new Array(8).fill(0x40),
      0xdc,
      0x1a,
    ]);
    expect(info).toMatchObject({
      modelId: 2304,
      protocolVersion: 1,
      printTask: "legacy",
      heartbeatCommand: 0,
      heartbeat: [1],
      compatible: true,
    });
    f.session.close();
  });
  it.each([[9], [9, 0]].map((model) => ({ model })))(
    "accepts source-compatible exact D110 identity %o",
    async ({ model }) => {
      const f = fixture({ model });
      expect((await f.session.initialize()).compatible).toBe(true);
      f.session.close();
    },
  );
  it.each(
    [
      [9, 1],
      [9, 16],
      [1, 2],
      [9, 0, 0],
    ].map((model) => ({ model })),
  )("does not print unidentified/unverified models %o", async ({ model }) => {
    const f = fixture({ model });
    if (model.length > 2)
      await expect(f.session.initialize()).rejects.toThrow("identity");
    else {
      expect((await f.session.initialize()).compatible).toBe(false);
      await expect(f.session.print(job())).rejects.toThrow("not verified");
    }
    expect(f.outgoing.some((f) => f.command === 0x21)).toBe(false);
    f.session.close();
  });
  it("rejects an incompatible positively decoded protocol and rejected connect ACK", async () => {
    const f = fixture({ protocol: 3 });
    expect((await f.session.initialize()).compatible).toBe(false);
    f.session.close();
    const rejected = fixture({ connectAck: 0 });
    await expect(rejected.session.initialize()).rejects.toThrow("handshake");
    expect(rejected.outgoing.map((f) => f.command)).toEqual([0xc1]);
  });
  it("preserves positively negotiated b1 copies as individual completed jobs", async () => {
    const f = fixture({ connectAck: 3, protocol: 2 });
    await f.session.initialize();
    f.outgoing.length = 0;
    const progress = vi.fn();
    const result = await f.session.print({ ...job(), copies: 2 }, progress);
    expect(f.outgoing.map((f) => f.command)).toEqual([
      0x21, 0x23, 1, 3, 0x13, 0x84, 0x84, 0xe3, 0xa3, 0xf3, 0x21, 0x23, 1, 3,
      0x13, 0x84, 0x84, 0xe3, 0xa3, 0xf3,
    ]);
    expect([...f.outgoing.find((f) => f.command === 1)!.data]).toEqual([
      0, 1, 0, 0, 0, 0, 0,
    ]);
    expect([...f.outgoing.find((f) => f.command === 0x13)!.data]).toEqual([
      0, 240, 0, 96, 0, 1,
    ]);
    expect(result.completedPages).toBe(2);
    expect(progress.mock.calls.at(-1)).toEqual([2000, 2000]);
    expect(f.chunks.every((c) => c.length <= 20)).toBe(true);
    f.session.close();
  });
  it("validates full raster/density before the first mutating packet", async () => {
    const f = fixture();
    await f.session.initialize();
    f.outgoing.length = 0;
    await expect(f.session.print({ ...job(), density: 8 })).rejects.toThrow(
      "density",
    );
    expect(f.outgoing).toEqual([]);
    f.session.close();
  });
  it("waits for page AND print/feed completion before PrintEnd, keeping progress under100", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.session.initialize();
    f.outgoing.length = 0;
    let polls = 0;
    f.setHandler((frame) => {
      if (frame.command !== 0xa3) return false;
      f.notify(0xb3, ++polls === 1 ? [0, 1, 100, 30] : [0, 1, 100, 100]);
      return true;
    });
    const progress = vi.fn(),
      printing = f.session.print(job(), progress);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.outgoing.some((f) => f.command === 0xf3)).toBe(false);
    expect(progress.mock.calls.every(([sent, total]) => sent < total)).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(150);
    expect((await printing).completedPages).toBe(1);
    expect(f.outgoing.at(-1)?.command).toBe(0xf3);
    f.session.close();
  });
  it("paces every no-response chunk including split bitmap frames", async () => {
    vi.useFakeTimers();
    const f = fixture({ withoutResponse: true });
    const connecting = f.session.initialize();
    await vi.runAllTimersAsync();
    await connecting;
    const rgba = new Uint8Array(job().rgba);
    rgba.set([0, 0, 0, 255], 0);
    const printing = f.session.print({ ...job(), rgba });
    await vi.runAllTimersAsync();
    await printing;
    expect(f.characteristic.writeValueWithResponse).not.toHaveBeenCalled();
    expect(f.characteristic.writeValueWithoutResponse).toHaveBeenCalled();
    expect(f.chunks.every((c) => c.length <= 20)).toBe(true);
    f.session.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a pending completion wait without PrintEnd, retries, listeners or timers", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.session.initialize();
    f.outgoing.length = 0;
    f.setHandler((frame) => frame.command === 0xa3);
    const printing = f.session.print(job());
    const rejected = expect(printing).rejects.toThrow(/stopped|disconnected/);
    await vi.advanceTimersByTimeAsync(1);
    f.session.cancel();
    await rejected;
    expect(f.outgoing.filter((f) => f.command === 0xa3)).toHaveLength(1);
    expect(f.outgoing.some((f) => f.command === 0xf3)).toBe(false);
    expect(f.characteristic.stopNotifications).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry a rejected or missing ACK and never ends an unconfirmed page", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.session.initialize();
    f.outgoing.length = 0;
    f.setHandler((frame) => frame.command === 0xe3);
    const rejected = expect(f.session.print(job())).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;
    expect(f.outgoing.filter((f) => f.command === 0xe3)).toHaveLength(1);
    expect(f.outgoing.some((f) => f.command === 0xf3)).toBe(false);
    f.session.close();
  });
});
