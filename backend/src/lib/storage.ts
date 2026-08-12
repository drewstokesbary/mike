/** S3-compatible storage utilities for Mike document management. */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import * as S3Commands from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";

const GetObjectCommand = (S3Commands as any).GetObjectCommand;

let cachedClient: S3Client | undefined;

export type StorageConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
};

/** Prefer provider-neutral names, with R2 variables as a legacy fallback. */
export function resolveStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig | null {
  const endpoint = env.STORAGE_ENDPOINT_URL || env.R2_ENDPOINT_URL || "";
  const accessKeyId = env.STORAGE_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey =
    env.STORAGE_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || "";
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket: env.STORAGE_BUCKET_NAME || env.R2_BUCKET_NAME || "mike",
    region: env.STORAGE_REGION || env.R2_REGION || "auto",
  };
}

function getClient(): S3Client {
  if (!cachedClient) {
    const config = resolveStorageConfig();
    if (!config) throw new Error("S3-compatible storage is not configured");
    cachedClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return cachedClient;
}

const storageConfig = resolveStorageConfig();
const BUCKET = storageConfig?.bucket ?? "mike";

export const storageEnabled = storageConfig !== null;

function requireStorageConfig(): void {
  if (!storageEnabled) {
    throw new Error(
      "Set STORAGE_ENDPOINT_URL, STORAGE_ACCESS_KEY_ID, and STORAGE_SECRET_ACCESS_KEY (or the legacy R2 equivalents)",
    );
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  requireStorageConfig();
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(content),
      ContentType: contentType,
    }),
  );
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  if (!storageEnabled) return null;
  try {
    const client = getClient();
    const response = (await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    )) as any;
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function listFiles(prefix: string): Promise<string[]> {
  if (!storageEnabled) return [];
  const client = getClient();
  const keys: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken,
      }),
    );
    for (const item of response.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    ContinuationToken = response.NextContinuationToken;
  } while (ContinuationToken);
  return keys;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
  if (!storageEnabled) return;
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ---------------------------------------------------------------------------
// Signed URL (pre-signed for temporary direct access)
// ---------------------------------------------------------------------------

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  if (!storageEnabled) return null;
  try {
    const client = getClient();
    // Override the response Content-Disposition so the browser uses this
    // filename on download, instead of the last path segment of the R2 key
    // (which includes the document UUID). The `download` attribute on <a>
    // is ignored for cross-origin URLs, so we have to set it server-side.
    const responseContentDisposition = downloadFilename
      ? buildContentDisposition("attachment", downloadFilename)
      : undefined;
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    }) as any;
    return await awsGetSignedUrl(client, command, { expiresIn });
  } catch {
    return null;
  }
}

export function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || "download";
  return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name)
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
}

export function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildContentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

export function storageKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

export function pdfStorageKey(
  userId: string,
  docId: string,
  stem: string,
): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}

export function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

export function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
