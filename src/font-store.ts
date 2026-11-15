import { fontBytes, parseFonts, type CustomFont } from "./font-types";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ezpz-label-studio.fonts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("fonts", { keyPath: "family" });
    request.onerror = () => reject(Error("Font storage could not open. Your existing fonts have not been changed."));
    request.onblocked = () => reject(Error("Close other app windows and try adding fonts again."));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function listCustomFonts(): Promise<CustomFont[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("fonts").objectStore("fonts").getAll();
      request.onsuccess = () => {
        try { resolve(request.result.flatMap(font => parseFonts([font]))); } catch (error) { reject(error); }
      };
      request.onerror = () => reject(Error("Your saved fonts could not be read."));
    });
  } finally { db.close(); }
}
export async function saveCustomFonts(fonts: CustomFont[]): Promise<CustomFont[]> {
  const validated = fonts.flatMap(font => parseFonts([font]));
  const db = await open();
  try {
    return await new Promise<CustomFont[]>((resolve, reject) => {
      const tx = db.transaction("fonts", "readwrite");
      let merged: CustomFont[] = [];
      let reason = "There is not enough local space to save these fonts. Your existing fonts have not been changed.";
      tx.oncomplete = () => resolve(merged);
      tx.onabort = tx.onerror = () => reject(Error(reason));
      const store = tx.objectStore("fonts");
      // Merge inside one transaction so another app window cannot lose fonts.
      store.getAll().onsuccess = event => {
        try {
          const existing = (event.target as IDBRequest<CustomFont[]>).result;
          merged = [...new Map([...existing, ...validated].map(f => [f.family, f])).values()];
          if (merged.length > 20 || merged.reduce((sum, f) => sum + fontBytes(f.data).length, 0) > 20_000_000)
            throw Error("Your font library can hold up to 20 fonts totaling 20 MB.");
          validated.forEach(font => store.put(font));
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
          tx.abort();
        }
      };
    });
  } finally { db.close(); }
}
