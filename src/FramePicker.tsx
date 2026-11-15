import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { frameGeometry, framePresets, type FrameStyle } from "./frames";

type FrameLabel = { widthMm: number; heightMm: number; dpi: number };
type FramePrinter = {
  protocol?: string;
  capabilities?: { dpi?: number; maxWidthDots?: number; maxWidthMm?: number };
};

/** Leave a label margin inside the connected printer's actual head width. */
export function framePlacement(
  label: FrameLabel,
  printer: FramePrinter | null = null,
) {
  if (
    ![label.widthMm, label.heightMm, label.dpi].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw Error(
      "Choose positive label dimensions and resolution before adding a frame.",
    );
  const cap = printer?.capabilities;
  const dpi =
    cap?.dpi && Number.isFinite(cap.dpi) && cap.dpi > 0 ? cap.dpi : label.dpi;
  const headMm = Math.min(
    cap?.maxWidthMm && Number.isFinite(cap.maxWidthMm) && cap.maxWidthMm > 0
      ? cap.maxWidthMm
      : Infinity,
    cap?.maxWidthDots &&
      Number.isFinite(cap.maxWidthDots) &&
      cap.maxWidthDots > 0
      ? (cap.maxWidthDots * 25.4) / dpi
      : Infinity,
  );
  // This transport rotates landscape artwork to its head axis before printing.
  // Other transports keep the document's horizontal axis across the head.
  const rotated =
    printer?.protocol === "niimbot" &&
    label.heightMm < label.widthMm &&
    label.widthMm > headMm;
  const cross = rotated ? label.heightMm : label.widthMm;
  const extra = Math.max(0, (cross - headMm) / 2);
  const inset = (axis: number, wanted: number) => {
    const minimum = Math.min(0.5, axis / 2, headMm / 2);
    return Math.max(0, Math.min(wanted, (axis - minimum) / 2));
  };
  const x = inset(label.widthMm, 1 + (rotated ? 0 : extra));
  const y = inset(label.heightMm, 1 + (rotated ? extra : 0));
  return { x, y, width: label.widthMm - 2 * x, height: label.heightMm - 2 * y };
}

export function FramePreview({ style }: { style?: FrameStyle }) {
  const shape = frameGeometry(style, 120, 68, 1.2);
  return (
    <svg
      className="size-full"
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={shape.strokeWidth}
    >
      {shape.paths.map((path, index) => (
        <path
          key={index}
          d={path.d}
          strokeDasharray={path.dash?.join(" ")}
          strokeLinecap={path.lineCap}
          strokeLinejoin={path.lineJoin}
        />
      ))}
    </svg>
  );
}

export function FramePicker({
  open,
  onOpenChange,
  onSelect,
  selectedStyle,
  editing = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (style: FrameStyle) => void;
  selectedStyle?: FrameStyle;
  editing?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Change frame" : "Choose a frame"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Choose a new style. The frame keeps its position, size, thickness and rotation."
              : "Add a frame behind your artwork, then resize, rotate or adjust its thickness in the editor."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[min(65vh,28rem)]">
          <div
            className="grid grid-cols-2 gap-3 p-1 pr-4 sm:grid-cols-3"
            role="group"
            aria-label="Frame styles"
          >
            {framePresets.map((frame) => (
              <Button
                key={frame.id}
                type="button"
                variant={selectedStyle === frame.id ? "secondary" : "outline"}
                className="h-auto min-w-0 flex-col gap-3 px-3 py-4"
                aria-label={`${editing ? "Use" : "Add"} ${frame.name} frame`}
                aria-pressed={selectedStyle === frame.id}
                onClick={() => {
                  onSelect(frame.id);
                  onOpenChange(false);
                }}
              >
                <span className="block h-16 w-full">
                  <FramePreview style={frame.id} />
                </span>
                <span className="whitespace-normal">{frame.name}</span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
