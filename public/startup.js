// Apply appearance before React or the stylesheet loads, including offline startup.
try {
  const preference = localStorage.getItem("label-studio.theme.v1");
  const theme = preference === "light" || preference === "dark" ? preference : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
} catch { /* The system media query in the critical CSS remains the fallback. */ }
