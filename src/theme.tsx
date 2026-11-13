import { FormSelect } from "@/components/form-select";
import { useEffect, useState } from "react";
import {
  MonitorDuotoneIcon,
  SunDuotoneIcon,
  MoonDuotoneIcon,
} from "@thesvg/ui-react";
type Theme = "system" | "light" | "dark";
export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const value = localStorage.getItem("label-studio.theme.v1");
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (query.matches ? "dark" : "light") : theme;
      document.documentElement.style.colorScheme =
        document.documentElement.dataset.theme;
    };
    apply();
    query.addEventListener("change", apply);
    try {
      localStorage.setItem("label-studio.theme.v1", theme);
    } catch {}
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  const Icon =
    theme === "system"
      ? MonitorDuotoneIcon
      : theme === "dark"
        ? MoonDuotoneIcon
        : SunDuotoneIcon;
  return (
    <label className="theme-control">
      <Icon size={17} />
      <FormSelect
        aria-label="Appearance"
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </FormSelect>
    </label>
  );
}
