import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async () => ({ bytesSent: 100 })),
}));
import { invoke } from "@tauri-apps/api/core";
import { printerCommand } from "./printer-command";
describe("native print bridge", () => {
  it("transfers packed monochrome rows instead of RGBA and keeps the print metadata", async () => {
    const rgba = new Uint8ClampedArray(80 * 80 * 4).fill(255);
    rgba.fill(0, 0, 3);
    await printerCommand("print_label", {
      job: {
        widthMm: 10,
        heightMm: 10,
        gapMm: 2,
        dpi: 203,
        copies: 1,
        density: 8,
        rgba,
        widthPx: 80,
        heightPx: 80,
        threshold: 128,
        protocol: "zpl",
      },
    });
    const [command, args] = vi.mocked(invoke).mock.calls.at(-1)!;
    expect(command).toBe("print_raster");
    const job = (args as { job: Record<string, unknown> }).job;
    expect(job).not.toHaveProperty("rgba");
    expect(job.raster).toHaveLength(800);
    expect((job.raster as number[])[0]).toBe(128);
    expect(job).toMatchObject({
      widthMm: 10,
      dpi: 203,
      copies: 1,
      protocol: "zpl",
    });
    expect(rgba.length / (job.raster as number[]).length).toBe(32);
  });
});
