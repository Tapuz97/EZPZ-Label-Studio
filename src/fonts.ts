import type { LabelDocument } from "./model";
import { assetUrl } from "./assets";
import { fontByteLength, fontBytes, isCustomFontFamily, maxDocumentFontBytes, maxFontBytes, type CustomFont } from "./font-types";

export const emojiFamily = "EZPZ Emoji";
export const hasEmoji = (text: string) => /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text);
const loaded = new Map<string, { data: string; ready: Promise<void>; face?: FontFace }>();
let emojiReady: Promise<void> | undefined;
export function ensureEmojiFont() {
  if (!emojiReady) {
    const face = new FontFace(emojiFamily, `url("${assetUrl("fonts/NotoEmoji.ttf")}")`, { weight: "300 700" });
    emojiReady = face.load().then(() => { document.fonts.add(face); }).catch(() => {
      emojiReady = undefined;
      throw Error("The bundled emoji font could not load. Reopen the app and try again.");
    });
  }
  return emojiReady;
}

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export async function fontFromFile(file: File): Promise<CustomFont> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["ttf", "otf", "woff", "woff2"].includes(ext ?? "") || !file.size || file.size > maxFontBytes)
    throw Error(`${file.name}: choose a TTF, OTF, WOFF or WOFF2 font up to 2 MB.`);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`data:font/${ext};base64,${String(reader.result).split(",")[1]}`);
    reader.onerror = () => reject(Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  const bytes = fontBytes(data);
  const font = {
    family: `EZPZFont_${await digest(bytes)}`,
    name: file.name.replace(/\.(ttf|otf|woff2?)$/i, "").replace(/[\u0000-\u001f]/g, "").slice(0, 120).trim() || "Custom font",
    data,
  };
  await ensureCustomFont(font);
  return font;
}

export function ensureCustomFont(font: CustomFont): Promise<void> {
  const previous = loaded.get(font.family);
  if (previous) {
    if (previous.data !== font.data) return Promise.reject(Error(`The embedded font “${font.name}” is damaged. Upload it again.`));
    loaded.delete(font.family);
    loaded.set(font.family, previous);
    return previous.ready;
  }
  const ready = (async () => {
    const bytes = fontBytes(font.data);
    if (`EZPZFont_${await digest(bytes)}` !== font.family)
      throw Error(`The embedded font “${font.name}” is damaged. Upload it again.`);
    const face = new FontFace(font.family, bytes.buffer);
    try { await face.load(); } catch { throw Error(`“${font.name}” could not load. Choose a valid font file.`); }
    document.fonts.add(face);
    const entry = loaded.get(font.family);
    if (entry) entry.face = face;
    // Font files imported with old templates must not accumulate indefinitely.
    while (loaded.size > 40) {
      const [family, oldest] = loaded.entries().next().value!;
      if (oldest.face) document.fonts.delete(oldest.face);
      loaded.delete(family);
    }
  })();
  loaded.set(font.family, { data: font.data, ready });
  void ready.catch(() => { if (loaded.get(font.family)?.ready === ready) loaded.delete(font.family); });
  return ready;
}

/** Keep templates portable, and drop font files no longer used by this design. */
export function withDocumentFonts(doc: LabelDocument, library: CustomFont[]): LabelDocument {
  const used = new Set(doc.elements.filter(e => isCustomFontFamily(e.fontFamily)).map(e => e.fontFamily));
  const available = new Map([...library, ...(doc.fonts ?? [])].map(f => [f.family, f]));
  const fonts = [...used].map(family => {
    const font = available.get(family);
    if (!font) throw Error("This design needs a font that is not available. Upload it again.");
    return font;
  });
  if (fonts.reduce((sum, font) => sum + fontByteLength(font.data), 0) > maxDocumentFontBytes)
    throw Error("Fonts in one label must total 4 MB or less. Choose a smaller font file.");
  if (!fonts.length && !doc.fonts) return doc;
  return { ...doc, fonts };
}

export async function ensureTextFonts(doc: LabelDocument, texts: string[]) {
  const used = new Set(doc.elements.filter(e => e.kind === "text").map(e => e.fontFamily));
  await Promise.all([
    ...(doc.fonts ?? []).filter(f => used.has(f.family)).map(ensureCustomFont),
    ...(texts.some(hasEmoji) ? [ensureEmojiFont()] : []),
  ]);
}
export const canvasFont = (family: string, size: number, bold: boolean) =>
  `${bold ? "700" : "400"} ${size}px "${family}", "${emojiFamily}", "Segoe UI Symbol", sans-serif`;
