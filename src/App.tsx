import { FieldGroup } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { FormField } from "@/components/form-field";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrinterDialog } from "@/components/printer-dialog";
import { ArtworkViewport } from "@/components/artwork-viewport";
import { useUnsavedWork } from "@/components/unsaved-work";
import { resizeElement } from "./resize";
import type { ResizeCorner } from "./resize";
import { parseTemplateFile, templateBundle } from "./templates";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/form-input";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/form-select";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { assetUrl } from "./assets";
import { bluetoothAvailable, printerCommand, WEB_PROGRESS_EVENT } from "./printer-command";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDown,
  ArrowUp,
  Barcode,
  Bluetooth,
  Check,
  Copy,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  FolderOpen,
  ImagePlus,
  Layers,
  Minus,
  MousePointer2,
  Printer,
  QrCode,
  Redo2,
  RotateCw,
  Save,
  Settings2,
  Square,
  Tag,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "./icons";
import {
  clamp,
  initialDocument,
  makeElement,
  mmToPx,
  parseCsv,
  parseDocument,
  uid,
} from "./model";
import type { ElementKind, LabelDocument, LabelElement } from "./model";
import { renderLabel } from "./render";
import { HomeScreen } from "./HomeScreen";
import { ImportFlow } from "./ImportFlow";
import { ThemeControl } from "./theme";
import { picturePresets, commonPresets, printerProtocol } from "./workflow";

type Device = { id: string; name: string; address: string; rssi?: number };
type Capabilities = {
  model?: string;
  manufacturer?: string;
  firmware?: string;
  dpi?: number;
  maxWidthDots?: number;
  maxWidthMm?: number;
  status: string;
  source: string[];
  fieldSources: Record<string, string>;
  notes: string[];
};
type Connection = {
  capabilities?: Capabilities;
  id: string;
  name: string;
  serviceUuid: string;
  writeUuid: string;
  notifyUuid?: string;
  writeMode: string;
  maxChunk: number;
};
type PrintResult = { bytesSent: number; chunksSent: number; message: string };
type Saved = { id: string; document: LabelDocument };
type History = {
  past: LabelDocument[];
  present: LabelDocument;
  future: LabelDocument[];
};
const native = isTauri();
const storageKey = "label-studio.document.v1",
  libraryKey = "label-studio.library.v1";
function loadDocument() {
  try {
    return parseDocument(
      JSON.parse(localStorage.getItem(storageKey) || "null"),
    );
  } catch {
    return initialDocument();
  }
}
function loadLibrary(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(libraryKey) || "[]");
    return Array.isArray(v)
      ? v.slice(0, 30).map((x) => ({
          id: String(x.id),
          document: parseDocument(x.document),
        }))
      : [];
  } catch {
    return [];
  }
}
async function saveDownload(name: string, data: Blob) {
  if (native) {
    return invoke<string | null>("save_export", {
      suggestedName: name,
      bytes: Array.from(new Uint8Array(await data.arrayBuffer())),
    });
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "label";
}
function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 200,
  step = 0.5,
  suffix = "mm",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <FormInput
          id={id}
          className={suffix ? "pr-12" : undefined}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) onChange(clamp(n, min, max));
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

export default function App() {
  const [screen, setScreen] = useState<"home" | "editor">("home");
  const [showImport, setShowImport] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: loadDocument(),
    future: [],
  }));
  const doc = history.present;
  const [pendingWork, setPendingWork] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    JSON.stringify(doc),
  );
  useUnsavedWork(
    "editor",
    pendingWork || JSON.stringify(doc) !== savedFingerprint,
  );
  function markSaved(document: LabelDocument) {
    setSavedFingerprint(JSON.stringify(document));
    setPendingWork(false);
  }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = doc.elements.find((e) => e.id === selectedId);
  const [library, setLibrary] = useState(loadLibrary);
  const [panel, setPanel] = useState<"elements" | "templates" | "data">(
    "elements",
  );
  const [devices, setDevices] = useState<Device[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transferStats, setTransferStats] = useState<{
    sent: number;
    total: number;
    elapsedMs: number;
    bytesPerSecond: number;
  } | null>(null);
  const [printNote, setPrintNote] = useState("");
  const [notice, setNotice] = useState("");
  const [autosaved, setAutosaved] = useState(true);
  const [error, setError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [grid, setGrid] = useState(true);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvName, setCsvName] = useState("");
  const [csvRow, setCsvRow] = useState(0);
  const [batch, setBatch] = useState(false);
  const [pdfDocuments, setPdfDocuments] = useState<LabelDocument[]>([]);
  const [pdfPageIndex, setPdfPageIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const stopBatch = useRef(false);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    corner?: ResizeCorner;
    next: LabelDocument;
  } | null>(null);
  const [dragDoc, setDragDoc] = useState<LabelDocument | null>(null);
  const current = dragDoc ?? doc;
  const row = csvRows[csvRow] ?? {};
  const update = (
    next: LabelDocument | ((d: LabelDocument) => LabelDocument),
  ) => {
    setPendingWork(true);
    setHistory((h) => ({
      past: [...h.past.slice(-59), h.present],
      present: typeof next === "function" ? next(h.present) : next,
      future: [],
    }));
  };
  const undo = () => {
    setPendingWork(true);
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1)!,
            future: [h.present, ...h.future],
          }
        : h,
    );
  };
  const redo = () => {
    setPendingWork(true);
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  };
  const patchElement = (patch: Partial<LabelElement>) =>
    update((d) => ({
      ...d,
      elements: d.elements.map((e) =>
        e.id === selectedId ? { ...e, ...patch } : e,
      ),
    }));
  const patchDoc = (patch: Partial<LabelDocument>) =>
    update((d) => ({ ...d, ...patch }));
  function changeElementSize(dimension: "width" | "height", value: number) {
    if (!selected) return;
    if (selected.kind !== "image") {
      patchElement({ [dimension]: value });
      return;
    }
    const scale = Math.min(
      value / selected[dimension],
      doc.widthMm / selected.width,
      doc.heightMm / selected.height,
    );
    const width = selected.width * scale,
      height = selected.height * scale;
    patchElement({
      width,
      height,
      x: Math.min(selected.x, doc.widthMm - width),
      y: Math.min(selected.y, doc.heightMm - height),
    });
  }
  const report = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setNotice("");
  };
  const clearMessages = () => {
    setError("");
    setNotice("");
  };
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(doc));
      setAutosaved(true);
    } catch {
      setAutosaved(false);
      setError("Autosave storage is full. Export your label to keep a copy.");
    }
  }, [doc]);
  useEffect(() => {
    let cancelled = false;
    renderLabel(current, row)
      .then((canvas) => {
        if (cancelled) return;
        const target = canvasRef.current;
        if (target) {
          target.width = canvas.width;
          target.height = canvas.height;
          target.getContext("2d")!.drawImage(canvas, 0, 0);
        }
        setRenderError("");
      })
      .catch((e) => {
        if (!cancelled) setRenderError(String(e.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [current, csvRows, csvRow]);
  useEffect(() => {
    let disposed = false;
    type TransferProgress = {
      sent: number;
      total: number;
      elapsedMs: number;
      bytesPerSecond: number;
    };
    const onProgress = (payload: TransferProgress) => {
      if (!disposed) {
        setProgress(
          payload.total ? payload.sent / payload.total : 0,
        );
        setTransferStats(payload);
      }
    };
    const onWebProgress = (event: Event) => onProgress((event as CustomEvent<TransferProgress>).detail);
    const unlisten = native ? listen<TransferProgress>("print-progress", event => onProgress(event.payload)) : Promise.resolve(() => {});
    if (!native) window.addEventListener(WEB_PROGRESS_EVENT,onWebProgress);
    const timer = setInterval(() => {
      printerCommand<{
        connected: boolean;
        name?: string;
        busy: boolean;
        capabilities?: Capabilities;
      }>("printer_status")
        .then((status) => {
          if (!status.connected) setConnection(null);
          else if (status.capabilities)
            setConnection((c) =>
              c ? { ...c, capabilities: status.capabilities } : c,
            );
        })
        .catch(() => {});
    }, 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
      void unlisten.then((f) => f());
      window.removeEventListener(WEB_PROGRESS_EVENT,onWebProgress);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        screen !== "editor" ||
        showImport ||
        showPrinter
      )
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          "input,textarea,select,[contenteditable],[role=tab],[role=combobox],[role=slider],[role=checkbox],[role=dialog],[role=alertdialog]",
        )
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (event.key === "Delete" && selectedId) {
        update((d) => ({
          ...d,
          elements: d.elements.filter((e) => e.id !== selectedId),
        }));
        setSelectedId(null);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        selectedId
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 0.1;
        update((d) => ({
          ...d,
          elements: d.elements.map((e) =>
            e.id !== selectedId
              ? e
              : {
                  ...e,
                  x: clamp(
                    e.x +
                      (event.key === "ArrowRight"
                        ? step
                        : event.key === "ArrowLeft"
                          ? -step
                          : 0),
                    0,
                    d.widthMm - e.width,
                  ),
                  y: clamp(
                    e.y +
                      (event.key === "ArrowDown"
                        ? step
                        : event.key === "ArrowUp"
                          ? -step
                          : 0),
                    0,
                    d.heightMm - e.height,
                  ),
                },
          ),
        }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, screen, showImport, showPrinter]);
  function add(kind: ElementKind) {
    if (doc.elements.length >= 100) {
      report(Error("A label can contain up to 100 elements."));
      return;
    }
    const e = makeElement(kind);
    e.width = Math.min(e.width, doc.widthMm - 6);
    e.height = Math.min(e.height, doc.heightMm - 6);
    update((d) => ({ ...d, elements: [...d.elements, e] }));
    setSelectedId(e.id);
  }
  function duplicate() {
    if (!selected) return;
    const e = {
      ...selected,
      id: uid(),
      x: clamp(selected.x + 1, 0, doc.widthMm - selected.width),
      y: clamp(selected.y + 1, 0, doc.heightMm - selected.height),
    };
    update((d) => ({ ...d, elements: [...d.elements, e] }));
    setSelectedId(e.id);
  }
  function remove() {
    update((d) => ({
      ...d,
      elements: d.elements.filter((e) => e.id !== selectedId),
    }));
    setSelectedId(null);
  }
  function moveLayer(direction: number) {
    if (!selected) return;
    const index = doc.elements.findIndex((e) => e.id === selected.id),
      to = clamp(index + direction, 0, doc.elements.length - 1);
    const elements = [...doc.elements];
    [elements[index], elements[to]] = [elements[to], elements[index]];
    patchDoc({ elements });
  }
  function beginDrag(
    e: PointerEvent<HTMLButtonElement>,
    element: LabelElement,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(element.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: element.id,
      startX: e.clientX,
      startY: e.clientY,
      x: element.x,
      y: element.y,
      next: doc,
    };
  }
  function dragMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !stageRef.current) return;
    const d = drag.current,
      rect = stageRef.current.getBoundingClientRect();
    const element = doc.elements.find((el) => el.id === d.id)!;
    if (d.corner) {
      const resized = resizeElement(
        element,
        d.corner,
        ((e.clientX - d.startX) / rect.width) * doc.widthMm,
        ((e.clientY - d.startY) / rect.height) * doc.heightMm,
        doc.widthMm,
        doc.heightMm,
      );
      d.next = {
        ...doc,
        elements: doc.elements.map((el) =>
          el.id === d.id ? { ...el, ...resized } : el,
        ),
      };
      setDragDoc(d.next);
      return;
    }
    const x = clamp(
        Math.round(
          (d.x + ((e.clientX - d.startX) / rect.width) * doc.widthMm) * 10,
        ) / 10,
        0,
        Math.max(0, doc.widthMm - element.width),
      ),
      y = clamp(
        Math.round(
          (d.y + ((e.clientY - d.startY) / rect.height) * doc.heightMm) * 10,
        ) / 10,
        0,
        Math.max(0, doc.heightMm - element.height),
      );
    d.next = {
      ...doc,
      elements: doc.elements.map((el) =>
        el.id === d.id ? { ...el, x, y } : el,
      ),
    };
    setDragDoc(d.next);
  }
  function endDrag() {
    if (drag.current && drag.current.next !== doc) update(drag.current.next);
    drag.current = null;
    setDragDoc(null);
  }
  function beginResize(
    e: PointerEvent<HTMLButtonElement>,
    element: LabelElement,
    corner: ResizeCorner,
  ) {
    beginDrag(e, element);
    if (e.button === 0 && drag.current) drag.current.corner = corner;
  }
  async function scan() {
    if (!bluetoothAvailable() || printing || scanning || connecting || connection) return;
    clearMessages();
    setDevices([]);
    setScanning(true);
    try {
      const result = await printerCommand<Device[]>("scan_printers");
      setDevices(result);
      if (!result.length)
        setNotice(
          "No BLE devices found. Turn on the printer and disconnect it from your phone.",
        );
    } catch (e) {
      report(e);
    } finally {
      setScanning(false);
    }
  }
  async function connect(device: Device) {
    if (!bluetoothAvailable() || printing || scanning || connecting) return;
    clearMessages();
    setConnecting(device.id);
    try {
      const c = await printerCommand<Connection>("connect_printer", { id: device.id });
      setConnection(c);
      patchDoc({ protocol: printerProtocol(c.capabilities?.model || c.name) });
      setNotice(`Connected to ${c.name}.`);
    } catch (e) {
      report(e);
    } finally {
      setConnecting(null);
    }
  }
  async function disconnect() {
    if (!bluetoothAvailable() || printing || scanning || connecting) return;
    try {
      await printerCommand("disconnect_printer");
      setConnection(null);
      setNotice("Printer disconnected.");
      setError("");
    } catch (e) {
      report(e);
    }
  }
  function openPrinter() {
    clearMessages();
    setShowPrinter(true);
    if (bluetoothAvailable() && !connection && !printing) void scan();
  }
  function saveTemplate() {
    try {
      const existing = library.findIndex((t) => t.document.name === doc.name);
      const next =
        existing >= 0
          ? library.map((t, i) =>
              i === existing ? { ...t, document: doc } : t,
            )
          : [...library, { id: uid(), document: doc }];
      if (next.length > 30)
        throw Error(
          "Template library is limited to 30 labels. Export or remove one first.",
        );
      localStorage.setItem(libraryKey, JSON.stringify(next));
      setLibrary(next);
      markSaved(doc);
      setNotice(`Saved “${doc.name}” to your templates.`);
      setError("");
    } catch (e) {
      report(e);
    }
  }
  function deleteTemplate(id: string) {
    try {
      const next = library.filter((t) => t.id !== id);
      localStorage.setItem(libraryKey, JSON.stringify(next));
      setLibrary(next);
    } catch (e) {
      report(e);
    }
  }
  async function importLabel(file?: File) {
    if (!file) return;
    clearMessages();
    try {
      if (file.size > 12_000_000)
        throw Error("Template file is too large (12 MB maximum).");
      const documents = parseTemplateFile(JSON.parse(await file.text()));
      const saved: unknown = JSON.parse(
        localStorage.getItem(libraryKey) || "[]",
      );
      if (!Array.isArray(saved))
        throw Error(
          "Your existing library could not be read. Nothing was imported.",
        );
      const currentLibrary: Saved[] = saved.map((item) => {
        if (!item || typeof item.id !== "string")
          throw Error(
            "Your existing library could not be read. Nothing was imported.",
          );
        return { id: item.id, document: parseDocument(item.document) };
      });
      if (currentLibrary.length + documents.length > 30)
        throw Error(
          `The library has room for ${Math.max(0, 30 - currentLibrary.length)} more templates. Remove or export templates before importing this file.`,
        );
      const next = [
        ...currentLibrary,
        ...documents.map((document) => ({ id: uid(), document })),
      ];
      localStorage.setItem(libraryKey, JSON.stringify(next));
      setLibrary(next);
      setNotice(
        `Imported ${documents.length} template${documents.length === 1 ? "" : "s"} into your library.`,
      );
    } catch (e) {
      report(e);
    }
  }
  async function exportTemplates(
    documents: LabelDocument[],
  ): Promise<string | null> {
    if (!documents.length)
      throw Error("Choose at least one template to export.");
    const blob = new Blob(
      [JSON.stringify(templateBundle(documents), null, 2)],
      { type: "application/json" },
    );
    if (blob.size > 12_000_000)
      throw Error(
        "Selected templates exceed 12 MB. Export fewer templates at a time.",
      );
    const path = await saveDownload("label-templates.json", blob);
    if (
      path !== null &&
      documents.some(
        (document) => JSON.stringify(document) === JSON.stringify(doc),
      )
    )
      markSaved(doc);
    setNotice(
      path === null
        ? "Export canceled."
        : `Exported ${documents.length} template${documents.length === 1 ? "" : "s"}.`,
    );
    setError("");
    return path === null ? null : (path ?? "download");
  }
  async function importImage(file?: File) {
    if (!file) return;
    clearMessages();
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 5_000_000
      )
        throw Error("Choose a PNG, JPEG or WebP image smaller than 5 MB.");
      const content = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const image = new Image();
      image.src = content;
      await image.decode();
      const width = Math.min(doc.widthMm - 6, 40),
        height = Math.min(
          doc.heightMm - 6,
          (width * image.height) / image.width,
        );
      const el = { ...makeElement("image"), content, width, height };
      update((d) => ({ ...d, elements: [...d.elements, el] }));
      setSelectedId(el.id);
    } catch (e) {
      report(e);
    }
  }
  async function importCsv(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw Error("CSV must be smaller than 1 MB.");
      setCsvRows(parseCsv(await file.text()));
      setPendingWork(true);
      setCsvName(file.name);
      setCsvRow(0);
      setBatch(false);
      setPanel("data");
      setNotice(
        "CSV loaded. Put {{column name}} in text, barcode or QR content.",
      );
      setError("");
    } catch (e) {
      report(e);
    }
  }
  async function exportPng() {
    clearMessages();
    try {
      const canvas = await renderLabel(doc, row);
      canvas.toBlob((blob) => {
        if (blob)
          void saveDownload(`${safeName(doc.name)}.png`, blob)
            .then((path) => {
              setNotice(path === null ? "Export canceled." : "PNG exported.");
              if (path !== null) markSaved(doc);
            })
            .catch(report);
      }, "image/png");
    } catch (e) {
      report(e);
    }
  }
  async function print() {
    if (!connection || printing || renderError) return;
    clearMessages();
    setPrinting(true);
    setProgress(0);
    setTransferStats(null);
    stopBatch.current = false;
    let done = 0;
    try {
      const jobs =
        pdfDocuments.length > 1
          ? pdfDocuments.map((d, i) => ({
              doc: {
                ...(i === pdfPageIndex ? doc : d),
                dpi: doc.dpi,
                protocol: doc.protocol,
                density: doc.density,
                threshold: doc.threshold,
                gapMm: doc.gapMm,
              },
              row: {},
            }))
          : batch && csvRows.length
            ? csvRows.map((r) => ({ doc, row: r }))
            : [{ doc, row }];
      if (jobs.length * copies > 100)
        throw Error("A print batch is limited to 100 labels including copies.");
      for (const [index, item] of jobs.entries()) {
        if (stopBatch.current) break;
        setPrintNote(`Checking label ${index + 1} of ${jobs.length}`);
        await renderLabel(item.doc, item.row);
      }
      for (const item of jobs) {
        if (stopBatch.current) break;
        setPrintNote(`Sending ${done + 1} of ${jobs.length}`);
        const canvas = await renderLabel(item.doc, item.row);
        const rgba = Array.from(
          canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data,
        );
        const result = await printerCommand<PrintResult>("print_label", {
          job: {
            widthMm: item.doc.widthMm,
            heightMm: item.doc.heightMm,
            gapMm: item.doc.gapMm,
            dpi: item.doc.dpi,
            copies,
            density: item.doc.density,
            rgba,
            widthPx: canvas.width,
            heightPx: canvas.height,
            threshold: item.doc.threshold,
            protocol: printerProtocol(
              connection.capabilities?.model || connection.name,
            ),
          },
        });
        done++;
        setPrintNote(result.message);
      }
      setNotice(
        stopBatch.current
          ? `Stopped after ${done} job${done === 1 ? "" : "s"}.`
          : `Sent ${done * copies} label${done * copies === 1 ? "" : "s"} to ${connection.name}. Check the printer for output.`,
      );
    } catch (e) {
      report(
        new Error(
          `${e instanceof Error ? e.message : String(e)}${done ? ` ${done} earlier job(s) were already sent.` : ""}`,
        ),
      );
    } finally {
      setPrinting(false);
      setPrintNote("");
      setProgress(0);
    }
  }
  useEffect(() => {
    setPdfDocuments((docs) =>
      docs.length > 1
        ? docs.map((d, i) => (i === pdfPageIndex ? doc : d))
        : docs,
    );
  }, [doc, pdfPageIndex]);
  async function exportJson() {
    try {
      const path = await saveDownload(
        `${safeName(doc.name)}.label.json`,
        new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
      );
      setNotice(path === null ? "Export canceled." : "Label file exported.");
      if (path !== null) markSaved(doc);
    } catch (e) {
      report(e);
    }
  }
  const labelStyle = {
    width: `${doc.widthMm * 4}px`,
    height: `${doc.heightMm * 4}px`,
  } as CSSProperties;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <img src={assetUrl("app-icon.svg")} alt="" className="size-9" />
          </span>
          <div>
            <strong>EZPZ Label Studio</strong>
            <span>YOUR DESKTOP LABEL WORKSPACE</span>
          </div>
        </div>
        <Button
          variant="outline"
          className={`button nav-home ${screen === "home" ? "active" : ""}`}
          onClick={() => setScreen("home")}
        >
          Home
        </Button>
        <div
          className="document-title"
          style={{ display: screen === "home" ? "none" : undefined }}
        >
          <FormInput
            aria-label="Label name"
            value={doc.name}
            maxLength={120}
            onChange={(e) => patchDoc({ name: e.target.value })}
          />
          <span>
            {autosaved ? "Saved on this device" : "Not saved · export a copy"}
          </span>
        </div>
        <div className="header-actions">
          <ThemeControl />
          <Button
            variant="outline"
            className="button"
            onClick={() => setShowImport(true)}
          >
            <Upload size={17} />
            Upload
          </Button>
          <Button
            variant="outline"
            className="button subtle"
            aria-label="Save template"
            title="Save template"
            style={{ display: screen === "home" ? "none" : undefined }}
            onClick={saveTemplate}
          >
            <Save size={16} />
            <span className="hidden xl:inline">Save template</span>
          </Button>
          <Button
            className="button primary"
            style={{ display: screen === "home" ? "none" : undefined }}
            disabled={!connection || printing || !!renderError}
            onClick={() => void print()}
          >
            <Printer size={17} />
            {printing
              ? "Sending…"
              : `Print${copies > 1 ? ` ${copies} copies` : ""}`}
          </Button>
        </div>
      </header>
      {screen === "home" && (error || notice) && (
        <Alert
          variant={error ? "destructive" : "default"}
          role={error ? "alert" : "status"}
          className="mx-auto mt-4 w-[calc(100%-3rem)] max-w-6xl"
        >
          <AlertDescription className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span>{error || notice}</span>
            <IconButton label="Dismiss message" onClick={clearMessages}>
              <X size={14} />
            </IconButton>
          </AlertDescription>
        </Alert>
      )}
      {screen === "home" && (
        <HomeScreen
          doc={doc}
          library={library}
          connected={connection?.name ?? null}
          onResume={() => {
            setPendingWork(true);
            setScreen("editor");
          }}
          onNew={(widthMm, heightMm, name) => {
            update({ ...doc, widthMm, heightMm, name, elements: [] });
            setPdfDocuments([]);
            setCsvRows([]);
            setSelectedId(null);
            setScreen("editor");
          }}
          onImport={() => setShowImport(true)}
          onLoad={(d) => {
            update(d);
            setPdfDocuments([]);
            setCsvRows([]);
            setSelectedId(null);
            setScreen("editor");
          }}
          onPrinter={openPrinter}
          onImportTemplates={() => fileRef.current?.click()}
          onExportTemplates={exportTemplates}
        />
      )}
      <div
        className="workspace"
        style={{ display: screen === "home" ? "none" : undefined }}
      >
        <aside className="left-panel">
          <Tabs
            value={panel}
            onValueChange={(value) => setPanel(value as typeof panel)}
          >
            <TabsList aria-label="Workspace panels" className="w-full">
              <TabsTrigger
                value="elements"
                className="min-w-0 gap-1 px-1 text-xs"
              >
                <Layers size={16} />
                Design
              </TabsTrigger>
              <TabsTrigger
                value="templates"
                className="min-w-0 gap-1 px-1 text-xs"
              >
                <FolderOpen size={16} />
                Saved
              </TabsTrigger>
              <TabsTrigger value="data" className="min-w-0 gap-1 px-1 text-xs">
                <FileText size={16} />
                Data
              </TabsTrigger>
            </TabsList>
            <TabsContent value="elements">
              <section>
                <div className="section-title">ADD TO LABEL</div>
                <div className="tool-grid">
                  {(
                    [
                      { kind: "text", icon: Type, label: "Text" },
                      { kind: "barcode", icon: Barcode, label: "Barcode" },
                      { kind: "qr", icon: QrCode, label: "QR code" },
                      { kind: "image", icon: ImagePlus, label: "Image" },
                      { kind: "line", icon: Minus, label: "Line" },
                      { kind: "rect", icon: Square, label: "Border" },
                    ] as const
                  ).map((t) => (
                    <Button
                      variant="outline"
                      key={t.kind}
                      onClick={() =>
                        t.kind === "image"
                          ? imageRef.current?.click()
                          : add(t.kind)
                      }
                    >
                      <t.icon size={23} />
                      <span>{t.label}</span>
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  className="button full"
                  onClick={() => setShowImport(true)}
                >
                  <FileImage size={16} />
                  Import artwork / PDF
                </Button>
              </section>
              <section className="layers">
                <div className="section-title">
                  LAYERS <span>{doc.elements.length}</span>
                </div>
                {doc.elements.length === 0 ? (
                  <Empty className="px-3 py-6 md:p-6">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Layers />
                      </EmptyMedia>
                      <EmptyTitle>No elements yet</EmptyTitle>
                      <EmptyDescription>
                        Start with text, an image or a code.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  doc.elements.map((el, i) => (
                    <Button
                      variant="outline"
                      key={el.id}
                      className={`layer ${selectedId === el.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(el.id)}
                    >
                      <span className="layer-icon">
                        {el.kind === "text" ? (
                          <Type size={16} />
                        ) : el.kind === "qr" ? (
                          <QrCode size={16} />
                        ) : el.kind === "barcode" ? (
                          <Barcode size={16} />
                        ) : el.kind === "image" ? (
                          <FileImage size={16} />
                        ) : (
                          <Square size={16} />
                        )}
                      </span>
                      <span>
                        <strong>
                          {el.kind === "text" ||
                          el.kind === "barcode" ||
                          el.kind === "qr"
                            ? el.content || "Empty content"
                            : el.kind === "image"
                              ? "Image"
                              : el.kind === "rect"
                                ? "Border"
                                : "Line"}
                        </strong>
                        <small>
                          {el.kind === "qr" ? "QR code" : el.kind} · {i + 1}
                        </small>
                      </span>
                    </Button>
                  ))
                )}
              </section>
            </TabsContent>
            <TabsContent value="templates">
              <section>
                <div className="section-title">
                  YOUR TEMPLATES <span>{library.length}</span>
                </div>
                <Button
                  variant="outline"
                  className="button full"
                  onClick={() => {
                    update({
                      ...initialDocument(),
                      name: "Untitled label",
                      elements: [],
                    });
                    setSelectedId(null);
                    setPdfDocuments([]);
                  }}
                >
                  <FilePlus2 size={16} />
                  New blank label
                </Button>
                <Button
                  variant="outline"
                  className="button full"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={16} />
                  Import templates
                </Button>
                {library.length === 0 ? (
                  <Empty className="px-3 py-6 md:p-6">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FolderOpen />
                      </EmptyMedia>
                      <EmptyTitle>A place for your favorites</EmptyTitle>
                      <EmptyDescription>
                        Save your layout as a template to use it again.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  library.map((t) => (
                    <div className="template-row" key={t.id}>
                      <Button
                        variant="outline"
                        onClick={() => {
                          update(t.document);
                          setSelectedId(null);
                          setPdfDocuments([]);
                        }}
                      >
                        <Tag size={18} />
                        <span>
                          <strong>{t.document.name}</strong>
                          <small>
                            {t.document.widthMm} × {t.document.heightMm} mm
                          </small>
                        </span>
                      </Button>
                      <IconButton
                        label={`Delete ${t.document.name}`}
                        onClick={() => deleteTemplate(t.id)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  ))
                )}
              </section>
            </TabsContent>
            <TabsContent value="data">
              <section>
                <div className="section-title">VARIABLE DATA</div>
                <p className="muted">
                  Make a label for every row. Use <code>{"{{column}}"}</code> in
                  text and codes.
                </p>
                <Button
                  variant="outline"
                  className="button full"
                  onClick={() => csvRef.current?.click()}
                >
                  <Upload size={16} />
                  Import CSV
                </Button>
                {csvRows.length > 0 ? (
                  <>
                    <div className="data-file">
                      <FileText size={18} />
                      <strong>{csvName}</strong>
                      <IconButton
                        label="Remove CSV"
                        onClick={() => {
                          setCsvRows([]);
                          setBatch(false);
                        }}
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                    <FormField label={<>Preview row</>}>
                      <FormSelect
                        value={csvRow}
                        onChange={(e) => setCsvRow(Number(e.target.value))}
                      >
                        {csvRows.map((_, i) => (
                          <option key={i} value={i}>
                            Row {i + 1} of {csvRows.length}
                          </option>
                        ))}
                      </FormSelect>
                    </FormField>
                    <div className="data-values">
                      {Object.entries(row).map(([k, v]) => (
                        <div key={k}>
                          <code>{`{{${k}}}`}</code>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                    <Field orientation="horizontal">
                      <FormInput
                        id="print-all-csv-rows"
                        type="checkbox"
                        checked={batch}
                        onChange={(e) => setBatch(e.target.checked)}
                      />
                      <FieldLabel htmlFor="print-all-csv-rows">
                        Print all {csvRows.length} rows
                      </FieldLabel>
                    </Field>
                  </>
                ) : (
                  <Empty className="px-3 py-6 md:p-6">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FileText />
                      </EmptyMedia>
                      <EmptyTitle>One design. Many labels.</EmptyTitle>
                      <EmptyDescription>
                        CSV files need a header row. Up to 100 rows per batch.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </aside>
        <main className="canvas-panel">
          {(error || notice) && (
            <Alert
              variant={error ? "destructive" : "default"}
              role={error ? "alert" : "status"}
              className="m-3 flex w-auto items-center gap-3 [&>svg]:translate-y-0 [&>svg]:shrink-0"
            >
              {error ? <X size={16} /> : <Check size={16} />}
              <AlertDescription className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span>{error || notice}</span>
                <IconButton label="Dismiss message" onClick={clearMessages}>
                  <X size={14} />
                </IconButton>
              </AlertDescription>
            </Alert>
          )}
          {pdfDocuments.length > 1 && (
            <div className="pdf-pages">
              <FileText size={15} />
              <span>{pdfDocuments.length} artwork labels queued</span>
              <FormSelect
                aria-label="Preview artwork label"
                value={pdfPageIndex}
                onChange={(e) => {
                  setPdfDocuments((items) =>
                    items.map((d, i) => (i === pdfPageIndex ? doc : d)),
                  );
                  setPdfPageIndex(Number(e.target.value));
                  update(pdfDocuments[Number(e.target.value)]);
                  setSelectedId(null);
                }}
              >
                {pdfDocuments.map((d, i) => (
                  <option key={i} value={i}>
                    Page {i + 1} · {d.name}
                  </option>
                ))}
              </FormSelect>
              <Button variant="outline" onClick={() => setPdfDocuments([])}>
                Keep current page only
              </Button>
            </div>
          )}
          <ArtworkViewport
            zoom={zoom}
            onZoomChange={setZoom}
            resetKey={`${doc.widthMm}x${doc.heightMm}:${pdfPageIndex}`}
            grid={grid}
            toolbar={
              <>
                <div className="tool-group">
                  <IconButton
                    label="Undo (Ctrl+Z)"
                    disabled={!history.past.length}
                    onClick={undo}
                  >
                    <Undo2 size={17} />
                  </IconButton>
                  <IconButton
                    label="Redo (Ctrl+Shift+Z)"
                    disabled={!history.future.length}
                    onClick={redo}
                  >
                    <Redo2 size={17} />
                  </IconButton>
                  <Separator orientation="vertical" className="mx-1 h-6" />
                  <IconButton
                    label="Duplicate selected"
                    disabled={!selected}
                    onClick={duplicate}
                  >
                    <Copy size={16} />
                  </IconButton>
                  <IconButton
                    label="Delete selected"
                    disabled={!selected}
                    onClick={remove}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
                <div className="tool-group">
                  <Button
                    variant="outline"
                    className={`text-button ${grid ? "active" : ""}`}
                    onClick={() => setGrid(!grid)}
                  >
                    Grid
                  </Button>
                </div>
              </>
            }
          >
            <div className="paper-surround">
              <div className="dimension-top">
                <span />
                {doc.widthMm} mm
                <span />
              </div>
              <div className="paper-row">
                <div className="dimension-side">{doc.heightMm} mm</div>
                <div
                  className="label-paper"
                  ref={stageRef}
                  style={labelStyle}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setSelectedId(null);
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    aria-label="Rendered monochrome label preview"
                  />
                  {current.elements.map((el) => (
                    <div
                      key={el.id}
                      className="absolute"
                      style={{
                        left: `${(el.x / doc.widthMm) * 100}%`,
                        top: `${(el.y / doc.heightMm) * 100}%`,
                        width: `${(el.width / doc.widthMm) * 100}%`,
                        height: `${(el.height / doc.heightMm) * 100}%`,
                        transform: `rotate(${el.rotation}deg)`,
                        zIndex: selectedId === el.id ? 2 : undefined,
                      }}
                    >
                      <Button
                        variant="ghost"
                        aria-label={`Select ${el.kind}: ${el.kind === "image" ? "image" : el.content}`}
                        className={`element-hitbox ${selectedId === el.id ? "selected" : ""}`}
                        style={{
                          background: "transparent",
                          padding: 0,
                          borderRadius: 0,
                          boxShadow: "none",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                        }}
                        onPointerDown={(e) => beginDrag(e, el)}
                        onPointerMove={dragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                      />
                      {selectedId === el.id &&
                        (["tl", "tr", "bl", "br"] as ResizeCorner[]).map(
                          (corner) => (
                            <Button
                              key={corner}
                              variant="outline"
                              size="icon-xs"
                              aria-label={`Resize ${el.kind} ${corner.startsWith("t") ? "top" : "bottom"} ${corner.endsWith("l") ? "left" : "right"}`}
                              title={
                                el.kind === "image"
                                  ? "Drag to resize artwork proportionally"
                                  : "Drag to resize"
                              }
                              className="absolute z-10 rounded-none border-primary bg-background p-0 shadow-sm"
                              style={{
                                width: 10,
                                height: 10,
                                minWidth: 10,
                                left: corner.endsWith("l") ? -5 : undefined,
                                right: corner.endsWith("r") ? -5 : undefined,
                                top: corner.startsWith("t") ? -5 : undefined,
                                bottom: corner.startsWith("b") ? -5 : undefined,
                                cursor:
                                  corner === "tl" || corner === "br"
                                    ? "nwse-resize"
                                    : "nesw-resize",
                                touchAction: "none",
                              }}
                              onPointerDown={(e) => beginResize(e, el, corner)}
                              onPointerMove={dragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={endDrag}
                            />
                          ),
                        )}
                    </div>
                  ))}
                </div>
              </div>
              {renderError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription>{renderError}</AlertDescription>
                </Alert>
              )}
              <div className="paper-caption">
                <span>PRINT PREVIEW</span>Black & white · {doc.dpi} dpi
              </div>
            </div>
          </ArtworkViewport>
          <div className="canvas-footer">
            <span>
              <MousePointer2 size={14} />
              {selected
                ? "Drag to move · corners to resize · arrows to nudge"
                : "Select an element to edit it"}
            </span>
            <span>
              {mmToPx(doc.widthMm, doc.dpi)} × {mmToPx(doc.heightMm, doc.dpi)}{" "}
              px
            </span>
            <Button
              variant="outline"
              onClick={() => void exportPng()}
              disabled={!!renderError}
            >
              <Download size={14} />
              PNG
            </Button>
            <Button variant="outline" onClick={() => void exportJson()}>
              <Download size={14} />
              Label file
            </Button>
          </div>
        </main>
        <aside className="right-panel">
          <section>
            <div className="section-heading">
              <Settings2 size={16} />
              <h2>{selected ? "Element properties" : "Label setup"}</h2>
              {selected && (
                <IconButton
                  label="Back to label setup"
                  onClick={() => setSelectedId(null)}
                >
                  <X size={15} />
                </IconButton>
              )}
            </div>
            {selected ? (
              <>
                <Badge variant="secondary" className="selected-kind">
                  {selected.kind === "qr"
                    ? "QR CODE"
                    : selected.kind.toUpperCase()}
                </Badge>
                {selected.kind === "image" && (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Resize the printed artwork with its corner handles or
                    dimensions. Image proportions stay locked.
                  </p>
                )}
                {["text", "qr", "barcode"].includes(selected.kind) && (
                  <FormField
                    label={<>{selected.kind === "text" ? "Text" : "Content"}</>}
                  >
                    <Textarea
                      aria-label="Element content"
                      dir="auto"
                      value={selected.content}
                      maxLength={4000}
                      onChange={(e) =>
                        patchElement({ content: e.target.value })
                      }
                      rows={3}
                    />
                  </FormField>
                )}
                <FieldGroup className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="X position"
                    value={selected.x}
                    max={doc.widthMm}
                    onChange={(x) => patchElement({ x })}
                  />
                  <NumberField
                    label="Y position"
                    value={selected.y}
                    max={doc.heightMm}
                    onChange={(y) => patchElement({ y })}
                  />
                  <NumberField
                    label="Width"
                    value={selected.width}
                    min={0.1}
                    max={doc.widthMm}
                    onChange={(width) => changeElementSize("width", width)}
                  />
                  <NumberField
                    label="Height"
                    value={selected.height}
                    min={0.1}
                    max={doc.heightMm}
                    onChange={(height) => changeElementSize("height", height)}
                  />
                </FieldGroup>
                {selected.kind === "barcode" && (
                  <FormField label={<>Barcode format</>}>
                    <FormSelect
                      value={selected.barcodeFormat}
                      onChange={(e) =>
                        patchElement({
                          barcodeFormat: e.target
                            .value as LabelElement["barcodeFormat"],
                        })
                      }
                    >
                      <option value="CODE128">Code 128</option>
                      <option value="CODE39">Code 39</option>
                      <option value="EAN13">EAN-13</option>
                      <option value="UPC">UPC-A</option>
                      <option value="ITF14">ITF-14</option>
                    </FormSelect>
                  </FormField>
                )}
                {selected.kind === "text" && (
                  <>
                    <FormField label={<>Font</>}>
                      <FormSelect
                        value={selected.fontFamily}
                        onChange={(e) =>
                          patchElement({
                            fontFamily: e.target
                              .value as LabelElement["fontFamily"],
                          })
                        }
                      >
                        <option>Arial</option>
                        <option>Segoe UI</option>
                        <option>Consolas</option>
                        <option>Courier New</option>
                        <option>Times New Roman</option>
                      </FormSelect>
                    </FormField>
                    <FieldGroup className="grid grid-cols-2 gap-3">
                      <NumberField
                        label="Font size"
                        value={selected.fontSize}
                        min={2}
                        max={144}
                        step={1}
                        suffix="pt"
                        onChange={(fontSize) => patchElement({ fontSize })}
                      />
                      <FormField label={<>Weight</>}>
                        <FormSelect
                          value={selected.bold ? "bold" : "regular"}
                          onChange={(e) =>
                            patchElement({ bold: e.target.value === "bold" })
                          }
                        >
                          <option value="regular">Regular</option>
                          <option value="bold">Bold</option>
                        </FormSelect>
                      </FormField>
                    </FieldGroup>
                    <FieldGroup className="grid grid-cols-2 gap-3">
                      <FormField label={<>Alignment</>}>
                        <FormSelect
                          value={selected.align}
                          onChange={(e) =>
                            patchElement({
                              align: e.target.value as LabelElement["align"],
                            })
                          }
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </FormSelect>
                      </FormField>
                      <FormField label={<>Direction</>}>
                        <FormSelect
                          value={selected.direction}
                          onChange={(e) =>
                            patchElement({
                              direction: e.target
                                .value as LabelElement["direction"],
                            })
                          }
                        >
                          <option value="auto">Auto</option>
                          <option value="ltr">LTR</option>
                          <option value="rtl">RTL / עברית</option>
                        </FormSelect>
                      </FormField>
                    </FieldGroup>
                  </>
                )}
                <div className="property-actions">
                  <Button
                    variant="outline"
                    className="button"
                    onClick={() =>
                      patchElement({ rotation: (selected.rotation + 90) % 360 })
                    }
                  >
                    <RotateCw size={15} />
                    {selected.rotation}°
                  </Button>
                  <IconButton
                    label="Bring forward"
                    onClick={() => moveLayer(1)}
                  >
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton
                    label="Send backward"
                    onClick={() => moveLayer(-1)}
                  >
                    <ArrowDown size={16} />
                  </IconButton>
                  <IconButton label="Duplicate element" onClick={duplicate}>
                    <Copy size={16} />
                  </IconButton>
                </div>
              </>
            ) : (
              <>
                <FormField label={<>Label size</>}>
                  <FormSelect
                    aria-label="Label size preset"
                    value={`${doc.widthMm}x${doc.heightMm}`}
                    onChange={(e) => {
                      const [w, h] = e.target.value.split("x").map(Number);
                      patchDoc({ widthMm: w, heightMm: h });
                    }}
                  >
                    {![
                      "60x90",
                      "50x30",
                      "40x30",
                      "100x150",
                      ...picturePresets.map(
                        (p) => `${p.widthMm}x${p.heightMm}`,
                      ),
                    ].includes(`${doc.widthMm}x${doc.heightMm}`) && (
                      <option value={`${doc.widthMm}x${doc.heightMm}`}>
                        Custom
                      </option>
                    )}
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
                  <NumberField
                    label="Label width"
                    value={doc.widthMm}
                    min={10}
                    max={216}
                    onChange={(widthMm) => patchDoc({ widthMm })}
                  />
                  <NumberField
                    label="Label height"
                    value={doc.heightMm}
                    min={10}
                    max={500}
                    onChange={(heightMm) => patchDoc({ heightMm })}
                  />
                </FieldGroup>
                <FieldGroup className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Gap"
                    value={doc.gapMm}
                    max={10}
                    onChange={(gapMm) => patchDoc({ gapMm })}
                  />
                  <FormField label={<>Resolution</>}>
                    <FormSelect
                      value={doc.dpi}
                      onChange={(e) =>
                        patchDoc({ dpi: Number(e.target.value) as 203 | 300 })
                      }
                    >
                      <option value={203}>203 dpi</option>
                      <option value={300}>300 dpi</option>
                    </FormSelect>
                  </FormField>
                </FieldGroup>
                <FormField
                  label={
                    <>
                      Black threshold <b>{doc.threshold}</b>
                    </>
                  }
                >
                  <FormInput
                    type="range"
                    aria-label="Black threshold"
                    min={1}
                    max={254}
                    value={doc.threshold}
                    onChange={(e) =>
                      patchDoc({ threshold: Number(e.target.value) })
                    }
                  />
                </FormField>
                <div className="range-labels">
                  <span>Lighter</span>
                  <span>Darker</span>
                </div>
              </>
            )}
          </section>
          <section className="printer-section" id="printer-panel">
            <div className="section-heading">
              <Bluetooth size={17} />
              <h2>Printer</h2>
              <span className={`status-dot ${connection ? "online" : ""}`} />
            </div>
            {connection ? (
              <div className="connected-device">
                <Printer size={23} />
                <div>
                  <strong>{connection.name}</strong>
                  <Badge variant="secondary">Connected</Badge>
                </div>
              </div>
            ) : (
              <Alert className="mb-3">
                <AlertDescription>
                  {bluetoothAvailable()
                    ? "Turn on your printer, then find it nearby."
                    : "Use Chrome or Edge on a supported device, or the Windows app, for Bluetooth printing."}
                </AlertDescription>
              </Alert>
            )}
            <Button
              variant="outline"
              className="w-full mb-3"
              onClick={openPrinter}
              disabled={printing}
            >
              <Bluetooth size={16} />
              {connection ? "Manage printer" : "Find Bluetooth printer"}
            </Button>
            {connection && (
              <div className="capability-details">
                <strong>Printer information</strong>
                <br />
                Model: {connection.capabilities?.model ?? "Not reported"}
                <br />
                Resolution:{" "}
                {connection.capabilities?.dpi
                  ? `${connection.capabilities.dpi} dpi reported`
                  : `Not reported · ${doc.dpi} dpi selected`}
                <br />
                Maximum width:{" "}
                {connection.capabilities?.maxWidthMm
                  ? `${connection.capabilities.maxWidthMm} mm reported`
                  : connection.capabilities?.maxWidthDots
                    ? `${connection.capabilities.maxWidthDots} dots reported`
                    : "Not reported"}
                <br />
                <span>Stock size is set manually.</span>
                <div className="mt-3 text-[10px] font-medium tracking-widest text-muted-foreground">
                  ENGINEERING
                </div>
                <Button
                  variant="quiet"
                  size="xs"
                  className="h-auto justify-start px-0 py-1 text-xs"
                  onClick={() =>
                    void printerCommand("printer_diagnostics")
                      .then((data) =>
                        saveDownload(
                          "printer-diagnostics.json",
                          new Blob([JSON.stringify(data, null, 2)], {
                            type: "application/json",
                          }),
                        ),
                      )
                      .catch(report)
                  }
                >
                  Export diagnostics
                </Button>
              </div>
            )}
            <FieldGroup className="grid grid-cols-2 gap-3">
              <NumberField
                label="Copies"
                value={copies}
                min={1}
                max={100}
                step={1}
                suffix=""
                onChange={(v) => setCopies(Math.floor(v))}
              />
              <NumberField
                label="Density"
                value={doc.density}
                max={15}
                step={1}
                suffix="/ 15"
                onChange={(v) => patchDoc({ density: Math.floor(v) })}
              />
            </FieldGroup>
            {printing && (
              <div className="progress-box">
                <div>
                  <span>{printNote || "Preparing label…"}</span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
                <Progress value={progress * 100} aria-label="Print progress" />
                {transferStats && (
                  <p className="text-xs text-muted-foreground">
                    {Math.floor(transferStats.elapsedMs / 1000)}s elapsed
                    {transferStats.elapsedMs >= 1000 &&
                    transferStats.bytesPerSecond > 0 &&
                    transferStats.sent < transferStats.total
                      ? ` · about ${Math.ceil((transferStats.total - transferStats.sent) / transferStats.bytesPerSecond)}s remaining`
                      : ""}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="text-button"
                  onClick={() => {
                    stopBatch.current = true;
                    setPrintNote("Stopping transfer…");
                    void printerCommand("cancel_print").catch(report);
                  }}
                >
                  Stop printing
                </Button>
              </div>
            )}
            <Button
              className="button primary full print-action"
              disabled={!connection || printing || !!renderError}
              onClick={() => void print()}
            >
              <Printer size={17} />
              {printing
                ? "Sending…"
                : pdfDocuments.length > 1
                  ? `Print ${pdfDocuments.length} artwork labels`
                  : batch && csvRows.length
                    ? `Print ${csvRows.length} rows`
                    : "Print label"}
            </Button>
            {!connection && (
              <p className="connection-hint">
                Connect a printer to enable printing.
              </p>
            )}
          </section>
        </aside>
      </div>
      <FormInput
        ref={fileRef}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          void importLabel(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <FormInput
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          void importImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <FormInput
        ref={csvRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          void importCsv(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <PrinterDialog
        open={showPrinter}
        onOpenChange={setShowPrinter}
        native={native}
        available={bluetoothAvailable()}
        devices={devices}
        connection={connection}
        scanning={scanning}
        connecting={connecting}
        printing={printing}
        error={error}
        notice={notice}
        onScan={() => void scan()}
        onConnect={(device) => void connect(device)}
        onDisconnect={() => void disconnect()}
      />
      {showImport && (
        <ImportFlow
          doc={doc}
          onClose={() => setShowImport(false)}
          onImport={(documents) => {
            setPdfDocuments(documents);
            setPdfPageIndex(0);
            update(documents[0]);
            setCsvRows([]);
            setSelectedId(
              documents[0].elements.find((element) => element.kind === "image")
                ?.id ?? null,
            );
            setShowImport(false);
            setScreen("editor");
            setNotice(
              `Prepared ${documents.length} artwork label${documents.length === 1 ? "" : "s"}. Review monochrome output before printing.`,
            );
          }}
        />
      )}
    </div>
  );
}
