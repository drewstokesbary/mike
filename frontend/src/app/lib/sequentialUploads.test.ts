import { describe, expect, it, vi } from "vitest";
import {
    uploadFilesSequentially,
    uploadFilesSequentiallySettled,
} from "./sequentialUploads";

const files = [new File(["a"], "a.docx"), new File(["b"], "b.docx")];

describe("sequential uploads", () => {
    it("does not start the next upload until the prior upload finishes", async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const upload = vi.fn(async (file: File) => {
            events.push(`${file.name}:start`);
            if (file.name === "a.docx") await firstGate;
            events.push(`${file.name}:end`);
            return file.name;
        });

        const pending = uploadFilesSequentially(files, upload);
        await Promise.resolve();
        expect(events).toEqual(["a.docx:start"]);
        releaseFirst();
        await expect(pending).resolves.toEqual(["a.docx", "b.docx"]);
        expect(events).toEqual([
            "a.docx:start",
            "a.docx:end",
            "b.docx:start",
            "b.docx:end",
        ]);
    });

    it("continues after a failed upload when settled results are requested", async () => {
        const results = await uploadFilesSequentiallySettled(files, async (file) => {
            if (file.name === "a.docx") throw new Error("failed");
            return file.name;
        });

        expect(results.map((result) => result.status)).toEqual([
            "rejected",
            "fulfilled",
        ]);
    });
});
