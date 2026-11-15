import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stock: typeof import("./printer-stock");
let values: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};
const key = "ezpz-printer-stock-catalog-v1";
const connection = (
  stockCode: string,
  modelId = 2304,
  protocol = "niimbot",
) => ({ protocol, capabilities: { stockCode, modelId } });
const answer = (barcode = "12345678", patch: Record<string, unknown> = {}) => ({
  code: 1,
  data: { barcode, width: 30, height: 15, paperType: 1, ...patch },
});
function fetchAnswer(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}
beforeEach(async () => {
  vi.resetModules();
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("fetch", fetchAnswer(answer()));
  stock = await import("./printer-stock");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("safe manufacturer roll size lookup", () => {
  it("uses the bundled roll without network only for exact original D110", async () => {
    expect(stock.stockForPrinter(connection("02282280"))).toEqual({
      widthMm: 30,
      heightMm: 15,
      source: "offline stock catalog",
    });
    expect(await stock.lookupStock("02282280")).toMatchObject({
      source: "offline stock catalog",
    });
    expect(fetch).not.toHaveBeenCalled();
    for (const code of ["", "unknown", "__proto__", "022822800"])
      expect(stock.stockForPrinter(connection(code))).toBeNull();
    for (const model of [2305, 2320])
      expect(stock.stockForPrinter(connection("02282280", model))).toBeNull();
    expect(
      stock.stockForPrinter(connection("02282280", 2304, "zpl")),
    ).toBeNull();
    expect(
      stock.stockForPrinter({
        protocol: "niimbot",
        capabilities: { stockCode: "02282280" },
      }),
    ).toBeNull();
  });
  it("sends only SKU, matches response, strips private/assets fields and caches dimensions", async () => {
    const fetcher = fetchAnswer(
      answer("12345678", {
        uid: "DO_NOT_KEEP",
        serial: "DO_NOT_KEEP",
        previewImageUrl: "https://invalid.example/image.png",
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const found = await stock.lookupStock("12345678");
    expect(found).toEqual({
      widthMm: 30,
      heightMm: 15,
      source: "manufacturer catalog",
    });
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://print.niimbot.com/api/template/getCloudTemplateByOneCode",
    );
    expect(options).toMatchObject({
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "niimbot-user-agent": "AppVersionName/999.0.0",
      },
    });
    expect(JSON.parse(options.body as string)).toEqual({ oneCode: "12345678" });
    expect(stock.stockForPrinter(connection("12345678"))).toEqual(found);
    expect(await stock.lookupStock("12345678")).toEqual(found);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(values.get(key)!)).toEqual({
      version: 1,
      entries: [{ barcode: "12345678", width: 30, height: 15, paperType: 1 }],
    });
    vi.resetModules();
    const reopened = await import("./printer-stock");
    expect(reopened.stockForPrinter(connection("12345678"))).toEqual({
      widthMm: 30,
      heightMm: 15,
      source: "cached manufacturer catalog",
    });
    expect(await reopened.lookupStock("12345678")).toMatchObject({
      source: "cached manufacturer catalog",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("loads only validated cache and discards unrelated fields", () => {
    values.set(
      key,
      JSON.stringify({
        version: 1,
        entries: [
          {
            barcode: "12345678",
            width: 15,
            height: 50,
            paperType: 1,
            serial: "discard",
          },
          { barcode: "bad", width: 99, height: 99, paperType: 1 },
          { barcode: "bad2", width: 30, height: 15, paperType: 2 },
        ],
      }),
    );
    expect(stock.stockForPrinter(connection("12345678"))).toEqual({
      widthMm: 15,
      heightMm: 50,
      source: "cached manufacturer catalog",
    });
    expect(stock.stockForPrinter(connection("bad"))).toBeNull();
    expect(stock.stockForPrinter(connection("bad2"))).toBeNull();
    expect(values.get(key)).not.toContain("discard");
  });
  it.each([
    "{broken",
    JSON.stringify({
      version: 0,
      entries: [{ barcode: "12345678", width: 30, height: 15, paperType: 1 }],
    }),
  ])("ignores unusable cache: %s", (saved) => {
    values.set(key, saved);
    expect(stock.stockForPrinter(connection("12345678"))).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { code: 0, data: answer().data },
    { code: "1", data: answer().data },
    answer("87654321"),
    answer("12345678", { width: "30" }),
    answer("12345678", { width: NaN }),
    answer("12345678", { height: Infinity }),
    answer("12345678", { width: 101 }),
    answer("12345678", { width: 9 }),
    answer("12345678", { height: 9 }),
    answer("12345678", { height: 101 }),
    answer("12345678", { width: 30, height: 30 }),
    answer("12345678", { paperType: 2 }),
    answer("12345678", { paperType: "1" }),
  ])(
    "rejects invalid/unmatched response without remembering it: %o",
    async (body) => {
      vi.stubGlobal("fetch", fetchAnswer(body));
      expect(await stock.lookupStock("12345678")).toBeNull();
      expect(stock.stockForPrinter(connection("12345678"))).toBeNull();
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );
  it("treats offline, HTTP and JSON errors as nonfatal without retries", async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw Error("offline");
      }),
      vi.fn(async () => ({ ok: false, json: async () => answer() })),
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw Error("invalid JSON");
        },
      })),
    ]) {
      vi.stubGlobal("fetch", fetcher);
      expect(await stock.lookupStock("12345678")).toBeNull();
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("bounds stalled JSON parsing, aborts and never caches late results", async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = stock.lookupStock("12345678");
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toBeNull();
    const options = (
      fetcher.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(options.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    complete(answer());
    await Promise.resolve();
    await Promise.resolve();
    expect(stock.stockForPrinter(connection("12345678"))).toBeNull();
  });
  it("deduplicates concurrent lookup and tolerates blocked/full storage", async () => {
    storage.getItem.mockImplementation(() => {
      throw Error("denied");
    });
    storage.setItem.mockImplementation(() => {
      throw Error("full");
    });
    const [a, b] = await Promise.all([
      stock.lookupStock("12345678"),
      stock.lookupStock("12345678"),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ source: "manufacturer catalog" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("bounds cached manufacturer entries to32", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => ({
        ok: true,
        json: async () => answer(JSON.parse(options.body as string).oneCode),
      })),
    );
    for (let index = 0; index < 34; index++)
      await stock.lookupStock(String(10000000 + index));
    const saved = JSON.parse(values.get(key)!);
    expect(saved.entries).toHaveLength(32);
    expect(stock.stockForPrinter(connection("10000000"))).toBeNull();
    expect(stock.stockForPrinter(connection("10000033"))).not.toBeNull();
    expect(saved.entries[0].barcode).toBe("10000002");
  });
  it.each([
    "",
    "__proto__",
    "has space",
    "bad/code",
    "x".repeat(65),
    "\u0000bad",
  ])("does not fetch invalid SKU %s", async (code) => {
    expect(await stock.lookupStock(code)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
