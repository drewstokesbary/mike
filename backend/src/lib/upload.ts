import type { RequestHandler } from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_MB = Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
);

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).slice(0, 16);
      callback(null, `mike-upload-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
});

export function singleFileUpload(fieldName: string): RequestHandler {
  return (req, res, next) => {
    diskUpload.single(fieldName)(req, res, (err) => {
      if (!err) {
        const temporaryPath = req.file?.path;
        if (temporaryPath) {
          let cleaned = false;
          const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            void fs.unlink(temporaryPath).catch((cleanupError: NodeJS.ErrnoException) => {
              if (cleanupError.code !== "ENOENT") {
                console.error("[upload] failed to remove temporary file", {
                  temporaryPath,
                  error: cleanupError,
                });
              }
            });
          };
          res.once("finish", cleanup);
          res.once("close", cleanup);
        }
        return next();
      }

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return void res.status(413).json({
            detail: `File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`,
          });
        }
        return void res.status(400).json({
          detail: `Upload failed: ${err.message}`,
        });
      }

      return next(err);
    });
  };
}

/**
 * Read a multipart upload regardless of whether it came from the production
 * disk-backed middleware or an in-memory file supplied by a focused test.
 */
export async function readUploadedFile(file: Express.Multer.File): Promise<Buffer> {
  if (file.buffer) return file.buffer;
  if (!file.path) throw new Error("Uploaded file has no temporary path");
  return fs.readFile(file.path);
}
