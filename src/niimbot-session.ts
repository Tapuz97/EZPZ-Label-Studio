import {
  D110_MODEL_ID,
  NiimbotFrameDecoder,
  d110RowFrames,
  niimbotFrame,
  niimbotProtocolVersion,
  niimbotStockCode,
  prepareD110Raster,
  type NiimbotFrame,
  type NiimbotPrintTask,
} from "./niimbot-protocol";
import type { WebPrintJob } from "./web-protocol";

type Waiter = {
  commands: readonly number[];
  resolve: (frame: NiimbotFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export type NiimbotIdentity = {
  modelId: number;
  connectResult: number;
  printTask: NiimbotPrintTask | null;
  protocolVersion: number | null;
  compatible: boolean;
  statusData: number[];
  heartbeat: number[];
  heartbeatCommand: number | null;
  information: Record<string, number[]>;
  rfid: number[] | null;
  stockCode?: string;
};

/** One notification subscription per connection; no automatic retries of writes. */
export class NiimbotSession {
  private decoder = new NiimbotFrameDecoder();
  private waiter: Waiter | null = null;
  private abort = new AbortController();
  private identity: NiimbotIdentity | null = null;
  private sent = 0;
  private chunks = 0;
  private closed = false;
  constructor(
    private characteristic: BluetoothRemoteGATTCharacteristic,
    private maxChunk = 20,
  ) {
    if (!Number.isInteger(maxChunk) || maxChunk < 20 || maxChunk > 244)
      throw Error("Invalid Bluetooth payload size.");
  }
  private onNotify = () => {
    const view = this.characteristic.value;
    if (!view || this.closed) return;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (const frame of this.decoder.push(bytes)) {
      const waiter = this.waiter;
      if (!waiter || !waiter.commands.includes(frame.command)) continue;
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    }
  };
  private check() {
    if (this.closed || this.abort.signal.aborted)
      throw Error(
        "Printer operation stopped. Buffered labels may still print; reconnect before trying again.",
      );
  }
  private async bounded<T>(
    operation: Promise<T>,
    timeout: number,
    label: string,
  ): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          onAbort = () =>
            reject(
              Error(
                "Printer operation stopped. Buffered labels may still print.",
              ),
            );
          this.abort.signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(
            () =>
              reject(
                Error(`${label} timed out. Reconnect before trying again.`),
              ),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener("abort", onAbort);
    }
  }
  private async pause(ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.bounded(
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
        ms + 1000,
        "Printer pacing",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private async write(bytes: Uint8Array<ArrayBuffer>) {
    for (let offset = 0; offset < bytes.length; offset += this.maxChunk) {
      this.check();
      const chunk = bytes.slice(offset, offset + this.maxChunk);
      const response = this.characteristic.properties.write;
      await this.bounded(
        response
          ? this.characteristic.writeValueWithResponse(chunk)
          : this.characteristic.writeValueWithoutResponse(chunk),
        10000,
        "Printer write",
      );
      this.check();
      this.sent += chunk.length;
      this.chunks++;
      if (!response) await this.pause(10);
    }
  }
  private async request(
    command: number,
    data: ArrayLike<number>,
    response: number | readonly number[],
    timeout = 2000,
    prefix = false,
  ) {
    this.check();
    if (this.waiter) throw Error("A printer reply is already pending.");
    let pending!: Waiter;
    const reply = new Promise<NiimbotFrame>((resolve, reject) => {
      pending = {
        commands: typeof response === "number" ? [response] : response,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.waiter === pending) this.waiter = null;
          reject(
            Error(
              `Printer reply ${pending.commands.map((command) => `0x${command.toString(16)}`).join("/")} timed out. No retry was sent.`,
            ),
          );
        }, timeout),
      };
      this.waiter = pending;
    });
    // A synchronous notification may settle this before the write returns.
    void reply.catch(() => {});
    try {
      const frame = niimbotFrame(command, data);
      await this.write(prefix ? new Uint8Array([3, ...frame]) : frame);
      return await reply;
    } catch (error) {
      clearTimeout(pending.timer);
      if (this.waiter === pending) this.waiter = null;
      pending.reject(error instanceof Error ? error : Error(String(error)));
      throw error;
    }
  }
  async initialize(): Promise<NiimbotIdentity> {
    this.characteristic.addEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    try {
      await this.bounded(
        this.characteristic.startNotifications(),
        3000,
        "Printer notifications",
      );
      // Connect is a protocol-session handshake, not a print/feed/configuration.
      const connected = await this.request(0xc1, [1], 0xc2, 2000, true);
      if (connected.data.length !== 1 || ![1, 2, 3].includes(connected.data[0]))
        throw Error("The printer rejected the connection handshake.");
      const connectResult = connected.data[0];
      const status = await this.request(0xa5, [1], 0xb5);
      const model = await this.request(0x40, [8], 0x48);
      if (model.data.length !== 1 && model.data.length !== 2)
        throw Error("The printer did not provide a complete model identity.");
      const modelId = (model.data[0] << 8) | (model.data[1] ?? 0);
      const information: Record<string, number[]> = { "08": [...model.data] };
      for (const sub of [0x0b, 0x0d, 0x0a, 7, 3, 0x0c, 9]) {
        try {
          information[sub.toString(16).padStart(2, "0")] = [
            ...(await this.request(0x40, [sub], 0x40 + sub, 600)).data,
          ];
        } catch (error) {
          this.check();
          if (!(error instanceof Error && error.message.includes("reply")))
            throw error;
        }
      }
      let heartbeat: NiimbotFrame | null = null;
      try {
        heartbeat = await this.request(0xdc, [4], [0xd9, 0], 600);
      } catch (error) {
        this.check();
        if (!(error instanceof Error && error.message.includes("reply")))
          throw error;
      }
      let rfid: Uint8Array<ArrayBuffer> | null = null;
      try {
        rfid = (await this.request(0x1a, [1], 0x1b, 600)).data;
      } catch (error) {
        this.check();
        if (!(error instanceof Error && error.message.includes("reply")))
          throw error;
      }
      const statusVersion = niimbotProtocolVersion(status.data);
      const protocolVersion =
        connectResult === 2 ? 1 : connectResult === 1 ? 0 : statusVersion;
      const printTask: NiimbotPrintTask | null =
        modelId !== D110_MODEL_ID
          ? null
          : connectResult === 2 && statusVersion === null
            ? "legacy"
            : connectResult === 3 && statusVersion === 3
              ? "b1"
              : null;
      this.identity = {
        modelId,
        connectResult,
        printTask,
        protocolVersion,
        compatible: printTask !== null,
        statusData: [...status.data],
        heartbeat: heartbeat ? [...heartbeat.data] : [],
        heartbeatCommand: heartbeat?.command ?? null,
        information,
        rfid: rfid ? [...rfid] : null,
        stockCode: rfid ? niimbotStockCode(rfid) : undefined,
      };
      return this.identity;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    const waiter = this.waiter;
    this.waiter = null;
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(Error("Printer disconnected or operation stopped."));
    }
    this.decoder.reset();
    this.characteristic.removeEventListener(
      "characteristicvaluechanged",
      this.onNotify,
    );
    // BLE disconnect is owned by WebPrinter. This asynchronous release never blocks exit.
    try {
      void this.characteristic.stopNotifications().catch(() => {});
    } catch {
      // Releasing a stale endpoint must never prevent the owner disconnecting.
    }
  }
  cancel() {
    this.close();
  }
  async print(
    job: WebPrintJob,
    progress?: (sent: number, total: number) => void,
  ) {
    this.check();
    if (!this.identity?.compatible)
      throw Error(
        "This NIIMBOT model or protocol is not verified for printing. No print data was sent.",
      );
    // Validate and encode the entire page before the first mutating command.
    const encodingStarted = performance.now();
    const raster = prepareD110Raster(job),
      rows = d110RowFrames(raster, this.identity.printTask!);
    const encodingMs = performance.now() - encodingStarted;
    const start = [0, 1, 0, 0, 0, 0, 0];
    const size = [raster.height >> 8, raster.height & 255, 0, 96, 0, 1];
    // Upload is only part of completion. Reserve progress for the printer's
    // physical page counter and closing ACK; 100% is never just bytes written.
    const total = job.copies * 1000,
      rowBytes = rows.reduce((sum, row) => sum + row.length, 0);
    this.sent = 0;
    this.chunks = 0;
    const began = performance.now();
    let completed = 0;
    const ack = async (
      command: number,
      data: number[],
      response: number,
      timeout?: number,
    ) => {
      const frame = await this.request(command, data, response, timeout);
      if (frame.data.length !== 1 || frame.data[0] !== 1)
        throw Error(
          `Printer rejected command 0x${command.toString(16)}. Check paper and lid; no retry was sent.`,
        );
    };
    for (let copy = 0; copy < job.copies; copy++) {
      await ack(0x21, [job.density], 0x31);
      await ack(0x23, [1], 0x33);
      const legacy = this.identity.printTask === "legacy";
      await ack(1, legacy ? [1] : start, 2);
      if (legacy) await ack(0x20, [1], 0x30);
      await ack(3, [1], 4);
      await ack(0x13, legacy ? size.slice(0, 4) : size, 0x14);
      if (legacy) await ack(0x15, [0, 1], 0x16);
      let uploaded = 0;
      for (const row of rows) {
        await this.write(row);
        uploaded += row.length;
        progress?.(
          copy * 1000 + 50 + Math.round((750 * uploaded) / rowBytes),
          total,
        );
      }
      await ack(0xe3, [1], 0xe4, 10000);
      progress?.(copy * 1000 + 850, total);
      const deadline = performance.now() + 30000;
      let complete = false;
      while (performance.now() < deadline) {
        const status = await this.request(0xa3, [1], 0xb3, 2000);
        if (status.data.length < 4)
          throw Error("Printer returned incomplete print progress.");
        const page = (status.data[0] << 8) | status.data[1];
        if (status.data[2] > 100 || status.data[3] > 100)
          throw Error("Printer returned invalid print progress.");
        progress?.(
          copy * 1000 +
            850 +
            Math.round(status.data[2] / 2 + status.data[3] / 2),
          total,
        );
        if (page >= 1 && status.data[2] === 100 && status.data[3] === 100) {
          complete = true;
          break;
        }
        await this.pause(150);
      }
      if (!complete)
        throw Error(
          "Physical print completion was not confirmed. Buffered labels may still print; no retry was sent.",
        );
      // Never send PrintEnd while the printer reports a page still in progress.
      await ack(0xf3, [1], 0xf4, 3000);
      completed++;
      progress?.(completed * 1000, total);
    }
    return {
      bytesSent: this.sent,
      chunksSent: this.chunks,
      elapsedMs: performance.now() - began,
      encodingMs,
      maxChunk: this.maxChunk,
      completedPages: completed,
      message: `Printer confirmed ${completed} completed label${completed === 1 ? "" : "s"}.`,
    };
  }
}
