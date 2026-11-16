import { useEffect, useRef, useState } from "react";
import { Icon, Search, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import type { IconNode } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, FieldLabel, FieldDescription } from "./components/ui/field";
import { ScrollArea } from "./components/ui/scroll-area";
import { Spinner } from "./components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./components/ui/empty";
import { graphicFromFile, graphicFromSvg } from "./graphics";
import type { PrintableGraphic } from "./graphics";
import { findIcons, iconName, iconSvg } from "./print-icons";
import type { IconCatalog, PrintIcon } from "./print-icons";

const pageSize = 60;
export function GraphicPicker({ open, onOpenChange, onAdd }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (graphics: PrintableGraphic[]) => void;
}) {
  const [catalog, setCatalog] = useState<IconCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!open || catalog) return;
    let active = true;
    import("./print-icons.json").then(module => {
      if (active) setCatalog(module.default as IconCatalog);
    }).catch(() => { if (active) setError("The icon library could not load. Close this window and try again."); });
    return () => { active = false; };
  }, [open, catalog]);
  useEffect(() => () => { operation.current++; }, []);
  const matches = catalog ? findIcons(catalog.icons, query) : [];
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  function close(value: boolean) {
    operation.current++;
    busyRef.current = false;
    setBusy(false);
    setError("");
    onOpenChange(value);
  }
  async function prepare(load: (active: () => boolean) => Promise<PrintableGraphic[]>) {
    if (busyRef.current) return;
    const id = ++operation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const graphics = await load(() => operation.current === id);
      if (operation.current !== id) return;
      onAdd(graphics);
      close(false);
    } catch (error) {
      if (operation.current === id) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation.current === id) { busyRef.current = false; setBusy(false); }
    }
  }
  function addIcon(icon: PrintIcon) {
    void prepare(async () => [await graphicFromSvg(iconSvg(icon), `${iconName(icon.id)} icon`, 1024)]);
  }
  function addFiles(files: File[]) {
    void prepare(async active => {
      if (!files.length || files.length > 10 || files.reduce((sum, f) => sum + f.size, 0) > 20_000_000)
        throw Error("Choose 1–10 SVG or PNG files totaling 20 MB or less.");
      if (files.some(f => !/\.(svg|png)$/i.test(f.name) && !["image/svg+xml", "image/png"].includes(f.type)))
        throw Error("Choose SVG or PNG files for your emoji artwork.");
      const graphics: PrintableGraphic[] = [];
      for (const file of files) {
        if (!active()) return [];
        graphics.push(await graphicFromFile(file));
      }
      return graphics;
    });
  }
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Icons & emoji artwork</DialogTitle>
        <DialogDescription>Add a printable icon or your own SVG/PNG emoji. Artwork stays editable and saves with your template.</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="icons">
        <TabsList className="w-full">
          <TabsTrigger value="icons">Icon library</TabsTrigger>
          <TabsTrigger value="import">Import SVG / PNG</TabsTrigger>
        </TabsList>
        {error && <Alert variant="destructive" className="my-3"><AlertDescription>{error}</AlertDescription></Alert>}
        <TabsContent value="icons" className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="print-icon-search" className="sr-only">Search icons</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input id="print-icon-search" placeholder="Search icons, e.g. heart, shipping, emoji…" className="pl-9" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
            </div>
          </Field>
          <ScrollArea className="h-[min(45vh,23rem)]">
            {!catalog ? <div role="status" className="flex items-center justify-center gap-2 p-8"><Spinner />Loading icon library…</div> : matches.length ?
              <TooltipProvider><div className="grid grid-cols-4 gap-2 pr-3 sm:grid-cols-6 lg:grid-cols-8">
                {matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(icon => <Tooltip key={icon.id}><TooltipTrigger asChild><Button variant="outline" className="h-20 min-w-0 flex-col gap-2 px-1" disabled={busy} aria-label={`Add ${iconName(icon.id)} icon`} onClick={() => addIcon(icon)}>
                  <Icon iconNode={icon.node.map(([tag, attrs], i) => [tag, { ...attrs, key: String(i) }]) as IconNode} className="size-7" aria-hidden="true" />
                  <span className="w-full truncate text-center text-xs">{iconName(icon.id)}</span>
                </Button></TooltipTrigger><TooltipContent>{iconName(icon.id)}</TooltipContent></Tooltip>)}
              </div></TooltipProvider> : <Empty><EmptyHeader><EmptyTitle>No matching icons</EmptyTitle><EmptyDescription>Try another name or import your own SVG or PNG.</EmptyDescription></EmptyHeader></Empty>}
          </ScrollArea>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{matches.length.toLocaleString()} icons · Lucide · Available offline</p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" aria-label="Previous icons" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button>
              <span className="text-xs tabular-nums">{currentPage + 1} / {pages}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Next icons" disabled={busy || currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="import">
          <Field className="py-3">
            <FieldLabel htmlFor="emoji-artwork-files">Your emoji artwork</FieldLabel>
            <Button variant="outline" className="h-48 flex-col gap-3 border-dashed" disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (!busy) addFiles(Array.from(e.dataTransfer.files)); }}>
              {busy ? <Spinner /> : <Upload />}
              <span>{busy ? "Preparing artwork…" : "Choose or drop SVG / PNG files"}</span>
            </Button>
            <input id="emoji-artwork-files" ref={input} type="file" accept=".svg,.png,image/svg+xml,image/png" multiple className="hidden" aria-label="Import emoji artwork files" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) addFiles(files); }} />
            <FieldDescription>Up to 5 MB per file. Transparent backgrounds and proportions are preserved. SVGs are prepared locally as high-resolution images; the print preview shows the final black-and-white output.</FieldDescription>
          </Field>
        </TabsContent>
      </Tabs>
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Preparing artwork…</p>}
    </DialogContent>
  </Dialog>;
}
