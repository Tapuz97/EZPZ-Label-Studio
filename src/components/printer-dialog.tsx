import { Bluetooth, Check, Printer, Redo2 } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

type Device = { id: string; name: string; address: string; rssi?: number };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  native: boolean;
  available?: boolean;
  devices: Device[];
  connection: { id: string; name: string } | null;
  scanning: boolean;
  connecting: string | null;
  printing: boolean;
  error: string;
  notice: string;
  onScan: () => void;
  onConnect: (device: Device) => void;
  onDisconnect: () => void;
};

export function PrinterDialog({
  open,
  onOpenChange,
  native,
  available = native,
  devices,
  connection,
  scanning,
  connecting,
  printing,
  error,
  notice,
  onScan,
  onConnect,
  onDisconnect,
}: Props) {
  const busy = scanning || connecting !== null || printing;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2">
              <Bluetooth />
              Connect a printer
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label={scanning ? "Scanning printers" : "Scan again"}
              title={scanning ? "Scanning printers" : "Scan again"}
              disabled={!available || busy || connection !== null}
              onClick={onScan}
            >
              {scanning ? <Spinner /> : <Redo2 />}
            </Button>
          </div>
          <DialogDescription>
            Turn on your Bluetooth label printer and disconnect it from your
            phone, then select it {native ? "below" : "in the browser Bluetooth picker"}.
          </DialogDescription>
        </DialogHeader>
        {!available ? (
          <Alert>
            <Printer />
            <AlertTitle>Bluetooth needs a supported browser</AlertTitle>
            <AlertDescription>
              You can design and export labels here. For Bluetooth printing, use
              Chrome or Edge on a supported device over HTTPS, or the Windows app.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {!native && <p className="text-xs text-muted-foreground">Your browser controls which devices this website can access. Only supported printer profiles can connect. Web Bluetooth printing is experimental.</p>}
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Printer connection</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!error && notice && (
              <Alert role="status">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}
            {printing && (
              <Alert>
                <AlertDescription>
                  A label is being sent. Printer connection controls will be
                  available when the transfer finishes.
                </AlertDescription>
              </Alert>
            )}
            {connection && (
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <Printer className="size-7 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{connection.name}</p>
                  <Badge variant="secondary" className="mt-1">
                    <Check className="size-3" />
                    Connected
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={onDisconnect}
                >
                  Disconnect
                </Button>
              </div>
            )}
            {scanning && (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
              >
                <Spinner />
                Scanning nearby printers…
              </div>
            )}
            {!scanning && !devices.length && !connection && (
              <Empty className="border py-8 md:p-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Printer />
                  </EmptyMedia>
                  <EmptyTitle>No printers found yet</EmptyTitle>
                  <EmptyDescription>
                    Keep the printer nearby and make sure another app is not
                    connected to it.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {devices.length > 0 && (
              <div
                aria-label="Available Bluetooth printers"
                className="flex max-h-72 flex-col gap-2 overflow-y-auto"
              >
                {devices.map((device) => (
                  <Button
                    key={device.id}
                    variant="outline"
                    className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-3 text-left"
                    disabled={busy || connection?.id === device.id}
                    onClick={() => onConnect(device)}
                  >
                    <Printer />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {device.name || "Unnamed Bluetooth device"}
                      </span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {device.address}
                        {device.rssi !== undefined
                          ? ` · ${device.rssi} dBm`
                          : ""}
                      </span>
                    </span>
                    {connecting === device.id ? (
                      <Spinner />
                    ) : connection?.id === device.id ? (
                      <Badge variant="secondary">Connected</Badge>
                    ) : (
                      <span className="text-xs">Connect</span>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
