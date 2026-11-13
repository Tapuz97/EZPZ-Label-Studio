import type { ChangeEvent, ComponentProps } from "react";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Slider } from "./ui/slider";
export function FormInput({
  type,
  onChange,
  checked,
  value,
  min,
  max,
  step,
  ...props
}: ComponentProps<"input">) {
  if (type === "checkbox")
    return (
      <Checkbox
        id={props.id}
        aria-label={props["aria-label"]}
        checked={checked}
        disabled={props.disabled}
        onCheckedChange={(next) =>
          onChange?.({
            target: { checked: next === true },
            currentTarget: { checked: next === true },
          } as ChangeEvent<HTMLInputElement>)
        }
      />
    );
  if (type === "range")
    return (
      <Slider
        aria-label={props["aria-label"]}
        value={[Number(value)]}
        min={Number(min)}
        max={Number(max)}
        step={Number(step ?? 1)}
        disabled={props.disabled}
        onValueChange={([next]) =>
          onChange?.({
            target: { value: String(next), valueAsNumber: next },
            currentTarget: { value: String(next), valueAsNumber: next },
          } as ChangeEvent<HTMLInputElement>)
        }
      />
    );
  return (
    <Input
      {...props}
      type={type}
      checked={checked}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
    />
  );
}
