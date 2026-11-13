import { invoke, isTauri } from "@tauri-apps/api/core";
import { webPrinter, webBluetoothAvailable } from "./web-printer";
import { monochrome, validatePrintJob, type WebPrintJob } from "./web-protocol";
export { WEB_PROGRESS_EVENT } from "./web-printer";
export const bluetoothAvailable = () => isTauri() || webBluetoothAvailable();
export async function printerCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) {
    if (command === "print_label") {
      const job = args?.job as WebPrintJob;
      validatePrintJob(job);
      const { rgba: _rgba, ...metadata } = job;
      return invoke<T>("print_raster", {
        job: { ...metadata, raster: Array.from(monochrome(job)) },
      });
    }
    return invoke<T>(command, args);
  }
  let result: unknown;
  switch (command) {
    case "scan_printers":
      result = await webPrinter.scan();
      break;
    case "connect_printer":
      result = await webPrinter.connect(String(args?.id));
      break;
    case "disconnect_printer":
      result = webPrinter.disconnect();
      break;
    case "printer_status":
      result = webPrinter.status();
      break;
    case "printer_diagnostics":
      result = webPrinter.diagnostics();
      break;
    case "cancel_print":
      result = webPrinter.cancel();
      break;
    case "print_label":
      result = await webPrinter.print(args?.job as WebPrintJob);
      break;
    default:
      throw Error(`Unsupported printer operation: ${command}`);
  }
  return result as T;
}
