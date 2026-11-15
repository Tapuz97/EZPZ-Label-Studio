// RFID contains a roll SKU, not dimensions. This starter roll is bundled;
// other rolls require a validated manufacturer catalog match, never a guess.
export type PrinterStock = {
  widthMm: number;
  heightMm: number;
  source:
    | "offline stock catalog"
    | "cached manufacturer catalog"
    | "manufacturer catalog";
};
const bundled = new Map<string, PrinterStock>([
  ["02282280", { widthMm: 30, heightMm: 15, source: "offline stock catalog" }],
]);
const catalog = new Map<string, PrinterStock>();
const pending = new Map<string, Promise<PrinterStock | null>>();
const cacheKey = "ezpz-printer-stock-catalog-v1";
const cacheLimit = 32;
const endpoint =
  "https://print.niimbot.com/api/template/getCloudTemplateByOneCode";
let hydrated = false;

function validCode(code: unknown): code is string {
  return (
    typeof code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validatedSize(
  data: unknown,
  code: string,
): Omit<PrinterStock, "source"> | null {
  if (!record(data) || data.barcode !== code || data.paperType !== 1)
    return null;
  const width = data.width,
    height = data.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 10 ||
    height < 10 ||
    width > 100 ||
    height > 100 ||
    Math.min(width, height) > 15
  )
    return null;
  return { widthMm: width, heightMm: height };
}
function remember(code: string, stock: PrinterStock) {
  catalog.delete(code);
  catalog.set(code, stock);
  while (catalog.size > cacheLimit)
    catalog.delete(catalog.keys().next().value!);
}
function persist() {
  try {
    globalThis.localStorage?.setItem(
      cacheKey,
      JSON.stringify({
        version: 1,
        entries: [...catalog].map(([barcode, size]) => ({
          barcode,
          width: size.widthMm,
          height: size.heightMm,
          paperType: 1,
        })),
      }),
    );
  } catch {
    /* Denied/full storage does not prevent using the result. */
  }
}
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = globalThis.localStorage?.getItem(cacheKey);
    if (!raw || raw.length > 32768) return;
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.entries))
      return;
    for (const entry of saved.entries.slice(-cacheLimit)) {
      if (
        !record(entry) ||
        !validCode(entry.barcode) ||
        bundled.has(entry.barcode)
      )
        continue;
      const size = validatedSize(entry, entry.barcode);
      if (size)
        remember(entry.barcode, {
          ...size,
          source: "cached manufacturer catalog",
        });
    }
    // Strip unrelated fields and enforce the bound even on imported cache data.
    persist();
  } catch {
    /* Corrupt/denied storage is an empty cache. */
  }
}

/** Synchronous, local-only lookup for an identified original D110. */
export function stockForPrinter(
  connection: {
    protocol?: string;
    capabilities?: { stockCode?: string; modelId?: number };
  } | null,
): PrinterStock | null {
  if (
    connection?.protocol !== "niimbot" ||
    connection.capabilities?.modelId !== 2304
  )
    return null;
  hydrate();
  const code = connection.capabilities.stockCode ?? "";
  return bundled.get(code) ?? catalog.get(code) ?? null;
}

/** Send only the SKU, with no account, RFID UID, serial, address or artwork. */
export async function lookupStock(
  stockCode: string,
): Promise<PrinterStock | null> {
  if (!validCode(stockCode)) return null;
  hydrate();
  const local = bundled.get(stockCode) ?? catalog.get(stockCode);
  if (local) return local;
  const existing = pending.get(stockCode);
  if (existing) return existing;
  const request = (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
            "niimbot-user-agent": "AppVersionName/999.0.0",
          },
          body: JSON.stringify({ oneCode: stockCode }),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        if (!record(body) || body.code !== 1) return null;
        return validatedSize(body.data, stockCode);
      })().catch(() => null);
      const size = await Promise.race([
        operation,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(null);
          }, 2500);
        }),
      ]);
      if (!size) return null;
      const result: PrinterStock = { ...size, source: "manufacturer catalog" };
      remember(stockCode, result);
      persist();
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  pending.set(stockCode, request);
  try {
    return await request;
  } finally {
    pending.delete(stockCode);
  }
}
