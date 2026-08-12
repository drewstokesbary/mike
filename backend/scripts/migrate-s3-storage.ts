import "dotenv/config";
import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

type Side = "SOURCE" | "DESTINATION";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function storage(side: Side) {
  const prefix = `${side}_STORAGE_`;
  const bucket = required(`${prefix}BUCKET_NAME`);
  return {
    bucket,
    client: new S3Client({
      endpoint: required(`${prefix}ENDPOINT_URL`),
      region: required(`${prefix}REGION`),
      forcePathStyle: true,
      credentials: {
        accessKeyId: required(`${prefix}ACCESS_KEY_ID`),
        secretAccessKey: required(`${prefix}SECRET_ACCESS_KEY`),
      },
    }),
  };
}

async function listAll(client: S3Client, bucket: string) {
  const objects: { key: string; size: number }[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents ?? []) {
      if (object.Key) objects.push({ key: object.Key, size: object.Size ?? 0 });
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const source = storage("SOURCE");
  const destination = storage("DESTINATION");
  const sourceObjects = await listAll(source.client, source.bucket);
  console.log(`Source contains ${sourceObjects.length} objects.`);

  for (const [index, object] of sourceObjects.entries()) {
    const sourceObject = await source.client.send(new GetObjectCommand({
      Bucket: source.bucket,
      Key: object.key,
    }));
    if (!sourceObject.Body) throw new Error(`Empty source body: ${object.key}`);
    const sourceBytes = await sourceObject.Body.transformToByteArray();
    await destination.client.send(new PutObjectCommand({
      Bucket: destination.bucket,
      Key: object.key,
      Body: sourceBytes,
      ContentType: sourceObject.ContentType,
      CacheControl: sourceObject.CacheControl,
      ContentDisposition: sourceObject.ContentDisposition,
      Metadata: sourceObject.Metadata,
    }));
    const destinationObject = await destination.client.send(new GetObjectCommand({
      Bucket: destination.bucket,
      Key: object.key,
    }));
    if (!destinationObject.Body) throw new Error(`Empty destination body: ${object.key}`);
    const destinationBytes = await destinationObject.Body.transformToByteArray();
    if (sha256(sourceBytes) !== sha256(destinationBytes)) {
      throw new Error(`SHA-256 mismatch: ${object.key}`);
    }
    console.log(`[${index + 1}/${sourceObjects.length}] verified ${object.key}`);
  }

  const destinationObjects = await listAll(destination.client, destination.bucket);
  const destinationByKey = new Map(destinationObjects.map((object) => [object.key, object.size]));
  const missing = sourceObjects.filter((object) => !destinationByKey.has(object.key));
  const sizeMismatches = sourceObjects.filter(
    (object) => destinationByKey.get(object.key) !== object.size,
  );
  if (missing.length || sizeMismatches.length) {
    throw new Error(
      `Verification failed: ${missing.length} missing, ${sizeMismatches.length} size mismatches`,
    );
  }
  console.log(
    `Verified ${sourceObjects.length} source keys in destination; source was not modified.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
