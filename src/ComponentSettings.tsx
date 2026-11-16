import { useId, useRef, useState } from "react";
import { CropEditor } from "./CropEditor";
import { FramePicker, FramePreview } from "./FramePicker";
import { framePresets } from "./frames";
import type { LabelElement } from "./model";
import { graphicFromFile } from "./graphics";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";
import { Button } from "./components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "./components/ui/field";

export function ComponentSettings({
  element: e,
  onChange,
  onError,
}: {
  element: LabelElement;
  onChange: (patch: Partial<LabelElement>) => void;
  onError: (error: unknown) => void;
}) {
  const id = useId(),
    file = useRef<HTMLInputElement>(null),
    selected = useRef(e.id);
  selected.current = e.id;
  const [loading, setLoading] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [choosingFrame, setChoosingFrame] = useState(false);
  const flag = (
    label: string,
    checked: boolean,
    patch: (value: boolean) => Partial<LabelElement>,
    key: string,
  ) => (
    <Field orientation="horizontal" key={key}>
      <Checkbox
        id={`${id}-${key}`}
        checked={checked}
        onCheckedChange={(value) => onChange(patch(value === true))}
      />
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
    </Field>
  );
  async function uploadLogo(source?: File) {
    if (!source) return;
    const owner = e.id;
    setLoading(true);
    try {
      const graphic = await graphicFromFile(source, { maxSide: 256, maxBytes: 8_000_000, maxPixels: 40_000_000 });
      if (selected.current === owner) onChange({ qrLogo: graphic.data, qrShowLogo: true });
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
      if (file.current) file.current.value = "";
    }
  }
  return (
    <FieldGroup>
      {["text", "qr", "barcode"].includes(e.kind) && (
        <Field>
          <FieldLabel htmlFor={`${id}-data`}>Component ID</FieldLabel>
          <Input
            id={`${id}-data`}
            value={e.dataId ?? ""}
            maxLength={120}
            placeholder="e.g. name"
            onChange={(event) =>
              onChange({ dataId: event.target.value.replace(/[\r\n]/g, "") })
            }
          />
          <FieldDescription>
            Use the matching CSV column. Leave empty for fixed content.
          </FieldDescription>
        </Field>
      )}
      {e.kind === "qr" && (
        <>
          {flag(
            "Show QR background",
            e.qrBackground !== false,
            (qrBackground) => ({ qrBackground }),
            "background",
          )}
          {flag(
            "Show center logo",
            !!e.qrShowLogo,
            (qrShowLogo) => ({ qrShowLogo }),
            "logo",
          )}
          <Field>
            <FieldLabel htmlFor={`${id}-logo-file`}>Center logo</FieldLabel>
            <Input
              ref={file}
              id={`${id}-logo-file`}
              type="file"
              accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
              disabled={loading}
              onChange={(event) => void uploadLogo(event.target.files?.[0])}
            />
            {e.qrLogo && (
              <>
                <img
                  src={e.qrLogo}
                  alt="Uploaded QR center logo"
                  className="size-12 object-contain"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ qrLogo: "", qrShowLogo: false })}
                >
                  Remove logo
                </Button>
              </>
            )}
            <FieldDescription>
              {loading
                ? "Preparing logo…"
                : "Logo prints in monochrome. Check that your finished QR code scans."}
            </FieldDescription>
          </Field>
        </>
      )}
      {e.kind === "barcode" &&
        flag(
          "Show barcode numbers",
          e.barcodeShowText !== false,
          (barcodeShowText) => ({ barcodeShowText }),
          "numbers",
        )}
      {e.kind === "rect" && (
        <Field>
          <FieldLabel htmlFor={`${id}-frame`}>Frame style</FieldLabel>
          <Button
            id={`${id}-frame`}
            type="button"
            variant="outline"
            className="h-auto justify-start gap-3 py-2"
            aria-label="Change frame style"
            onClick={() => setChoosingFrame(true)}
          >
            <span className="block h-8 w-14">
              <FramePreview style={e.frameStyle} />
            </span>
            <span>
              {framePresets.find(
                (frame) => frame.id === (e.frameStyle ?? "plain"),
              )?.name ?? "Plain"}{" "}
              · Change
            </span>
          </Button>
          <FramePicker
            open={choosingFrame}
            onOpenChange={setChoosingFrame}
            editing
            selectedStyle={e.frameStyle ?? "plain"}
            onSelect={(frameStyle) => onChange({ frameStyle })}
          />
        </Field>
      )}
      {(e.kind === "line" || e.kind === "rect") && (
        <Field>
          <FieldLabel htmlFor={`${id}-stroke`}>Thickness (mm)</FieldLabel>
          <Input
            id={`${id}-stroke`}
            type="number"
            min={0.05}
            max={10}
            step={0.05}
            value={e.strokeWidth ?? 0.2}
            onChange={(event) => {
              const n = event.target.valueAsNumber;
              if (Number.isFinite(n))
                onChange({ strokeWidth: Math.max(0.05, Math.min(10, n)) });
            }}
          />
        </Field>
      )}
      {e.kind === "image" && (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCropping(true)}
          >
            Crop image
          </Button>
          {cropping && (
            <CropEditor
              key={e.id}
              element={e}
              onClose={() => setCropping(false)}
              onApply={(crop) => {
                onChange({ crop });
                setCropping(false);
              }}
            />
          )}
        </>
      )}
    </FieldGroup>
  );
}
