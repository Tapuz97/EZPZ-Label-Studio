import { cloneElement, isValidElement, useId } from "react";
import type { ReactNode } from "react";
import { Field, FieldLabel } from "./ui/field";
export function FormField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const nodes = Array.isArray(children) ? children : [children];
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {nodes.map((node, i) =>
        isValidElement<{ id?: string }>(node) && typeof node.type !== "string"
          ? cloneElement(node, { id, key: i })
          : node,
      )}
    </Field>
  );
}
