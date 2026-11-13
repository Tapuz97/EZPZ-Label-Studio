import { useEffect, useState } from "react";
import { SunDuotoneIcon, MoonDuotoneIcon } from "@thesvg/ui-react";
import { Button } from "./components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";

type Appearance = "light" | "dark";
export function ThemeControl() {
  const [preference, setPreference] = useState<Appearance | null>(() => {
    try {
      const value = localStorage.getItem("label-studio.theme.v1");
      return value === "light" || value === "dark" ? value : null;
    } catch { return null; }
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = preference ?? (systemDark ? "dark" : "light");
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(query.matches);
    changed();
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (preference) {
      try { localStorage.setItem("label-studio.theme.v1", preference); } catch { /* Appearance still works when storage is unavailable. */ }
    }
  }, [theme, preference]);
  const next = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  const Icon = next === "dark" ? MoonDuotoneIcon : SunDuotoneIcon;
  return <TooltipProvider delayDuration={250}><Tooltip><TooltipTrigger asChild>
    <Button variant="ghost" size="icon" aria-label={label} onClick={() => setPreference(next)}><Icon /></Button>
  </TooltipTrigger><TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent></Tooltip></TooltipProvider>;
}
