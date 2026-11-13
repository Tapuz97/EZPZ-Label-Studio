import { Children, Fragment, isValidElement } from "react";
import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "@/lib/utils";

// Adapts the editor's existing option data to the official shadcn Select.
export function FormSelect({
  children,
  value,
  onChange,
  className,
  disabled,
  id,
  title,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const encode = (value: unknown) => String(value ?? "") || "__custom__";
  function options(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (node) => {
      if (
        !isValidElement<{
          children?: ReactNode;
          value?: string | number;
          label?: string;
          disabled?: boolean;
        }>(node)
      )
        return null;
      if (node.type === Fragment) return options(node.props.children);
      if (node.type === "optgroup")
        return (
          <SelectGroup>
            <SelectLabel>{node.props.label}</SelectLabel>
            {options(node.props.children)}
          </SelectGroup>
        );
      return (
        <SelectItem
          value={encode(node.props.value)}
          disabled={node.props.disabled}
        >
          {node.props.children}
        </SelectItem>
      );
    });
  }
  return (
    <Select
      value={encode(value)}
      disabled={disabled}
      onValueChange={(next) => {
        const target = { value: next === "__custom__" ? "" : next };
        onChange?.({
          target,
          currentTarget: target,
        } as ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger
        id={id}
        title={title}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        className={cn("w-full", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>{options(children)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}
