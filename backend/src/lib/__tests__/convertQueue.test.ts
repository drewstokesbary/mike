import { describe, expect, it } from "vitest";
import { runWithLibreOfficeConversionLock } from "../convert";

describe("LibreOffice conversion lock", () => {
  it("runs conversion work one task at a time and preserves queue order", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runWithLibreOfficeConversionLock(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return 1;
    });
    const second = runWithLibreOfficeConversionLock(async () => {
      events.push("second:start");
      events.push("second:end");
      return 2;
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("continues the queue after a failed conversion", async () => {
    const failed = runWithLibreOfficeConversionLock(async () => {
      throw new Error("conversion failed");
    });
    const next = runWithLibreOfficeConversionLock(async () => "converted");

    await expect(failed).rejects.toThrow("conversion failed");
    await expect(next).resolves.toBe("converted");
  });
});
