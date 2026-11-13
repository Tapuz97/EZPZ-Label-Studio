import { encodeWebPrint, type WebPrintJob } from "./web-protocol";

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
            reject(Error(`${label} timed out. Reconnect before trying again.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class WebPrinter {
  private selected = new Map<string, BluetoothDevice>();
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private busy = false;
  private cancelled = false;
  private generation = 0;
  private info: ReturnType<WebPrinter["connectionInfo"]> | null = null;
  private connectionInfo(
    device: BluetoothDevice,
    characteristic: BluetoothRemoteGATTCharacteristic,
  ) {
    return {
      id: device.id,
      name: device.name || "Bluetooth printer",
      serviceUuid: characteristic.service.uuid,
      writeUuid: characteristic.uuid,
      writeMode: characteristic.properties.write
        ? "WithResponse"
        : "WithoutResponse",
      maxChunk: 20,
      capabilities: {
        status: "unknown",
        source: ["Web Bluetooth supported GATT profile"],
        fieldSources: {},
        notes: [
          "DPI, printable width and loaded stock are not reported by this browser connection. Choose the loaded stock manually.",
        ],
      },
    };
  }
  async scan() {
    if (!webBluetoothAvailable())
      throw Error(
        "Bluetooth printing requires Chrome or Edge on a supported device over HTTPS. You can still design and export labels here.",
      );
    if (this.busy || this.device?.gatt?.connected)
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
    const device = this.selected.get(id);
    if (!device?.gatt)
      throw Error("Choose this printer in the browser Bluetooth picker first.");
    this.disconnect();
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
      let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
      for (const profile of profiles) {
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
      this.device = device;
      this.characteristic = characteristic;
      this.info = this.connectionInfo(device, characteristic);
      device.addEventListener("gattserverdisconnected", this.onDisconnected);
      return this.info;
    } catch (error) {
      this.generation++;
      device.gatt.disconnect();
      throw error;
    }
  }
  private onDisconnected = () => {
    this.cancelled = true;
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.onDisconnected,
    );
    this.device = null;
    this.characteristic = null;
    this.info = null;
  };
  disconnect() {
    this.generation++;
    this.cancelled = true;
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
      notes: [
        "Browser device identifiers are scoped to this website. No hardware address or negotiated MTU is exposed.",
        "A successful transfer is not confirmation that a physical label printed.",
      ],
    };
  }
  cancel() {
    this.cancelled = true;
  }
  async print(job: WebPrintJob) {
    if (this.busy) throw Error("A print job is already being sent.");
    if (!this.characteristic || !this.device?.gatt?.connected)
      throw Error("Connect a printer before printing.");
    this.busy = true;
    this.cancelled = false;
    const characteristic = this.characteristic,
      started = performance.now();
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
      for (let offset = 0; offset < bytes.length; offset += 20) {
        if (this.cancelled)
          throw Error("Printing stopped. Buffered data may still print.");
        if (performance.now() - started > 600000)
          throw Error("The print transfer exceeded ten minutes.");
        const chunk = bytes.slice(offset, offset + 20),
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
        await wait(Math.max(0, budget - (performance.now() - tick)));
        if (performance.now() - lastProgress >= 100 || sent === bytes.length) {
          progress();
          lastProgress = performance.now();
        }
      }
      return {
        bytesSent: sent,
        chunksSent: chunks,
        message: `Sent ${sent.toLocaleString()} bytes. Check the printer for output.`,
      };
    } catch (error) {
      this.disconnect();
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
export const webPrinter = new WebPrinter();
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => webPrinter.disconnect());
