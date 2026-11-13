import { useState } from "react";
import type { ComponentType } from "react";
import {
  FilePlus2,
  FileImage,
  FolderOpen,
  Printer,
  Tag,
  Upload,
  Download,
  ArrowUp,
} from "./icons";
import { commonPresets, picturePresets, validateSize } from "./workflow";
import type { LabelDocument } from "./model";
import { cn } from "@/lib/utils";
import { FormSelect } from "./components/form-select";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "./components/ui/empty";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
  FieldContent,
} from "./components/ui/field";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { Spinner } from "./components/ui/spinner";

type Saved = { id: string; document: LabelDocument };
type HomeScreenProps = {
  doc: LabelDocument;
  library: Saved[];
  connected: string | null;
  onResume: () => void;
  onNew: (width: number, height: number, name: string) => void;
  onImport: () => void;
  onLoad: (doc: LabelDocument) => void;
  onPrinter: () => void;
  onImportTemplates: () => void;
  onExportTemplates: (docs: LabelDocument[]) => Promise<string | null>;
};
const cardInteraction =
  "relative cursor-pointer transition-shadow hover:border-primary hover:ring-2 hover:ring-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function ActionCard({
  title,
  description,
  detail,
  action,
  icon: Icon,
  onClick,
  emphasized = false,
}: {
  title: string;
  description: string;
  detail: string;
  action: string;
  icon: ComponentType<{ size?: number }>;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={onClick}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        cardInteraction,
        "h-full gap-4 [@media(max-height:760px)]:gap-2.5 [@media(max-height:760px)]:py-3",
        emphasized && "border-primary/40",
      )}
    >
      <CardHeader>
        <EmptyMedia variant="icon" className="[@media(max-height:760px)]:mb-0 [@media(max-height:760px)]:size-8">
          <Icon />
        </EmptyMedia>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
      <CardFooter>
        <Button
          asChild
          variant={emphasized ? "default" : "outline"}
          className="w-full justify-between"
        >
          <span aria-hidden="true">
            {action}
            <ArrowUp
              data-icon="inline-end"
              style={{ transform: "rotate(45deg)" }}
            />
          </span>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function HomeScreen({
  doc,
  library,
  connected,
  onResume,
  onNew,
  onImport,
  onLoad,
  onPrinter,
  onImportTemplates,
  onExportTemplates,
}: HomeScreenProps) {
  const [creating, setCreating] = useState(false);
  const [width, setWidth] = useState(60);
  const [height, setHeight] = useState(90);
  const [name, setName] = useState("Untitled label");
  const [error, setError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const selectedTemplates = library.filter((item) => selectedIds.has(item.id));
  const selectedCount = selectedTemplates.length;
  const allSelected = library.length > 0 && selectedCount === library.length;
  const presetValue = [...commonPresets, ...picturePresets].some(
    (p) => p.widthMm === width && p.heightMm === height,
  )
    ? `${width}x${height}`
    : "";

  function beginExport() {
    setSelectedIds(new Set(library.map((item) => item.id)));
    setExportError("");
    setExportNotice("");
    setExportOpen(true);
  }
  async function exportSelected() {
    if (!selectedCount || exportBusy) return;
    setExportBusy(true);
    setExportError("");
    setExportNotice("");
    try {
      const result = await onExportTemplates(
        selectedTemplates.map((item) => item.document),
      );
      if (result === null)
        setExportNotice("Export canceled. Your selection is unchanged.");
      else {
        setExportOpen(false);
        setExportNotice(
          `Exported ${selectedCount} template${selectedCount === 1 ? "" : "s"}.`,
        );
      }
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExportBusy(false);
    }
  }
  function createLabel() {
    try {
      validateSize(width, height, doc.dpi);
      if (!name.trim()) throw Error("Give the label a name.");
      onNew(width, height, name.trim());
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="home-screen flex flex-col gap-6 [@media(max-height:760px)]:gap-4">
      <div className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-3 [@media(max-height:760px)]:gap-1.5">
          <Badge variant="secondary" className="w-fit">
            YOUR LABEL WORKSPACE
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight [@media(max-height:760px)]:text-[28px] [@media(max-height:760px)]:leading-tight">
            What are we printing today?
          </h1>
          <p className="text-muted-foreground">
            Create a label, open your artwork, or pick up where you left off.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-auto gap-3 px-4 py-3"
          onClick={onPrinter}
        >
          <Printer data-icon="inline-start" />
          <span className="flex flex-col items-start gap-1">
            <span>{connected || "Connect a printer"}</span>
            <span className="text-xs text-muted-foreground">
              {connected
                ? "Bluetooth connected"
                : "Choose your Bluetooth label printer"}
            </span>
          </span>
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-5">
        <ActionCard
          title="New label"
          description="Start with a blank canvas."
          detail="Add text, barcodes, QR codes and images at the size you need."
          action="Create label"
          icon={FilePlus2}
          onClick={() => {
            setError("");
            setCreating(true);
          }}
          emphasized
        />
        <ActionCard
          title="Print artwork"
          description="Images and PDF pages, ready to prepare."
          detail="Preview your files and fit them to your stock or match the artwork size."
          action="Upload files"
          icon={FileImage}
          onClick={onImport}
        />
        <ActionCard
          title="Continue editing"
          description={doc.name}
          detail={`${doc.widthMm} × ${doc.heightMm} mm · ${doc.elements.length} elements`}
          action="Open editor"
          icon={Tag}
          onClick={onResume}
        />
      </div>
      <section
        className="flex flex-col gap-5"
        aria-labelledby="saved-templates-title"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div>
              <h2 id="saved-templates-title" className="text-xl font-semibold">
                Saved templates
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Stored on this computer, ready to reuse.
              </p>
            </div>
            <Badge variant="secondary">{library.length}</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onImportTemplates}>
              <Upload data-icon="inline-start" />
              Import
            </Button>
            <Button
              variant="outline"
              onClick={beginExport}
              disabled={!library.length}
            >
              <Download data-icon="inline-start" />
              Export
            </Button>
          </div>
        </div>
        {!exportOpen && exportNotice && (
          <Alert>
            <AlertTitle>Template export</AlertTitle>
            <AlertDescription>{exportNotice}</AlertDescription>
          </Alert>
        )}
        {library.length ? (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            {library.map((item) => (
              <Card
                key={item.id}
                className={cn(
                  "relative",
                  "transition-shadow hover:border-primary hover:ring-2 hover:ring-primary focus-within:border-primary focus-within:ring-2 focus-within:ring-primary",
                )}
              >
                <CardHeader>
                  <CardTitle className="truncate">
                    {item.document.name}
                  </CardTitle>
                  <CardDescription>
                    {item.document.widthMm} × {item.document.heightMm} mm
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">{item.document.dpi} dpi</Badge>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {item.document.elements.length} elements
                  </p>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    className="w-full after:absolute after:inset-0"
                    onClick={() => onLoad(item.document)}
                    aria-label={`Open template ${item.document.name}`}
                  >
                    <FolderOpen data-icon="inline-start" />
                    Open template
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Empty className="flex-row justify-start border px-6 py-5 text-left md:p-5">
              <EmptyMedia variant="icon" className="mb-0">
                <FolderOpen />
              </EmptyMedia>
            <EmptyHeader className="max-w-none items-start text-left">
              <EmptyTitle>Your templates live here</EmptyTitle>
              <EmptyDescription>
                Save a design in the editor, or import a template file to get
                started.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="ml-auto w-auto shrink-0">
              <Button variant="outline" onClick={onImportTemplates}>
                <Upload data-icon="inline-start" />
                Import templates
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a label</DialogTitle>
            <DialogDescription>
              Use the dimensions printed on your label roll.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createLabel();
            }}
            className="flex flex-col gap-6"
          >
            <FieldGroup>
              <Field data-invalid={!!error && !name.trim()}>
                <FieldLabel htmlFor="new-label-name">Label name</FieldLabel>
                <Input
                  id="new-label-name"
                  value={name}
                  maxLength={120}
                  aria-invalid={!!error && !name.trim()}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-label-preset">Size</FieldLabel>
                <FormSelect
                  id="new-label-preset"
                  aria-label="New label preset"
                  value={presetValue}
                  onChange={(event) => {
                    if (event.target.value) {
                      const [w, h] = event.target.value.split("x").map(Number);
                      setWidth(w);
                      setHeight(h);
                    }
                  }}
                >
                  <option value="">Custom dimensions</option>
                  <optgroup label="Common label sizes">
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
              </Field>
              <FieldGroup className="grid grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="new-label-width">Width · mm</FieldLabel>
                  <Input
                    id="new-label-width"
                    type="number"
                    min={10}
                    max={216}
                    step="any"
                    value={width}
                    onChange={(event) => setWidth(Number(event.target.value))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-label-height">
                    Height · mm
                  </FieldLabel>
                  <Input
                    id="new-label-height"
                    type="number"
                    min={10}
                    max={500}
                    step="any"
                    value={height}
                    onChange={(event) => setHeight(Number(event.target.value))}
                  />
                </Field>
              </FieldGroup>
              <FieldDescription>
                Custom dimensions are supported. Check that the width fits your
                printer.
              </FieldDescription>
            </FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Check the label settings</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create label</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!exportBusy) setExportOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={!exportBusy}
          className="max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Export templates</DialogTitle>
            <DialogDescription>
              Choose the saved templates to include in one reusable template
              file.
            </DialogDescription>
          </DialogHeader>
          <FieldSet disabled={exportBusy}>
            <FieldLegend>Saved templates</FieldLegend>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id="export-all-templates"
                  checked={
                    allSelected ? true : selectedCount ? "indeterminate" : false
                  }
                  onCheckedChange={(checked) =>
                    setSelectedIds(
                      checked === true
                        ? new Set(library.map((item) => item.id))
                        : new Set(),
                    )
                  }
                  disabled={exportBusy}
                />
                <FieldLabel htmlFor="export-all-templates">
                  Select all ({library.length})
                </FieldLabel>
                <Badge variant="secondary">{selectedCount} selected</Badge>
              </Field>
              <FieldGroup
                className="max-h-72 overflow-y-auto pr-2"
                data-slot="checkbox-group"
              >
                {library.map((item) => (
                  <Field key={item.id} orientation="horizontal">
                    <Checkbox
                      id={`export-template-${item.id}`}
                      checked={selectedIds.has(item.id)}
                      disabled={exportBusy}
                      onCheckedChange={(checked) =>
                        setSelectedIds((previous) => {
                          const next = new Set(previous);
                          if (checked === true) next.add(item.id);
                          else next.delete(item.id);
                          return next;
                        })
                      }
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`export-template-${item.id}`}>
                        {item.document.name}
                      </FieldLabel>
                      <FieldDescription>
                        {item.document.widthMm} × {item.document.heightMm} mm ·{" "}
                        {item.document.dpi} dpi
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                ))}
              </FieldGroup>
            </FieldGroup>
          </FieldSet>
          {exportError && (
            <Alert variant="destructive">
              <AlertTitle>Export could not finish</AlertTitle>
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          )}
          {exportNotice && (
            <Alert>
              <AlertDescription>{exportNotice}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={exportBusy}
              onClick={() => setExportOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!selectedCount || exportBusy}
              onClick={() => void exportSelected()}
            >
              {exportBusy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {exportBusy ? "Exporting…" : `Export selected (${selectedCount})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
