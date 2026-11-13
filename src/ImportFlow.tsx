import { FieldGroup } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/form-field";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/form-input";
import { FormSelect } from "@/components/form-select";
import { useEffect, useRef, useState } from "react";
import { FileImage, Upload, X, Trash2, Check } from "./icons";
import { makeElement } from "./model";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { FileDuotoneIcon } from "@thesvg/ui-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArtworkViewport } from "@/components/artwork-viewport";
import { useUnsavedWork, useUnsavedWorkGuard } from "@/components/unsaved-work";
import {
  artworkOrientation,
  orientLabel,
  artworkPlacement,
} from "./import-artwork";
import type { ArtworkOrientation } from "./import-artwork";
import type { LabelDocument } from "./model";
import {
  parsePages,
  pdfOptions,
  picturePresets,
  commonPresets,
  validateSize,
} from "./workflow";
type Artwork = {
  batchId: string;
  rasterPixels: number;
  name: string;
  data: string;
  width: number;
  height: number;
  widthMm?: number;
  heightMm?: number;
};
export function ImportFlow({
  doc,
  onClose,
  onImport,
}: {
  doc: LabelDocument;
  onClose: () => void;
  onImport: (docs: LabelDocument[]) => void;
}) {
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pdf, setPdf] = useState<{
    file: File;
    pages: number;
    batchId: string;
    appliedRange: string;
  } | null>(null);
  const [range, setRange] = useState(""),
    [mode, setMode] = useState<"fit" | "match">("fit");
  const [width, setWidth] = useState(doc.widthMm),
    [height, setHeight] = useState(doc.heightMm);
  const [orientation, setOrientation] = useState<ArtworkOrientation>(() =>
    artworkOrientation(doc.widthMm, doc.heightMm),
  );
  const [sourceDpi, setSourceDpi] = useState(203),
    [margin, setMargin] = useState(0),
    [printScale, setPrintScale] = useState(100);
  const [selected, setSelected] = useState(0),
    [dragActive, setDragActive] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    busyRef = useRef(false),
    operation = useRef(0),
    mounted = useRef(true);
  const pdfTask = useRef<{ destroy: () => Promise<void> } | null>(null);
  const { confirmDiscard } = useUnsavedWorkGuard();
  useUnsavedWork("import", artworks.length > 0 || pdf !== null || busy);
  async function destroyTask(task: { destroy: () => Promise<void> } | null) {
    try {
      await task?.destroy();
    } catch {
      /* Already canceled. */
    }
  }
  function cancel() {
    confirmDiscard(() => {
      operation.current++;
      busyRef.current = false;
      void destroyTask(pdfTask.current);
      onClose();
    }, "import");
  }
  useEffect(() => {
    mounted.current = true;
    const preventNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      mounted.current = false;
      operation.current++;
      void destroyTask(pdfTask.current);
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);
  function active(id: number) {
    return mounted.current && operation.current === id;
  }
  function checkBudget(pixels: number) {
    if (pixels > 40_000_000)
      throw Error(
        "This job exceeds 40 million decoded pixels. Import fewer pages or smaller images.",
      );
  }
  function chooseOrientation(value: ArtworkOrientation) {
    setOrientation(value);
    const next = orientLabel(width, height, value);
    setWidth(next.widthMm);
    setHeight(next.heightMm);
  }
  function selectArtwork(index: number, source: Artwork) {
    setSelected(index);
    chooseOrientation(artworkOrientation(source.width, source.height));
  }
  async function renderPdfPage(
    pdfDocument: PDFDocumentProxy,
    pageNumber: number,
    file: File,
    batchId: string,
    pixels: number,
    id: number,
  ): Promise<Artwork> {
    const page = await pdfDocument.getPage(pageNumber);
    try {
      if (!active(id)) throw Error("Preparation canceled.");
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(
          300 / 72,
          2400 / Math.max(natural.width, natural.height),
        ),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      checkBudget(pixels + canvas.width * canvas.height);
      await page.render({ canvas, viewport }).promise;
      if (!active(id)) throw Error("Preparation canceled.");
      return {
        batchId,
        name: `${file.name} · page ${pageNumber}`,
        data: canvas.toDataURL("image/png"),
        rasterPixels: canvas.width * canvas.height,
        width: canvas.width,
        height: canvas.height,
        widthMm: (natural.width * 25.4) / 72,
        heightMm: (natural.height * 25.4) / 72,
      };
    } finally {
      page.cleanup();
    }
  }
  async function files(list: File[]) {
    if (busyRef.current) {
      setError(
        "Wait for the current file preparation to finish before adding files.",
      );
      return;
    }
    if (!list.length) {
      setError("Drop supported files from your computer, or choose files.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setDragActive(false);
    const id = ++operation.current;
    try {
      if (artworks.length + list.length > 50)
        throw Error("Add up to 50 pages or images per job.");
      if (
        list.length > 1 &&
        list.some(
          (file) =>
            file.type === "application/pdf" || /\.pdf$/i.test(file.name),
        )
      )
        throw Error("Add one PDF at a time so you can choose its pages.");
      const additions: Artwork[] = [];
      let pixels = artworks.reduce((sum, a) => sum + a.rasterPixels, 0);
      let nextPdf: typeof pdf = pdf;
      for (const file of list) {
        if (!active(id)) return;
        if (file.size > 30_000_000)
          throw Error(`${file.name} exceeds the 30 MB limit.`);
        const batchId = crypto.randomUUID();
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const pdfjs = await import("pdfjs-dist");
          if (!active(id)) return;
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
          const data = await file.arrayBuffer();
          if (!active(id)) return;
          const task = pdfjs.getDocument({ data, ...pdfOptions });
          pdfTask.current = task;
          try {
            const document = await task.promise;
            if (!active(id)) return;
            const first = await renderPdfPage(
              document,
              1,
              file,
              batchId,
              pixels,
              id,
            );
            additions.push(first);
            pixels += first.rasterPixels;
            nextPdf = {
              file,
              pages: document.numPages,
              batchId,
              appliedRange: "1",
            };
          } finally {
            await destroyTask(task);
          }
        } else {
          if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name))
            throw Error(
              "Supported artwork: PDF, PNG, JPEG, WebP, BMP and GIF (first frame).",
            );
          const url = URL.createObjectURL(file);
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            if (!active(id)) return;
            if (img.width * img.height > 32_000_000)
              throw Error(
                "Image exceeds 32 million pixels. Resize it before importing.",
              );
            const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            pixels += canvas.width * canvas.height;
            checkBudget(pixels);
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            additions.push({
              batchId,
              name: file.name,
              data: canvas.toDataURL("image/png"),
              rasterPixels: canvas.width * canvas.height,
              width: img.width,
              height: img.height,
            });
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
      if (active(id) && additions.length) {
        setArtworks((items) => [...items, ...additions]);
        selectArtwork(artworks.length, additions[0]);
        setPdf(nextPdf);
        if (nextPdf !== pdf) setRange("1");
      }
    } catch (cause) {
      if (active(id))
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (active(id)) {
        pdfTask.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function loadPdf() {
    if (!pdf || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const id = ++operation.current;
    try {
      const pages = parsePages(range, pdf.pages);
      const retained = artworks.filter((a) => a.batchId !== pdf.batchId);
      if (retained.length + pages.length > 50)
        throw Error("This job can hold up to 50 pages or images.");
      const pdfjs = await import("pdfjs-dist");
      const data = await pdf.file.arrayBuffer();
      if (!active(id)) return;
      const task = pdfjs.getDocument({ data, ...pdfOptions });
      pdfTask.current = task;
      try {
        const document = await task.promise;
        const additions: Artwork[] = [];
        let pixels = retained.reduce((sum, a) => sum + a.rasterPixels, 0);
        for (const n of pages) {
          if (!active(id)) return;
          const artwork = await renderPdfPage(
            document,
            n,
            pdf.file,
            pdf.batchId,
            pixels,
            id,
          );
          additions.push(artwork);
          pixels += artwork.rasterPixels;
        }
        if (active(id)) {
          setArtworks([...retained, ...additions]);
          selectArtwork(retained.length, additions[0]);
          setPdf({ ...pdf, appliedRange: range });
        }
      } finally {
        await destroyTask(task);
      }
    } catch (cause) {
      if (active(id))
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (active(id)) {
        pdfTask.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function dimensions(a: Artwork) {
    return mode === "fit"
      ? { widthMm: width, heightMm: height }
      : orientLabel(
          Math.round((a.widthMm ?? (a.width * 25.4) / sourceDpi) * 100) / 100,
          Math.round((a.heightMm ?? (a.height * 25.4) / sourceDpi) * 100) / 100,
          orientation,
        );
  }
  const current = artworks[selected] ?? artworks[0];
  const size = current
    ? dimensions(current)
    : { widthMm: width, heightMm: height };
  let placement: ReturnType<typeof artworkPlacement> | null = null;
  try {
    if (current)
      placement = artworkPlacement(
        current.width,
        current.height,
        size,
        margin,
        printScale,
      );
  } catch {
    /* Validation is shown when the user continues. */
  }
  const pendingPages = pdf !== null && range !== pdf.appliedRange;
  function commit() {
    try {
      if (pendingPages)
        throw Error("Apply your PDF page selection before continuing.");
      const docs = artworks.map((a) => {
        const size = dimensions(a);
        validateSize(size.widthMm, size.heightMm, doc.dpi);
        return {
          ...doc,
          ...size,
          name: a.name,
          elements: [
            {
              ...makeElement("image"),
              ...artworkPlacement(a.width, a.height, size, margin, printScale),
              content: a.data,
            },
          ],
        };
      });
      if (!docs.length) throw Error("Add artwork first.");
      onImport(docs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  function dropFiles(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const dropped = Array.from(event.dataTransfer.files);
    void files(
      dropped.length
        ? dropped
        : Array.from(event.dataTransfer.items)
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null),
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = busy ? "none" : "copy";
        }}
        onDrop={dropFiles}
        className="import-flow w-[calc(100vw-3rem)] flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
      >
        <header>
          <DialogHeader>
            <span className="eyebrow">ARTWORK TO LABEL</span>
            <DialogTitle>Upload & prepare</DialogTitle>
            <DialogDescription>
              Preview every page before opening the print workspace.
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="outline"
            className="icon-button"
            aria-label="Close upload"
            onClick={cancel}
          >
            <X size={22} />
          </Button>
        </header>
        <div className="import-body">
          <aside className="import-controls">
            <Button
              variant="outline"
              className="drop-area h-auto min-h-36 flex-col whitespace-normal data-[drag-active=true]:border-primary data-[drag-active=true]:ring-2 data-[drag-active=true]:ring-primary"
              data-drag-active={dragActive}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) input.current?.click();
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setDragActive(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = busy ? "none" : "copy";
              }}
              onDrop={dropFiles}
            >
              <Upload size={30} />
              <strong>
                {busy ? "Preparing files…" : "Choose or drop files"}
              </strong>
              <span>PDF · PNG · JPEG · WebP · BMP · GIF</span>
              <small>Up to 30 MB per file · 50 pages per job</small>
            </Button>
            <FormInput
              ref={input}
              type="file"
              hidden
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif"
              onChange={(e) => {
                void files([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            {pdf && (
              <div className="pdf-picker">
                <strong>{pdf.file.name}</strong>
                <p>
                  {pdf.pages} pages available · page 1 previews automatically
                </p>
                <FormField label={<>Pages to import</>}>
                  <FormInput
                    aria-label="PDF pages"
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    placeholder="1-3, 5"
                  />
                </FormField>
                <Button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void loadPdf()}
                >
                  Apply selected pages
                </Button>
              </div>
            )}
            <FormField label="Label orientation">
              <ToggleGroup
                type="single"
                value={orientation}
                onValueChange={(value) => {
                  if (value) chooseOrientation(value as ArtworkOrientation);
                }}
                variant="outline"
                className="grid grid-cols-2"
                aria-label="Label orientation"
              >
                <ToggleGroupItem
                  value="vertical"
                  aria-label="Vertical"
                  className="h-auto flex-col gap-2 py-3"
                >
                  <FileDuotoneIcon />
                  <span>Vertical</span>
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="horizontal"
                  aria-label="Horizontal"
                  className="h-auto flex-col gap-2 py-3"
                >
                  <FileDuotoneIcon className="rotate-90" />
                  <span>Horizontal</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </FormField>
            <h3>Artwork sizing</h3>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as "fit" | "match")}
              aria-label="Artwork sizing"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem id="sizing-fit" value="fit" />
                <Label
                  htmlFor="sizing-fit"
                  className="flex flex-col items-start gap-1"
                >
                  Fit to label
                  <span className="text-xs text-muted-foreground">
                    Keep the entire image, without stretching.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem id="sizing-match" value="match" />
                <Label
                  htmlFor="sizing-match"
                  className="flex flex-col items-start gap-1"
                >
                  Match label to artwork
                  <span className="text-xs text-muted-foreground">
                    PDF page size, or image pixels at your chosen DPI.
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {mode === "fit" ? (
              <>
                <FormField label={<>Stock size</>}>
                  <FormSelect
                    aria-label="Artwork label size"
                    value=""
                    onChange={(e) => {
                      const p = e.target.value.split("x").map(Number);
                      if (p.length === 2) {
                        const next = orientLabel(p[0], p[1], orientation);
                        setWidth(next.widthMm);
                        setHeight(next.heightMm);
                      }
                    }}
                  >
                    <option value="">
                      Custom · {width} × {height} mm
                    </option>
                    <optgroup label="Common sizes">
                      {commonPresets.map((p) => (
                        <option
                          key={p.label}
                          value={`${p.widthMm}x${p.heightMm}`}
                        >
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Inch sizes">
                      {picturePresets.map((p) => (
                        <option
                          key={p.label}
                          value={`${p.widthMm}x${p.heightMm}`}
                        >
                          {p.label} · {p.widthMm} × {p.heightMm} mm
                        </option>
                      ))}
                    </optgroup>
                  </FormSelect>
                </FormField>
                <FieldGroup className="grid grid-cols-2 gap-3">
                  <FormField label={<>Width · mm</>}>
                    <FormInput
                      type="number"
                      min="10"
                      max="216"
                      value={width}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setWidth(next);
                        setOrientation(artworkOrientation(next, height));
                      }}
                    />
                  </FormField>
                  <FormField label={<>Height · mm</>}>
                    <FormInput
                      type="number"
                      min="10"
                      max="500"
                      value={height}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setHeight(next);
                        setOrientation(artworkOrientation(width, next));
                      }}
                    />
                  </FormField>
                </FieldGroup>
              </>
            ) : (
              <FormField label={<>Source image DPI</>}>
                <FormSelect
                  value={sourceDpi}
                  onChange={(e) => setSourceDpi(Number(e.target.value))}
                >
                  <option value="72">72 dpi</option>
                  <option value="96">96 dpi</option>
                  <option value="203">203 dpi</option>
                  <option value="300">300 dpi</option>
                </FormSelect>
                <small>
                  Used for images only. PDF dimensions come from the page.
                </small>
              </FormField>
            )}
            <FormField label={<>Inset margin · mm</>}>
              <FormInput
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={margin}
                onChange={(e) =>
                  setMargin(Math.max(0, Math.min(20, Number(e.target.value))))
                }
              />
            </FormField>
            <FormField label="Image print scale · %">
              <FormInput
                type="number"
                min="1"
                max="100"
                step="1"
                value={printScale}
                onChange={(event) => setPrintScale(Number(event.target.value))}
              />
              <small className="text-muted-foreground">
                100% fits inside the margins. Lower values print a smaller
                centered image.
              </small>
            </FormField>
            {current && placement && (
              <p className="text-xs text-muted-foreground">
                Printed artwork: {placement.width.toFixed(1)} ×{" "}
                {placement.height.toFixed(1)} mm
              </p>
            )}
            <p className="muted">
              Choose stock that fits your printer. Matching artwork changes
              label dimensions; it does not detect the loaded roll.
            </p>
          </aside>
          <div className="import-preview-panel">
            {current ? (
              <>
                <div className="import-preview-label">
                  {current.name}
                  <span>
                    {size.widthMm} × {size.heightMm} mm
                  </span>
                </div>
                <ArtworkViewport
                  resetKey={`${current.batchId}-${selected}-${size.widthMm}-${size.heightMm}`}
                  className="mt-3 rounded-lg border bg-muted/50"
                  toolbar={
                    <span className="text-xs text-muted-foreground">
                      Artwork preview
                    </span>
                  }
                >
                  <ImportPaper
                    source={current.data}
                    size={size}
                    placement={placement}
                  />
                </ArtworkViewport>
                <div className="artwork-strip">
                  {artworks.map((a, i) => (
                    <div
                      className="relative shrink-0 pt-7"
                      key={`${a.name}-${i}`}
                    >
                      <Button
                        variant="outline"
                        size="icon"
                        className="relative h-20 w-16 flex-col gap-0 overflow-hidden p-1 data-[selected=true]:border-primary data-[selected=true]:ring-2 data-[selected=true]:ring-primary"
                        data-selected={i === selected}
                        aria-pressed={i === selected}
                        aria-label={`Preview ${a.name}`}
                        onClick={() => selectArtwork(i, a)}
                      >
                        <img
                          className="h-full w-full object-contain"
                          src={a.data}
                          alt=""
                        />
                        <span className="absolute bottom-1 left-1 rounded-sm bg-background px-1 text-xs leading-4">
                          {i + 1}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-xs"
                        className="absolute top-0 right-0 rounded-full"
                        aria-label={`Remove ${a.name}`}
                        onClick={() => {
                          setArtworks((items) =>
                            items.filter((_, n) => n !== i),
                          );
                          setSelected(0);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
                <small className="muted">
                  The editor shows the final monochrome print preview. All files
                  are processed on this computer.
                </small>
              </>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileImage />
                  </EmptyMedia>
                  <EmptyTitle>Your artwork, ready to print</EmptyTitle>
                  <EmptyDescription>
                    Add files to preview, select pages and set the label size.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
        <footer>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <span>
              {artworks.length
                ? `${artworks.length} label${artworks.length === 1 ? "" : "s"} ready to prepare`
                : "No files selected"}
            </span>
          )}
          <Button variant="outline" className="button" onClick={cancel}>
            {busy ? "Cancel preparation" : "Cancel"}
          </Button>
          <Button
            className="button primary"
            disabled={busy || !artworks.length || pendingPages}
            onClick={commit}
          >
            <Check size={17} />
            Open in workspace
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function ImportPaper({
  source,
  size,
  placement,
}: {
  source: string;
  size: { widthMm: number; heightMm: number };
  placement: ReturnType<typeof artworkPlacement> | null;
}) {
  const longest = Math.max(1, size.widthMm, size.heightMm);
  const view = {
    width: (360 * size.widthMm) / longest,
    height: (360 * size.heightMm) / longest,
  };
  return (
    <div
      data-import-paper
      className="relative overflow-hidden bg-white shadow-md"
      style={{ width: view.width, height: view.height }}
    >
      {placement && (
        <img
          draggable={false}
          className="pointer-events-none absolute object-contain"
          src={source}
          alt="Artwork fitted to the selected label"
          style={{
            left: `${(placement.x / size.widthMm) * 100}%`,
            top: `${(placement.y / size.heightMm) * 100}%`,
            width: `${(placement.width / size.widthMm) * 100}%`,
            height: `${(placement.height / size.heightMm) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
