import { createElement, useEffect } from "react";
import { Button } from "./ui/button";

const badgeScript = "https://get.microsoft.com/badge/ms-store-badge.bundled.js";

export function MicrosoftStoreBadge() {
  useEffect(() => {
    if (document.querySelector(`script[src="${badgeScript}"]`)) return;
    const script = document.createElement("script");
    script.type = "module";
    script.src = badgeScript;
    script.async = true;
    document.head.appendChild(script);
    // Keep the shared custom-element module across Home/editor navigation.
  }, []);

  return (
    <footer
      aria-label="Windows application download"
      className="flex flex-wrap items-center justify-between gap-4 border-t pt-5 [@media(max-width:760px)]:flex-col [@media(max-width:760px)]:items-start"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">Prefer the Windows app?</p>
        <p className="text-sm text-muted-foreground">
          Design and print offline on your PC.
        </p>
      </div>
      {createElement(
        "ms-store-badge",
        {
          className: "store-download-badge",
          productid: "9PNR3K65GQFL",
          "window-mode": "direct",
          theme: "auto",
          size: "large",
          language: "en-us",
          animation: "on",
        },
        <Button variant="outline" asChild>
          <a href="https://apps.microsoft.com/detail/9PNR3K65GQFL">
            Download from Microsoft Store
          </a>
        </Button>,
      )}
    </footer>
  );
}
