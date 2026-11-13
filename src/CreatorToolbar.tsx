import { useState } from "react";
import { CropEditor } from "./CropEditor";
import { CropDuotoneIcon as Crop } from "@thesvg/ui-react";
import type { LabelElement } from "./model";
import type { Alignment } from "./editor-geometry";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Toggle } from "./components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { FormSelect } from "./components/form-select";
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
} from "lucide-react";
import { ArrowUp, ArrowDown, RotateCw } from "./icons";
const alignments = [
  ["left", "Align left", AlignStartVertical],
  ["center", "Center horizontally", AlignCenterVertical],
  ["right", "Align right", AlignEndVertical],
  ["top", "Align top", AlignStartHorizontal],
  ["middle", "Center vertically", AlignCenterHorizontal],
  ["bottom", "Align bottom", AlignEndHorizontal],
] as const;
export function CreatorToolbar({
  element,
  elements,
  target,
  onTarget,
  onAlign,
  onChange,
  onLayer,
}: {
  element: LabelElement;
  elements: LabelElement[];
  target: string;
  onTarget: (value: string) => void;
  onAlign: (mode: Alignment) => void;
  onChange: (patch: Partial<LabelElement>) => void;
  onLayer: (direction: number) => void;
}) {
  const [cropping, setCropping] = useState(false);
  return (
    <div
      role="region"
      aria-label="Component creator tools"
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      {element.kind === "image" && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Crop image"
          title="Crop image"
          onClick={() => setCropping(true)}
        >
          <Crop />
        </Button>
      )}
      {cropping && element.kind === "image" && (
        <CropEditor
          element={element}
          onApply={(crop) => {
            onChange({ crop });
            setCropping(false);
          }}
          onClose={() => setCropping(false)}
        />
      )}
      {element.kind === "text" && (
        <div
          role="group"
          aria-label="Text formatting"
          className="flex flex-wrap items-center gap-1"
        >
          <div className="w-32">
            <FormSelect
              aria-label="Text font"
              value={element.fontFamily}
              onChange={(e) =>
                onChange({
                  fontFamily: e.target.value as LabelElement["fontFamily"],
                })
              }
            >
              {[
                "Arial",
                "Segoe UI",
                "Consolas",
                "Courier New",
                "Times New Roman",
              ].map((font) => (
                <option value={font} key={font}>
                  {font}
                </option>
              ))}
            </FormSelect>
          </div>
          <Input
            aria-label="Text font size"
            title="Font size (pt)"
            type="number"
            min={2}
            max={144}
            step={1}
            className="w-16"
            value={element.fontSize}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isFinite(n) && n >= 2 && n <= 144)
                onChange({ fontSize: n });
            }}
          />
          <Toggle
            size="sm"
            pressed={element.bold}
            onPressedChange={(bold) => onChange({ bold })}
            aria-label="Bold text"
            title="Bold"
          >
            <Bold />
          </Toggle>
          <ToggleGroup
            type="single"
            size="sm"
            value={element.align}
            aria-label="Text alignment"
            onValueChange={(align) => {
              if (align) onChange({ align: align as LabelElement["align"] });
            }}
          >
            <ToggleGroupItem
              value="left"
              aria-label="Align text left"
              title="Align text left"
            >
              <AlignLeft />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="center"
              aria-label="Center text"
              title="Center text"
            >
              <AlignCenter />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="right"
              aria-label="Align text right"
              title="Align text right"
            >
              <AlignRight />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      <div
        role="group"
        aria-label="Position component"
        className="flex flex-wrap items-center gap-1"
      >
        <div className="w-32">
          <FormSelect
            aria-label="Align relative to"
            title="Align relative to label or component"
            value={
              elements.some((e) => e.id === target && e.id !== element.id)
                ? target
                : "label"
            }
            onChange={(e) => onTarget(e.target.value)}
          >
            <option value="label">To label</option>
            {elements
              .filter((e) => e.id !== element.id)
              .map((e, i) => (
                <option key={e.id} value={e.id}>
                  {e.kind} {i + 1}:{" "}
                  {e.kind === "image" ? "Image" : e.content.slice(0, 18)}
                </option>
              ))}
          </FormSelect>
        </div>
        {alignments.map(([mode, label, Icon]) => (
          <Button
            key={mode}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            onClick={() => onAlign(mode)}
          >
            <Icon />
          </Button>
        ))}
      </div>
      <div
        role="group"
        aria-label="Rotate and arrange"
        className="flex items-center gap-1"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Rotate clockwise 90 degrees"
          title="Rotate clockwise 90°"
          onClick={() => onChange({ rotation: (element.rotation + 90) % 360 })}
        >
          <RotateCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Bring component forward"
          title="Bring forward"
          onClick={() => onLayer(1)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Send component backward"
          title="Send backward"
          onClick={() => onLayer(-1)}
        >
          <ArrowDown />
        </Button>
      </div>
    </div>
  );
}
