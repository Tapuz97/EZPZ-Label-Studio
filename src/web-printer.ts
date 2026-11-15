import { encodeWebPrint, type WebPrintJob } from "./web-protocol";
import { NIIMBOT_SERVICE, NIIMBOT_CHARACTERISTIC } from "./niimbot-protocol";
import { NiimbotSession, type NiimbotIdentity } from "./niimbot-session";
import { printerProtocol } from "./workflow";

const uuid = (id: string) => `0000${id}-0000-1000-8000-00805f9b34fb`;
const profiles = [
  { service: uuid("18f0"), write: uuid("2af1") },
  {
    service: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    write: "49535343-8841-43f4-a8d4-ecbe34729bb3",
  },
  {
    service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    write: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
  },
];
const fallbackService = uuid("fff0");
export const WEB_PROGRESS_EVENT = "ezpz-print-progress";
export function webBluetoothAvailable() {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator &&
    globalThis.isSecureContext === true
  );
}
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function bounded<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BluetoothTimeoutError(
                `${label} timed out. Reconnect before trying again.`,
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
class BluetoothTimeoutError extends Error {}

type PacketProof = { maxChunk: number; source: string; model?: string };
function reportedPacketLimit(server: BluetoothRemoteGATTServer): number | null {
  // Feature-detect the emerging API; no browser/OS guess and no flag required.
  const limit = (
    server as BluetoothRemoteGATTServer & {
      maxWriteWithoutResponseSize?: number;
    }
  ).maxWriteWithoutResponseSize;
  return typeof limit === "number" &&
    Number.isInteger(limit) &&
    limit >= 20 &&
    limit <= 514
    ? Math.min(limit, 244)
    : null;
}

export class WebPrinter {
  private selected = new Map<string, BluetoothDevice>();
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private busy = false;
  private cancelled = false;
  private generation = 0;
  private packetProof: PacketProof = { maxChunk: 20, source: "baseline" };
  private lastTransfer: Record<string, unknown> | null = null;
  private info: ReturnType<WebPrinter["connectionInfo"]> | null = null;
  private niimbot: NiimbotSession | null = null;
  private niimbotIdentity: NiimbotIdentity | null = null;
  private connecting = false;
  private connectingDevice: BluetoothDevice | null = null;
  private connectionInfo(
    device: BluetoothDevice,
    characteristic: BluetoothRemoteGATTCharacteristic,
  ) {
    const binaryFamily =
      characteristic.service.uuid === NIIMBOT_SERVICE ||
      characteristic.uuid === NIIMBOT_CHARACTERISTIC ||
      printerProtocol(device.name || "") === "unsupported";
    const d110 = binaryFamily && this.niimbotIdentity?.compatible;
    const protocol: "zpl" | "tspl" | "niimbot" | "unsupported" = binaryFamily
      ? d110
        ? "niimbot"
        : "unsupported"
      : printerProtocol(device.name || "");
    return {
      id: device.id,
      name: device.name || "Bluetooth printer",
      serviceUuid: characteristic.service.uuid,
      writeUuid: characteristic.uuid,
      writeMode: characteristic.properties.write
        ? "WithResponse"
        : "WithoutResponse",
      maxChunk: this.packetProof.maxChunk,
      chunkSource: this.packetProof.source,
      protocol,
      supportedForPrinting: protocol !== "unsupported",
      capabilities: {
        model: d110
          ? "NIIMBOT D110"
          : this.niimbotIdentity
            ? `NIIMBOT model ${this.niimbotIdentity.modelId}`
            : this.packetProof.model,
        modelId: this.niimbotIdentity?.modelId,
        protocolVersion: this.niimbotIdentity?.protocolVersion,
        status: d110
          ? "model-specification"
          : this.packetProof.model
            ? "partial"
            : "unknown",
        source: d110
          ? ["live NIIMBOT model inquiry", "D110 model specification"]
          : ["Web Bluetooth supported GATT profile"],
        fieldSources: {
          ...(d110
            ? {
                model: "live-query",
                dpi: "model-specification",
                maxWidthDots: "model-specification",
                density: "model-specification",
              }
            : {}),
          ...(this.niimbotIdentity?.stockCode
            ? { stockCode: "live RFID roll identifier" }
            : {}),
        },
        stockCode: this.niimbotIdentity?.stockCode,
        dpi: d110 ? 203 : undefined,
        maxWidthDots: d110 ? 96 : undefined,
        densityMin: d110 ? 1 : undefined,
        densityMax: d110 ? 3 : undefined,
        densityDefault: d110 ? 2 : undefined,
        notes: d110
          ? [
              "Experimental D110 support. Model identity was queried live; 203 dpi, 96-dot head and density 1–3 come from model specifications, not a live measurement. Stock is selected manually.",
            ]
          : binaryFamily
            ? [
                "This NIIMBOT model or protocol has not been verified for printing. No ASCII printer fallback is permitted.",
              ]
            : [
                "DPI, printable width and loaded stock are not reported by this browser connection. Choose the loaded stock manually.",
              ],
      },
    };
  }
  private async modelReply(
    write: BluetoothRemoteGATTCharacteristic,
    notify: BluetoothRemoteGATTCharacteristic,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let received = "",
      resolveReply!: (value: string | null) => void;
    const reply = new Promise<string | null>((resolve) => {
      resolveReply = resolve;
      timer = setTimeout(() => resolve(null), 1800);
    });
    const listener = () => {
      const value = notify.value;
      if (!value) return;
      if (received.length + value.byteLength > 128) {
        resolveReply(null);
        return;
      }
      for (let i = 0; i < value.byteLength; i++)
        received += String.fromCharCode(value.getUint8(i));
      const model = received.replace(/\0/g, "").trim();
      if (model === "DB403") resolveReply(model);
      else if (/[\r\n]/.test(received) && model) resolveReply(null);
    };
    notify.addEventListener("characteristicvaluechanged", listener);
    try {
      await bounded(
        write.writeValueWithResponse(bytes),
        10000,
        "Printer inquiry write",
      );
      return await reply;
    } finally {
      clearTimeout(timer);
      notify.removeEventListener("characteristicvaluechanged", listener);
    }
  }
  private async verifyPacketLimit(
    device: BluetoothDevice,
    write: BluetoothRemoteGATTCharacteristic,
  ): Promise<PacketProof> {
    const baseline: PacketProof = { maxChunk: 20, source: "baseline" };
    if (!write.properties.write) return baseline;
    const reported = device.gatt ? reportedPacketLimit(device.gatt) : null;
    if (reported !== null)
      return { maxChunk: reported, source: "browser-reported-payload" };
    // Only the physically identified DB403/18F0 profile gets a read-only probe.
    if (device.name !== "DB403" || write.service.uuid !== uuid("18f0"))
      return baseline;
    let notify: BluetoothRemoteGATTCharacteristic;
    try {
      notify = await bounded(
        write.service.getCharacteristic(uuid("2af0")),
        2000,
        "Find model notification endpoint",
      );
    } catch (error) {
      if (error instanceof BluetoothTimeoutError) throw error;
      return baseline;
    }
    if (!notify.properties.notify && !notify.properties.indicate)
      return baseline;
    await bounded(
      notify.startNotifications(),
      2000,
      "Listen for printer inquiry",
    );
    try {
      const model = await this.modelReply(
        write,
        notify,
        new TextEncoder().encode("~!T\n"),
      );
      if (model !== "DB403") return baseline;
      // Let the single baseline reply settle before associating another reply.
      await wait(150);
      // Blank command separators followed by the known nonmutating inquiry.
      // A truncated packet contains only blank lines: the inquiry is at the end.
      // No print/feed/configuration instruction is sent by this check.
      const probe = new Uint8Array(244).fill(10);
      probe.set(new TextEncoder().encode("~!T\n"), 240);
      try {
        if ((await this.modelReply(write, notify, probe)) === model)
          return { maxChunk: 244, source: "db403-padded-model-inquiry", model };
      } catch (error) {
        if (error instanceof BluetoothTimeoutError || !device.gatt?.connected)
          throw error;
      }
      // Clear any incomplete command separator after a rejected/truncated probe.
      await bounded(
        write.writeValueWithResponse(new Uint8Array([10])),
        3000,
        "Finish printer inquiry",
      );
      return { ...baseline, model };
    } finally {
      await bounded(
        notify.stopNotifications(),
        2000,
        "Release printer inquiry notifications",
      );
    }
  }
  async scan() {
    if (!webBluetoothAvailable())
      throw Error(
        "Bluetooth printing requires Chrome or Edge on a supported device over HTTPS. You can still design and export labels here.",
      );
    if (this.busy || this.connecting || this.device?.gatt?.connected)
      throw Error("Disconnect the printer before selecting another device.");
    // This call must remain synchronous with the user's click (browser activation).
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...profiles.map((p) => p.service), fallbackService],
    });
    this.selected.clear();
    this.selected.set(device.id, device);
    return [
      {
        id: device.id,
        name: device.name || "Bluetooth printer",
        address: "Selected in browser",
      },
    ];
  }
  async connect(id: string) {
    if (this.busy) throw Error("A print job is already being sent.");
    if (this.connecting)
      throw Error("A printer connection is already in progress.");
    const device = this.selected.get(id);
    if (!device?.gatt)
      throw Error("Choose this printer in the browser Bluetooth picker first.");
    this.disconnect();
    this.connecting = true;
    this.connectingDevice = device;
    const generation = this.generation;
    try {
      const pending = device.gatt.connect().then((server) => {
        if (generation !== this.generation) {
          server.disconnect();
          throw Error("Bluetooth connection cancelled.");
        }
        return server;
      });
      const server = await bounded(pending, 10000, "Bluetooth connection");
      device.addEventListener("gattserverdisconnected", this.onDisconnected);
      let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
      const orderedProfiles = [...profiles].sort(
        (a, b) =>
          Number(b.service === NIIMBOT_SERVICE) -
          Number(a.service === NIIMBOT_SERVICE),
      );
      for (const profile of orderedProfiles) {
        try {
          const service = await bounded(
            server.getPrimaryService(profile.service),
            3000,
            "Find print service",
          );
          const candidate = await bounded(
            service.getCharacteristic(profile.write),
            3000,
            "Find print endpoint",
          );
          if (
            candidate.properties.write ||
            candidate.properties.writeWithoutResponse
          ) {
            characteristic = candidate;
            break;
          }
        } catch (error) {
          if (!server.connected) throw error;
        }
      }
      if (!characteristic) {
        const service = await bounded(
          server.getPrimaryService(fallbackService),
          3000,
          "Find compatible print service",
        );
        const candidates = (
          await bounded(
            service.getCharacteristics(),
            3000,
            "Find compatible endpoints",
          )
        ).filter(
          (c) =>
            [uuid("fff1"), uuid("fff2")].includes(c.uuid) &&
            (c.properties.write || c.properties.writeWithoutResponse),
        );
        if (candidates.length === 1) characteristic = candidates[0];
      }
      if (!characteristic)
        throw Error(
          "This printer needs a verified compatibility profile. No print data was sent.",
        );
      if (generation !== this.generation)
        throw Error("Bluetooth connection cancelled.");
      const niimbotEndpoint =
        characteristic.service.uuid === NIIMBOT_SERVICE ||
        characteristic.uuid === NIIMBOT_CHARACTERISTIC;
      if (niimbotEndpoint) {
        if (
          !characteristic.properties.notify &&
          !characteristic.properties.indicate
        )
          throw Error(
            "This NIIMBOT endpoint cannot return the required printer acknowledgements.",
          );
        this.packetProof = {
          maxChunk: reportedPacketLimit(server) ?? 20,
          source:
            reportedPacketLimit(server) === null
              ? "baseline"
              : "browser-reported-payload",
        };
        this.niimbot = new NiimbotSession(
          characteristic,
          this.packetProof.maxChunk,
        );
        this.niimbotIdentity = await this.niimbot.initialize();
      } else if (printerProtocol(device.name || "") !== "unsupported") {
        this.packetProof = await this.verifyPacketLimit(device, characteristic);
      } else this.packetProof = { maxChunk: 20, source: "baseline" };
      if (generation !== this.generation)
        throw Error("Bluetooth connection cancelled.");
      if (!device.gatt?.connected)
        throw Error("The printer disconnected during connection verification.");
      this.device = device;
      this.characteristic = characteristic;
      this.info = this.connectionInfo(device, characteristic);
      device.addEventListener("gattserverdisconnected", this.onDisconnected);
      return this.info;
    } catch (error) {
      this.niimbot?.close();
      this.niimbot = null;
      this.niimbotIdentity = null;
      device.removeEventListener("gattserverdisconnected", this.onDisconnected);
      this.generation++;
      device.gatt.disconnect();
      throw error;
    } finally {
      this.connecting = false;
      this.connectingDevice = null;
    }
  }
  private onDisconnected = () => {
    this.niimbot?.close();
    this.niimbot = null;
    this.niimbotIdentity = null;
    this.cancelled = true;
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnected,
    );
    this.connectingDevice?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnected,
    );
    this.device = null;
    this.characteristic = null;
    this.info = null;
  };
  disconnect() {
    this.niimbot?.close();
    this.niimbot = null;
    this.niimbotIdentity = null;
    this.generation++;
    this.cancelled = true;
    this.connectingDevice?.gatt?.disconnect();
    this.connectingDevice?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnected,
    );
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnected,
    );
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
    this.info = null;
  }
  status() {
    return {
      connected: !!this.device?.gatt?.connected,
      busy: this.busy,
      ...(this.device?.gatt?.connected ? this.info : {}),
    };
  }
  diagnostics() {
    return {
      platform: "Web Bluetooth",
      connection: this.status(),
      lastTransfer: this.lastTransfer,
      niimbotIdentity: this.niimbotIdentity,
      notes: [
        "Browser device identifiers are scoped to this website. No hardware address or negotiated MTU is exposed.",
        "A successful transfer is not confirmation that a physical label printed.",
      ],
    };
  }
  cancel() {
    this.cancelled = true;
    this.niimbot?.cancel();
  }
  async print(job: WebPrintJob) {
    if (this.busy) throw Error("A print job is already being sent.");
    if (!this.characteristic || !this.device?.gatt?.connected)
      throw Error("Connect a printer before printing.");
    if (!this.info?.supportedForPrinting)
      throw Error(
        "This printer model is not verified for printing. No print data was sent.",
      );
    if (job.protocol !== this.info.protocol)
      throw Error(
        "The label printer format does not match this connection. No print data was sent.",
      );
    if (this.niimbot) {
      this.busy = true;
      this.cancelled = false;
      const started = performance.now();
      try {
        const result = await this.niimbot.print(job, (sent, total) =>
          window.dispatchEvent(
            new CustomEvent(WEB_PROGRESS_EVENT, {
              detail: {
                sent,
                total,
                elapsedMs: performance.now() - started,
                bytesPerSecond: 0,
              },
            }),
          ),
        );
        this.lastTransfer = { ...result, protocol: "niimbot", error: null };
        return result;
      } catch (error) {
        this.lastTransfer = {
          protocol: "niimbot",
          error: error instanceof Error ? error.message : String(error),
        };
        this.disconnect();
        throw error;
      } finally {
        this.busy = false;
      }
    }
    if (job.protocol === "niimbot")
      throw Error(
        "NIIMBOT printing requires its identified printer connection. No print data was sent.",
      );
    this.busy = true;
    this.cancelled = false;
    const characteristic = this.characteristic,
      encodingStarted = performance.now();
    let started = encodingStarted,
      encodingMs = 0,
      transferError: string | null = null;
    const reported = this.device.gatt
      ? reportedPacketLimit(this.device.gatt)
      : null;
    if (characteristic.properties.write && reported !== null)
      this.packetProof = {
        ...this.packetProof,
        maxChunk: reported,
        source: "browser-reported-payload",
      };
    const maxChunk = this.packetProof.maxChunk;
    if (this.info) this.info.maxChunk = maxChunk;
    let sent = 0,
      chunks = 0,
      lastProgress = 0;
    const progress = () => {
      const elapsedMs = performance.now() - started;
      window.dispatchEvent(
        new CustomEvent(WEB_PROGRESS_EVENT, {
          detail: {
            sent,
            total: bytes.length,
            elapsedMs,
            bytesPerSecond: elapsedMs ? (sent * 1000) / elapsedMs : 0,
          },
        }),
      );
    };
    let bytes: Uint8Array = new Uint8Array();
    try {
      bytes = await encodeWebPrint(job);
      encodingMs = performance.now() - encodingStarted;
      started = performance.now();
      for (let offset = 0; offset < bytes.length; offset += maxChunk) {
        if (this.cancelled)
          throw Error("Printing stopped. Buffered data may still print.");
        if (performance.now() - started > 600000)
          throw Error("The print transfer exceeded ten minutes.");
        const chunk = bytes.slice(offset, offset + maxChunk),
          tick = performance.now();
        await bounded(
          characteristic.properties.write
            ? characteristic.writeValueWithResponse(chunk)
            : characteristic.writeValueWithoutResponse(chunk),
          10000,
          "Print transfer",
        );
        sent += chunk.length;
        chunks++;
        const budget = characteristic.properties.write
          ? (chunk.length / 8192) * 1000
          : Math.max(10, (chunk.length / 8192) * 1000);
        const remaining = budget - (performance.now() - tick);
        if (remaining > 0) await wait(remaining);
        if (performance.now() - lastProgress >= 100 || sent === bytes.length) {
          progress();
          lastProgress = performance.now();
        }
      }
      return {
        bytesSent: sent,
        chunksSent: chunks,
        elapsedMs: performance.now() - started,
        encodingMs,
        maxChunk,
        message: `Sent ${sent.toLocaleString()} bytes. Check the printer for output.`,
      };
    } catch (error) {
      transferError = error instanceof Error ? error.message : String(error);
      this.disconnect();
      throw error;
    } finally {
      this.lastTransfer = {
        bytesSent: sent,
        totalBytes: bytes.length,
        chunksSent: chunks,
        elapsedMs: performance.now() - started,
        encodingMs,
        maxChunk,
        chunkSource: this.packetProof.source,
        error: transferError,
      };
      this.busy = false;
    }
  }
}
export const webPrinter = new WebPrinter();
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => webPrinter.disconnect());
